"""Pit-Boss-Pelletgrill (und Louisiana Grills) über ``pytboss``.

Konfiguration – einer der beiden Wege:

  - integration: pitboss
    name: Grill
    model: PBV4PS2            # steht auf dem Typenschild, siehe unten
    host: 10.10.1.60          # lokal, ohne Umweg über die Hersteller-Cloud
    scan_interval: 30

  - integration: pitboss
    name: Grill
    model: PBV4PS2
    grill_id: "abc123..."     # aus der Pit-Boss-App, geht über die Cloud
    allow_remote_start: false

**Warum lokal, wenn es geht:** Der Grill spricht dieselbe RPC-Schnittstelle
auch direkt im Netz. Dann bleibt der Hersteller aussen vor, und der Grill
funktioniert weiter, wenn deren Dienst mal steht. Nicht jedes Gerät
antwortet aber lokal – ältere Steuerplatinen haben gar keinen HTTP-Server,
und bei den übrigen muss er eingeschaltet sein. Klappt es nicht, ist
``grill_id`` der Weg; die Kennung steht in der App.

**Warum Bluetooth hier nicht vorkommt:** Der Hub läuft im Rechenzentrum
des Hauses, nicht auf der Terrasse. Für Bluetooth müsste er in Reichweite
stehen.

**Warum Anzünden standardmässig fehlt:** ``turn_on`` entfacht ein Feuer in
einem Gerät, neben dem gerade niemand stehen muss. Die Platine nimmt den
Befehl in jedem Zustand an – auch mit offenem Deckel, auch ohne Pellets,
auch wenn das Gerät unter dem Vordach steht. Diese Entscheidung gehört
nicht in eine Automation, die jemand vor drei Monaten gebaut hat. Deshalb
gibt es das Kommando nur mit ``allow_remote_start: true`` in der
Konfiguration, und auch dann nur für Bewohner.

Ausschalten geht immer – das ist die sichere Richtung.
"""

from __future__ import annotations

import asyncio
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError, HomePilotError
from ..core.integration import Integration

# Wie oft nachgefragt wird. Beim lokalen Weg gibt es keine Meldungen von
# sich aus, nur Abfragen; 30 Sekunden sind beim Grillen genau genug und
# belasten die kleine Platine nicht.
DEFAULT_INTERVAL = 30.0


def slug(name: str) -> str:
    """Aus «Grill Terrasse» wird «grill_terrasse» (rein, testbar)."""
    kept = [c.lower() if c.isalnum() else "_" for c in name.strip()]
    return "".join(kept).strip("_").replace("__", "_") or "grill"


def probe_temperatures(state: dict[str, Any]) -> dict[int, int]:
    """Die belegten Fleischfühler aus dem Zustand (rein, testbar).

    Ein nicht eingesteckter Fühler meldet ``None``. Ihn trotzdem als
    Entität zu führen, hiesse: eine Kachel, die dauerhaft «–» zeigt.
    """
    found: dict[int, int] = {}
    for number in (1, 2, 3, 4):
        value = state.get(f"p{number}Temp")
        if isinstance(value, int) and not isinstance(value, bool):
            found[number] = value
    return found


def faults(state: dict[str, Any]) -> list[str]:
    """Was gerade nicht stimmt, in lesbaren Worten (rein, testbar).

    Bewusst als Liste und nicht als einzelnes Kennzeichen: Beim Grillen
    hängt zu viel dran, als dass «Störung» genügen würde – ob die Pellets
    aus sind oder das Gebläse steht, führt zu ganz verschiedenen Schritten.
    """
    problems = []
    if state.get("noPellets"):
        problems.append("Pellets leer")
    if state.get("highTempErr"):
        problems.append("Übertemperatur")
    if state.get("fanErr"):
        problems.append("Gebläse")
    if state.get("hotErr"):
        problems.append("Zündung")
    if state.get("motorErr"):
        problems.append("Förderschnecke")
    if state.get("erL"):
        problems.append("Anzünden fehlgeschlagen")
    for number in (1, 2, 3):
        if state.get(f"err{number}"):
            problems.append(f"Fühler {number}")
    return problems


def grill_state(state: dict[str, Any]) -> dict[str, Any]:
    """Rohzustand des Grills in die Form des Hubs bringen (rein, testbar)."""
    running = bool(state.get("moduleIsOn"))
    problems = faults(state)
    return {
        "state": "running" if running else "off",
        "temperature": state.get("grillTemp"),
        "target": state.get("grillSetTemp"),
        "unit": "°F" if state.get("isFahrenheit") else "°C",
        # Was die Platine gerade tut – daran sieht man beim Anheizen, dass
        # sich etwas rührt, lange bevor die Temperatur steigt.
        "igniter": bool(state.get("hotState")),
        "fan": bool(state.get("fanState")),
        "auger": bool(state.get("motorState")),
        "light": bool(state.get("lightState")),
        "probes": probe_temperatures(state),
        # Dieselben Werte zusätzlich flach (probe_1 …): Nur so taugen sie
        # als messbares Attribut in Abläufen - «Sonde 1 über 63 °C» kann
        # nicht in ein verschachteltes Wörterbuch hineinschauen.
        **{
            f"probe_{number}": temp
            for number, temp in probe_temperatures(state).items()
        },
        "faults": problems,
        "problem": problems[0] if problems else None,
    }


class PitBossIntegration(Integration):
    name = "pitboss"

    async def setup(self) -> None:
        try:
            from pytboss import HttpConnection, PitBoss, WebSocketConnection
        except ImportError as err:  # pragma: no cover - hängt am Abbild
            raise ConfigError(
                "pitboss braucht das Paket 'pytboss' (pip install pytboss)"
            ) from err

        model = str(self.config.get("model") or "").strip()
        if not model:
            raise ConfigError(
                "pitboss braucht 'model' (z.B. PBV4PS2) – die Steuerplatine "
                "lässt sich nicht selbst erkennen, und ohne sie weiss der "
                "Hub nicht, welche Befehle das Gerät versteht."
            )
        host = str(self.config.get("host") or "").strip()
        grill_id = str(self.config.get("grill_id") or "").strip()
        if bool(host) == bool(grill_id):
            raise ConfigError(
                "pitboss braucht entweder 'host' (lokal) oder 'grill_id' "
                "(Cloud) – genau eines von beiden."
            )
        self._name = str(self.config.get("name") or "Grill")
        self._interval = float(self.config.get("scan_interval", DEFAULT_INTERVAL))
        # Ohne diesen Schalter fehlt das Kommando ganz, statt nur versteckt
        # zu sein: Was es nicht gibt, kann auch kein Ablauf auslösen.
        self._may_start = bool(self.config.get("allow_remote_start", False))
        # Über die Cloud meldet sich der Grill von selbst, lokal nicht.
        self._pushes = not host

        connection = (
            HttpConnection(host) if host else WebSocketConnection(grill_id)
        )
        try:
            self._boss = PitBoss(
                connection, model, password=str(self.config.get("password") or "")
            )
        except Exception as err:
            raise ConfigError(f"pitboss: Modell '{model}' unbekannt ({err})") from err

        commands = ["turn_off", "set_temperature"]
        if self._may_start:
            commands.append("turn_on")
        if getattr(self._boss.spec, "has_lights", False):
            commands += ["light_on", "light_off"]

        self._entity = await self.add_entity(
            slug(self._name),
            EntityKind.APPLIANCE,
            self._name,
            state={"state": "unknown"},
            commands=commands,
            available=False,
        )

        try:
            await self._boss.start()
        except Exception as err:
            # Ein kalter Grill ist stromlos und damit nicht erreichbar –
            # das ist der Normalfall und darf den Hub-Start nicht stören.
            self.log.warning("Grill '%s' antwortet nicht: %s", self._name, err)

        if self._pushes:
            await self._boss.subscribe_state(self._on_push)
        self.start_task(self._poll_loop())

    async def _on_push(self, payload: Any) -> None:
        """Meldung aus der Cloud – dieselbe Verarbeitung wie beim Abfragen."""
        if isinstance(payload, dict):
            await self._publish(payload)

    async def _poll_loop(self) -> None:
        while True:
            try:
                state = await self._boss.get_state()
            except Exception as err:
                # Zwischen zwei Grillabenden ist das Gerät wochenlang aus.
                # Das ist kein Fehler, nur «nicht da».
                self.log.debug("Grill '%s' nicht erreichbar: %s", self._name, err)
                await self.hub.registry.update_state(
                    self._entity.id, {}, available=False
                )
            else:
                if isinstance(state, dict):
                    await self._publish(state)
            await asyncio.sleep(self._interval)

    async def _publish(self, raw: dict[str, Any]) -> None:
        shaped = grill_state(raw)
        await self.hub.registry.update_state(self._entity.id, shaped, available=True)

    async def handle_command(
        self, entity: Entity, command: str, data: dict[str, Any]
    ) -> None:
        try:
            if command == "turn_off":
                await self._boss.turn_grill_off()
            elif command == "turn_on":
                if not self._may_start:
                    raise ConfigError(
                        "Fernstart ist nicht freigegeben. In der config.yaml "
                        "beim pitboss-Eintrag 'allow_remote_start: true' setzen."
                    )
                # Das gehört ins Protokoll, auch wenn nichts schiefgeht.
                self.log.warning("Grill '%s' wird aus der Ferne angezündet", self._name)
                await self._boss.turn_grill_on()
            elif command == "set_temperature":
                await self._boss.set_grill_temperature(int(data.get("temperature", 0)))
            elif command == "light_on":
                await self._boss.turn_light_on()
            elif command == "light_off":
                await self._boss.turn_light_off()
            else:
                raise ConfigError(f"Kommando '{command}' gibt es hier nicht")
        except (ConfigError, HomePilotError):
            raise
        except Exception as err:
            raise HomePilotError(f"Grill antwortet nicht: {err}") from err
        # Nicht auf die nächste Abfrage warten – wer schaltet, will sehen,
        # dass es angekommen ist.
        try:
            await self._publish(await self._boss.get_state())
        except Exception:
            pass

    async def teardown(self) -> None:
        try:
            await self._boss.stop()
        except Exception:
            pass


INTEGRATION = PitBossIntegration
