"""Virtuelle Geräte zum Entwickeln der App und Testen von Automationen.

Konfiguration:
  - integration: demo
"""

from __future__ import annotations

import asyncio
import random
import time
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
                "play", "pause", "toggle", "turn_off", "set_volume", "mute",
                "play_url",
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
                "play", "pause", "toggle", "turn_off", "next", "previous",
                "play_on", "set_volume", "mute", "play_playlist", "shuffle",
                "repeat",
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
            # Wie ein Android TV: Er meldet die laufende App (und nur die),
            # kennt Apps, Steuerkreuz und Einschlaf-Timer, und die
            # Lautstärke lässt sich nur schrittweise ändern. Vorher stand
            # hier eine Box mit Bildschirm - an ihr liess sich die
            # Fernsehkachel nicht ansehen, ohne einen echten Fernseher im
            # Netz zu haben.
            state={
                "state": "on",
                "app": "Plex",
                "track": "Plex",
                "volume": 20,
                "has_screen": True,
                "apps": [
                    {"name": "Plex", "app": "com.plexapp.android"},
                    {"name": "Zattoo", "app": "com.zattoo.player"},
                    {"name": "YouTube", "app": "com.google.android.youtube.tv"},
                    {"name": "Netflix", "app": "com.netflix.ninja"},
                ],
            },
            commands=[
                "play", "pause", "next", "previous", "toggle",
                "turn_on", "turn_off", "mute", "volume_up", "volume_down",
                "launch_app", "sleep_timer", "play_url",
                "dpad_up", "dpad_down", "dpad_left", "dpad_right", "ok",
                "home", "back",
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
            # Eine Box wird nicht «off», sie wird leer: Der Empfänger ist
            # frei, es läuft nichts mehr. «off» wäre die Vokabel einer
            # Lampe - eine Kachel, die «Aus» statt «Nichts läuft» sagt,
            # liest sich falsch.
            if entity.kind == EntityKind.MEDIA_PLAYER and not entity.state.get("has_screen"):
                changes["state"] = "idle"
                # Ausdrücklich None: Der Zustand wird verschmolzen, ein
                # weggelassenes Feld behielte seinen alten Wert.
                changes["track"] = None
                changes["artist"] = None
                changes["image"] = None
            else:
                changes["state"] = "off"
        elif command == "toggle":
            # Eine Box kippt zwischen «spielt» und «pausiert», eine Lampe
            # zwischen an und aus. Derselbe Knopf, zwei Vokabeln – die
            # App liest sie beide aus `state`.
            if entity.kind == EntityKind.MEDIA_PLAYER and entity.state.get("has_screen"):
                # Am Fernseher ist der Knopf unten auf der Kachel der
                # Netzschalter, nicht Pause - wie beim echten Android TV.
                aus = entity.state.get("state") != "off"
                changes["state"] = "off" if aus else "on"
                # Ein dunkler Fernseher meldet keine App mehr. Ausdrücklich
                # None: Der Zustand wird verschmolzen, ein weggelassenes
                # Feld behielte seinen alten Wert (core/registry.py).
                changes["app"] = None if aus else "Plex"
                changes["track"] = changes["app"]
                if aus:
                    changes["sleep_until"] = None
            elif entity.kind == EntityKind.MEDIA_PLAYER:
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
        elif command in ("volume_up", "volume_down"):
            # Der Fernseher nimmt keinen Zielwert entgegen, nur Schritte -
            # daran hängt, dass die Kachel Knöpfe statt eines Schiebers
            # zeigt (app/src/lib/fernsehkachel.ts).
            schritt = 5 if command == "volume_up" else -5
            stand = int(entity.state.get("volume") or 0)
            changes["volume"] = max(0, min(100, stand + schritt))
            changes["muted"] = False
        elif command == "mute":
            changes["muted"] = not entity.state.get("muted")
        elif command == "launch_app":
            paket = str(data.get("app") or "")
            apps = entity.state.get("apps") or []
            name = next(
                (str(a.get("name")) for a in apps if str(a.get("app")) == paket), paket
            )
            # Ein Android TV meldet die laufende App als App *und* als
            # Titel - genau die Doppelung, um die es auf der Kachel geht.
            changes.update({"state": "on", "app": name, "track": name})
        elif command == "sleep_timer":
            minuten = int(data.get("minutes") or 0)
            changes["sleep_until"] = time.time() + minuten * 60 if minuten > 0 else None
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
