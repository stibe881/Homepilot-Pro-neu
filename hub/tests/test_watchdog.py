"""Integrations-Wächter: Ausfall erkennen, melden, Entwarnung geben."""

import asyncio

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.watchdog import low_batteries, watched_entities
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
        entity = type(
            "E",
            (),
            {
                "id": "hue.lampe",
                "name": "Lampe",
                "integration": "hue",
                "available": False,
                "state": {},
            },
        )()
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


def test_only_alarm_sensors_are_watched_one_by_one():
    """Alles zu melden wäre Lärm – bei hundert Geräten ist immer eines
    kurz weg. Was die Alarmanlage bewacht, hat jemand bewusst als wichtig
    eingestuft."""
    def entity(entity_id: str, available: bool = True, low: bool | None = None):
        state = {} if low is None else {"low_battery": low}
        return type(
            "E",
            (),
            {
                "id": entity_id,
                "name": entity_id,
                "integration": "homematic",
                "available": available,
                "state": state,
            },
        )()

    entities = [entity("hm.rauchmelder"), entity("hm.lampe")]
    watched = watched_entities(entities, {"hm.rauchmelder"})
    assert [item.id for item in watched] == ["hm.rauchmelder"]
    assert watched_entities(entities, set()) == []


def test_low_batteries_are_found():
    def entity(entity_id: str, low: bool | None):
        state = {} if low is None else {"low_battery": low}
        return type("E", (), {"id": entity_id, "name": entity_id, "state": state})()

    entities = [entity("a", True), entity("b", False), entity("c", None)]
    assert [item.id for item in low_batteries(entities)] == ["a"]


async def test_a_weak_battery_is_reported_once():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None):
            sent.append((title, body))
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        melder = type(
            "E",
            (),
            {
                "id": "hm.rauchmelder",
                "name": "Rauchmelder Flur",
                "integration": "homematic",
                "available": True,
                "state": {"low_battery": True},
            },
        )()
        hub.registry.all = lambda: [melder]  # type: ignore[assignment]

        await hub.watchdog.check()
        assert any("Rauchmelder Flur" in title for title, _ in sent)
        # Zweite Runde: keine zweite Nachricht, sonst schweigt man sie tot.
        before = len(sent)
        await hub.watchdog.check()
        assert len(sent) == before

        # Nach dem Batteriewechsel wieder scharf für die nächste Warnung.
        melder.state = {"low_battery": False}
        await hub.watchdog.check()
        melder.state = {"low_battery": True}
        await hub.watchdog.check()
        assert len(sent) > before
    finally:
        await hub.stop()
