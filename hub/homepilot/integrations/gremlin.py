"""Absichtlich unzuverlässige Geräte - zum Testen der Fehlerpfade.

Die Demo-Integration zeigt den Schönwetterfall; im Alltag geht es aber
gerade um die anderen Tage: Ein Funkgerät verstummt, eine Steckdose
schluckt jeden dritten Befehl, ein Sensor liefert plötzlich Unsinn. Ob
der Wächter meldet, der «verstummt»-Auslöser feuert und die App das
richtige Grau zeigt, liess sich bisher nur am echten Haus prüfen - indem
man wartete, bis wirklich etwas kaputt ging.

Der Gremlin macht kaputt, was man zum Prüfen braucht, und zwar planbar:

  - ``light_moody``  - schluckt jeden dritten Befehl (Fehler statt Antwort).
  - ``sensor_dropout`` - verschwindet regelmässig für eine Weile und kommt
    wieder (Erreichbarkeits-Flanken für Auslöser und Wächter).
  - ``sensor_wild``  - misst brav, liefert aber ab und zu einen Ausreisser.
  - ``tv_zappelig``  - meldet nach jedem Tastendruck seinen Zustand neu und
    sagt dazwischen kurz «aus», wie ein echter Android TV es tut.

Konfiguration:
  - integration: gremlin
    pace: 30        # Sekunden je Schritt (Vorgabe 30; Tests nehmen weniger)
    seed: 7         # optional, macht die Launen reproduzierbar

Bewusst neben der Demo statt in ihr: Wer nur Oberflächen baut, will keine
Geräte, die dabei ständig ausfallen.
"""

from __future__ import annotations

import asyncio
import random
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import HomePilotError
from ..core.integration import Integration


class GremlinIntegration(Integration):
    name = "gremlin"

    async def setup(self) -> None:
        self._pace = float(self.config.get("pace") or 30.0)
        self._rng = random.Random(self.config.get("seed"))
        self._commands_seen = 0
        await self.add_entity(
            "light_moody",
            EntityKind.LIGHT,
            "Launisches Licht",
            state={"state": "off", "brightness": 100},
            commands=["turn_on", "turn_off", "toggle", "set_brightness"],
        )
        await self.add_entity(
            "sensor_dropout",
            EntityKind.SENSOR,
            "Verstummender Sensor",
            state={"state": 21.0, "unit": "°C"},
        )
        await self.add_entity(
            "sensor_wild",
            EntityKind.SENSOR,
            "Ausreisser-Sensor",
            state={"state": 50.0, "unit": "%"},
        )
        # Ein Fernseher, der sich meldet wie ein echter.
        #
        # Ein Android TV schickt nach jedem Tastendruck seinen Zustand
        # neu - und dazwischen steht dort für einen Moment «aus». Das ist
        # kein Fehler des Geräts, sondern seine Bauart, und es ist die
        # härteste Prüfung für die Oberfläche: Alles, was daran hängt, ob
        # der Fernseher gerade «an» meldet, wird bei jedem Druck abgeräumt
        # und neu aufgebaut. Genau so flog das offene
        # Fernbedienungs-Blatt monatelang aus dem Baum - auf dem iPhone
        # als Wegblinken zu sehen, sonst nirgends.
        #
        # Am zahmen Demo-Fernseher ist dieser Fehler unsichtbar. Deshalb
        # steht der zappelige hier: Die Browser-Probe misst an ihm.
        await self.add_entity(
            "tv_zappelig",
            EntityKind.MEDIA_PLAYER,
            "Zappeliger Fernseher",
            state={
                "state": "on",
                "app": "Plex",
                "track": "Plex",
                "volume": 20,
                "has_screen": True,
                "apps": [
                    {"name": "Plex", "app": "com.plexapp.android"},
                    {"name": "Zattoo", "app": "com.zattoo.player"},
                ],
            },
            commands=[
                "play", "pause", "next", "previous", "toggle",
                "turn_on", "turn_off", "mute", "volume_up", "volume_down",
                "launch_app", "sleep_timer",
                "dpad_up", "dpad_down", "dpad_left", "dpad_right", "ok",
                "home", "back",
            ],
        )
        self.start_task(self._misbehave())

    async def _misbehave(self) -> None:
        """Der Stundenplan des Gremlins: melden, verstummen, ausreissen.

        Je «Takt» (pace) ein Schritt; der Sensor verschwindet in jedem
        vierten Takt und bleibt einen Takt lang weg. So sind die Flanken
        häufig genug zum Zuschauen, aber nicht so hektisch, dass die App
        nur noch flackert.
        """
        schritt = 0
        while True:
            await asyncio.sleep(self._pace)
            schritt += 1
            dropout = self.entity_id("sensor_dropout")
            wild = self.entity_id("sensor_wild")
            if self.hub.registry.get(dropout) is None:
                return
            if schritt % 4 == 0:
                # Verstummen: keine Werte mehr, als «nicht erreichbar»
                # markiert - die Flanke, auf die Auslöser und Wächter hören.
                await self.hub.registry.update_state(dropout, {}, available=False)
            else:
                wert = round(19.0 + self._rng.uniform(0.0, 4.0), 1)
                await self.hub.registry.update_state(
                    dropout, {"state": wert}, available=True
                )
            # Der wilde Sensor misst meist brav um 50 - und reisst in
            # jedem fünften Takt aus (0 oder 100). Wer Schwellen-Auslöser
            # baut, sieht hier, ob eine Haltezeit («bleibt so für X») den
            # Ausreisser aussortiert.
            if self._rng.random() < 0.2:
                ausreisser = self._rng.choice([0.0, 100.0])
                await self.hub.registry.update_state(wild, {"state": ausreisser})
            else:
                await self.hub.registry.update_state(
                    wild, {"state": round(45 + self._rng.uniform(0.0, 10.0), 1)}
                )

    async def _tv_meldet_sich(self, entity_id: str) -> None:
        """Die Rückmeldung eines Android TV nach einem Tastendruck.

        Erst «aus», einen Wimpernschlag später wieder «an» - so kommen
        die Rückrufe der Bibliothek im Haus tatsächlich an, weil der
        Fernseher seinen Zustand neu aufbaut, statt eine Taste einzeln zu
        quittieren. Die Lücke dazwischen ist der ganze Punkt: Alles in
        der Oberfläche, was an «meldet gerade an» hängt, verschwindet
        darin kurz.
        """
        await asyncio.sleep(0.05)
        await self.hub.registry.update_state(entity_id, {"state": "off"})
        await asyncio.sleep(0.25)
        await self.hub.registry.update_state(
            entity_id, {"state": "on", "app": "Plex", "track": "Plex"}
        )

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        # Der zappelige Fernseher nimmt jeden Befehl an - er ist nicht
        # störrisch, sondern gesprächig. Sein Beitrag ist die Rückmeldung
        # danach, nicht das Verschlucken davor.
        if entity.id.endswith(".tv_zappelig"):
            self.start_task(self._tv_meldet_sich(entity.id))
            return

        # Jeder dritte Befehl scheitert - deterministisch gezählt, nicht
        # gewürfelt: «beim dritten Mal klemmt es» lässt sich so gezielt
        # vorführen und in Tests nachstellen.
        self._commands_seen += 1
        if self._commands_seen % 3 == 0:
            raise HomePilotError("Der Gremlin hat den Befehl verschluckt.")
        changes: dict[str, Any] = {}
        if command == "turn_on":
            changes["state"] = "on"
        elif command == "turn_off":
            changes["state"] = "off"
        elif command == "toggle":
            changes["state"] = "off" if entity.state.get("state") == "on" else "on"
        elif command == "set_brightness":
            changes["brightness"] = max(0, min(100, int(data.get("brightness", 100))))
            changes["state"] = "on" if changes["brightness"] > 0 else "off"
        if changes:
            await self.hub.registry.update_state(entity.id, changes)


INTEGRATION = GremlinIntegration
