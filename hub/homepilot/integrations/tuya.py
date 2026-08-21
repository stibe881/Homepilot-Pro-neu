"""Tuya – Lampen, Steckdosen und Projektoren, lokal im eigenen Netz.

Konfiguration:
  - integration: tuya
    devices:
      - name: Sternenprojektor
        id: bf1234567890abcdefgh
        key: "0123456789abcdef"      # lokaler Schlüssel, siehe docs/tuya.md
        # ip: 192.168.1.77           # optional; sonst wird gesucht
        # version: 3.4               # optional, Standard 3.3
        # kind: light                # light (Standard) | switch
        # Zusätzliche Schalter am selben Gerät, z.B. die Laserpunkte:
        # switches:
        #   - name: Sterne
        #     dp: 101

Voraussetzung:  pip install "homepilot[tuya]"  bzw.  pip install tinytuya

Warum lokal und nicht über die Tuya-Cloud: Ein Gerät im eigenen
Wohnzimmer soll nicht davon abhängen, ob ein Rechenzentrum in Shenzhen
erreichbar ist. Der lokale Weg antwortet in Millisekunden, funktioniert
ohne Internet und meldet Änderungen von selbst - auch die, die jemand am
Gerät oder in der Hersteller-App macht.

Der Preis dafür ist der lokale Schlüssel: Tuya verschlüsselt auch im
eigenen Netz, und den Schlüssel gibt es nur über ein (kostenloses)
Entwicklerkonto beim Hersteller. Einmalig, danach nie wieder -
docs/tuya.md führt Schritt für Schritt hindurch, und

    python -m homepilot.integrations.tuya --cloud

holt die Schlüssel aller Geräte auf einmal und schreibt den fertigen
Konfigurationsblock hin.

Was ein Gerät kann, steht bei Tuya nicht in einem Namen, sondern in
nummerierten Datenpunkten («DPS»). Die Nummern sind je nach Gerät anders.
Die verbreitete Belegung für Lampen ist voreingestellt (siehe DEFAULT_DPS);
was ein bestimmtes Gerät wirklich meldet, zeigt

    python -m homepilot.integrations.tuya -c config.yaml --dps Sternenprojektor
"""

from __future__ import annotations

import asyncio
import json
import queue
import threading
import time
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Die verbreitete Belegung neuerer Tuya-Lampen. Ältere Geräte benutzen
# 1-6 statt 20-25; beides lässt sich in der Konfiguration überschreiben.
DEFAULT_DPS = {
    "switch": 20,
    "mode": 21,
    "brightness": 22,
    "color_temp": 23,
    "color": 24,
    "scene": 25,
}
LEGACY_DPS = {
    "switch": 1,
    "mode": 2,
    "brightness": 3,
    "color_temp": 4,
    "color": 5,
    "scene": 6,
}

# Tuya rechnet Helligkeit in 10..1000 (neuere Geräte) bzw. 25..255
# (ältere). Unten wird nicht auf 0 gegangen: Eine Lampe mit Helligkeit 0
# ist bei Tuya nicht aus, sondern kaputt anzusehen.
BRIGHTNESS_RANGE = (10, 1000)
LEGACY_BRIGHTNESS_RANGE = (25, 255)

# Farbtemperatur: Tuya zählt 0 (warm) bis 1000 (kalt), der Hub rechnet wie
# Hue in Mired. 2700 K sind 370 Mired, 6500 K sind 153.
MIRED_WARM = 370
MIRED_COLD = 153

# Wie oft ein Lebenszeichen nötig ist, damit das Gerät die Verbindung
# offen lässt. Tuya wirft nach etwa 30 Sekunden Stille hinaus.
HEARTBEAT_SECONDS = 9
# Vollständige Abfrage - nur als Rückfall. Der Regelfall ist, dass das
# Gerät Änderungen von selbst meldet.
REFRESH_SECONDS = 60


def dps_map(config: dict[str, Any]) -> dict[str, int]:
    """Welche Nummer welche Eigenschaft ist (rein, testbar).

    Voreingestellt ist die verbreitete Belegung; `legacy: true` schaltet
    auf die alte Zählweise um, und einzelne Nummern lassen sich darüber
    hinaus überschreiben. `null` schaltet eine Eigenschaft ab - nützlich
    für Geräte, die zwar eine Nummer belegen, aber Unsinn darunter führen.
    """
    basis = dict(LEGACY_DPS if config.get("legacy") else DEFAULT_DPS)
    for schluessel, wert in (config.get("dps") or {}).items():
        if wert is None:
            basis.pop(schluessel, None)
        else:
            basis[schluessel] = int(wert)
    return basis


def brightness_range(config: dict[str, Any]) -> tuple[int, int]:
    """Der Zahlenbereich der Helligkeit (rein, testbar)."""
    roh = config.get("brightness_range")
    if isinstance(roh, (list, tuple)) and len(roh) == 2:
        return (int(roh[0]), int(roh[1]))
    return LEGACY_BRIGHTNESS_RANGE if config.get("legacy") else BRIGHTNESS_RANGE


def to_percent(raw: Any, bereich: tuple[int, int]) -> int | None:
    """Tuya-Helligkeit in Prozent (rein, testbar)."""
    try:
        wert = float(raw)
    except (TypeError, ValueError):
        return None
    unten, oben = bereich
    if oben <= unten:
        return None
    anteil = (wert - unten) / (oben - unten)
    return max(0, min(100, round(anteil * 100)))


def from_percent(percent: Any, bereich: tuple[int, int]) -> int:
    """Prozent in Tuya-Helligkeit (rein, testbar)."""
    try:
        wert = float(percent)
    except (TypeError, ValueError):
        wert = 100.0
    wert = max(0.0, min(100.0, wert))
    unten, oben = bereich
    return round(unten + (oben - unten) * wert / 100)


def to_mired(raw: Any) -> int | None:
    """Tuya-Farbtemperatur (0 warm .. 1000 kalt) in Mired (rein, testbar)."""
    try:
        wert = float(raw)
    except (TypeError, ValueError):
        return None
    anteil = max(0.0, min(1.0, wert / 1000.0))
    return round(MIRED_WARM - anteil * (MIRED_WARM - MIRED_COLD))


def from_mired(mired: Any) -> int:
    """Mired in Tuya-Farbtemperatur (rein, testbar)."""
    try:
        wert = float(mired)
    except (TypeError, ValueError):
        wert = MIRED_WARM
    wert = max(MIRED_COLD, min(MIRED_WARM, wert))
    anteil = (MIRED_WARM - wert) / (MIRED_WARM - MIRED_COLD)
    return round(anteil * 1000)


def hsv_to_hex(h: float, s: float, v: float) -> str:
    """HSV in «#RRGGBB» (rein, testbar). h in Grad, s und v in 0..1."""
    h = h % 360
    s = max(0.0, min(1.0, s))
    v = max(0.0, min(1.0, v))
    c = v * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = v - c
    reihen = [(c, x, 0.0), (x, c, 0.0), (0.0, c, x), (0.0, x, c), (x, 0.0, c), (c, 0.0, x)]
    r, g, b = reihen[int(h // 60) % 6]
    return "#" + "".join(f"{round((wert + m) * 255):02X}" for wert in (r, g, b))


def hex_to_hsv(farbe: str) -> tuple[float, float, float]:
    """«#RRGGBB» in HSV (rein, testbar). h in Grad, s und v in 0..1."""
    text = str(farbe).strip().lstrip("#")
    if len(text) == 3:
        text = "".join(zeichen * 2 for zeichen in text)
    if len(text) != 6:
        raise ValueError(f"'{farbe}' ist keine Farbe der Form #RRGGBB")
    r, g, b = (int(text[i : i + 2], 16) / 255 for i in (0, 2, 4))
    gross, klein = max(r, g, b), min(r, g, b)
    spanne = gross - klein
    if spanne == 0:
        h = 0.0
    elif gross == r:
        h = (60 * ((g - b) / spanne)) % 360
    elif gross == g:
        h = 60 * ((b - r) / spanne) + 120
    else:
        h = 60 * ((r - g) / spanne) + 240
    return (h, 0.0 if gross == 0 else spanne / gross, gross)


def decode_color(roh: Any) -> str | None:
    """Tuyas Farbzeichenkette in «#RRGGBB» (rein, testbar).

    Zwei Formate sind im Umlauf: zwölf Zeichen (HHHH SSSS VVVV, neuere
    Geräte) und vierzehn (RRGGBB HHHH SS VV, ältere). Beim langen wären
    die ersten sechs Zeichen schon die Antwort - gerechnet wird trotzdem
    aus HSV, weil manche Geräte das RGB-Feld nicht mitführen.
    """
    text = str(roh or "").strip()
    try:
        if len(text) == 12:
            h = int(text[0:4], 16)
            s = int(text[4:8], 16) / 1000
            v = int(text[8:12], 16) / 1000
        elif len(text) == 14:
            h = int(text[6:10], 16)
            s = int(text[10:12], 16) / 255
            v = int(text[12:14], 16) / 255
        else:
            return None
    except ValueError:
        return None
    return hsv_to_hex(h, min(s, 1.0), min(v, 1.0))


def encode_color(farbe: str, *, legacy: bool = False) -> str:
    """«#RRGGBB» in Tuyas Farbzeichenkette (rein, testbar)."""
    h, s, v = hex_to_hsv(farbe)
    if legacy:
        roh = str(farbe).strip().lstrip("#").upper()
        if len(roh) == 3:
            roh = "".join(zeichen * 2 for zeichen in roh)
        return f"{roh}{round(h):04x}{round(s * 255):02x}{round(v * 255):02x}"
    return f"{round(h):04x}{round(s * 1000):04x}{round(v * 1000):04x}"


def light_state(
    dps: dict[str, Any], nummern: dict[str, int], bereich: tuple[int, int]
) -> dict[str, Any]:
    """Die gemeldeten Datenpunkte in einen Entitätszustand (rein, testbar).

    Nur was das Gerät wirklich schickt, landet im Zustand. Tuya meldet bei
    einer Änderung oft nur den einen geänderten Punkt - würde hier für
    jeden fehlenden ein Standardwert entstehen, überschriebe die nächste
    Meldung «heller» die Farbe mit Weiss.
    """
    zustand: dict[str, Any] = {}
    for name, nummer in nummern.items():
        schluessel = str(nummer)
        if schluessel not in dps:
            continue
        wert = dps[schluessel]
        if name == "switch":
            zustand["state"] = "on" if wert else "off"
        elif name == "brightness":
            prozent = to_percent(wert, bereich)
            if prozent is not None:
                zustand["brightness"] = prozent
        elif name == "color_temp":
            mired = to_mired(wert)
            if mired is not None:
                zustand["color_temp"] = mired
        elif name == "color":
            farbe = decode_color(wert)
            if farbe:
                zustand["color"] = farbe
        elif name == "mode":
            zustand["mode"] = str(wert)
    return zustand


# Was Tuya im Fehlerfall zurückgibt, ist eine Nummer. Die drei, die man
# beim Einrichten wirklich trifft, in Klartext - sonst sucht man nach
# «Err 914» und findet Forenbeiträge von 2019.
TUYA_ERRORS = {
    "901": "Das Gerät hat die Verbindung abgewiesen – meist ist die IP falsch.",
    "905": "Das Gerät antwortet nicht. Ist es am Strom und im selben Netz?",
    "914": (
        "Schlüssel oder Protokollfassung passen nicht. Die Fassung zeigt "
        "--scan; der Schlüssel ändert sich, sobald das Gerät in der "
        "Hersteller-App neu angelernt wurde – dann --cloud noch einmal."
    ),
}


def error_hint(antwort: Any) -> str | None:
    """Aus Tuyas Fehlernummer einen brauchbaren Satz machen (rein, testbar)."""
    if not isinstance(antwort, dict):
        return None
    nummer = str(antwort.get("Err") or "").strip()
    return TUYA_ERRORS.get(nummer)


def light_commands(nummern: dict[str, int], kind: str) -> list[str]:
    """Welche Kommandos das Gerät anbieten darf (rein, testbar).

    Nur was eine Nummer hat: Ein Knopf «Farbe» auf einer Steckdose wäre
    ein Versprechen, das der Hub nicht halten kann.
    """
    befehle = ["turn_on", "turn_off", "toggle"]
    if kind != EntityKind.LIGHT:
        return befehle
    if "brightness" in nummern:
        befehle.append("set_brightness")
    if "color_temp" in nummern:
        befehle.append("set_color_temp")
    if "color" in nummern:
        befehle.append("set_color")
    return befehle


class TuyaIntegration(Integration):
    name = "tuya"

    async def setup(self) -> None:
        try:
            import tinytuya  # noqa: F401 – nur Verfügbarkeit prüfen
        except ImportError as err:
            raise ConfigError(
                "tinytuya fehlt – installieren mit: pip install tinytuya"
            ) from err

        devices = self.config.get("devices") or []
        if not devices:
            raise ConfigError("tuya: 'devices' ist leer – kein Gerät zu bedienen")

        self._loop = asyncio.get_running_loop()
        # Je Gerät ein Arbeiter mit einem eigenen Draht zum Gerät. Zwei
        # Fäden auf demselben Socket vertragen sich bei tinytuya nicht;
        # deshalb schickt niemand direkt, sondern legt in die Schlange.
        self._queues: dict[str, queue.Queue] = {}
        # Je Gerät merken, ob der Klartext-Hinweis schon im Log stand.
        self._gemeldet: dict[str, bool] = {}
        self._workers: dict[str, threading.Thread] = {}
        self._stop = threading.Event()
        self._geraete: dict[str, dict[str, Any]] = {}
        # Entitäts-ID -> (Gerät, Datenpunkt) für die Zusatzschalter.
        self._extra: dict[str, tuple[str, int]] = {}

        for block in devices:
            await self._add_device(block)

        for schluessel in list(self._geraete):
            arbeiter = threading.Thread(
                target=self._worker,
                args=(schluessel,),
                name=f"tuya-{schluessel}",
                daemon=True,
            )
            self._workers[schluessel] = arbeiter
            arbeiter.start()

    async def _add_device(self, block: dict[str, Any]) -> None:
        geraete_id = str(block.get("id") or "").strip()
        key = str(block.get("key") or "").strip()
        if not geraete_id or not key:
            raise ConfigError(
                "tuya: jedes Gerät braucht 'id' und 'key' – die holt "
                "'python -m homepilot.integrations.tuya --cloud'"
            )
        name = str(block.get("name") or geraete_id)
        kind = EntityKind.SWITCH if block.get("kind") == "switch" else EntityKind.LIGHT
        nummern = dps_map(block)
        bereich = brightness_range(block)

        entity = await self.add_entity(
            geraete_id,
            kind,
            name,
            state={"state": "off"},
            commands=light_commands(nummern, kind),
            available=False,
        )
        self._geraete[geraete_id] = {
            "config": block,
            "entity_id": entity.id,
            "dps": nummern,
            "range": bereich,
            "legacy": bool(block.get("legacy")),
        }
        self._queues[geraete_id] = queue.Queue()

        # Zusatzschalter: Ein Sternenprojektor hat neben dem Licht noch die
        # Laserpunkte und die Wellen - eigene Datenpunkte ohne festen
        # Namen. Als eigene Schalter sind sie in App, Szenen und Abläufen
        # sofort brauchbar, ohne dass es dafür eine besondere Kachel
        # bräuchte.
        for zusatz in block.get("switches") or []:
            dp = zusatz.get("dp")
            if dp is None:
                raise ConfigError("tuya: jeder Zusatzschalter braucht ein 'dp'")
            unter = await self.add_entity(
                f"{geraete_id}_{int(dp)}",
                EntityKind.SWITCH,
                str(zusatz.get("name") or f"{name} {dp}"),
                state={"state": "off"},
                commands=["turn_on", "turn_off", "toggle"],
                available=False,
            )
            self._extra[unter.id] = (geraete_id, int(dp))

    async def teardown(self) -> None:
        self._stop.set()
        for schlange in getattr(self, "_queues", {}).values():
            # Aufwecken, damit der Arbeiter nicht bis zum Zeitablauf wartet.
            schlange.put(None)
        for arbeiter in getattr(self, "_workers", {}).values():
            arbeiter.join(timeout=5)
        await super().teardown()

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    def _connect(self, schluessel: str) -> Any:
        """Verbindung aufbauen (läuft im Arbeitsfaden)."""
        import tinytuya

        block = self._geraete[schluessel]["config"]
        device = tinytuya.Device(
            schluessel,
            address=block.get("ip") or None,
            local_key=str(block.get("key")),
            persist=True,
        )
        device.set_version(float(block.get("version", 3.3)))
        device.set_socketPersistent(True)
        device.set_socketTimeout(5)
        return device

    def _worker(self, schluessel: str) -> None:
        """Ein Faden je Gerät: schickt, lauscht, hält die Leitung warm.

        Der lauschende Teil ist der eigentliche Gewinn: Tuya meldet jede
        Änderung von selbst - auch die, die jemand am Gerät oder in der
        Hersteller-App macht. Ohne ihn wüsste der Hub erst bei der
        nächsten Abfrage davon.
        """
        schlange = self._queues[schluessel]
        device: Any = None
        letzter_schlag = 0.0
        letzte_abfrage = 0.0
        fehler_gemeldet = False

        while not self._stop.is_set():
            try:
                if device is None:
                    device = self._connect(schluessel)
                    antwort = device.status()
                    self._melden(schluessel, antwort, verfuegbar=True)
                    if fehler_gemeldet:
                        self.log.info("Tuya-Gerät %s wieder erreichbar", schluessel)
                    fehler_gemeldet = False
                    letzter_schlag = letzte_abfrage = time.time()

                gesendet = False
                while True:
                    try:
                        auftrag = schlange.get_nowait()
                    except queue.Empty:
                        break
                    if auftrag is None:
                        break
                    nutzlast, future = auftrag
                    try:
                        antwort = device.set_multiple_values(nutzlast)
                        self._melden(schluessel, antwort, verfuegbar=True)
                        self._erledigt(future, None)
                    except Exception as err:  # Leitung neu aufbauen
                        self._erledigt(future, err)
                        raise
                    gesendet = True

                if self._stop.is_set():
                    break

                jetzt = time.time()
                if gesendet:
                    letzter_schlag = jetzt
                elif jetzt - letzter_schlag >= HEARTBEAT_SECONDS:
                    device.heartbeat(True)
                    letzter_schlag = jetzt

                if jetzt - letzte_abfrage >= REFRESH_SECONDS:
                    self._melden(schluessel, device.status(), verfuegbar=True)
                    letzte_abfrage = jetzt

                antwort = device.receive()
                if antwort:
                    self._melden(schluessel, antwort, verfuegbar=True)
            except Exception as err:
                if not fehler_gemeldet:
                    self.log.warning(
                        "Tuya-Gerät %s nicht erreichbar: %s – wird weiter versucht",
                        schluessel,
                        err,
                    )
                    fehler_gemeldet = True
                self._melden(schluessel, None, verfuegbar=False)
                if device is not None:
                    try:
                        device.close()
                    except Exception:
                        pass
                    device = None
                self._stop.wait(10)

        if device is not None:
            try:
                device.close()
            except Exception:
                pass

    def _erledigt(self, future: Any, fehler: Exception | None) -> None:
        """Das Ergebnis eines Kommandos zurück in die Ereignisschleife."""

        def setzen() -> None:
            if future.done():
                return
            if fehler is None:
                future.set_result(None)
            else:
                future.set_exception(fehler)

        self._loop.call_soon_threadsafe(setzen)

    def _melden(self, schluessel: str, antwort: Any, *, verfuegbar: bool) -> None:
        """Aus dem Arbeitsfaden zurück in die Ereignisschleife."""
        dps = {}
        if isinstance(antwort, dict):
            if antwort.get("Error"):
                verfuegbar = False
                # Einmal im Klartext sagen, was die Nummer bedeutet -
                # sonst steht «Err 914» im Log und man sucht in Foren.
                hinweis = error_hint(antwort)
                if hinweis and not self._gemeldet.get(schluessel):
                    self._gemeldet[schluessel] = True
                    self.log.warning("Tuya-Gerät %s: %s", schluessel, hinweis)
            else:
                self._gemeldet.pop(schluessel, None)
            dps = antwort.get("dps") or {}
        asyncio.run_coroutine_threadsafe(
            self._uebernehmen(schluessel, dps, verfuegbar), self._loop
        )

    async def _uebernehmen(
        self, schluessel: str, dps: dict[str, Any], verfuegbar: bool
    ) -> None:
        geraet = self._geraete.get(schluessel)
        if geraet is None:
            return
        zustand = light_state(dps, geraet["dps"], geraet["range"]) if dps else {}
        await self.hub.registry.update_state(
            geraet["entity_id"], zustand, available=verfuegbar
        )
        for entity_id, (gehoert_zu, dp) in self._extra.items():
            if gehoert_zu != schluessel:
                continue
            teil: dict[str, Any] = {}
            if str(dp) in dps:
                teil["state"] = "on" if dps[str(dp)] else "off"
            await self.hub.registry.update_state(entity_id, teil, available=verfuegbar)

    # ── Hub → Gerät ────────────────────────────────────────────────────────

    async def handle_command(
        self, entity: Entity, command: str, data: dict[str, Any]
    ) -> None:
        if entity.id in self._extra:
            schluessel, dp = self._extra[entity.id]
            an = command == "turn_on" or (
                command == "toggle" and entity.state.get("state") != "on"
            )
            await self._senden(schluessel, {dp: an})
            return

        schluessel = entity.id.split(".", 1)[1]
        geraet = self._geraete.get(schluessel)
        if geraet is None:
            raise ConfigError(f"Gerät '{entity.id}' gehört nicht zu dieser Integration")
        nummern = geraet["dps"]
        nutzlast: dict[int, Any] = {}

        if command in ("turn_on", "turn_off", "toggle"):
            an = command == "turn_on" or (
                command == "toggle" and entity.state.get("state") != "on"
            )
            nutzlast[nummern["switch"]] = an
        elif command == "set_brightness":
            prozent = data.get("brightness", 100)
            # Auf 0 gestellt heisst «aus» - nicht «an, aber unsichtbar».
            if float(prozent or 0) <= 0:
                nutzlast[nummern["switch"]] = False
            else:
                nutzlast[nummern["switch"]] = True
                nutzlast[nummern["brightness"]] = from_percent(prozent, geraet["range"])
                if "mode" in nummern:
                    nutzlast[nummern["mode"]] = "white"
        elif command == "set_color_temp":
            nutzlast[nummern["switch"]] = True
            nutzlast[nummern["color_temp"]] = from_mired(
                data.get("color_temp", data.get("mirek", MIRED_WARM))
            )
            if "mode" in nummern:
                nutzlast[nummern["mode"]] = "white"
        elif command == "set_color":
            farbe = data.get("color") or data.get("hex")
            if not farbe:
                raise ConfigError("set_color braucht eine Farbe der Form #RRGGBB")
            nutzlast[nummern["switch"]] = True
            nutzlast[nummern["color"]] = encode_color(
                str(farbe), legacy=geraet["legacy"]
            )
            if "mode" in nummern:
                nutzlast[nummern["mode"]] = "colour"
        else:
            raise ConfigError(f"Kommando '{command}' gibt es hier nicht")

        await self._senden(schluessel, nutzlast)

    async def _senden(self, schluessel: str, nutzlast: dict[int, Any]) -> None:
        """Auftrag in die Schlange des Arbeiters und auf die Antwort warten."""
        future: asyncio.Future = self._loop.create_future()
        self._queues[schluessel].put(({str(dp): wert for dp, wert in nutzlast.items()}, future))
        try:
            await asyncio.wait_for(future, timeout=15)
        except asyncio.TimeoutError as err:
            raise ConnectionError(
                f"Tuya-Gerät {schluessel} antwortet nicht"
            ) from err
        except Exception as err:
            raise ConnectionError(f"Tuya-Gerät {schluessel}: {err}") from err


INTEGRATION = TuyaIntegration


# ── Einrichtungs-Helfer ────────────────────────────────────────────────────
# Drei Fragen stehen zwischen einem Tuya-Gerät und dieser Integration, und
# für jede gibt es hier einen Aufruf:
#
#   --scan                       Welche Geräte sind im Netz, und welche
#                                Protokollfassung sprechen sie?
#   --cloud                      Wie lauten die lokalen Schlüssel?
#   -c config.yaml --dps <Name>  Welche Nummer macht was?


def _scan(seconds: int) -> int:
    import tinytuya

    print(f"Suche {seconds} s lang nach Tuya-Geräten im Netz …\n")
    gefunden = tinytuya.deviceScan(False, seconds, color=False, poll=False)
    if not gefunden:
        print(
            "Nichts gefunden. Die Suche läuft über einen Rundruf im eigenen\n"
            "Netz – sie funktioniert nur, wenn der Hub im selben Netz steht\n"
            "wie die Geräte (bei Docker: network_mode: host)."
        )
        return 1
    for ip, info in sorted(gefunden.items()):
        print(f"  {ip:<16} id={info.get('gwId')}  Protokoll {info.get('version')}")
    print(
        "\nDie Kennungen stehen jetzt da, die Schlüssel noch nicht – die\n"
        "holt: python -m homepilot.integrations.tuya --cloud"
    )
    return 0


def _cloud() -> int:
    import getpass

    import tinytuya

    print(
        "Zugangsdaten des Tuya-Entwicklerprojekts (siehe docs/tuya.md).\n"
        "Sie werden nur für diesen Aufruf gebraucht und nirgends gespeichert.\n"
    )
    region = input("Region (eu / us / cn / in) [eu]: ").strip() or "eu"
    api_key = input("Access ID / Client ID: ").strip()
    api_secret = getpass.getpass("Access Secret / Client Secret: ").strip()
    if not api_key or not api_secret:
        print("✗ Ohne Zugangsdaten geht es nicht.")
        return 1

    wolke = tinytuya.Cloud(apiRegion=region, apiKey=api_key, apiSecret=api_secret)
    geraete = wolke.getdevices()
    if not isinstance(geraete, list):
        print(f"✗ Tuya antwortet: {geraete}")
        return 1

    print("\n# Fertig zum Einfügen in die config.yaml:\n")
    print("  - integration: tuya")
    print("    devices:")
    for geraet in geraete:
        schluessel = geraet.get("key") or ""
        print(f"      - name: {geraet.get('name') or geraet.get('id')}")
        print(f"        id: {geraet.get('id')}")
        print(f"        key: \"{schluessel}\"")
        if geraet.get("ip"):
            print(f"        ip: {geraet['ip']}")
        if geraet.get("version"):
            print(f"        version: {geraet['version']}")
    print(
        "\nDie Schlüssel sind Geheimnisse – sie gehören in die config.yaml\n"
        "auf dem Hub, nicht in ein Repository."
    )
    return 0


async def _dps_main(config_path: str, gesucht: str) -> int:
    import tinytuya

    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "tuya"]
    if not blocks:
        print("✗ In der config.yaml steht kein 'tuya'-Block.")
        return 1

    treffer = [
        geraet
        for block in blocks
        for geraet in (block.get("devices") or [])
        if gesucht.lower() in str(geraet.get("name", "")).lower()
        or gesucht == str(geraet.get("id"))
    ]
    if not treffer:
        namen = [
            str(geraet.get("name"))
            for block in blocks
            for geraet in (block.get("devices") or [])
        ]
        print(f"✗ '{gesucht}' ist keines von: {', '.join(namen) or '(keine)'}")
        return 1

    for geraet in treffer:
        device = tinytuya.Device(
            str(geraet["id"]),
            address=geraet.get("ip") or None,
            local_key=str(geraet["key"]),
        )
        device.set_version(float(geraet.get("version", 3.3)))
        antwort = await asyncio.to_thread(device.status)
        print(f"\n{geraet.get('name')} ({geraet['id']}):")
        if not isinstance(antwort, dict) or antwort.get("Error"):
            print(f"  ✗ {antwort}")
            hinweis = error_hint(antwort)
            if hinweis:
                print(f"    {hinweis}")
            continue
        dps = antwort.get("dps") or {}
        if not dps:
            print("  (keine Datenpunkte gemeldet)")
            continue
        nummern = dps_map(geraet)
        bekannt = {str(nummer): name for name, nummer in nummern.items()}
        for nummer, wert in sorted(dps.items(), key=lambda paar: int(paar[0])):
            deutung = bekannt.get(nummer, "")
            print(f"  {nummer:>4}  {json.dumps(wert)}{'   ← ' + deutung if deutung else ''}")
        print(
            "\n  Was hier ohne Pfeil steht, kennt der Hub noch nicht. Ein\n"
            "  Ein/Aus-Punkt (true/false) lässt sich als Zusatzschalter\n"
            "  eintragen:\n"
            "      switches:\n"
            "        - name: Sterne\n"
            "          dp: 101"
        )
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Tuya-Einrichtung für HomePilot")
    parser.add_argument("-c", "--config", help="Pfad zur config.yaml des Hubs")
    parser.add_argument(
        "--scan",
        nargs="?",
        const=10,
        type=int,
        metavar="SEKUNDEN",
        help="Geräte im Netz suchen",
    )
    parser.add_argument(
        "--cloud",
        action="store_true",
        help="Lokale Schlüssel aus dem Tuya-Entwicklerprojekt holen",
    )
    parser.add_argument(
        "--dps", metavar="NAME", help="Datenpunkte eines eingerichteten Geräts zeigen"
    )
    args = parser.parse_args()

    if args.scan is not None:
        sys.exit(_scan(args.scan))
    if args.cloud:
        sys.exit(_cloud())
    if args.dps:
        if not args.config:
            parser.error("--dps braucht auch -c config.yaml")
        sys.exit(asyncio.run(_dps_main(args.config, args.dps)))
    parser.error("Nichts zu tun – --scan, --cloud oder --dps wählen")
