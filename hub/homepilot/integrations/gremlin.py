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
  - ``cover_gestrig`` - meldet stur die Stellung von vorhin, egal was man
    fährt (Punkt 504). Der Fall aus dem Haus: «Das Gateway gibt seit
    Stunden dieselbe alte Stellung heraus» - dafür gibt es
    ``homepilot.storencheck --funk``, und geprüft wurde er nie.
  - ``sensor_luegner`` - liefert Unsinn statt Zahlen: einen Text, eine
    negative Temperatur, ein leeres Feld. Jeder davon hat hier schon
    einmal eine Karte weiss werden lassen.
  - ``schalter_lahm`` - antwortet erst nach Sekunden. Die Kachel steht
    so lange auf «wird geschaltet», und genau diese Frist stand nirgends
    auf dem Prüfstand.

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

#: Was der lügende Sensor statt einer Zahl meldet (Punkt 504).
#:
#: Jeder Eintrag stammt aus einem Fehler, der hier wirklich passiert
#: ist: ein Text aus einem Gateway, das «--» für «kein Wert» schreibt;
#: eine Temperatur unterhalb des absoluten Nullpunkts aus einem Sensor
#: mit leerer Batterie; ein leeres Feld; und ``None``, das durch jede
#: Prüfung rutscht, die nur auf den Typ sieht.
UNSINN: tuple[Any, ...] = ("--", -999.0, "", None)

#: Wie lange der lahme Schalter braucht (Punkt 504 der Werkbank).
#:
#: Vier Sekunden, knapp unter der Frist, nach der die App ihre Vermutung
#: aufgibt (PENDING_TIMEOUT in hooks/useHub.ts, sechs Sekunden). Darüber
#: prüfte man das Verfallen der Anzeige, darunter sähe man sie gar nicht.
LAHM_SEKUNDEN = 4.0


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
        # Eine Store, die eine alte Stellung behauptet (Punkt 504 der
        # Werkbank). Der gemeldete Fall aus dem Haus: «Das Gateway gibt
        # seit Stunden dieselbe alte Stellung heraus.» Dafür gibt es
        # `homepilot.storencheck --funk` - und geprüft war der Fall nie,
        # weil sich am Demo-Gerät alles sofort bewegt.
        await self.add_entity(
            "cover_gestrig",
            EntityKind.COVER,
            "Gestrige Store",
            state={"state": "open", "position": 100},
            commands=["open", "close", "stop", "set_position"],
        )
        # Ein Sensor, der Unsinn meldet. Nicht «kein Wert» - das ist der
        # Fall daneben und heisst «nicht erreichbar» -, sondern ein
        # Wert, den niemand erwartet: ein Text, eine negative
        # Temperatur, ein leeres Feld. Jeder davon hat hier schon einmal
        # eine Karte weiss werden lassen, weil irgendwo `toFixed` auf
        # einer Zeichenkette stand.
        await self.add_entity(
            "sensor_luegner",
            EntityKind.SENSOR,
            "Lügender Sensor",
            state={"state": 21.0, "unit": "°C"},
        )
        # Ein Schalter, der sich Zeit lässt. Die Kachel steht so lange
        # auf «wird geschaltet» (PENDING_TIMEOUT in hooks/useHub.ts, sechs
        # Sekunden) - und ob sie danach den richtigen Zustand zeigt oder
        # in ihrer Vermutung hängen bleibt, sah man nur am echten
        # Funkgerät im Keller.
        await self.add_entity(
            "schalter_lahm",
            EntityKind.SWITCH,
            "Lahmer Schalter",
            state={"state": "off"},
            commands=["turn_on", "turn_off", "toggle"],
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
            # Der Lügner (Punkt 504): in jedem dritten Takt etwas, das
            # keine Temperatur ist. Reihum, nicht zufällig - so kommt
            # jede Sorte Unsinn vor, statt dass eine davon wochenlang
            # ausbleibt und genau die den Fehler enthält.
            luegner = self.entity_id("sensor_luegner")
            if schritt % 3 == 0:
                unsinn: Any = UNSINN[(schritt // 3) % len(UNSINN)]
                await self.hub.registry.update_state(luegner, {"state": unsinn})
            else:
                await self.hub.registry.update_state(
                    luegner, {"state": round(20 + self._rng.uniform(0.0, 2.0), 1)}
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

        # Die gestrige Store nimmt den Befehl an und tut nichts (Punkt
        # 504 der Werkbank). Kein Fehler: Genau das ist der gemeldete
        # Fall - «das Gateway gibt seit Stunden dieselbe alte Stellung
        # heraus». Wer den Befehl abwiese, prüfte den anderen Fall, und
        # den gibt es schon (launisches Licht).
        if entity.id.endswith(".cover_gestrig"):
            return

        # Der lahme Schalter antwortet - irgendwann (Punkt 504). Die
        # Kachel steht so lange auf «wird geschaltet»; die Frist dafür
        # ist sechs Sekunden (PENDING_TIMEOUT in hooks/useHub.ts), und
        # vier liegen knapp darunter: So sieht man die Anzeige und das
        # richtige Ende, statt die Vermutung verfallen zu sehen.
        if entity.id.endswith(".schalter_lahm"):
            ziel = "off" if entity.state.get("state") == "on" else "on"
            if command == "turn_on":
                ziel = "on"
            elif command == "turn_off":
                ziel = "off"
            self.start_task(self._lahm_antworten(entity.id, ziel))
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


    async def _lahm_antworten(self, entity_id: str, ziel: str) -> None:
        """Erst warten, dann schalten (Punkt 504 der Werkbank).

        Vier Sekunden: knapp unter der Frist, nach der die App ihre
        Vermutung aufgibt (PENDING_TIMEOUT in hooks/useHub.ts). Darüber
        prüfte man das Verfallen, darunter sähe man die Anzeige gar
        nicht - hier sieht man beides, die Wartezeit und das richtige
        Ende.
        """
        await asyncio.sleep(LAHM_SEKUNDEN)
        if self.hub.registry.get(entity_id) is None:
            return
        await self.hub.registry.update_state(entity_id, {"state": ziel})


INTEGRATION = GremlinIntegration
