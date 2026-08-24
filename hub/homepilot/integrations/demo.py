"""Virtuelle Geräte zum Entwickeln der App und Testen von Automationen.

Konfiguration:
  - integration: demo
"""

from __future__ import annotations

import asyncio
import random
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.integration import Integration


class DemoIntegration(Integration):
    name = "demo"

    async def setup(self) -> None:
        await self.add_entity(
            "light_livingroom",
            EntityKind.LIGHT,
            "Licht Wohnzimmer",
            state={"state": "off", "brightness": 100},
            commands=["turn_on", "turn_off", "toggle", "set_brightness"],
        )
        await self.add_entity(
            "light_bedroom",
            EntityKind.LIGHT,
            "Licht Schlafzimmer",
            state={"state": "off", "brightness": 60},
            commands=["turn_on", "turn_off", "toggle", "set_brightness"],
        )
        await self.add_entity(
            "switch_coffee",
            EntityKind.SWITCH,
            "Kaffeemaschine",
            state={"state": "off"},
            commands=["turn_on", "turn_off", "toggle"],
        )
        await self.add_entity(
            "motion_hall",
            EntityKind.BINARY_SENSOR,
            "Bewegung Flur",
            state={"state": "off"},
            # Manuell schaltbar, um Automationen aus der App zu testen.
            commands=["turn_on", "turn_off", "toggle"],
        )
        await self.add_entity(
            "smoke_hall",
            EntityKind.BINARY_SENSOR,
            "Rauchmelder Flur",
            # Mit schwacher Batterie: Ohne ein solches Gerät liess sich die
            # Batterienliste samt Quittieren nie ansehen.
            state={"state": "off", "device_class": "smoke", "low_battery": True},
        )
        await self.add_entity(
            "window_kitchen",
            EntityKind.BINARY_SENSOR,
            "Fenster Küche",
            state={"state": "off", "device_class": "contact", "battery": 62},
        )
        await self.add_entity(
            "temp_livingroom",
            EntityKind.SENSOR,
            "Temperatur Wohnzimmer",
            state={"state": 21.5, "unit": "°C"},
        )
        # Eine Box, wie ein Chromecast eine ist: Sie nimmt eine Tonadresse
        # entgegen. Ohne sie liessen sich Durchsage und Radio im Browser
        # nicht ansehen – beides braucht ein Gerät, das `play_url` kann.
        await self.add_entity(
            "speaker_kitchen",
            EntityKind.MEDIA_PLAYER,
            "Küche Lautsprecher",
            state={"state": "idle", "volume": 35},
            commands=[
                "play", "pause", "toggle", "set_volume", "mute", "play_url",
            ],
        )
        # Eine Quelle mit eigener Auswahl, wie Spotify eine ist. Ohne sie
        # liess sich weder das Playlist-Panel ansehen noch die Quellenwahl
        # im Musikplayer – für beides braucht es ein Konto, das im
        # Demo-Haus niemand hat.
        await self.add_entity(
            "music",
            EntityKind.MEDIA_PLAYER,
            "Musikdienst",
            state={
                "state": "idle",
                "playlists": ["Morgen", "Küche", "Konzentration", "Party"],
                "devices": ["Küche Lautsprecher"],
                "device": None,
                "volume": 30,
            },
            commands=[
                "play", "pause", "toggle", "next", "previous", "play_on",
                "set_volume", "mute", "play_playlist", "shuffle", "repeat",
            ],
        )
        # Ein Cast-Fernseher: dieselben Befehle wie die Box, aber ein Bild
        # daran. Ohne ihn war der Fehler unsichtbar, dass die Startseite
        # ihn für eine Musikbox hielt – im Demo-Haus stand schlicht kein
        # Fernseher.
        await self.add_entity(
            "tv_livingroom",
            EntityKind.MEDIA_PLAYER,
            "Wohnzimmer TV",
            state={"state": "idle", "volume": 20, "has_screen": True},
            commands=[
                "play", "pause", "toggle", "set_volume", "mute", "play_url",
            ],
        )
        # Eine Lichtszene wie die einer Hue-Bridge: ein Knopf, kein Regler.
        # Ohne sie liesse sich die Szenen-Auswahl der App nicht ansehen,
        # ohne eine echte Bridge im Netz zu haben.
        await self.add_entity(
            "scene_relax",
            EntityKind.SCENE,
            "Entspannen",
            state={"state": "idle", "scene": "Entspannen"},
            commands=["activate"],
        )
        self.start_task(self._temperature_drift())

    async def _temperature_drift(self) -> None:
        rng = random.Random()
        entity_id = self.entity_id("temp_livingroom")
        while True:
            await asyncio.sleep(15)
            entity = self.hub.registry.get(entity_id)
            if entity is None:
                return
            current = float(entity.state.get("state", 21.0))
            drift = rng.uniform(-0.3, 0.3)
            value = round(min(28.0, max(17.0, current + drift)), 1)
            await self.hub.registry.update_state(entity_id, {"state": value})

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        changes: dict[str, Any] = {}
        if command == "turn_on":
            changes["state"] = "on"
        elif command == "turn_off":
            changes["state"] = "off"
        elif command == "toggle":
            # Eine Box kippt zwischen «spielt» und «pausiert», eine Lampe
            # zwischen an und aus. Derselbe Knopf, zwei Vokabeln – die
            # App liest sie beide aus `state`.
            if entity.kind == EntityKind.MEDIA_PLAYER:
                changes["state"] = (
                    "paused" if entity.state.get("state") == "playing" else "playing"
                )
            else:
                changes["state"] = "off" if entity.state.get("state") == "on" else "on"
        elif command == "play":
            changes["state"] = "playing"
        elif command == "pause":
            changes["state"] = "paused"
        elif command == "play_playlist":
            changes["state"] = "playing"
            changes["playlist"] = str(data.get("name") or "")
            changes["track"] = str(data.get("name") or "")
            if data.get("device"):
                changes["device"] = str(data["device"])
        elif command == "play_on":
            changes["device"] = str(data.get("device") or "")
        elif command == "play_url":
            # Der Chromecast startet dafür den «Default Media Receiver» –
            # daran erkennt das Radio später, ob noch es selbst läuft.
            changes["state"] = "playing"
            changes["app"] = "Default Media Receiver"
            changes["track"] = str(data.get("url") or "")
        elif command == "set_volume":
            changes["volume"] = max(0, min(100, int(data.get("volume", 0))))
        elif command == "activate":
            # Eine Szene gilt, bis jemand eines ihrer Lichter anfasst. Das
            # nachzubilden wäre hier Aufwand ohne Ertrag – sie bleibt an.
            changes["state"] = "active"
        elif command == "set_brightness":
            changes["brightness"] = max(0, min(100, int(data.get("brightness", 100))))
            changes["state"] = "on" if changes["brightness"] > 0 else "off"
        if "brightness" in data and command == "turn_on":
            changes["brightness"] = max(0, min(100, int(data["brightness"])))
        if changes:
            await self.hub.registry.update_state(entity.id, changes)


INTEGRATION = DemoIntegration
