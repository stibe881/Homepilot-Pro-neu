"""Die Kanal-Logik der Homematic-Anbindung (rein, testbar).

Herausgelöst aus homematic.py (Punkt 50 der Werkbank): Welcher Kanal
schaltet, was ein Datenpunkt-Wert für den Zustand bedeutet, wie ein
Befehl zu (Datenpunkt, Wert) wird - alles über blossen Werten
entscheidbar, ohne CCU. Die Integration daneben spricht XML-RPC.
"""

from __future__ import annotations

import socket
from typing import Any

from ..core.entity import EntityKind

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

# Datenpunkte, die einen Druck begleiten, aber keiner sind: Anfang und
# Ende eines langen Drucks, die Wiederholung beim Halten. Der Hub wertet
# sie nicht aus - er würde sonst einen langen Druck dreimal melden. Sie
# sind aber der Beweis, dass die CCU überhaupt etwas weiterreicht, und
# genau danach sucht man, wenn eine Taste «nichts tut».
PRESS_BEGLEITER = frozenset({"PRESS_LONG_START", "PRESS_LONG_RELEASE", "PRESS_CONT"})

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

# Kanalarten, die einen Tastendruck melden.
#
# Der Unterschied ist der Grund, warum ein eingetragener Taster schweigen
# kann: Ein HmIP-BSL etwa hat für jede Wippe einen KEY_TRANSCEIVER *und*
# mehrere SWITCH_VIRTUAL_RECEIVER für die Schaltausgänge. Trägt man einen
# der Ausgänge ein, ist alles richtig geschrieben, der Kanal existiert -
# und trotzdem kommt nie ein PRESS_SHORT, weil ein Ausgang nichts sendet.
#
# «Bereit, noch kein Druck» ist dann die Wahrheit und trotzdem irreführend.
# Darum sagt der Hub es beim Start (siehe button_hinweis).
KEY_TYPES = frozenset(
    {
        # Klassisches BidCos: Wandtaster, Fernbedienungen.
        "KEY",
        "VIRTUAL_KEY",
        # Homematic IP: Wandtaster, Wippen, Schaltaktoren mit Tasten.
        "KEY_TRANSCEIVER",
        # Angeschlossene Kontakte, die als Taster arbeiten (HmIP-FCI, -DSD).
        "MULTI_MODE_INPUT_TRANSMITTER",
        "SWITCH_INTERFACE",
    }
)

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


def key_channels(address: str, channels: dict[str, str]) -> list[str]:
    """Die Tastenkanäle desselben Geräts, aufsteigend (rein, testbar).

    ``channels`` ist die Kanalliste der CCU (Adresse → Kanalart). Eine
    leere Liste heisst: Dieses Gerät hat keinen - dann ist der Eintrag
    nicht bloss auf dem falschen Kanal, sondern am falschen Gerät.
    """
    serial = address.split(":", 1)[0]

    def number(candidate: str) -> int:
        part = candidate.split(":", 1)[1] if ":" in candidate else ""
        return int(part) if part.isdigit() else 0

    return sorted(
        (
            candidate
            for candidate, kind in channels.items()
            if candidate.split(":", 1)[0] == serial and kind in KEY_TYPES
        ),
        key=number,
    )


def button_hinweis(address: str, channels: dict[str, str]) -> str | None:
    """Warum von diesem Kanal nie ein Druck kommt (rein, testbar).

    ``None`` heisst: Alles in Ordnung, oder der Hub weiss es nicht besser
    (die CCU kennt den Kanal nicht - dafür warnt schon die Kanalliste).

    Der Text nennt immer den Ausweg. «Falscher Kanal» allein hilft
    niemandem, der gerade zum dritten Mal auf seinen Schalter drückt.
    """
    art = channels.get(address)
    if art is None or art in KEY_TYPES:
        return None
    andere = [kanal for kanal in key_channels(address, channels) if kanal != address]
    if not andere:
        return (
            f"{address} ist ein {art} und meldet keine Tastendrücke - "
            "und dieses Gerät hat überhaupt keinen Tastenkanal. "
            "Wahrscheinlich ist die Adresse die eines anderen Geräts."
        )
    return (
        f"{address} ist ein {art} und meldet keine Tastendrücke. "
        f"Dieses Gerät meldet sie auf: {', '.join(andere)}."
    )


def druck_hinweis(
    address: str,
    art: str,
    datenpunkte: set[str],
    channels: dict[str, str],
) -> str | None:
    """Warum von diesem Kanal kein Druck kommt - nach den Datenpunkten.

    Genauer als ``button_hinweis``, das nur die Kanalart kennt: Ein
    HmIP-Eingang kann als Taster *oder* als Ja/Nein-Kontakt eingerichtet
    sein, und dann heisst derselbe Kanal einmal PRESS_SHORT und einmal
    STATE. Was der Kanal wirklich anbietet, weiss nur die CCU.

    ``None`` heisst: Der Kanal meldet Tastendrücke, alles in Ordnung.
    """
    if datenpunkte & set(PRESS_DATAPOINTS):
        return None
    satz = (
        f"{address} meldet keine Tastendrücke: Der Kanal ({art}) kennt "
        f"{', '.join(sorted(datenpunkte)) or 'gar keine Datenpunkte'}. "
        f"Dafür passt {kanal_rat(art, datenpunkte)}."
    )
    andere = [kanal for kanal in key_channels(address, channels) if kanal != address]
    if andere:
        return satz + f" Tastendrücke meldet dieses Gerät auf: {', '.join(andere)}."
    return satz


def fremder_druck(address: str, datapoint: str) -> str:
    """Ein Tastendruck von einem Kanal, den niemand eingetragen hat.

    Die nützlichste Zeile im ganzen Log: Wer nicht weiss, welcher Kanal
    seines Schalters sendet, drückt einmal und liest hier nach - samt
    dem Stück config.yaml, das er braucht.
    """
    return (
        f"Tastendruck auf {address} ({datapoint}) - dieser Kanal steht in "
        "keiner Konfiguration. Zum Eintragen: "
        f'address: "{address}", kind: button'
    )


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
    # Messwerte. Die App sucht ihre Klima-Zeile über device_class und
    # Einheit (lib/klimachip.ts): Ohne beides ist ein Aussenfühler bloss
    # eine Zahl in der Geräteliste - und der Tropfen oben zeigte im
    # Zweifel den Sendespeicher der Funkschnittstelle, weil auch der in
    # Prozent zählt.
    "ACTUAL_TEMPERATURE": "temperature",
    "TEMPERATURE": "temperature",
    "SET_POINT_TEMPERATURE": "temperature",
    "HUMIDITY": "humidity",
    "ACTUAL_HUMIDITY": "humidity",
    "ILLUMINATION": "illuminance",
    "CURRENT_ILLUMINATION": "illuminance",
}

# Die Einheit zum Datenpunkt. Homematic liefert nackte Zahlen; welche
# Einheit dazugehört, weiss nur, wer den Datenpunkt kennt.
UNIT_BY_DATAPOINT: dict[str, str] = {
    "ACTUAL_TEMPERATURE": "°C",
    "TEMPERATURE": "°C",
    "SET_POINT_TEMPERATURE": "°C",
    "HUMIDITY": "%",
    "ACTUAL_HUMIDITY": "%",
    "ILLUMINATION": "lx",
    "CURRENT_ILLUMINATION": "lx",
    "AVERAGE_ILLUMINATION": "lx",
    "RAIN_COUNTER": "mm",
    "WIND_SPEED": "km/h",
    "AIR_PRESSURE": "hPa",
    "CONCENTRATION": "ppm",
}


class UnknownParameter(RuntimeError):
    """Ein Datenpunkt, den auch das ganze Wertepaket nicht hergibt.

    Braucht es, weil der zweite Leseweg (`getParamset`) keinen Fehler
    wirft, sondern schlicht ein Paket ohne den gesuchten Namen liefert.
    Ohne eigene Ausnahme müsste der Aufrufer zwei Fälle unterscheiden -
    so bleibt für ihn beides derselbe: Der Wert kam nicht.
    """


def unknown_parameter(err: Any) -> bool:
    """Meint dieser Fehler «diesen Datenpunkt gibt es hier nicht»? (rein)

    Die CCU antwortet auf jeden Unfug mit «Fault -5». Nur der Text
    unterscheidet «Kanal kennt den Namen nicht» von «Wert gerade nicht
    lesbar» - und nur im ersten Fall lohnt die Nachfrage, welche Namen
    der Kanal denn hat.
    """
    return "unknown parameter" in str(err).lower()


def unit_for(datapoint: str | None) -> str | None:
    """Welche Einheit gehört zu diesem Datenpunkt? (rein, testbar)

    Nichts zu wissen ist besser als zu raten: Ein falsches «°C» an einem
    Zählerstand macht aus einer Zahl eine falsche Aussage.
    """
    return UNIT_BY_DATAPOINT.get(str(datapoint or "").upper())


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



# ── Was ein Kanal hergibt (fürs Nachsehen an der CCU) ─────────────────────


def kanal_rat(art: str, datenpunkte: set[str]) -> str:
    """Was in die config.yaml gehört, damit dieser Kanal etwas tut (rein).

    Nicht die Kanalart allein entscheidet, sondern was der Kanal an
    Datenpunkten anbietet: Ein HmIP-Eingang kann als Taster *oder* als
    Ja/Nein-Kontakt eingerichtet sein (CHANNEL_OPERATION_MODE), und dann
    heisst derselbe Kanal einmal PRESS_SHORT und einmal STATE. Wer nach
    der Art geht, rät; wer nach den Datenpunkten geht, weiss es.

    Die Art zählt trotzdem an einer Stelle mit: Ein Gerät hat zu jedem
    Empfängerkanal einen Sendekanal, der dieselben Datenpunkte führt
    (SWITCH_TRANSMITTER neben SWITCH_VIRTUAL_RECEIVER). Nur der Empfänger
    lässt sich schalten - der Sender daneben ist die Rückmeldung des
    Geräts an sich selbst und gehört in keine Zeile.
    """
    if "PRESS_SHORT" in datenpunkte or "PRESS_LONG" in datenpunkte:
        return "kind: button"
    if "POWER" in datenpunkte:
        return "power_address (Messkanal)"
    if art == "MAINTENANCE":
        # Der Wartungskanal jedes Geräts. Der Hub liest ihn von selbst -
        # eine eigene Zeile dafür wäre eine Kachel «UNREACH».
        return "Wartungskanal - liest der Hub selbst"
    if "COLOR" in datenpunkte and "LEVEL" in datenpunkte and art in SWITCHING_TYPES:
        # Die Signalleuchte eines Markenschalters (HmIP-BSL). Als Licht
        # eintragbar; die Farbe stellt der Hub (noch) nicht.
        return "kind: light, dimmable: true (Signalleuchte)"
    if "LEVEL" in datenpunkte and art in SWITCHING_TYPES:
        return "kind: light, dimmable: true"
    if "STATE" in datenpunkte and art in SWITCHING_TYPES:
        return "kind: light oder switch"
    if art.endswith("_TRANSMITTER") and art not in KEY_TYPES:
        # Sendekanäle führen dieselben Datenpunkte wie ihr Empfänger,
        # lassen sich aber nicht schalten: jedes setValue endet in
        # Fault -5. Wer sie einträgt, bekommt eine Kachel, die nichts kann.
        #
        # Nicht jeder Sender ist einer: Der MULTI_MODE_INPUT_TRANSMITTER
        # eines HmIP-Eingangs heisst so und ist trotzdem ein Eingang -
        # darum die Ausnahme über KEY_TYPES.
        return "Sendekanal - nicht eintragen"
    if "STATE" in datenpunkte:
        return "kind: binary_sensor, datapoint: STATE"
    messwerte = sorted(
        name
        for name in datenpunkte
        if name.startswith(("ACTUAL_", "CURRENT_", "HUMIDITY", "ILLUMINATION"))
    )
    if messwerte:
        return f"kind: sensor, datapoint: {messwerte[0]}"
    if not datenpunkte:
        return "nichts - dieser Kanal gibt nichts her"
    return "kein Vorschlag - siehe daneben"


def lesbare_datenpunkte(beschreibung: dict[str, Any]) -> set[str]:
    """Aus der Paramset-Beschreibung der CCU die Namen holen (rein).

    Die CCU antwortet mit einem Wörterbuch je Datenpunkt; interessant ist
    hier nur, welche es gibt. Alles, was sich nicht lesen lässt (Flag 1
    fehlt), fällt heraus - ein Datenpunkt, den man nur schreiben kann,
    meldet auch nichts.
    """
    namen = set()
    for name, angaben in beschreibung.items():
        if not isinstance(angaben, dict):
            namen.add(str(name))
            continue
        operations = angaben.get("OPERATIONS")
        # Bit 1 = lesbar, Bit 4 = meldet Ereignisse. Fehlt die Angabe,
        # wird nicht gefiltert - lieber einer zu viel als einer zu wenig.
        if operations is None or int(operations) & 0b101:
            namen.add(str(name))
    return namen


def wartungszeile(werte: dict[str, Any]) -> str:
    """Was der Wartungskanal über ein Gerät sagt (rein, testbar).

    Bei einem Batteriegerät, das sich nur beim Drücken meldet, ist das
    die einzige Auskunft, die es *ohne* Druck gibt - und damit die
    Antwort auf «alles richtig eingetragen und trotzdem stumm»:

    * ``UNREACH`` - die CCU hält es für unerreichbar. Dann liegt es an
      der Funkstrecke oder am Anlernen, nicht an der config.yaml.
    * ``CONFIG_PENDING`` - die CCU hat noch eine Konfiguration offen und
      wartet auf den nächsten Kontakt. Solange das steht, ist das Gerät
      angelernt, aber noch nicht fertig eingerichtet.
    * ``RSSI_DEVICE`` - wie gut die CCU es zuletzt gehört hat. Fehlt der
      Wert ganz, hat sie es noch nie gehört.
    """
    teile: list[str] = []
    for name in ("UNREACH", "CONFIG_PENDING", "LOW_BAT", "UPDATE_PENDING"):
        if name not in werte:
            continue
        teile.append(f"{name}={'ja' if werte[name] else 'nein'}")
    rssi = werte.get("RSSI_DEVICE")
    if isinstance(rssi, int) and rssi not in (0, 65536):
        teile.append(f"RSSI_DEVICE={rssi} dBm")
    elif "RSSI_DEVICE" in werte:
        teile.append("RSSI_DEVICE=noch nie gehört")
    spannung = werte.get("OPERATING_VOLTAGE")
    if isinstance(spannung, (int, float)) and spannung:
        teile.append(f"Batterie {float(spannung):.1f} V")
    return " · ".join(teile) or "keine Angaben"


def eintraege_zum_geraet(devices: list[dict[str, Any]], serial: str) -> list[str]:
    """Welche Kanäle dieses Geräts in der config.yaml stehen (rein, testbar).

    Die Frage, die der Kanalliste fehlte: Die CCU kennt das Gerät, die
    Datenpunkte stimmen - aber steht es überhaupt beim Hub? Ein Eintrag,
    den man in eine andere Datei geschrieben hat oder der beim Speichern
    verloren ging, sieht von aussen genauso aus wie ein Funkproblem.
    """
    gefunden = []
    for eintrag in devices or []:
        adresse = str(eintrag.get("address") or "")
        if adresse.split(":", 1)[0] != serial:
            continue
        art = str(eintrag.get("kind") or "?")
        name = str(eintrag.get("name") or adresse)
        gefunden.append(f"{adresse} «{name}» (kind: {art})")
    return sorted(gefunden)
