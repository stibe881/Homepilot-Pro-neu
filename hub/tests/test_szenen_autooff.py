"""Szenen, die sich nach einer Frist von selbst zurücknehmen."""

import asyncio
import time

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.scenes import restlaufzeit


class TestRestlaufzeit:
    def test_ohne_frist_keine_uhr(self) -> None:
        assert restlaufzeit(1000.0, 0, 2000.0) is None

    def test_die_uhr_rechnet_ab_dem_ausloesen(self) -> None:
        assert restlaufzeit(1000.0, 1800, 1600.0) == 1200.0

    def test_nach_dem_neustart_ist_abgelaufen_sofort(self) -> None:
        # Frist während des Neustarts verstrichen: 0, nicht negativ.
        assert restlaufzeit(1000.0, 60, 5000.0) == 0.0


async def test_scene_takes_itself_back_after_the_deadline(monkeypatch):
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        licht = hub.registry.get("demo.light_livingroom")
        await hub.integrations.dispatch_command(licht.id, "turn_off", {})
        hub.data.set(
            "scenes",
            [
                {
                    "id": "app_test",
                    "name": "Sternenhimmel",
                    "actions": [{"entity_id": licht.id, "command": "turn_on"}],
                    "toggles": True,
                    "auto_off": 1,
                }
            ],
        )
        hub.reload_scenes()

        await hub.scenes.activate("app_test")
        assert licht.state.get("state") == "on"
        assert hub.scenes.undo_fuer("app_test")

        # Die Frist (1 s) verstreichen lassen - die Uhr nimmt zurück.
        for _ in range(40):
            await asyncio.sleep(0.05)
            if not hub.scenes.undo_fuer("app_test"):
                break
        assert not hub.scenes.undo_fuer("app_test")
        assert licht.state.get("state") == "off"
    finally:
        await hub.stop()


async def test_manual_revert_stops_the_clock():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        licht = hub.registry.get("demo.light_livingroom")
        await hub.integrations.dispatch_command(licht.id, "turn_off", {})
        hub.data.set(
            "scenes",
            [
                {
                    "id": "app_test",
                    "name": "Sternenhimmel",
                    "actions": [{"entity_id": licht.id, "command": "turn_on"}],
                    "toggles": True,
                    "auto_off": 3600,
                }
            ],
        )
        hub.reload_scenes()
        await hub.scenes.activate("app_test")
        assert "app_test" in hub.scenes._uhren
        await hub.scenes.revert("app_test")
        assert "app_test" not in hub.scenes._uhren
    finally:
        await hub.stop()


async def test_clock_survives_a_reload_like_a_restart():
    """Der Neustart-Fall: load() findet den Rückweg auf der Platte und
    stellt die Uhr neu - gerechnet ab dem damaligen Auslösen."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        licht = hub.registry.get("demo.light_livingroom")
        hub.data.set(
            "scenes",
            [
                {
                    "id": "app_test",
                    "name": "Sternenhimmel",
                    "actions": [{"entity_id": licht.id, "command": "turn_on"}],
                    "toggles": True,
                    "auto_off": 3600,
                }
            ],
        )
        # Ein Rückweg von «vorhin» liegt schon da - wie nach einem Neustart.
        hub.data.set(
            "scene_undo",
            [
                {
                    "scene": "app_test",
                    "at": time.time() - 60,
                    "commands": [{"entity_id": licht.id, "command": "turn_off"}],
                }
            ],
        )
        hub.reload_scenes()
        assert "app_test" in hub.scenes._uhren
    finally:
        await hub.stop()
