"""Overkiz (Somfy TaHoma & Co.) – Storen, Rollläden, Markisen.

Konfiguration:
  - integration: overkiz
    host: gateway-2310-9733-0267.local:8443
    token: "${OVERKIZ_TOKEN}"    # lokales Token, siehe unten

Voraussetzung:  pip install "homepilot[overkiz]"  bzw.  pip install pyoverkiz

Gesteuert wird lokal über das Gateway (Somfy Developer Mode) – schnell und
ohne Cloud. Einmalig braucht es ein lokales Token. Am einfachsten direkt
in der TaHoma-App erzeugen:

  1. Im Somfy-/TaHoma-Konto den Entwicklermodus für das Gateway aktivieren.
  2. In der TaHoma-App unter „Token verwalten“ ein neues lokales Token
     erstellen und in die config.yaml eintragen (token: ...).
  3. Hub (neu) starten.

Alternativ erzeugt der Helfer das Token über die Somfy-Cloud und legt es
in overkiz-token.json:
     python -m homepilot.integrations.overkiz -c config.yaml

Aussenraffstoren (ExteriorVenetianBlind) haben Position UND Lamellenwinkel;
beides erscheint als cover-Entität mit den Kommandos open/close/stop,
set_position und – wo vorhanden – set_tilt.

Zum Funk: io-homecontrol und RTS quittieren nicht wie ein Netzwerk. Ein
Befehl, der untergeht, ist kein Defekt, sondern der Normalfall – und
«nicht erreichbar» heisst beim Gateway «hat sich länger nicht gemeldet»,
nicht «hört nicht zu». Beides ist hier eingebaut: Befehle gehen einzeln
mit Pause hinaus und werden bei Ablehnung wiederholt, und ausgegraut wird
eine Store erst, wenn sie sich mehrfach hintereinander nicht meldet.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

from ..core import tokenstore
from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Overkiz-Widgets, die wir als Storen/Rollläden (cover) führen.
COVER_WIDGETS = {
    "ExteriorVenetianBlind",
    "PositionableExteriorVenetianBlind",
    "RollerShutter",
    "PositionableRollerShutter",
    "PositionableScreen",
    "PositionableHorizontalAwning",
    "UpDownRollerShutter",
    "Awning",
    "Blind",
}
COVER_UI_CLASSES = {"ExteriorVenetianBlind", "RollerShutter", "Screen", "Awning", "Blind"}

# Zustandsnamen der Overkiz-API.
CLOSURE = "core:ClosureState"          # 0 = offen, 100 = geschlossen
# Markisen zählen andersherum: Sie fahren *aus* statt *zu*. Overkiz meldet
# dafür nicht die Geschlossenheit, sondern den Ausfahrgrad - 0 heisst
# eingefahren, 100 ganz draussen. Über die Closure-Rechnung gelesen wäre
# eine ausgefahrene Markise «Position 0» und damit «Geschlossen»: genau
# der gemeldete Fehler an der Terrasse.
DEPLOYMENT = "core:DeploymentState"    # 0 = eingefahren, 100 = ausgefahren
ORIENTATION = "core:SlateOrientationState"  # Lamellenwinkel 0…100
OPEN_CLOSED = "core:OpenClosedState"

# Ein Storen-Kommando heisst je nach Funk-Standard anders: io-homecontrol
# kennt open/close/stop, RTS dagegen up/down/my. Deshalb bilden wir jedes
# App-Kommando auf die erste vom Gerät wirklich unterstützte Variante ab –
# sonst antwortet das Gateway mit „No such command" (UNSPECIFIED_ERROR).
COMMAND_ALIASES: dict[str, list[str]] = {
    "open": ["open", "up", "rollUp"],
    "close": ["close", "down", "rollDown"],
    "stop": ["stop", "my"],
    # setDeployment zuerst: Wo es das gibt, ist das Gerät eine Markise, und
    # setClosure kennt sie gar nicht. Die Reihenfolge entscheidet, welche
    # Variante genommen wird - siehe die Auswahl beim Einrichten.
    "set_position": ["setDeployment", "setClosure"],
    "set_tilt": ["setOrientation"],
}


# ── Funk ist kein Draht ────────────────────────────────────────────────
#
# io-homecontrol und RTS sind Funkprotokolle ohne Quittung im Sinne eines
# Netzwerks. Zwei Dinge folgen daraus, und beide haben Stefan Storen
# gekostet, die stehen blieben:
#
#   1. Werden mehrere Storen gleichzeitig angesprochen, gehen Telegramme
#      im Funk unter. Das Gateway meldet trotzdem Erfolg - es hat den
#      Befehl ja abgeschickt. Deshalb geht hier immer nur ein Befehl aufs
#      Mal hinaus, mit einer Pause dazwischen.
#   2. «Nicht erreichbar» heisst bei Overkiz «hat sich länger nicht
#      gemeldet», nicht «kann nichts empfangen». Ein Befehl an so ein
#      Gerät kommt meistens trotzdem an - genau das erlebt man, wenn man
#      es in der TaHoma-App einfach nochmal versucht und es geht.

#: Mindestabstand zwischen zwei Befehlen an dasselbe Gateway.
BEFEHLSPAUSE = 0.6

#: So oft wird ein abgewiesener Befehl wiederholt, und wie lange dazwischen
#: gewartet wird. Von Hand macht man genau das: nochmal drücken.
WIEDERHOLUNGEN = 2
WIEDERHOLPAUSE = 3.0

#: Wie oft das Gateway ein Gerät hintereinander als abwesend melden muss,
#: bevor der Hub es in der App ausgraut. Eine einzelne Meldung ist Funk-
#: rauschen; bisher genügte sie, und die Store blieb bis zum Neustart
#: grau - auch wenn sie längst wieder da war.
ABWESEND_SCHWELLE = 3

#: Takt, in dem die Geräteliste beim Gateway nachgefragt wird.
ABFRAGE_INTERVALL = 300.0


def verfuegbarkeit(
    zaehler: int, meldet_sich: bool, schwelle: int = ABWESEND_SCHWELLE
) -> tuple[int, bool]:
    """Aus einer Meldung des Gateways einen Verfügbarkeits-Stand machen.

    Rein und testbar. Zurück kommt der neue Zähler und ob das Gerät für
    die App als erreichbar gilt. Eine gute Meldung setzt sofort zurück -
    wer sich meldet, ist da; eine schlechte zählt hoch, und erst ab der
    Schwelle wird ausgegraut.
    """
    if meldet_sich:
        return 0, True
    neu = zaehler + 1
    return neu, neu < schwelle


def cover_state(states: dict[str, Any]) -> dict[str, Any]:
    """Übersetzt Overkiz-Zustände in Entitäts-Attribute (rein, testbar).

    Overkiz zählt 'closure' als Geschlossenheit (0 offen … 100 zu); die App
    denkt in 'offen %', deshalb wird hier gedreht.

    Bei Markisen zählt Overkiz nicht die Geschlossenheit, sondern den
    Ausfahrgrad (`core:DeploymentState`, 0 eingefahren … 100 draussen).
    Der wird *nicht* gedreht - sonst stünde eine ausgefahrene Markise als
    «Geschlossen» da. Genau so war es an der Terrasse.
    """
    result: dict[str, Any] = {}
    closure = states.get(CLOSURE)
    deployment = states.get(DEPLOYMENT)
    open_closed = states.get(OPEN_CLOSED)
    # Der Ausfahrgrad zuerst: Wo er steht, ist das Gerät eine Markise, und
    # dann ist er die richtige Angabe. Eine Store meldet ihn gar nicht.
    if deployment is not None:
        try:
            position = max(0, min(100, int(deployment)))
            result["position"] = position
            result["state"] = (
                "open" if position >= 99 else "closed" if position <= 1 else "partial"
            )
        except (TypeError, ValueError):
            pass
    if "position" not in result and closure is not None:
        try:
            position = max(0, min(100, 100 - int(closure)))
            result["position"] = position
            result["state"] = (
                "open" if position >= 99 else "closed" if position <= 1 else "partial"
            )
        except (TypeError, ValueError):
            pass
    if "state" not in result and open_closed is not None:
        result["state"] = "open" if str(open_closed).lower() == "open" else "closed"
    orientation = states.get(ORIENTATION)
    if orientation is not None:
        try:
            # Wie bei der Position dreht der Hub auch hier: Overkiz zählt
            # die Lamellen als Geschlossenheit (100 = zu), die App denkt in
            # «offen %» – sonst zeigt sie geschlossene Lamellen als offen.
            result["tilt"] = max(0, min(100, 100 - int(orientation)))
        except (TypeError, ValueError):
            pass
    result.setdefault("state", "unknown")
    return result


# Grenzen für die gelernte Laufzeit: Schneller als 5 s fährt kein Storen
# komplett, und über 3 Minuten ist eher ein hängengebliebener Messwert.
TRAVEL_MIN = 5.0
TRAVEL_MAX = 180.0


def learned_travel(
    old: float | None, start: float, target: float, seconds: float
) -> float | None:
    """Volle Laufzeit (0 bis 100 %) aus einer beobachteten Fahrt (rein, testbar).

    Kurze Fahrten (unter 20 % Weg oder 3 s) sind zu ungenau zum Lernen; aus
    dem Rest wird auf die volle Strecke hochgerechnet und mit dem bisherigen
    Wert gemittelt, damit ein Ausreisser nicht alles verstellt.
    """
    fraction = abs(target - start) / 100
    if fraction < 0.2 or seconds < 3:
        return None
    full = seconds / fraction
    estimate = full if old is None else (old + full) / 2
    return max(TRAVEL_MIN, min(TRAVEL_MAX, estimate))


class OverkizIntegration(Integration):
    name = "overkiz"

    async def setup(self) -> None:
        host = self.config.get("host")
        if not host:
            raise ConfigError(
                "overkiz braucht 'host' (z.B. gateway-XXXX-XXXX-XXXX.local:8443)"
            )

        try:
            from pyoverkiz.client import OverkizClient
            from pyoverkiz.models import Command
            from pyoverkiz.utils import generate_local_server
        except ImportError as err:
            raise ConfigError(
                "pyoverkiz fehlt – installieren mit: pip install pyoverkiz"
            ) from err

        self._Command = Command
        token = self.config.get("token") or self._load_token()
        if not token:
            raise ConfigError(
                "overkiz: kein Token – einmalig anmelden mit: "
                "python -m homepilot.integrations.overkiz -c config.yaml"
            )

        # Lokale API über das Gateway: eigener SSL-Kontext der Bibliothek.
        server = generate_local_server(host=host)
        self._session = self.http_session()
        self._client = OverkizClient(
            username="", password="", server=server, token=token,
            verify_ssl=False, session=self._session,
        )
        try:
            await self._client.login()
        except Exception as err:
            # Im Docker-Container lässt sich ein .local-mDNS-Name nicht
            # auflösen – der häufigste Stolperstein. Klarer Hinweis statt
            # rohem DNS-Fehler.
            if ".local" in host:
                raise ConfigError(
                    f"Gateway '{host}' nicht erreichbar. Im Container lässt sich der "
                    ".local-Name meist nicht auflösen – trag die feste IP des Gateways "
                    "ein (z.B. host: 192.168.1.50:8443) und gib ihm im Router eine "
                    "feste Adresse."
                ) from err
            raise ConfigError(f"Overkiz-Gateway '{host}' nicht erreichbar: {err}") from err

        # device_url → entity_id und zurück; je Entität die Abbildung
        # App-Kommando → echter Overkiz-Kommandoname (open→up bei RTS usw.).
        self._devices: dict[str, str] = {}
        # Laufzeit-Lernen: angestossene Fahrten und die gelernte volle
        # Laufzeit je Storen - daraus macht die App eine Bewegung, die mit
        # der echten Store mithält.
        self._moves: dict[str, dict[str, float]] = {}
        self._travel: dict[str, float] = self._stored_travel()
        self._url_by_entity: dict[str, str] = {}
        self._cmd_by_entity: dict[str, dict[str, list[str]]] = {}
        # Wie oft ein Gerät hintereinander als abwesend gemeldet wurde.
        self._abwesend: dict[str, int] = {}
        # Nur ein Befehl aufs Mal, mit Pause: Funktelegramme, die sich
        # überlagern, gehen verloren - siehe Kopf dieser Datei.
        self._funk = asyncio.Lock()
        self._zuletzt_gesendet = 0.0
        for device in await self._client.get_devices():
            if not self._is_cover(device):
                continue
            states = {state.name: state.value for state in device.states or []}
            supported = {
                cd.command_name for cd in getattr(device.definition, "commands", []) or []
            }
            # Je App-Kommando ALLE vom Gerät gekannten Varianten, nach Vorzug
            # sortiert. Wird die erste abgewiesen, probiert handle_command die
            # nächste – ein abgelehnter Befehl bewegt ohnehin nichts.
            cmd_map: dict[str, list[str]] = {}
            for app_cmd, variants in COMMAND_ALIASES.items():
                got = [v for v in variants if v in supported]
                if got:
                    cmd_map[app_cmd] = got
            # setClosure/setOrientation nur, wenn es dazu auch einen Zustand gibt
            # (sonst hätte die App einen Regler ohne Rückmeldung).
            if CLOSURE not in states:
                cmd_map.pop("set_position", None)
            if ORIENTATION not in states:
                cmd_map.pop("set_tilt", None)
            commands = list(cmd_map.keys())
            self.log.info(
                "Overkiz: %s (%s) – App-Kommandos [%s]; Gerät kann [%s]",
                device.label,
                getattr(device, "widget", None) or getattr(device, "ui_class", None),
                ", ".join(commands) or "keine",
                ", ".join(sorted(supported)) or "keine",
            )
            entity = await self.add_entity(
                device.device_url.replace("/", "_").replace(":", "_"),
                EntityKind.COVER,
                device.label or "Storen",
                state=cover_state(states),
                commands=commands,
                # Beim Start zählt die Meldung des Gateways einmal - eine
                # Store, die gerade nicht funkt, wird deshalb nicht sofort
                # ausgegraut. Erst wenn sie sich mehrfach nicht meldet.
                available=True,
            )
            self._devices[device.device_url] = entity.id
            self._url_by_entity[entity.id] = device.device_url
            self._cmd_by_entity[entity.id] = cmd_map
            self._abwesend[entity.id] = (
                0 if bool(getattr(device, "available", True)) else 1
            )

        if not self._devices:
            self.log.warning("Overkiz verbunden, aber keine Storen/Rollläden gefunden")

        self.start_task(self._event_loop())
        # Der Ereigniskanal meldet Änderungen, aber nicht, dass ein Gerät
        # wieder da ist - deshalb zusätzlich ein langsamer Takt. Ohne ihn
        # blieb eine einmal ausgegraute Store bis zum Neustart grau.
        self.start_polling(self._geraete_auffrischen, interval=ABFRAGE_INTERVALL)

    @staticmethod
    def _is_cover(device: Any) -> bool:
        return (
            str(getattr(device, "widget", "")) in COVER_WIDGETS
            or str(getattr(device, "ui_class", "")) in COVER_UI_CLASSES
        )

    def _token_file(self) -> Path:
        return tokenstore.token_file(self.hub.config.data_file, self.config, "overkiz")

    def _load_token(self) -> str | None:
        return tokenstore.value(self._token_file(), "token")

    # ── Gateway → Hub ────────────────────────────────────────────────────────

    def _stored_travel(self) -> dict[str, float]:
        """Gelernte Laufzeiten aus der Datendatei holen.

        Ohne das begänne das Lernen nach jedem Neustart von vorn - und bis
        zur nächsten vollen Fahrt liefe die Animation wieder nach Annahme
        statt nach Messung.
        """
        result: dict[str, float] = {}
        for entry in self.hub.data.get("cover_travel"):
            if not isinstance(entry, dict):
                continue
            entity_id = entry.get("entity_id")
            seconds = entry.get("seconds")
            if isinstance(entity_id, str) and isinstance(seconds, (int, float)):
                result[entity_id] = float(seconds)
        return result

    def _save_travel(self) -> None:
        self.hub.data.set(
            "cover_travel",
            [
                {"entity_id": entity_id, "seconds": round(seconds, 1)}
                for entity_id, seconds in sorted(self._travel.items())
            ],
        )

    async def _event_loop(self) -> None:
        """Live-Updates über den Ereigniskanal des Gateways."""
        while True:
            try:
                await self._client.register_event_listener()
                while True:
                    for event in await self._client.fetch_events():
                        await self._handle_event(event)
                    await asyncio.sleep(2)
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.debug("Overkiz-Ereigniskanal unterbrochen (%s), neu in 15s", err)
                await asyncio.sleep(15)

    async def _geraete_auffrischen(self) -> None:
        """Beim Gateway nachfragen, wer da ist - und wie es steht.

        Der Ereigniskanal meldet Änderungen. Er meldet aber nicht, dass
        ein Gerät wieder antwortet: Genau deshalb blieb eine einmal als
        abwesend gemeldete Store in der App grau, bis jemand den Hub neu
        startete - auch wenn sie in der TaHoma-App längst wieder normal
        lief.
        """
        try:
            geraete = await self._client.get_devices()
        except Exception as err:
            self.log.debug("Overkiz: Geräteliste nicht abrufbar (%s)", err)
            return
        for device in geraete:
            entity_id = self._devices.get(getattr(device, "device_url", None))
            if entity_id is None:
                continue
            zaehler, erreichbar = verfuegbarkeit(
                self._abwesend.get(entity_id, 0),
                bool(getattr(device, "available", True)),
            )
            self._abwesend[entity_id] = zaehler
            entity = self.hub.registry.get(entity_id)
            states = {state.name: state.value for state in device.states or []}
            if entity is not None and entity.available != erreichbar:
                self.log.info(
                    "Overkiz: %s %s",
                    entity.label,
                    "meldet sich wieder" if erreichbar else "meldet sich nicht mehr",
                )
            await self.hub.registry.update_state(
                entity_id, cover_state(states), available=erreichbar
            )

    def health(self) -> dict[str, Any]:
        """Welche Storen sich gerade nicht melden.

        «Manchmal fährt eine nicht mit» ist von aussen nicht davon zu
        unterscheiden, dass der Befehl gar nicht ankam. Hier steht, was
        das Gateway dazu sagt - und dass ein Befehl trotzdem hinausgeht.
        """
        still = []
        for entity_id, zaehler in self._abwesend.items():
            if zaehler < ABWESEND_SCHWELLE:
                continue
            entity = self.hub.registry.get(entity_id)
            still.append(entity.label if entity else entity_id)
        if not still:
            return {"ok": True, "detail": f"{len(self._devices)} Storen, alle melden sich."}
        return {
            "ok": True,
            "detail": (
                f"Meldet sich nicht: {', '.join(sorted(still))}. Befehle gehen "
                "trotzdem hinaus - bei Funk heisst «meldet sich nicht» nicht "
                "«hört nicht zu»."
            ),
        }

    async def _handle_event(self, event: Any) -> None:
        device_url = getattr(event, "device_url", None)
        entity_id = self._devices.get(device_url) if device_url else None
        if entity_id is None:
            return
        changed = getattr(event, "device_states", None)
        if not changed:
            return
        states = {state.name: state.value for state in changed}
        updates = cover_state(states)
        # Nur melden, was das Event wirklich enthielt (kein Zustand erfunden).
        if "position" not in updates and CLOSURE not in states:
            updates.pop("position", None)
        # Wer meldet, ist da - der Zähler beginnt von vorn.
        self._abwesend[entity_id] = 0
        await self.hub.registry.update_state(entity_id, updates, available=True)

        # Laufzeit lernen: Meldet das Gateway die Zielposition einer von uns
        # angestossenen Fahrt, ist die Fahrtzeit bekannt.
        move = self._moves.get(entity_id)
        position = updates.get("position")
        if move and isinstance(position, (int, float)):
            if abs(position - move["target"]) <= 2:
                travel = learned_travel(
                    self._travel.get(entity_id),
                    move["start"],
                    move["target"],
                    time.monotonic() - move["at"],
                )
                self._moves.pop(entity_id, None)
                if travel is not None:
                    self._travel[entity_id] = travel
                    self._save_travel()
                    await self.hub.registry.update_state(
                        entity_id, {"travel_seconds": round(travel, 1)}
                    )

    # ── Hub → Gateway ────────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        device_url = self._url_by_entity[entity.id]
        Command = self._Command
        # Alle vom Gerät gekannten Varianten dieses App-Kommandos (Vorzug zuerst).
        variants = self._cmd_by_entity.get(entity.id, {}).get(command)
        if not variants:
            raise ConfigError(f"Diese Storen kennen das Kommando '{command}' nicht")
        # Fahrt fürs Laufzeit-Lernen vormerken (Halt beendet die Messung).
        if command in ("open", "close", "set_position"):
            start = entity.state.get("position")
            if isinstance(start, (int, float)):
                target = (
                    100.0
                    if command == "open"
                    else 0.0
                    if command == "close"
                    else float(max(0, min(100, int(data.get("position", 0)))))
                )
                self._moves[entity.id] = {
                    "start": float(start),
                    "target": target,
                    "at": time.monotonic(),
                }
        elif command == "stop":
            self._moves.pop(entity.id, None)
        # Parameter bestimmen. Wichtig: leere Liste statt None – sonst wird aus
        # dem JSON-null in der Gateway-Firmware ein 'nil' und der Befehl fällt
        # mit UNSPECIFIED_ERROR / error:'nil' durch.
        if command == "set_position":
            offen = max(0, min(100, int(data.get("position", 0))))
            # App: offen %. Overkiz zählt bei Storen die Geschlossenheit -
            # also drehen. Bei Markisen den Ausfahrgrad, und der zählt
            # schon in dieselbe Richtung: 100 heisst draussen. Wer hier
            # dreht, fährt die Markise beim «ganz auf» ein.
            markise = variants and str(variants[0]) == "setDeployment"
            params: list[Any] = [offen if markise else 100 - offen]
        elif command == "set_tilt":
            # App: offen %, Overkiz: geschlossen % - wie bei set_position.
            params = [max(0, min(100, 100 - int(data.get("tilt", 0))))]
        else:
            params = []

        last_err: Exception | None = None
        for runde in range(WIEDERHOLUNGEN + 1):
            if runde:
                # Von Hand macht man genau das: nochmal drücken, und dann
                # geht es. Funk ist kein Draht - ein verlorenes Telegramm
                # ist kein Defekt, sondern der Normalfall.
                self.log.info(
                    "Overkiz: '%s' an %s kam nicht durch – Versuch %s von %s",
                    command, device_url, runde + 1, WIEDERHOLUNGEN + 1,
                )
                await asyncio.sleep(WIEDERHOLPAUSE)
            for name in variants:
                try:
                    await self._senden(device_url, Command(name, params))
                except Exception as err:
                    last_err = err
                    self.log.warning(
                        "Overkiz: '%s' abgewiesen (%s) – nächste Variante", name, err
                    )
                    continue
                # Klappt eine spätere Variante, in Zukunft direkt diese nehmen.
                if name != variants[0]:
                    self._cmd_by_entity[entity.id][command] = [name]
                # Das Gerät hat den Befehl genommen - es ist also da,
                # was das Gateway vorher auch behauptet haben mag.
                self._abwesend[entity.id] = 0
                if not entity.available:
                    await self.hub.registry.update_state(entity.id, {}, available=True)
                return
        raise ConfigError(f"Gateway lehnt '{command}' ab: {last_err}")

    async def _senden(self, device_url: str, befehl: Any) -> None:
        """Ein Befehl aufs Mal, mit Pause dazwischen.

        Der Grund steht im Kopf dieser Datei: Werden mehrere Storen
        gleichzeitig angesprochen - «alle zu», eine Szene, ein Ablauf -,
        überlagern sich die Funktelegramme, und einzelne Storen bleiben
        stehen. Nicht immer dieselben, denn es hängt am Zufall. Das
        Gateway meldet trotzdem Erfolg: Abgeschickt hat es ja.
        """
        async with self._funk:
            wartezeit = BEFEHLSPAUSE - (time.monotonic() - self._zuletzt_gesendet)
            if wartezeit > 0:
                await asyncio.sleep(wartezeit)
            self.log.info("Overkiz sendet '%s' an %s", befehl.name, device_url)
            try:
                await self._client.execute_command(device_url, befehl)
            finally:
                self._zuletzt_gesendet = time.monotonic()


INTEGRATION = OverkizIntegration


# ── Anmelde-Helfer ─────────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.overkiz -c config.yaml
# Loggt sich einmalig in die Somfy-Cloud ein, erzeugt ein lokales Token für
# das Gateway und legt es neben die homepilot-data.json.


async def _login_main(config_path: str) -> int:
    import getpass

    from pyoverkiz.client import OverkizClient
    from pyoverkiz.const import SUPPORTED_SERVERS

    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "overkiz"]
    host = (blocks[0].get("host") if blocks else None) or input("Gateway-Host: ").strip()
    # gateway-2310-9733-0267.local:8443 → Gateway-ID 2310-9733-0267
    gateway_id = host.split(".")[0].replace("gateway-", "")

    print("Verfügbare Server (die meisten Somfy-Nutzer in Europa: somfy_europe):")
    print("  " + ", ".join(sorted(str(s.value) for s in SUPPORTED_SERVERS)))
    server_key = input("Server [somfy_europe]: ").strip() or "somfy_europe"
    overkiz_server = next(
        (srv for key, srv in SUPPORTED_SERVERS.items() if key.value == server_key), None
    )
    if overkiz_server is None:
        print(f"✗ Unbekannter Server '{server_key}'")
        return 1

    username = input("Somfy-E-Mail: ").strip()
    password = getpass.getpass("Somfy-Passwort: ")

    # Durchgängig Keyword-Argumente: manche pyoverkiz-Versionen machen
    # username/password keyword-only.
    async with OverkizClient(
        username=username, password=password, server=overkiz_server
    ) as client:
        try:
            await client.login()
            token = await client.generate_local_token(gateway_id)
            await client.activate_local_token(
                gateway_id=gateway_id, token=token, label="HomePilot"
            )
        except Exception as err:
            print(f"✗ Anmeldung/Token fehlgeschlagen: {err}")
            print("  Ist der Entwicklermodus für das Gateway aktiviert?")
            return 1

    token_file = tokenstore.token_file(
        config.data_file, blocks[0] if blocks else None, "overkiz"
    )
    tokenstore.save(token_file, {"token": token})
    print(f"✓ Lokales Token erstellt und in {token_file} gespeichert – jetzt den Hub starten.")
    return 0


async def _geraete_main(config_path: str) -> int:
    """Was das Gateway über jede Store meldet - roh.

    Der Anlass: «Die Store Terrasse ist geöffnet, wird aber als
    geschlossen angezeigt.» Ob das an der Rechnung liegt oder daran, was
    das Gerät meldet, sieht man nur hier. Die App zeigt den fertigen
    Zustand; welche Zustandsnamen dahinterstehen, verrät sie nicht.
    """
    from pyoverkiz.client import OverkizClient
    from pyoverkiz.utils import generate_local_server

    from ..core import tokenstore
    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "overkiz"]
    if not blocks:
        print(f"In {config_path} steht kein overkiz-Block.")
        return 1
    block = blocks[0]
    host = str(block.get("host") or "")
    token = block.get("token") or tokenstore.value(
        tokenstore.token_file(config.data_file, block, "overkiz"), "token"
    )
    if not host or not token:
        print("Ohne host und Token geht es nicht - erst anmelden:")
        print(f"  python -m homepilot.integrations.overkiz -c {config_path}")
        return 1

    async with OverkizClient(
        username="",
        password="",
        server=generate_local_server(host=host),
        token=str(token),
        verify_ssl=False,
    ) as client:
        await client.login()
        geraete = await client.get_devices()

    for device in geraete:
        art = getattr(device, "widget", None) or getattr(device, "ui_class", None)
        print(f"\n{device.label}  ({art})")
        zustaende = {
            str(getattr(state, "name", "")): getattr(state, "value", None)
            for state in (getattr(device, "states", None) or [])
        }
        for name in sorted(zustaende):
            # Die drei, um die es beim Auf und Zu geht, zuerst erkennbar.
            marke = "→" if name in (CLOSURE, DEPLOYMENT, OPEN_CLOSED) else " "
            print(f"  {marke} {name} = {zustaende[name]}")
        print(f"    daraus wird: {cover_state(zustaende)}")
        befehle = sorted(
            str(getattr(befehl, "command_name", befehl))
            for befehl in (getattr(device, "definition", None).commands or [])
        ) if getattr(device, "definition", None) else []
        if befehle:
            print(f"    Kommandos: {', '.join(befehle)}")
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Overkiz-Anmeldung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    parser.add_argument(
        "--geraete",
        action="store_true",
        help="Zeigen, was das Gateway je Store meldet (roh) - statt anzumelden",
    )
    args = parser.parse_args()
    sys.exit(
        asyncio.run(
            _geraete_main(args.config) if args.geraete else _login_main(args.config)
        )
    )
