"""Ein Anlauf, der schiefgeht, ist nicht das Ende.

Der Fall aus dem Betrieb: Beim Neustart des Hubs antwortet die Ring-Cloud
nicht rechtzeitig. Bisher blieb die Türklingel damit bis zum nächsten
Neustart weg - und niemand startet den Hub neu, ohne es zu merken.
"""

import asyncio
import time

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.errors import ConfigError
from homepilot.core.hub import Hub
from homepilot.core.integration import Integration, IntegrationManager, is_permanent


def test_only_transient_failures_are_worth_repeating():
    """ConfigError heisst «so wird das nie etwas» – der Rest ist Wetter."""
    assert is_permanent(ConfigError("Bibliothek fehlt")) is True
    assert is_permanent(TimeoutError("api.ring.com")) is False
    assert is_permanent(ConnectionError("Netz weg")) is False


class _Wackelig(Integration):
    """Scheitert die ersten Male, dann klappt es."""

    name = "wackelig"
    versuche = 0
    scheitert_bis = 2

    async def setup(self) -> None:
        type(self).versuche += 1
        if type(self).versuche <= type(self).scheitert_bis:
            raise TimeoutError("Cloud antwortet nicht")


class _Kaputt(Integration):
    name = "kaputt"
    versuche = 0

    async def setup(self) -> None:
        type(self).versuche += 1
        raise ConfigError("Token-Datei fehlt")


@pytest.mark.asyncio
async def test_a_timeout_is_tried_again(monkeypatch):
    _Wackelig.versuche = 0
    monkeypatch.setattr(
        "homepilot.core.integration.load_integration_class", lambda name: _Wackelig
    )
    # Nicht wirklich fünf Minuten warten.
    monkeypatch.setattr("homepilot.core.integration.RETRY_SECONDS", 0)

    manager = IntegrationManager(hub=None)
    await manager.setup_all([{"integration": "wackelig"}])
    assert manager.status()["wackelig"]["ok"] is False

    # Dem Wiederanlauf Zeit geben, seine Runden zu drehen.
    for _ in range(50):
        await asyncio.sleep(0)
        if manager.get("wackelig") is not None:
            break
    assert manager.get("wackelig") is not None
    assert manager.status()["wackelig"]["ok"] is True
    assert _Wackelig.versuche == 3
    manager.stop_retries()


@pytest.mark.asyncio
async def test_a_broken_configuration_is_not_tried_again(monkeypatch):
    _Kaputt.versuche = 0
    monkeypatch.setattr(
        "homepilot.core.integration.load_integration_class", lambda name: _Kaputt
    )
    monkeypatch.setattr("homepilot.core.integration.RETRY_SECONDS", 0)

    manager = IntegrationManager(hub=None)
    await manager.setup_all([{"integration": "kaputt"}])
    for _ in range(50):
        await asyncio.sleep(0)
    assert _Kaputt.versuche == 1
    assert manager.status()["kaputt"]["ok"] is False
    assert "Token-Datei fehlt" in manager.status()["kaputt"]["error"]
    manager.stop_retries()


# ── Zeitlimit beim Start ───────────────────────────────────────────────────


async def test_a_hanging_integration_does_not_hold_up_the_hub(monkeypatch):
    """Eine Integration, die beim Verbinden hängt, blockiert nicht alles.

    Vorher wartete `setup_all` auf sie, und solange kein einziges Gerät im
    Haus reagierte. Jetzt bricht der Start nach dem Zeitlimit ab, die
    übrigen Integrationen kommen hoch, und der Wiederanlauf versucht es
    später erneut.
    """
    from homepilot.core import integration as integration_module

    # Im Test Sekundenbruchteile statt neunzig Sekunden.
    monkeypatch.setattr(integration_module, "SETUP_TIMEOUT", 0.05)

    class Haenger(integration_module.Integration):
        name = "haenger"

        async def setup(self) -> None:
            await asyncio.sleep(30)

    monkeypatch.setattr(
        integration_module, "load_integration_class", lambda name: Haenger
    )

    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    manager = integration_module.IntegrationManager(hub)
    begonnen = time.monotonic()
    await manager.setup_all([{"integration": "haenger"}])
    gedauert = time.monotonic() - begonnen

    # Es hat abgebrochen, nicht dreissig Sekunden gewartet.
    assert gedauert < 5
    assert "haenger" not in manager._integrations
    # Und die Meldung sagt, woran es lag - nicht bloss «TimeoutError».
    assert "nicht gemeldet" in manager.status()["haenger"]["error"]
    for task in list(getattr(manager, "_retry_task", None) and [manager._retry_task] or []):
        task.cancel()


def test_setup_error_explains_a_timeout():
    from homepilot.core.integration import setup_error

    text = setup_error("hue", TimeoutError())
    assert "hue" in text and "antwortet nicht" in text
    # Alles andere bleibt, wie es kam.
    assert setup_error("hue", ValueError("kein Schlüssel")) == "kein Schlüssel"
