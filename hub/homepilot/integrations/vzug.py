"""V-ZUG-Geräte über die lokale Home-API.

Konfiguration:
  - integration: vzug
    scan_interval: 60
    devices:
      - host: 192.168.1.40
        name: Geschirrspüler
        username: "${VZUG_USER}"      # optional, nur bei aktivierter Anmeldung
        password: "${VZUG_PASSWORD}"

Die Geräte liefern unter /ai?command=getDeviceStatus ihren Zustand. Die API
ist lesend – Programme lassen sich damit nicht starten, was für Geschirr-
spüler und Backofen auch gut so ist.
"""

from __future__ import annotations

import asyncio
import re
import time
from time import monotonic
from typing import Any

import aiohttp

from ..core.entity import EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


def minutes_until(end_text: str, now_minutes: int) -> int | None:
    """Restminuten aus dem 'End'-Feld (rein, testbar).

    AdoraDish/AdoraWash liefern das Programmende je nach Firmware als
    Uhrzeit «18:05», als Dauer «1h05» / «0h47» oder als Minutenzahl.
    ``now_minutes`` ist die aktuelle Uhrzeit in Minuten seit Mitternacht.
    """
    text = str(end_text).strip().lower()
    if not text:
        return None
    if ":" in text:
        try:
            hours, minutes = text.split(":", 1)
            end = int(hours) * 60 + int(minutes)
        except ValueError:
            return None
        # Endet das Programm «vor jetzt», ist Mitternacht dazwischen.
        return end - now_minutes if end >= now_minutes else end + 24 * 60 - now_minutes
    # Dauer-Formate. Ein einziges Muster statt getrennter Zweige, weil die
    # Firmware zwischen «1h05», «1h 20min» und «45» wechselt - «1h 20min»
    # lief vorher in einen ValueError und die Kachel blieb ohne Restzeit.
    treffer = re.fullmatch(r"(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min(?:uten)?|m)?)?", text)
    if treffer is None or not (treffer.group(1) or treffer.group(2)):
        return None
    return int(treffer.group(1) or 0) * 60 + int(treffer.group(2) or 0)


def parse_device_status(
    payload: dict[str, Any], now_minutes: int | None = None
) -> dict[str, Any]:
    """Übersetzt die Antwort von getDeviceStatus in Entitäts-Attribute.

    'Inactive' kommt als String "true"/"false" – daraus wird der Hauptwert
    idle/running. Aus dem Programmende wird, wo möglich, die Restzeit in
    Minuten berechnet (minutes_left) – die zeigt die App auf der Startseite.
    """
    inactive = str(payload.get("Inactive", "true")).strip().lower() == "true"
    program_end = payload.get("ProgramEnd") or {}
    end_text = (
        (program_end.get("End") or None) if isinstance(program_end, dict) else None
    )
    program = payload.get("Program") or None
    status_text = payload.get("Status") or None
    # «Inactive: false» heisst nur: Die Anzeige ist an. Ohne Programm und
    # ohne Statustext läuft nichts - eine Maschine im Standby (Türe zu,
    # Display wach) stand sonst dauerhaft als «läuft» auf der Startseite.
    laeuft = not inactive and bool(program or status_text)
    result: dict[str, Any] = {
        "state": "running" if laeuft else "idle",
        "program": program,
        "status": status_text,
        "program_end": end_text,
        "serial": payload.get("Serial") or None,
    }
    # Immer setzen, auch als None - und das ist der Kern: Der Hub *merged*
    # Zustandsänderungen (registry.update_state). Ein Feld, das einfach
    # weggelassen wird, behält deshalb seinen alten Wert. Genau daran hing
    # das «noch 1 min», das tagelang an einer längst fertigen Maschine
    # klebte: Das Programmende verschwand aus der Antwort, die Zahl blieb.
    minutes: int | None = None
    if laeuft and end_text:
        if now_minutes is None:
            from datetime import datetime

            local = datetime.now()
            now_minutes = local.hour * 60 + local.minute
        gerechnet = minutes_until(end_text, now_minutes)
        if gerechnet is not None and 0 <= gerechnet <= 24 * 60:
            minutes = gerechnet
    result["minutes_left"] = minutes
    return result


def unfrozen_status(
    status: dict[str, Any],
    merker: dict[str, tuple[int, float]],
    entity_id: str,
    jetzt: float,
    grenze: float = 300.0,
) -> dict[str, Any]:
    """Eine stehengebliebene Restzeit-Anzeige entlarven (rein, testbar).

    Der Fall aus dem Betrieb: Waschmaschine und Geschirrspüler zeigten
    tagelang «noch 1 min», obwohl sie längst fertig waren - manche
    Firmware lässt am Programmende «Inactive: false» samt letzter
    End-Angabe einfach stehen.

    Die Physik hilft: Eine Maschine, die wirklich läuft, zählt runter.
    Meldet ein Gerät über mehr als fünf Minuten dieselbe Restzeit, ist
    das keine Restzeit, sondern eine eingefrorene Anzeige - sie fliegt
    raus, und steht sie auf ≤ 1 Minute, ist das Programm durch und das
    Gerät gilt als fertig.

    ``merker`` hält je Gerät (Minutenzahl, seit wann) und wird hier
    fortgeschrieben - hinein gehört immer dasselbe dict.
    """
    minutes = status.get("minutes_left")
    if not isinstance(minutes, int) or status.get("state") != "running":
        merker.pop(entity_id, None)
        return status
    bisher = merker.get(entity_id)
    if bisher is None or bisher[0] != minutes:
        merker[entity_id] = (minutes, jetzt)
        return status
    if jetzt - bisher[1] <= grenze:
        return status
    # Auf None setzen statt den Schlüssel wegzulassen - sonst holt der
    # Merge in registry.update_state die eingefrorene Zahl zurück.
    result = {**status, "minutes_left": None}
    if minutes <= 1:
        result["state"] = "idle"
    return result


# Wie oft ein Abruf hintereinander scheitern darf, bevor das Gerät als
# ausgefallen gilt. Vorher genügte ein einziger: Die Ausfallliste war
# voll mit Löchern von einer bis vier Minuten, während Waschmaschine und
# Geschirrspüler die ganze Zeit am Netz hingen.
AUSFAELLE_BIS_WEG = 3

# «503 Service Unavailable» ist bei diesen Geräten kein Fehler, sondern
# eine Auskunft: «bin da, bediene aber gerade nicht». Im Protokoll einer
# ganzen Nacht steht das im festen Takt – rund vier Minuten 503, rund
# zwei Minuten Antwort, und das ohne ein einziges laufendes Programm. Das
# ist der Standby-Rhythmus des eingebauten Webservers.
#
# Wer das als Ausfall führt, schreibt jede Nacht hundert Zeilen über ein
# Gerät, das ruhig in der Küche steht. Der letzte bekannte Zustand bleibt
# also stehen, und das Gerät gilt weiter als erreichbar.
BESCHAEFTIGT = 503

# Irgendwann ist «gerade nicht» dann doch ein Ausfall. Eine halbe Stunde
# deckt den beobachteten Takt um ein Vielfaches ab; was länger schweigt,
# hat ein echtes Problem.
BESCHAEFTIGT_HOECHSTENS = 30 * 60

# Während das Gerät 503 meldet, immer seltener nachfragen: Es hilft
# niemandem, einen schlafenden Webserver im Minutentakt zu wecken.
RUHE_HOECHSTENS = 300.0

# Zweiter Versuch im selben Durchgang. Der kleine Webserver im Gerät
# nimmt nicht jede Verbindung an; nach ein paar Sekunden klappt es
# meistens. Das ist billiger als eine Minute bis zum nächsten Takt zu
# warten und dabei als «weg» dazustehen.
VERSUCHE = 2
PAUSE_VOR_ZWEITEM_VERSUCH = 3.0

# Der Wert, mit dem eine Kachel ins Leben tritt: «noch nie etwas gehört».
# Ein Platzhalter, kein Messwert.
UNBEKANNT = "unknown"

# Und der Wert für das, was ein 503 tatsächlich sagt: Gerät am Netz,
# Anzeige schläft. Bewusst nicht «idle»: «fertig» ist eine Aussage über
# ein Programm, das gelaufen ist - der Wächter macht daraus einen
# Programmlauf im Protokoll und irgendwann ein «ist noch voll». Aus
# einem schlafenden Webserver lässt sich das nicht ablesen.
STANDBY = "standby"


def standby_grund(host: str) -> str:
    """Der Satz zum 503 – an zwei Stellen gebraucht, also einmal hier."""
    return (
        f"{host} ist am Netz, bedient aber gerade nicht (HTTP 503). Das "
        "ist der Standby-Takt des eingebauten Webservers; hält es über "
        "Stunden an, hilft nur, das Gerät einmal stromlos zu machen."
    )


def stoerungsgrund(host: str, fehler: BaseException) -> str:
    """Aus einem misslungenen Abruf einen Satz machen, der weiterhilft.
    (rein, testbar)

    Der Anlass: In der Ausfallliste standen Geschirrspüler und
    Waschmaschine als «nie gesehen» – ohne ein Wort dazu, warum. Der
    Grund stand im Log des Hubs, also genau dort, wo niemand nachsieht,
    der gerade in der Küche steht. Was hier herauskommt, hängt an der
    Kachel.

    Die Fälle sind wenige und unterscheiden sich in dem, was zu tun ist:
    Eine neue DHCP-Adresse verlangt eine Änderung in der Konfiguration,
    ein 401 verlangt Zugangsdaten, ein 503 verlangt Geduld. Alles in
    einen «nicht erreichbar»-Topf zu werfen, verschweigt genau diesen
    Unterschied.
    """
    if isinstance(fehler, aiohttp.ClientResponseError):
        if fehler.status in (401, 403):
            return (
                f"{host} verlangt eine Anmeldung (HTTP {fehler.status}). "
                "Im Gerät unter «Netzwerk» stehen Benutzername und "
                "Passwort; sie gehören als username/password in die "
                "Gerätezeile der Konfiguration."
            )
        if fehler.status == BESCHAEFTIGT:
            return standby_grund(host)
        return f"{host} antwortet mit HTTP {fehler.status} ({fehler.message})."
    if isinstance(fehler, TimeoutError | asyncio.TimeoutError):
        return (
            f"{host} nimmt die Verbindung an, antwortet aber nicht "
            "rechtzeitig. Meist steht dort inzwischen ein anderes Gerät – "
            "die Adresse im Router prüfen."
        )
    if isinstance(fehler, aiohttp.ClientConnectorError | OSError):
        return (
            f"Unter {host} meldet sich nichts ({fehler}). V-ZUG-Geräte "
            "bekommen ihre Adresse per DHCP und wechseln sie beim "
            "Neustart des Routers – im Router nachsehen, host anpassen "
            "und dem Gerät am besten eine feste Adresse geben."
        )
    return f"{host}: {fehler}"


def wartezeit(runden: int, takt: float, hoechstens: float = RUHE_HOECHSTENS) -> float:
    """Wie lange nach einem «gerade nicht» gewartet wird (rein, testbar).

    Verdoppelt sich mit jeder Runde, bis zur Obergrenze. Nie kürzer als
    der normale Takt – schneller nachzufragen als sonst wäre verkehrt
    herum.
    """
    if runden <= 0:
        return takt
    return min(hoechstens, takt * (2 ** (runden - 1)))


class VZugIntegration(Integration):
    name = "vzug"

    async def setup(self) -> None:
        devices = self.config.get("devices") or []
        if not devices:
            raise ConfigError("vzug braucht mindestens ein Gerät unter 'devices'")
        self._interval = self.scan_interval()
        # Zwei Dinge, die dieser Gerätetyp braucht:
        #
        # force_close – V-ZUG-Geräte schliessen eine ruhende Verbindung
        # nach kurzer Zeit von sich aus. aiohttp weiss davon nichts,
        # greift beim nächsten Takt zum selben Socket und bekommt ein
        # «Server disconnected». Das war ein Ausfall, der nie einer war.
        #
        # limit_per_host – der eingebaute Webserver beantwortet immer nur
        # eine Anfrage. Zwei gleichzeitig, und eine davon fällt hin.
        self._session = self.http_session(
            connector=aiohttp.TCPConnector(force_close=True, limit_per_host=1),
        )

        # entity_id → (host, auth)
        self._devices: dict[str, tuple[str, aiohttp.BasicAuth | None]] = {}
        # Je Gerät: welche Restzeit zuletzt gemeldet wurde und seit wann -
        # für die Eingefroren-Erkennung (siehe unfrozen_status).
        self._countdown: dict[str, tuple[int, float]] = {}
        # Geräte, die gerade nicht antworten. V-ZUG-Geräte schlafen im
        # Standby und melden dann 503 – bei jedem Abruf eine Warnung zu
        # schreiben flutet das Log und begräbt alles Wichtige darunter.
        self._down: set[str] = set()
        # Je Gerät: wie viele Abrufe hintereinander misslungen sind.
        self._fehlversuche: dict[str, int] = {}
        # Seit wann ein Gerät «beschäftigt» meldet, wie oft in Folge, und
        # bis wann es deshalb in Ruhe gelassen wird.
        self._beschaeftigt_seit: dict[str, float] = {}
        self._beschaeftigt_runden: dict[str, int] = {}
        self._ruhe_bis: dict[str, float] = {}
        for device in devices:
            host = device.get("host")
            if not host:
                raise ConfigError("vzug: jedes Gerät braucht einen 'host'")
            username, password = device.get("username"), device.get("password")
            auth = (
                aiohttp.BasicAuth(username, password) if username and password else None
            )
            entity = await self.add_entity(
                str(host).replace(".", "_"),
                EntityKind.APPLIANCE,
                device.get("name", f"V-ZUG {host}"),
                state={"state": UNBEKANNT},
                available=False,
            )
            self._devices[entity.id] = (host, auth)

        await self._refresh_all()
        self.start_task(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh_all()

    async def _refresh_all(self) -> None:
        for entity_id, (host, auth) in self._devices.items():
            # Meldet das Gerät gerade «beschäftigt», wird es in Ruhe
            # gelassen, bis die Wartezeit um ist.
            if monotonic() < self._ruhe_bis.get(entity_id, 0.0):
                continue
            await self._refresh(entity_id, host, auth)

    async def _holen(self, host: str, auth: aiohttp.BasicAuth | None) -> Any:
        """Einmal nach dem Zustand fragen. Wirft, wenn es nicht klappt."""
        async with self._session.get(
            f"http://{host}/ai",
            params={"command": "getDeviceStatus"},
            auth=auth,
        ) as response:
            response.raise_for_status()
            # Die Geräte senden JSON teils als text/plain.
            return await response.json(content_type=None)

    async def _refresh(
        self, entity_id: str, host: str, auth: aiohttp.BasicAuth | None
    ) -> None:
        payload: Any = None
        fehler: Exception | None = None
        beschaeftigt = False
        for versuch in range(VERSUCHE):
            if versuch:
                await asyncio.sleep(PAUSE_VOR_ZWEITEM_VERSUCH)
            try:
                payload = await self._holen(host, auth)
                fehler = None
                break
            except aiohttp.ClientResponseError as err:
                fehler = err
                if err.status == BESCHAEFTIGT:
                    # Gleich noch einmal zu fragen hilft nicht: Diese
                    # Phase dauert Minuten, nicht Sekunden.
                    beschaeftigt = True
                    break
            except Exception as err:
                fehler = err

        if beschaeftigt:
            await self._melde_beschaeftigt(entity_id, host)
            return

        if fehler is not None:
            offen = self._fehlversuche.get(entity_id, 0) + 1
            self._fehlversuche[entity_id] = offen
            # Ein verlorener Abruf ist kein Ausfall. Das Gerät behält
            # seinen letzten Zustand, bis es wirklich mehrfach schweigt -
            # sonst steht in der Liste ein Loch von einer Minute, weil ein
            # Paket unterwegs verlorenging.
            if offen < AUSFAELLE_BIS_WEG:
                self.log.debug(
                    "V-ZUG %s hat nicht geantwortet (%d/%d): %s",
                    host,
                    offen,
                    AUSFAELLE_BIS_WEG,
                    fehler,
                )
                return
            # Nur beim Übergang warnen, danach still bleiben: Ein Gerät im
            # Standby wäre sonst jede Minute eine Zeile.
            grund = stoerungsgrund(host, fehler)
            if entity_id not in self._down:
                self._down.add(entity_id)
                self.log.warning("V-ZUG %s nicht erreichbar: %s", host, grund)
            else:
                self.log.debug("V-ZUG %s weiterhin nicht erreichbar: %s", host, fehler)
            # Der Grund gehört an die Kachel, nicht nur ins Log: «nie
            # gesehen» allein sagt, dass etwas fehlt, aber nicht, ob die
            # Adresse veraltet ist oder das Gerät Zugangsdaten will.
            await self.hub.registry.update_state(
                entity_id, {"problem": grund}, available=False
            )
            return

        self._fehlversuche[entity_id] = 0
        self._beschaeftigt_seit.pop(entity_id, None)
        self._beschaeftigt_runden.pop(entity_id, None)
        self._ruhe_bis.pop(entity_id, None)
        if entity_id in self._down:
            self._down.discard(entity_id)
            self.log.info("V-ZUG %s wieder erreichbar", host)
        status = unfrozen_status(
            parse_device_status(payload), self._countdown, entity_id, time.time()
        )
        await self.hub.registry.update_state(
            entity_id, {**status, "problem": None}, available=True
        )

    async def _melde_beschaeftigt(self, entity_id: str, host: str) -> None:
        """Das Gerät ist da, bedient aber gerade nicht.

        Der letzte bekannte Zustand bleibt stehen und das Gerät gilt
        weiter als erreichbar – alles andere hiesse, den Standby-Takt des
        Geräts als Ausfall zu führen. Nur wenn es sehr lange dabei
        bleibt, ist es doch einer.
        """
        jetzt = monotonic()
        seit = self._beschaeftigt_seit.setdefault(entity_id, jetzt)
        runden = self._beschaeftigt_runden.get(entity_id, 0) + 1
        self._beschaeftigt_runden[entity_id] = runden
        self._ruhe_bis[entity_id] = jetzt + wartezeit(runden, self._interval)

        dauer = jetzt - seit
        if dauer < BESCHAEFTIGT_HOECHSTENS:
            self.log.debug(
                "V-ZUG %s bedient gerade nicht (503, seit %.0f s) – nächster "
                "Versuch in %.0f s",
                host,
                dauer,
                self._ruhe_bis[entity_id] - jetzt,
            )
            # Ein Gerät, das den Hub-Start verschlafen hat, stand hier bis
            # zu einer halben Stunde als «nie gesehen» ohne ein Wort dazu.
            # Die Erreichbarkeit bleibt bewusst unangetastet – 503 ist
            # kein Ausfall –, aber der Satz gehört an die Kachel.
            entity = self.hub.registry.get(entity_id)
            if entity is not None and entity.last_seen is None:
                aenderungen: dict[str, Any] = {"problem": standby_grund(host)}
                # Und der Zustand dazu. Das ist der Fall aus der Küche:
                # Die Maschinen schlafen fast immer, der Hub wird beim
                # Bauen neu gestartet - und weil ein 503 nie einen
                # Zustand geschrieben hat, blieb der Platzhalter aus dem
                # Setup stehen. Unter «Waschmaschine» stand dann roh das
                # englische «unknown», stundenlang.
                #
                # Wir wissen aber etwas: Das Gerät antwortet, es bedient
                # nur nicht. Das ist Standby, und mehr behauptet der Wert
                # auch nicht. Nur der Platzhalter wird ersetzt - eine
                # echte Messung von vorhin bleibt, wie sie war.
                if str(entity.state.get("state") or "") in ("", UNBEKANNT):
                    aenderungen["state"] = STANDBY
                await self.hub.registry.update_state(entity_id, aenderungen)
            return

        if entity_id not in self._down:
            self._down.add(entity_id)
            self.log.warning(
                "V-ZUG %s meldet seit %.0f Minuten «503 – bedient nicht». "
                "Sonst dauert das Minuten, nicht Stunden: Gerät stromlos "
                "machen oder im Netz nachsehen.",
                host,
                dauer / 60,
            )
        await self.hub.registry.update_state(
            entity_id,
            {
                "problem": (
                    f"{host} meldet seit {dauer / 60:.0f} Minuten «503 – "
                    "bedient nicht». Sonst dauert das Minuten, nicht "
                    "Stunden: Gerät einmal stromlos machen."
                )
            },
            available=False,
        )


INTEGRATION = VZugIntegration
