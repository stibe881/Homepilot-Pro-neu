"""Szenen, die sich nach einer Frist von selbst ausschalten."""

import asyncio
import time

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.scenes import restlaufzeit
from homepilot.core.szenenrueckweg import aus_befehle


class TestRestlaufzeit:
    def test_ohne_frist_keine_uhr(self) -> None:
        assert restlaufzeit(1000.0, 0, 2000.0) is None

    def test_die_uhr_rechnet_ab_dem_ausloesen(self) -> None:
        assert restlaufzeit(1000.0, 1800, 1600.0) == 1200.0

    def test_nach_dem_neustart_ist_abgelaufen_sofort(self) -> None:
        # Frist während des Neustarts verstrichen: 0, nicht negativ.
        assert restlaufzeit(1000.0, 60, 5000.0) == 0.0


async def test_scene_switches_off_after_the_deadline(monkeypatch):
    """Nach der Frist geht alles *aus*, was die Szene verändert hat -
    nicht zurück in den vorherigen Zustand: Der Sternenhimmel soll um
    20:15 dunkel sein, auch wenn das Licht vor der Szene an war."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        licht = hub.registry.get("demo.light_livingroom")
        # Vorher AN - ein Zurückstellen liesse das Licht wieder brennen.
        await hub.integrations.dispatch_command(licht.id, "turn_on", {})
        await hub.integrations.dispatch_command(licht.id, "set_brightness", {"brightness": 80})
        hub.data.set(
            "scenes",
            [
                {
                    "id": "app_test",
                    "name": "Sternenhimmel",
                    "actions": [
                        {"entity_id": licht.id, "command": "set_brightness", "data": {"brightness": 20}}
                    ],
                    "toggles": True,
                    "auto_off": 1,
                }
            ],
        )
        hub.reload_scenes()

        await hub.scenes.activate("app_test")
        assert licht.state.get("brightness") == 20
        assert hub.scenes.undo_fuer("app_test")

        # Die Frist (1 s) verstreichen lassen - die Uhr nimmt zurück.
        for _ in range(40):
            await asyncio.sleep(0.05)
            if not hub.scenes.undo_fuer("app_test"):
                break
        assert not hub.scenes.undo_fuer("app_test")
        # Aus - nicht zurück auf «an mit 80».
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


class TestAusBefehle:
    def test_je_geraet_der_passende_aus_befehl(self) -> None:
        geraete = {
            "licht": {"commands": ["turn_on", "turn_off"]},
            "box": {"commands": ["play", "pause"]},
            "store": {"commands": ["open", "close", "stop"]},
        }
        assert aus_befehle(["licht", "box", "store"], geraete) == [
            {"entity_id": "licht", "command": "turn_off"},
            {"entity_id": "box", "command": "pause"},
            {"entity_id": "store", "command": "stop"},
        ]

    def test_ohne_aus_befehl_bleibt_das_geraet_unangetastet(self) -> None:
        # Lieber ein Licht zu viel an als ein Befehl, den es nicht gibt.
        assert aus_befehle(["fuehler"], {"fuehler": {"commands": []}}) == []
        assert aus_befehle(["weg"], {}) == []

    def test_doppelte_zaehlen_einmal(self) -> None:
        geraete = {"licht": {"commands": ["turn_off"]}}
        assert len(aus_befehle(["licht", "licht"], geraete)) == 1

