"""Homematic-Geräte über die XML-RPC-Schnittstelle der CCU.

Konfiguration:
  - integration: homematic
    host: 192.168.1.15
    port: 2001              # Standard-Schnittstelle: 2001 BidCos-RF (Funk),
                            # 2010 Homematic IP, 2000 Wired
    callback_port: 9125     # Port, auf dem der Hub Events entgegennimmt (0 = nur Polling)
    callback_host: null     # Adresse, unter der die CCU den Hub erreicht (null = automatisch)
    scan_interval: 300
    devices:
      - address: "VCU0000299:1"    # Kanal, nicht das Gerät
        name: Licht Küche
        kind: switch
      - address: "ABC1234567:1"
        name: Stehlampe
        kind: light
        dimmable: true             # nutzt LEVEL statt STATE
      - address: "ABC7654321:4"
        name: Temperatur Bad
        kind: sensor
        datapoint: ACTUAL_TEMPERATURE
      - address: "001015699EA263:3"     # HmIP: Port am Gerät angeben
        port: 2010
        name: Tumbler
        kind: switch
        power_address: "001015699EA263:6"    # Messkanal → state.power in Watt

Melder und Taster (Homematic IP, alle auf ``port: 2010``). Entscheidend ist
je Gerät der richtige Datenpunkt – welchen Kanal es hat, steht beim Start
in der Kanalliste im Log:

      - address: "0001D8A9B12345:1"     # HmIP-SMI
        port: 2010
        name: Bewegung Flur
        kind: binary_sensor
        datapoint: MOTION

      - address: "0001D8A9B12346:1"     # HmIP-SPI (Präsenzmelder)
        port: 2010
        name: Präsenz Büro
        kind: binary_sensor
        datapoint: PRESENCE_DETECTION_STATE

Bewegungs- und Präsenzmelder messen nebenbei die Helligkeit. Der Hub liest
sie von selbst mit und legt sie als ``illumination`` (Lux) an dieselbe
Entität. Damit lässt sich in einem Ablauf «nur wenn es dunkel ist» am
echten Messwert festmachen statt am Sonnenstand – der weiss nichts von
einem trüben Novembernachmittag. Findet der Melder keinen solchen
Datenpunkt, passiert nichts; wer den Namen kennt, kann ihn mit
``illumination_datapoint`` angeben.

      - address: "0001D8A9B12347:1"     # HmIP-SWSD (Rauchwarnmelder)
        port: 2010
        name: Rauchmelder Flur
        kind: binary_sensor
        datapoint: SMOKE_DETECTOR_ALARM_STATUS

      - address: "0001D8A9B12348:1"     # HmIP-WRC2/WRC6/BRC2, je Taste ein Kanal
        port: 2010
        name: Wandtaster Küche oben
        kind: button

Ein ``button`` wird nicht abgefragt, sondern meldet sich: Die CCU schickt
PRESS_SHORT bzw. PRESS_LONG, der Zustand wird dann «short» oder «long».
Damit lässt sich in einem Ablauf darauf auslösen (Auslöser «Zustand», Ziel
``short``). Wichtig: Der Callback-Betrieb muss laufen (``callback_port``) –
ohne ihn kommen Tastendrücke gar nicht an, denn abfragen lassen sie sich
nicht.

Beim 6-fach-Taster hat jede Taste einen eigenen Kanal (:1 … :6), beim
2-fach-Taster :1 und :2. Der HmIP-SMI55(-2) vereint beides in einem
Gehäuse - drei Einträge für ein Gerät, jede Funktion ihr Kanal: die
untere Taste auf :1, die obere auf :2, der Bewegungsmelder auf :3.

      - address: "0031A0C9A6F400:3"
        port: 2010
        name: Bewegung Flur
        kind: binary_sensor
        datapoint: MOTION
      - address: "0031A0C9A6F400:2"
        port: 2010
        name: Taster Flur oben
        kind: button
      - address: "0031A0C9A6F400:1"
        port: 2010
        name: Taster Flur unten
        kind: button

Geräte dürfen einzeln einen anderen ``port`` angeben – so laufen klassische
Homematic- (2001) und Homematic-IP-Geräte (2010) gemischt über dieselbe
Integration.

Bei Homematic IP (z.B. Schalt-Messsteckdose HmIP-PSM) liegt STATE auf dem
Schaltkanal (Kanaltyp SWITCH_VIRTUAL_RECEIVER, meist Kanal 3) – dort wird
auch geschaltet. Der Messkanal (ENERGIE_METER_TRANSMITTER, meist Kanal 6)
liefert nur POWER & Co. und gehört als ``power_address`` dazu. Schlägt das
Lesen eines Kanals fehl, kommt der andere trotzdem an – und eine
Log-Warnung nennt den Grund. Wer melden und schalten wirklich trennen
muss, kann Kommandos mit ``command_address`` umlenken.

Steht als ``address`` versehentlich der Messkanal, korrigiert der Hub das
beim Start selbst: Er kennt die Kanalliste der CCU, sucht den Schaltkanal
desselben Geräts und schaltet und liest dort. Im Log steht, was er
umgebogen hat.

Die CCU kann Änderungen aktiv melden: Der Hub meldet sich per ``init`` mit
einer Callback-Adresse an, danach ruft die CCU bei jeder Wertänderung
``event`` auf. Das ist deutlich schneller und schonender als Polling, das
hier nur noch als Sicherheitsnetz in grossem Intervall mitläuft.

Adressen sind Kanäle in der Form ``SERIENNUMMER:KANAL``. Welche es gibt,
listet der Hub beim Start ins Log.
"""

from __future__ import annotations

import asyncio
import http.client
import socket
import threading
import time
import xmlrpc.client
from socketserver import ThreadingMixIn
from typing import Any
from xmlrpc.server import SimpleXMLRPCServer

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError, HomePilotError
from ..core.integration import Integration

# Der Hauptdatenpunkt je Entitätsart, wenn nichts anderes konfiguriert ist.
DEFAULT_DATAPOINTS = {
    EntityKind.SWITCH: "STATE",
    EntityKind.LIGHT: "STATE",
    EntityKind.BINARY_SENSOR: "STATE",
    EntityKind.BUTTON: "PRESS_SHORT",
}

# Wandtaster melden Tastendrücke als Ereignis, nicht als Zustand: Die CCU
# schickt PRESS_SHORT bzw. PRESS_LONG, abfragen lässt sich auf so einem
# Kanal nichts. Ein Taster hört deshalb auf beide Datenpunkte zugleich.
PRESS_DATAPOINTS = {"PRESS_SHORT": "short", "PRESS_LONG": "long"}

# Rauchwarnmelder (HmIP-SWSD) melden keinen Ja/Nein-Wert, sondern eine
# Alarmart: 0 = Ruhe, 1 = eigener Alarm, 2 = Einbruchalarm, 3 = von einem
# anderen Melder weitergereichter Alarm. Für die Anlage zählt nur, ob Ruhe
# herrscht – welcher Fall es war, steht daneben in 'alarm_status'.
ALARM_STATUS_DATAPOINTS = frozenset({"SMOKE_DETECTOR_ALARM_STATUS", "ALARM_STATUS"})
IDLE_ALARM_VALUES = frozenset({"0", "IDLE_OFF", "False", "None", ""})

# Ab hier ist die Antwort an die CCU so langsam, dass es auffällt: Sie
# wartet darauf, bevor sie dem Gerät bestätigt.
SLOW_CALLBACK = 0.5

# Wie oft geprüft wird, ob die CCU den Hub noch als Client kennt, und wie
# lange dabei auf ihr PONG gewartet wird.
PING_INTERVAL = 120.0
PING_TIMEOUT = 10.0

# Der Wartungskanal jedes Homematic-Geräts (immer Kanal 0). Dort steht,
# ob die Batterie schwach ist – bei Rauchmeldern und Alarmsensoren die
# wichtigste Information überhaupt, und bisher las sie niemand.
MAINTENANCE_CHANNEL = "0"
LOW_BAT = "LOW_BAT"

LEVEL = "LEVEL"
# Messkanal einer Schalt-Messsteckdose (HmIP-PSM, HM-ES-PMSw1): Momentanleistung.
POWER = "POWER"
# Helligkeit in Lux. Melder heissen sie unterschiedlich: HmIP-SMI und
# HmIP-SPI liefern ILLUMINATION, manche Fassungen zusätzlich
# CURRENT_ILLUMINATION (der Momentanwert statt des Mittels über die
# Messperiode). Der Hub probiert der Reihe nach und nimmt, was da ist.
ILLUMINATION_DATAPOINTS = ("ILLUMINATION", "CURRENT_ILLUMINATION")

# Kanalarten, auf denen sich wirklich schalten lässt. Messkanäle heissen
# ähnlich (SWITCH_TRANSMITTER, ENERGIE_METER_TRANSMITTER), können es aber
# nicht: Dort gibt es kein STATE, und jedes setValue endet in Fault -5.
SWITCHING_TYPES = frozenset(
    {
        "SWITCH",
        "SWITCH_VIRTUAL_RECEIVER",
        "DIMMER",
        "DIMMER_VIRTUAL_RECEIVER",
        "VIRTUAL_DIMMER",
    }
)


def group_by_device(channels: dict[str, str]) -> dict[str, list[tuple[int, str]]]:
    """Kanäle nach Gerät bündeln (rein, testbar).

    Nach Kanalart gruppiert war die Liste beim Einrichten unbrauchbar: Wer
    ein Gerät eintragen will, braucht dessen Kanäle beisammen – und bei über
    hundert Tastenkanälen im Haus fiel genau das gesuchte hinten heraus.
    """
    devices: dict[str, list[tuple[int, str]]] = {}
    for address, kind in channels.items():
        serial, _, channel = address.partition(":")
        number = int(channel) if channel.isdigit() else 0
        devices.setdefault(serial, []).append((number, kind or "UNBEKANNT"))
    for entries in devices.values():
        entries.sort()
    return devices


def describe_channels(entries: list[tuple[int, str]]) -> str:
    """Die Kanäle eines Geräts als eine Zeile (rein, testbar)."""
    return ", ".join(f"{number} {kind}" for number, kind in entries)


def switch_channel(address: str, channels: dict[str, str]) -> str | None:
    """Der Kanal desselben Geräts, auf dem geschaltet wird (rein, testbar).

    ``channels`` ist die Kanalliste der CCU (Adresse → Kanalart). Gibt
    ``None`` zurück, wenn der angegebene Kanal schon schalten kann, die CCU
    ihn nicht kennt oder das Gerät gar keinen Schaltkanal hat. Bei mehreren
    gewinnt die kleinste Kanalnummer – bei einer HmIP-PSM also Kanal 3.
    """
    if address not in channels or channels[address] in SWITCHING_TYPES:
        return None
    serial = address.split(":", 1)[0]

    def number(candidate: str) -> int:
        part = candidate.split(":", 1)[1] if ":" in candidate else ""
        return int(part) if part.isdigit() else 0

    candidates = sorted(
        (
            candidate
            for candidate, kind in channels.items()
            if candidate.split(":", 1)[0] == serial and kind in SWITCHING_TYPES
        ),
        key=number,
    )
    return candidates[0] if candidates else None


def is_timeout(fault: Exception) -> bool:
    """Hat die CCU das Gerät nicht erreicht? (rein, testbar)

    Ein Funk-Timeout ist oft vorübergehend – ein zweiter Versuch lohnt sich,
    anders als bei einem falschen Kanal.
    """
    text = str(getattr(fault, "faultString", None) or fault).upper()
    return "TIMEOUT" in text


def command_error(address: str, datapoint: str, fault: Exception) -> str:
    """Aus einem CCU-Fehler eine Meldung machen, die weiterhilft (rein).

    «Fault -5: Invalid parameter or value» und «Fault -1: Generic error
    (TIMEOUT)» sagen für sich genommen nichts – dahinter stecken zwei ganz
    verschiedene Ursachen, und die gehören in die Meldung.
    """
    text = str(getattr(fault, "faultString", None) or fault)
    if is_timeout(fault):
        return (
            f"Die CCU erreicht das Gerät zu Kanal {address} nicht (Funk-Timeout). "
            "Der Kanal stimmt, geantwortet hat das Gerät nicht. Prüfen: Steckt "
            "es und ist es angelernt, stehen in der CCU noch Konfigurationsdaten "
            "aus, und ist der Sendespeicher (Duty Cycle) der Funk-Schnittstelle "
            "frei?"
        )
    if getattr(fault, "faultCode", None) == -5 or "Invalid parameter" in text:
        return (
            f"Die CCU kennt auf Kanal {address} keinen Datenpunkt {datapoint}. "
            "Bei Homematic IP wird auf dem Schaltkanal geschaltet (meist :3); "
            "der Messkanal (meist :6) liefert nur Verbrauchswerte."
        )
    return f"CCU meldet für {address}: {text}"


def duty_cycle_of(interfaces: Any) -> dict[str, int]:
    """Sendespeicher je Funk-Schnittstelle, in Prozent (rein, testbar).

    Der Duty Cycle ist die gesetzlich begrenzte Sendezeit im 868-MHz-Band.
    Läuft er voll, schaltet nichts mehr – und zwar ohne Fehlermeldung am
    Gerät, es passiert einfach nichts. Bisher tauchte er nur in der
    Erklärung eines Timeouts auf, also erst, wenn es schon zu spät war.

    Die CCU liefert die Liste über ``listBidcosInterfaces``. Was keinen
    lesbaren Wert hat (HmIP-Schnittstellen melden ihn nicht immer), fällt
    weg – lieber kein Messwert als einer, der immer null zeigt.
    """
    result: dict[str, int] = {}
    for interface in interfaces or []:
        if not isinstance(interface, dict):
            continue
        address = str(interface.get("ADDRESS") or "").strip()
        roh = interface.get("DUTY_CYCLE")
        if not address or roh is None or isinstance(roh, bool):
            continue
        try:
            prozent = int(round(float(roh)))
        except (TypeError, ValueError):
            continue
        # -1 heisst «kenne ich nicht», und über 100 gibt es nicht.
        if 0 <= prozent <= 100:
            result[address] = prozent
    return result


def value_to_state(value: Any, datapoint: str, dimmable: bool) -> dict[str, Any]:
    """Übersetzt einen CCU-Wert in Entitäts-Attribute.

    Homematic gibt Dimmwerte als Fliesskomma 0…1 an, die App rechnet in
    Prozent – umgerechnet wird deshalb hier, an genau einer Stelle.

    Ja/Nein-Werte werden zu «on»/«off», egal wie der Datenpunkt heisst. Das
    ist nicht nur Kosmetik: Ein Bewegungsmelder meldet auf MOTION, ein
    Präsenzmelder auf PRESENCE_DETECTION_STATE, und die Alarmanlage sucht
    nach «on». Stünde dort ein rohes True, würde sie den Sensor nie sehen.
    """
    if dimmable and datapoint == LEVEL:
        level = float(value or 0)
        return {"state": "on" if level > 0 else "off", "brightness": round(level * 100)}
    if datapoint in ALARM_STATUS_DATAPOINTS:
        return {
            "state": "off" if str(value) in IDLE_ALARM_VALUES else "on",
            "alarm_status": value,
        }
    if isinstance(value, bool):
        return {"state": "on" if value else "off"}
    return {"state": value}


def lux_to_state(value: Any) -> dict[str, Any]:
    """Helligkeitsmessung in den Zustand (rein, testbar).

    Melder liefern Lux als Zahl. Alles andere - None nach einem
    Lesefehler, ein leerer Text - wird verworfen statt als 0 Lux
    eingetragen: «stockdunkel» wäre eine Behauptung, kein Messwert, und
    ein Ablauf «nur wenn unter 20 Lux» liefe damit am hellen Mittag.
    """
    if isinstance(value, bool) or value is None:
        return {}
    try:
        return {"illumination": round(float(value), 1)}
    except (TypeError, ValueError):
        return {}


def maintenance_address(address: str) -> str:
    """Der Wartungskanal desselben Geräts (rein, testbar)."""
    return f"{address.split(':', 1)[0]}:{MAINTENANCE_CHANNEL}"


def battery_to_state(value: Any) -> dict[str, Any]:
    """LOW_BAT in ein Attribut übersetzen (rein, testbar).

    Unlesbare Werte ergeben nichts, statt eine volle Batterie zu behaupten –
    bei einem Rauchmelder wäre das die gefährlichere Lüge.
    """
    if isinstance(value, bool):
        return {"low_battery": value}
    if str(value) in ("0", "False", "false"):
        return {"low_battery": False}
    if str(value) in ("1", "True", "true"):
        return {"low_battery": True}
    return {}


# Woran man einem Datenpunkt ansieht, wofür der Melder steht. Nur die
# eindeutigen Fälle – bei allem anderen bleibt es beim Nichts, und die
# Angabe gehört in die config.yaml.
DEVICE_CLASS_BY_DATAPOINT: dict[str, str] = {
    "STATE": "contact",
    "MOTION": "motion",
    "PRESENCE_DETECTION_STATE": "motion",
    "SMOKE_DETECTOR_ALARM_STATUS": "smoke",
    "WATER_DETECTED": "moisture",
    "MOISTURE_DETECTED": "moisture",
    "WATERLEVEL_DETECTED": "moisture",
    "ALARMSTATE": "moisture",
}


def guess_device_class(datapoint: str | None) -> str | None:
    """Wofür steht dieser Melder? (rein, testbar)

    «STATE» ist bei Homematic der Fensterkontakt – der häufigste Fall.
    Alles Unklare bleibt offen: Eine falsche Angabe wäre schlimmer als
    keine, denn daran hängen Warnungen.
    """
    return DEVICE_CLASS_BY_DATAPOINT.get(str(datapoint or "").upper())


def press_to_state(datapoint: str, now: float) -> dict[str, Any]:
    """Ein Tastendruck als Zustand (rein, testbar).

    Der Zeitstempel muss mit: Zweimal kurz hintereinander dieselbe Taste
    gedrückt hiesse sonst «Zustand unverändert», und der zweite Druck käme
    in keinem Ablauf an.
    """
    return {"state": PRESS_DATAPOINTS.get(datapoint, "short"), "last_press": now}


def power_to_state(value: Any) -> dict[str, Any]:
    """Momentanleistung des Messkanals als Watt-Attribut (rein, testbar).

    Homematic liefert Watt als Fliesskomma; ungültige Werte (None, "") sollen
    das bisherige Attribut nicht mit Unsinn überschreiben.
    """
    try:
        return {"power": round(float(value), 1)}
    except (TypeError, ValueError):
        return {}


def command_to_value(
    command: str, data: dict[str, Any], dimmable: bool, current: dict[str, Any]
) -> tuple[str, Any]:
    """Ergibt (Datenpunkt, Wert) für ein Kommando."""
    if command == "toggle":
        command = "turn_off" if current.get("state") == "on" else "turn_on"

    if dimmable:
        if command == "turn_off":
            return LEVEL, 0.0
        if command == "turn_on":
            brightness = float(data.get("brightness", current.get("brightness") or 100))
            return LEVEL, max(0.0, min(1.0, brightness / 100))
        if command == "set_brightness":
            brightness = float(data.get("brightness", 100))
            return LEVEL, max(0.0, min(1.0, brightness / 100))
    else:
        if command == "turn_on":
            return "STATE", True
        if command == "turn_off":
            return "STATE", False

    raise ValueError(f"Kommando '{command}' nicht unterstützt")


def local_address_for(host: str, port: int) -> str:
    """Ermittelt, unter welcher IP die CCU diesen Hub erreicht.

    Die CCU ruft den Callback aktiv auf – dafür braucht sie die Adresse des
    Hubs im richtigen Netz, was bei mehreren Schnittstellen nicht die
    erstbeste ist.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.connect((host, port))
        return sock.getsockname()[0]


class _TimeoutTransport(xmlrpc.client.Transport):
    """Transport mit Zeitlimit – eine hängende CCU darf keinen Thread binden."""

    def __init__(self, timeout: float) -> None:
        super().__init__()
        self._timeout = timeout

    def make_connection(self, host: str) -> http.client.HTTPConnection:
        connection = super().make_connection(host)
        connection.timeout = self._timeout
        return connection


class _CallbackServer(ThreadingMixIn, SimpleXMLRPCServer):
    daemon_threads = True
    allow_reuse_address = True


class HomematicIntegration(Integration):
    name = "homematic"

    async def setup(self) -> None:
        host = self.config.get("host")
        if not host:
            raise ConfigError("homematic braucht 'host' in der Konfiguration")
        self._host = host
        self._port = int(self.config.get("port", 2001))
        self._interval = self.scan_interval()
        self._callback_port = int(self.config.get("callback_port", 9125))
        self._server: _CallbackServer | None = None
        # Bestätigte Anmeldungen (Kennung aus dem PONG der CCU).
        self._pong: set[str] = set()
        self._callback_url: str | None = None
        self._loop = asyncio.get_running_loop()

        # Je Schnittstelle (Port) ein eigener Proxy: Homematic IP läuft auf
        # 2010, klassisches BidCos-RF auf 2001 – beides an derselben CCU.
        self._proxies: dict[int, xmlrpc.client.ServerProxy] = {}

        # Wann zuletzt ein Ereignis der CCU ankam.
        self._last_event: float | None = None
        # Wartungskanal → alle Entitäten dieses Geräts.
        self._by_battery: dict[tuple[str, str], list[str]] = {}
        # Bereits gemeldete Lesefehler – jede Adresse warnt nur einmal.
        self._warned: set[tuple[str, str]] = set()
        # (Adresse, Datenpunkt) → entity_id, plus Stammdaten je Entität
        self._by_datapoint: dict[tuple[str, str], str] = {}
        # Messkanäle getrennt: sie liefern kein state, sondern nur 'power'.
        self._by_power: dict[tuple[str, str], str] = {}
        # Helligkeit der Melder: liefert kein state, sondern 'illumination'.
        self._by_lux: dict[tuple[str, str], str] = {}
        # Kanäle, die diesen Datenpunkt nicht kennen - einmal gemerkt,
        # dann nicht mehr gefragt.
        self._missing_lux: set[tuple[str, str]] = set()
        self._devices: dict[str, dict[str, Any]] = {}
        # Sendespeicher je Funk-Schnittstelle: object_id → (Adresse, Port).
        self._duty: dict[str, tuple[str, int]] = {}

        for device in self.config.get("devices") or []:
            await self._add_device(device)

        for port in sorted(self._ports()):
            channels = await self._log_available_channels(port)
            self._use_switch_channels(port, channels)
        await self._add_duty_cycle_sensors()
        await self._refresh_all()

        if self._callback_port:
            await self._start_callbacks()
        self.start_task(self._poll_loop())

    async def _add_duty_cycle_sensors(self) -> None:
        """Je Funk-Schnittstelle ein Messwert «Sendespeicher».

        Man sieht das Volllaufen damit kommen, statt vor einer stummen
        Funkstrecke zu stehen: Über 80 Prozent schaltet die CCU von sich
        aus nichts mehr, ohne dass ein Gerät einen Fehler meldet.

        Nur dort, wo die CCU wirklich einen Wert liefert. Nicht jede
        Schnittstelle kennt ``listBidcosInterfaces``, und HmIP meldet ihn
        nicht immer – ein Messwert, der ewig auf null steht, wäre
        schlimmer als keiner.
        """
        for port in sorted(self._ports()):
            try:
                interfaces = await self._call("listBidcosInterfaces", port=port)
            except Exception as err:
                self.log.debug("Port %s ohne listBidcosInterfaces (%s)", port, err)
                continue
            for address, prozent in duty_cycle_of(interfaces).items():
                object_id = f"duty_cycle_{address.replace(':', '_').replace('-', '_')}"
                self._duty[object_id] = (address, port)
                await self.add_entity(
                    object_id,
                    EntityKind.SENSOR,
                    f"Sendespeicher {address}",
                    state={"state": prozent, "unit": "%"},
                )

    async def _refresh_duty_cycle(self) -> None:
        """Die Sendespeicher nachlesen – einmal je Schnittstelle."""
        ports = {port for _, port in self._duty.values()}
        for port in sorted(ports):
            try:
                interfaces = await self._call("listBidcosInterfaces", port=port)
            except Exception as err:
                self.log.debug("Sendespeicher auf Port %s nicht lesbar: %s", port, err)
                continue
            werte = duty_cycle_of(interfaces)
            for object_id, (address, eigener_port) in self._duty.items():
                if eigener_port != port or address not in werte:
                    continue
                await self.hub.registry.update_state(
                    f"{self.name}.{object_id}",
                    {"state": werte[address], "unit": "%"},
                    available=True,
                )

    def _ports(self) -> set[int]:
        """Alle Ports, die tatsächlich gebraucht werden."""
        ports = {info["port"] for info in self._devices.values()}
        return ports or {self._port}

    def _proxy_for(self, port: int) -> xmlrpc.client.ServerProxy:
        proxy = self._proxies.get(port)
        if proxy is None:
            proxy = xmlrpc.client.ServerProxy(
                f"http://{self._host}:{port}",
                transport=_TimeoutTransport(15.0),
                allow_none=True,
            )
            self._proxies[port] = proxy
        return proxy

    async def _add_device(self, device: dict[str, Any]) -> None:
        address = device.get("address")
        if not address:
            raise ConfigError("homematic: jedes Gerät braucht eine 'address'")
        kind = device.get("kind", EntityKind.SWITCH)
        dimmable = bool(device.get("dimmable", False))
        datapoint = device.get("datapoint") or (
            LEVEL if dimmable else DEFAULT_DATAPOINTS.get(kind)
        )
        if not datapoint:
            # Die häufigste Ursache ist nicht ein fehlender Datenpunkt,
            # sondern die falsche Art: Ein Wandtaster ist 'button' und
            # braucht dann gar keinen. Das gehört in die Meldung – sonst
            # sucht man einen Datenpunkt, den es nicht gibt.
            raise ConfigError(
                f"homematic: {address} hat kind '{kind}' – dafür ist ein "
                "'datapoint' nötig (z.B. ACTUAL_TEMPERATURE bei einem "
                "Temperaturfühler, MOTION bei einem Bewegungsmelder). "
                "Wandtaster und Fernbedienungen sind kind 'button' und "
                "kommen ohne aus; Schalter und Lichter sind 'switch' bzw. "
                "'light'. Welche Kanäle das Gerät hat, steht beim Start in "
                "der Kanalliste im Log."
            )

        commands: list[str] = []
        if kind in (EntityKind.SWITCH, EntityKind.LIGHT):
            commands = ["turn_on", "turn_off", "toggle"]
            if dimmable:
                commands.append("set_brightness")

        power_address = device.get("power_address")
        power_datapoint = device.get("power_datapoint", POWER)

        # Wofür der Melder steht: «contact» (Fenster), «motion», «smoke»,
        # «moisture» (Wassermelder). Ohne diese Angabe ist ein Melder für
        # den Hub bloss ein Ja/Nein – der Wächter kann dann weder vor einem
        # offenen Fenster noch vor Wasser warnen. Was der Datenpunkt schon
        # verrät, wird geraten; angeben sticht raten.
        device_class = device.get("device_class") or guess_device_class(datapoint)

        entity = await self.add_entity(
            address.replace(":", "_").replace("-", "_"),
            kind,
            device.get("name", address),
            state={"state": "unknown", **({"device_class": device_class} if device_class else {})},
            commands=commands,
            # Ein Taster lässt sich nicht abfragen – er meldet sich nur.
            # Ihn bis zum ersten Druck als «nicht erreichbar» zu zeigen,
            # wäre falsch: Er ist da, er hat bloss nichts zu sagen.
            available=kind == EntityKind.BUTTON,
        )
        self._devices[entity.id] = {
            "address": address,
            "kind": kind,
            "datapoint": datapoint,
            "dimmable": dimmable,
            "port": int(device.get("port", self._port)),
            "power_address": power_address,
            "power_datapoint": power_datapoint,
            "command_address": device.get("command_address") or address,
        }
        if kind == EntityKind.BUTTON:
            # Kurz und lang laufen auf demselben Kanal ein.
            for press in PRESS_DATAPOINTS:
                self._by_datapoint[(address, press)] = entity.id
        else:
            self._by_datapoint[(address, datapoint)] = entity.id
        if power_address:
            self._by_power[(power_address, power_datapoint)] = entity.id
        # Helligkeit liegt auf demselben Kanal wie die Ja/Nein-Meldung -
        # anders als beim Strom, der einen eigenen Messkanal hat.
        if kind == EntityKind.BINARY_SENSOR:
            wanted = device.get("illumination_datapoint")
            candidates = (
                (str(wanted),) if wanted else ILLUMINATION_DATAPOINTS
            )
            self._devices[entity.id]["illumination"] = candidates
            for name in candidates:
                self._by_lux[(address, name)] = entity.id
        # Batteriewarnung: Der Wartungskanal gehört zum Gerät, nicht zum
        # Kanal – mehrere Entitäten desselben Geräts teilen ihn sich.
        self._by_battery.setdefault(
            (maintenance_address(address), LOW_BAT), []
        ).append(entity.id)

    # ── CCU → Hub ──────────────────────────────────────────────────────────

    async def _call(self, method: str, *args: Any, port: int | None = None) -> Any:
        """XML-RPC ist blockierend – deshalb in einem Thread ausführen."""
        proxy = self._proxy_for(port if port is not None else self._port)
        return await asyncio.to_thread(getattr(proxy, method), *args)

    async def _log_available_channels(self, port: int) -> dict[str, str]:
        """Listet Kanäle der CCU – hilft beim Ausfüllen der Konfiguration.

        Gibt die Kanalliste (Adresse → Kanalart) zurück; der Hub biegt damit
        anschliessend Schaltbefehle auf den richtigen Kanal um.

        Eine Zeile pro Kanalart statt einer einzigen, alphabetisch
        abgeschnittenen Liste: Bei vielen Geräten dominieren sonst
        Verwaltungskanäle (z.B. Rauchmelder-Systemkanäle) den Anfang, und
        die eigentlich interessanten Schalter/Sensoren fallen weg. So bleibt
        jede Art vollständig sichtbar und gezielt grep-bar.
        """
        try:
            devices = await self._call("listDevices", port=port)
        except Exception as err:
            self.log.warning("CCU auf Port %s nicht erreichbar: %s", port, err)
            return {}

        channels = {
            device["ADDRESS"]: device.get("TYPE", "")
            for device in devices
            if device.get("PARENT")
        }
        # Nur Geräte dieser Schnittstelle bemängeln – ein HmIP-Kanal fehlt
        # auf Port 2001 zu Recht.
        configured = {
            info["address"] for info in self._devices.values() if info["port"] == port
        } | {
            info["power_address"]
            for info in self._devices.values()
            if info["port"] == port and info["power_address"]
        }
        missing = configured - set(channels)
        if missing:
            self.log.warning(
                "Diese Adressen kennt die CCU auf Port %s nicht: %s",
                port,
                ", ".join(sorted(missing)),
            )

        by_device = group_by_device(channels)
        self.log.info(
            "CCU (Port %s) meldet %d Kanäle an %d Geräten (eine Log-Zeile je Gerät):",
            port,
            len(channels),
            len(by_device),
        )
        for serial in sorted(by_device):
            self.log.info("  %s: %s", serial, describe_channels(by_device[serial]))
        self.log.info(
            "  Zum Eintragen: %s → kind: button, %s → kind: switch/light, "
            "%s → kind: binary_sensor (mit passendem datapoint), "
            "%s → power_address.",
            "KEY_TRANSCEIVER",
            "SWITCH_VIRTUAL_RECEIVER",
            "MOTIONDETECTOR/PRESENCEDETECTOR/SMOKE_DETECTOR",
            "ENERGIE_METER_TRANSMITTER",
        )
        return channels

    def _use_switch_channels(self, port: int, channels: dict[str, str]) -> None:
        """Schalten und Lesen auf den Schaltkanal des Geräts umbiegen.

        Wer bei einer HmIP-Schalt-Messsteckdose den Messkanal (:6) als
        Adresse einträgt, bekam beim Einschalten nur ein nacktes
        «Fault -5: Invalid parameter or value» – dort gibt es kein STATE.
        Der Hub sucht den passenden Schaltkanal jetzt selbst und schreibt in
        Log, was er tut; der Messkanal bleibt für die Leistung zuständig.
        """
        for entity_id, info in self._devices.items():
            if info["port"] != port:
                continue
            if info["kind"] not in (EntityKind.SWITCH, EntityKind.LIGHT):
                continue
            target = switch_channel(info["command_address"], channels)
            if target is None:
                continue
            self.log.info(
                "%s: %s ist kein Schaltkanal (%s) – geschaltet wird auf %s.",
                entity_id,
                info["command_address"],
                channels.get(info["command_address"], "unbekannt"),
                target,
            )
            info["command_address"] = target
            # Auch der Zustand kommt vom Schaltkanal: Auf dem Messkanal gäbe
            # es sonst dauerhaft «unbekannt».
            if switch_channel(info["address"], channels) is not None:
                self._by_datapoint.pop((info["address"], info["datapoint"]), None)
                info["address"] = target
                self._by_datapoint[(target, info["datapoint"])] = entity_id

    async def _refresh_all(self) -> None:
        for entity_id, info in self._devices.items():
            port = info["port"]
            changes: dict[str, Any] = {}

            # Taster haben nichts zum Abfragen: PRESS_SHORT ist ein Ereignis,
            # kein Wert. Ein getValue darauf endet in Fault -5 – also gar
            # nicht erst fragen.
            if info["kind"] == EntityKind.BUTTON:
                continue

            # Haupt- und Messkanal unabhängig lesen: Bei Homematic IP hat der
            # Messkanal (z.B. HmIP-PSM Kanal 6) kein STATE – dann soll
            # wenigstens die Leistung ankommen statt gar nichts.
            try:
                value = await self._call(
                    "getValue", info["address"], info["datapoint"], port=port
                )
                changes.update(value_to_state(value, info["datapoint"], info["dimmable"]))
                self._warned.discard((info["address"], info["datapoint"]))
            except Exception as err:
                self._warn_once(
                    (info["address"], info["datapoint"]),
                    f"{info['address']} liefert kein {info['datapoint']} ({err}) – "
                    "bei HmIP liegt STATE meist auf dem Schaltkanal "
                    "(SWITCH_VIRTUAL_RECEIVER, siehe Kanalliste oben)",
                )

            if info["power_address"]:
                try:
                    watts = await self._call(
                        "getValue",
                        info["power_address"],
                        info["power_datapoint"],
                        port=port,
                    )
                    changes.update(power_to_state(watts))
                    self._warned.discard(
                        (info["power_address"], info["power_datapoint"])
                    )
                except Exception as err:
                    self._warn_once(
                        (info["power_address"], info["power_datapoint"]),
                        f"Messkanal {info['power_address']} nicht lesbar: {err}",
                    )

            # Helligkeit der Melder. Der erste Datenpunkt, den der Kanal
            # kennt, gewinnt; kennt er keinen, wird nicht weiter gefragt -
            # sonst stünde bei jedem Durchlauf dieselbe Warnung im Log.
            for name in info.get("illumination") or ():
                if (info["address"], name) in self._missing_lux:
                    continue
                try:
                    lux = await self._call(
                        "getValue", info["address"], name, port=port
                    )
                except Exception:
                    self._missing_lux.add((info["address"], name))
                    continue
                measured = lux_to_state(lux)
                if measured:
                    changes.update(measured)
                    break

            if changes:
                await self.hub.registry.update_state(entity_id, changes, available=True)
            else:
                await self.hub.registry.update_state(entity_id, {}, available=False)

        await self._refresh_batteries()
        await self._refresh_duty_cycle()

    async def _refresh_batteries(self) -> None:
        """Den Wartungskanal je Gerät einmal lesen.

        Einmal je Gerät, nicht je Entität: Ein 6-fach-Taster hat sechs
        Entitäten, aber nur eine Batterie.
        """
        for (address, datapoint), entity_ids in self._by_battery.items():
            port = self._devices[entity_ids[0]]["port"]
            try:
                value = await self._call("getValue", address, datapoint, port=port)
            except Exception as err:
                # Netzgeräte haben kein LOW_BAT – das ist kein Fehler.
                self.log.debug("%s ohne %s (%s)", address, datapoint, err)
                continue
            changes = battery_to_state(value)
            if not changes:
                continue
            for entity_id in entity_ids:
                await self.hub.registry.update_state(entity_id, changes)

    def _warn_once(self, key: tuple[str, str], message: str) -> None:
        """Einmal warnen statt alle 5 Minuten – sonst übersieht man im
        zugerauschten Log genau die Zeile, die das Problem erklärt.

        Nach einem geglückten Lesen wird der Vermerk gelöscht: Sonst bliebe
        eine vorübergehende Störung – etwa direkt nach einem Neustart der
        CCU – für immer stumm, obwohl sie später wirklich auftritt."""
        if key not in self._warned:
            self._warned.add(key)
            self.log.warning("%s", message)

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh_all()

    # ── Events der CCU ─────────────────────────────────────────────────────

    async def _start_callbacks(self) -> None:
        callback_host = self.config.get("callback_host") or local_address_for(
            self._host, self._port
        )
        server = _CallbackServer(
            ("0.0.0.0", self._callback_port), allow_none=True, logRequests=False
        )
        server.register_function(self._on_event, "event")
        # Die CCU erwartet diese Methoden, auch wenn wir sie nicht auswerten.
        server.register_function(lambda *_args: [], "listDevices")
        server.register_function(lambda *_args: "", "newDevices")
        server.register_function(lambda *_args: "", "deleteDevices")
        server.register_function(lambda *_args: "", "updateDevice")
        server.register_function(lambda *_args: "", "replaceDevice")
        server.register_function(lambda *_args: "", "readdedDevice")
        server.register_multicall_functions()
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self._server = server

        self._callback_url = f"http://{callback_host}:{self._callback_port}"
        # Jede Schnittstelle braucht ihre eigene Anmeldung, sonst schickt
        # z.B. Homematic IP (2010) keine Events.
        for port in sorted(self._ports()):
            try:
                await self._call(
                    "init", self._callback_url, f"homepilot-{port}", port=port
                )
                self.log.info(
                    "Bei der CCU (Port %s) für Events angemeldet (%s)",
                    port,
                    self._callback_url,
                )
            except Exception as err:
                self.log.warning(
                    "Event-Anmeldung auf Port %s fehlgeschlagen (%s) – es wird nur gepollt",
                    port,
                    err,
                )
        self.start_task(self._keepalive_loop())

    # ── Anmeldung wachhalten ───────────────────────────────────────────────

    def health(self) -> dict[str, Any]:
        """Was die App über die CCU-Verbindung wissen muss.

        Genau die Zahlen, nach denen wir bei jeder Störung im Log gesucht
        haben: Ist der Hub noch angemeldet, und wann kam zuletzt ein
        Ereignis? Bleibt das lange leer, obwohl Geräte aktiv sind, ist die
        Anmeldung weg – und dann kommt gar nichts mehr an.
        """
        return {
            "callback": self._callback_url,
            "registered": sorted(self._pong),
            "last_event": self._last_event,
            "devices": len(self._devices),
        }

    async def _check_registration(self, port: int) -> bool:
        """Ist der Hub bei dieser Schnittstelle noch angemeldet?

        Gefragt wird mit ``ping``: Die CCU schickt daraufhin ein
        PONG-Ereignis an jeden angemeldeten Client. Bleibt es aus, kennt sie
        den Hub nicht mehr.
        """
        caller = f"homepilot-{port}"
        self._pong.discard(caller)
        try:
            await self._call("ping", caller, port=port)
        except Exception as err:
            self.log.debug("Ping an Port %s fehlgeschlagen: %s", port, err)
            return False
        deadline = asyncio.get_running_loop().time() + PING_TIMEOUT
        while asyncio.get_running_loop().time() < deadline:
            if caller in self._pong:
                return True
            await asyncio.sleep(0.2)
        return caller in self._pong

    async def _keepalive_loop(self) -> None:
        """Die Anmeldung bei der CCU regelmässig prüfen und erneuern.

        Die CCU vergisst ihre angemeldeten Clients, sobald sie ihre Dienste
        neu startet – nach einem Neustart, einem Firmware-Update oder schon
        beim Einrichten einer Kopplung. Der Hub hat davon bisher nichts
        gemerkt: Er meldete sich einmal beim Start an und wartete danach auf
        Ereignisse, die nie mehr kamen. Wandtaster lösten dann nichts mehr
        aus, Sensoren meldeten nichts mehr – ohne eine einzige Zeile im Log.
        """
        while True:
            await asyncio.sleep(PING_INTERVAL)
            for port in sorted(self._ports()):
                if await self._check_registration(port):
                    continue
                self.log.warning(
                    "Die CCU (Port %s) kennt den Hub nicht mehr – Anmeldung "
                    "wird erneuert. Bis dahin kamen keine Tastendrücke und "
                    "Sensormeldungen an.",
                    port,
                )
                try:
                    await self._call(
                        "init", self._callback_url, f"homepilot-{port}", port=port
                    )
                except Exception as err:
                    self.log.warning(
                        "Erneute Anmeldung bei Port %s fehlgeschlagen: %s", port, err
                    )

    def _on_event(self, _interface_id: str, address: str, key: str, value: Any) -> str:
        """Wird von einem Thread des Callback-Servers aufgerufen.

        Muss schnell zurückkehren: Die CCU ruft hier synchron auf und
        wartet auf die Antwort, bevor sie weitermacht – unter anderem, bevor
        sie dem sendenden Gerät bestätigt. Ein Wandtaster blinkt so lange
        orange und nimmt keinen weiteren Druck an. Deshalb wird hier nur
        umgerechnet und in den Event-Loop gereicht, nie gewartet; dauert es
        trotzdem, sagt es eine Warnung.
        """
        started = time.monotonic()
        self._last_event = time.time()
        try:
            return self._handle_event(address, key, value)
        finally:
            elapsed = time.monotonic() - started
            if elapsed > SLOW_CALLBACK:
                self.log.warning(
                    "Antwort an die CCU dauerte %.2f s (%s %s) – so lange wartet "
                    "auch das sendende Gerät",
                    elapsed,
                    address,
                    key,
                )

    def _handle_event(self, address: str, key: str, value: Any) -> str:
        if key == "PONG":
            # Antwort auf unseren Ping – damit ist die Anmeldung bestätigt.
            self._pong.add(str(value))
            return ""
        battery = self._by_battery.get((address, key))
        if battery is not None:
            changes = battery_to_state(value)
            if changes:
                for entity_id in battery:
                    asyncio.run_coroutine_threadsafe(
                        self.hub.registry.update_state(entity_id, changes), self._loop
                    )
            return ""

        entity_id = self._by_datapoint.get((address, key))
        if entity_id is not None:
            info = self._devices[entity_id]
            if info["kind"] == EntityKind.BUTTON:
                # Loslassen meldet die CCU als zweites Ereignis mit False –
                # das ist kein Druck und darf keinen Ablauf auslösen.
                if value is False:
                    return ""
                changes = press_to_state(key, time.time())
            else:
                changes = value_to_state(value, key, info["dimmable"])
        elif (address, key) in self._by_power:
            entity_id = self._by_power[(address, key)]
            changes = power_to_state(value)
            if not changes:
                return ""
        else:
            entity_id = self._by_lux.get((address, key))
            if entity_id is None:
                return ""
            changes = lux_to_state(value)
            if not changes:
                return ""

        # Zurück in den Event-Loop des Hubs, der nicht threadsicher ist.
        asyncio.run_coroutine_threadsafe(
            self.hub.registry.update_state(entity_id, changes, available=True),
            self._loop,
        )
        return ""

    async def teardown(self) -> None:
        if self._server is not None:
            for port in sorted(self._ports()):
                try:
                    # Abmelden über dieselbe URL wie bei der Anmeldung, mit
                    # leerer Interface-ID – daran erkennt die CCU den Eintrag.
                    await self._call("init", self._callback_url, "", port=port)
                except Exception:
                    pass
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        await super().teardown()

    # ── Hub → CCU ──────────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        info = self._devices[entity.id]
        datapoint, value = command_to_value(command, data, info["dimmable"], entity.state)
        # Funk-Timeouts sind oft vorübergehend (Gerät gerade nicht wach, kurze
        # Störung) – ein zweiter Versuch räumt die meisten aus. Mehr als einen
        # gibt es bewusst nicht: Die CCU quittiert jeden Versuch erst nach
        # Sekunden, und die App soll nicht ewig auf eine Antwort warten.
        for attempt in (1, 2):
            try:
                await self._call(
                    "setValue",
                    info["command_address"],
                    datapoint,
                    value,
                    port=info["port"],
                )
                break
            except xmlrpc.client.Fault as err:
                if is_timeout(err) and attempt == 1:
                    self.log.warning(
                        "%s: %s antwortet nicht, zweiter Versuch …",
                        entity.id,
                        info["command_address"],
                    )
                    await asyncio.sleep(0.5)
                    continue
                raise HomePilotError(
                    command_error(info["command_address"], datapoint, err)
                ) from err
        # Die CCU meldet die Änderung per Event zurück; ohne Callback-Betrieb
        # ziehen wir den Zustand direkt nach.
        if self._server is None:
            await self.hub.registry.update_state(
                entity.id, value_to_state(value, datapoint, info["dimmable"])
            )


INTEGRATION = HomematicIntegration
