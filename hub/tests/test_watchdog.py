"""Integrations-Wächter: Ausfall erkennen, melden, Entwarnung geben."""

import asyncio

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.watchdog import down_integrations


class _E:
    def __init__(self, integration, available):
        self.integration, self.available = integration, available


def test_down_integrations_pure():
    entities = [
        _E("hue", False), _E("hue", False),
        _E("ring", False), _E("ring", True),
        _E("demo", False),  # steht auf der Ignorier-Liste
    ]
    assert down_integrations(entities) == {"hue"}
    assert down_integrations([]) == set()


async def test_watchdog_meldet_ausfall_und_rueckkehr():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None):
            sent.append((title, body))
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        # 'hue' fällt komplett aus – zwei Runden Karenz, dann Meldung.
        entity = type("E", (), {"integration": "hue", "available": False})()
        hub.registry.all = lambda: [entity]  # type: ignore[assignment]
        await hub.watchdog.check()
        assert hub.watchdog.down_since == {}
        await hub.watchdog.check()
        assert "hue" in hub.watchdog.down_since
        assert sent and "hue" in sent[0][0]
        assert hub.watchdog.outages[0]["ended"] is None

        # Wieder erreichbar → Entwarnung, Ausfall abgeschlossen.
        entity.available = True
        await hub.watchdog.check()
        assert hub.watchdog.down_since == {}
        assert "wieder da" in sent[1][0]
        assert hub.watchdog.outages[0]["ended"] is not None
    finally:
        await hub.stop()
