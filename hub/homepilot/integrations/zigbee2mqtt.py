"""Zigbee2MQTT: Zigbee-Geräte im eigenen Netz, ohne Wolke.

Konfiguration:
  - integration: zigbee2mqtt
    broker: 192.168.1.5
    port: 1883
    username: "${MQTT_USER}"
    password: "${MQTT_PASSWORD}"
    tls: false
    base_topic: zigbee2mqtt        # so heisst es bei Zigbee2MQTT selbst
    ignore:                        # optional: was der Hub nicht führen soll
      - Repeater Keller

**Warum eine eigene Integration und nicht die vorhandene mqtt.** Die
bedient Tasmota: ein Topic je Gerät, ON/OFF als Text, alles von Hand in
die config.yaml. Zigbee2MQTT führt eine Geräteliste und beschreibt jedes
Gerät selbst - was es kann, welche Werte es meldet, wie es heisst.
Dieselbe Liste von Hand nachzubauen wäre Arbeit, die der Bridge-Dienst
längst gemacht hat, und sie wäre nach dem ersten neuen Sensor falsch.

**Warum ohne Wolke.** Ein Aqara-Kontakt über Zigbee2MQTT redet mit dem
eigenen Koordinator im Haus. Derselbe Kontakt über die Hersteller-App
redet mit einem Rechenzentrum, und wenn dort etwas ausfällt, steht die
Wohnung. Das ist der ganze Grund für Zigbee.

**Wo das Funkstück steckt, ist hier nicht zu sehen** - und das ist
Absicht. Diese Integration liest MQTT-Themen; ob ein USB-Stick am Server
hängt oder ein Kästchen am Netzwerkkabel (hier: ein SONOFF Dongle Max
über PoE), weiss nur Zigbee2MQTT. Aufbau und Einstellungen des Dongles:
docs/zigbee.md.

Der Hub führt **ein Gerät als eine Kachel**, nicht als sieben. Ein
Bewegungsmelder, der Bewegung, Helligkeit, Temperatur und Batterie
meldet, ist im Alltag ein Bewegungsmelder; der Rest gehört als Angabe
daneben, nicht als eigene Kachel in den Raum.
"""

from __future__ import annotations

import asyncio
import json
import ssl
from typing import Any

import aiomqtt

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

#: Was Zigbee2MQTT als Zustand meldet und wie es beim Hub heisst. Der
#: linke Name ist der von Zigbee2MQTT (englisch, fest); der rechte der,
#: den Kacheln, Abläufe und die App benutzen.
MESSWERTE = {
    "temperature": "temperature",
    "humidity": "humidity",
    "pressure": "pressure",
    "illuminance_lux": "illuminance",
    "illuminance": "illuminance",
    "battery": "battery",
    "power": "power",
    "energy": "energy",
    "voltage": "voltage",
    "current": "current",
    "linkquality": "linkquality",
    # Was ein Rauchwarnmelder ausser «Rauch ja/nein» führt (Punkt 542).
    # Vorher fiel das alles hier durch: Diese Liste ist eine Auswahl,
    # kein Durchlass, und was nicht darin steht, kommt beim Hub nie an.
    # Gefragt war «Status, Batterie, Smoke density, Smoke density dbm
    # usw.» - und die beiden Dichten sind genau die Zahlen, an denen man
    # sieht, ob ein Melder noch misst oder nur noch hängt.
    "smoke_density": "smoke_density",
    "smoke_density_dbm": "smoke_density_dbm",
    # Der Melder im Selbsttest. Ohne dieses Feld sieht «Rauch» nach
    # Feuer aus, obwohl jemand nur den Knopf gedrückt hat.
    "test": "test",
}

#: Melder, deren «true» etwas bedeutet - und was der Hub daraus macht.
#: `device_class` ist dieselbe Sprache, die der Wächter und die App
#: schon sprechen (siehe core/watchrules.py).
MELDER = {
    "occupancy": ("motion", "on", "off"),
    "presence": ("motion", "on", "off"),
    "vibration": ("vibration", "on", "off"),
    "water_leak": ("moisture", "on", "off"),
    "smoke": ("smoke", "on", "off"),
    "gas": ("gas", "on", "off"),
    "tamper": ("tamper", "on", "off"),
    # Zigbee dreht den Kontakt um: `contact: true` heisst **zu**.
    # Wer das übersieht, baut ein Haus, das nachts meldet, alle Fenster
    # stünden offen, sobald sie geschlossen sind.
    "contact": ("contact", "off", "on"),
}

#: Umlaute gehören in den Namen, nicht in die Kennung. Sie steht in
#: Adressen, in Abläufen und in Szenen; ein «ü» darin ist überall dort
#: eine Quelle für Ärger, die man sich sparen kann.
UMSCHRIFT = str.maketrans(
    {"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "ae", "Ö": "oe", "Ü": "ue", "ß": "ss"}
)


def object_id(friendly_name: str) -> str:
    """Aus dem Namen bei Zigbee2MQTT eine Kennung (rein, testbar).

    Der Name ist das, was in Zigbee2MQTT steht - er darf Leerzeichen,
    Umlaute und Schrägstriche enthalten. Die Kennung muss stabil sein:
    Sie steht in Abläufen, Szenen und Favoriten, und wer sie ändert,
    lässt diese ins Leere zeigen. Deshalb wird sie aus dem Namen
    abgeleitet und nie neu vergeben - wer in Zigbee2MQTT umbenennt,
    bekommt allerdings eine neue Kachel; das ist der Preis dafür, dass
    Zigbee2MQTT selbst keine dauerhafte Kennung mitschickt, die nicht
    die IEEE-Adresse wäre.
    """
    sauber = []
    for zeichen in str(friendly_name or "").strip().lower().translate(UMSCHRIFT):
        if zeichen.isascii() and zeichen.isalnum():
            sauber.append(zeichen)
        elif zeichen in " -/._":
            sauber.append("_")
    kennung = "".join(sauber).strip("_")
    while "__" in kennung:
        kennung = kennung.replace("__", "_")
    return kennung or "geraet"


def _merkmale(exposes: Any) -> set[str]:
    """Alle Eigenschaftsnamen eines Geräts, auch die verschachtelten.

    Zigbee2MQTT beschreibt zusammengesetzte Geräte in Schichten: Ein
    Licht hat einen Block «light», und darin stecken state, brightness
    und color_temp. Flach gelesen fehlte die halbe Auskunft.
    """
    gefunden: set[str] = set()

    def gehe(knoten: Any) -> None:
        if isinstance(knoten, list):
            for eintrag in knoten:
                gehe(eintrag)
            return
        if not isinstance(knoten, dict):
            return
        art = str(knoten.get("type") or "")
        name = str(knoten.get("property") or knoten.get("name") or "")
        if name:
            gefunden.add(name)
        if art:
            gefunden.add(f"type:{art}")
        gehe(knoten.get("features"))

    gehe(exposes)
    return gefunden


def schreibbare_merkmale(exposes: Any) -> set[str]:
    """Nur die Eigenschaften, die man dem Gerät *schreiben* darf.

    Zigbee2MQTT führt je Eigenschaft ein `access`-Bitfeld: 1 heisst «wird
    gemeldet», 2 heisst «lässt sich über /set stellen», 4 heisst «lässt
    sich abfragen». `_merkmale` sammelt alle Namen, auch die nur
    lesbaren - für die Frage «was ist das für ein Gerät?» ist das
    richtig, für «was kann man ihm befehlen?» nicht.

    Der Unterschied ist hier nicht akademisch: Etliche Melder führen
    eine Eigenschaft `alarm`, und bei den meisten ist sie der *Zustand*
    («ich schlage gerade an») und kein Befehl. Ohne diese Trennung
    bekäme jeder davon einen Knopf «Signal geben», der nichts tut - und
    genau das soll die Auswahl im Ablauf-Editor nie zeigen
    (szenengeraete.ts).
    """
    gefunden: set[str] = set()

    def gehe(knoten: Any) -> None:
        if isinstance(knoten, list):
            for eintrag in knoten:
                gehe(eintrag)
            return
        if not isinstance(knoten, dict):
            return
        name = str(knoten.get("property") or knoten.get("name") or "")
        try:
            zugang = int(knoten.get("access") or 0)
        except (TypeError, ValueError):
            zugang = 0
        if name and zugang & 2:
            gefunden.add(name)
        gehe(knoten.get("features"))

    gehe(exposes)
    return gefunden


#: Wie ein Gerät zum Lärmen gebracht wird - in der Reihenfolge, in der
#: gesucht wird. `warning` ist der Zigbee-Standard dafür (IAS WD, das
#: «Warngerät» der Alarm-Spezifikation) und kann Ton, Blitzlicht und
#: Dauer; `alarm` ist die einfache Fassung vieler Tuya-Melder, ein
#: blosses Ja/Nein.
SIRENEN = ("warning", "alarm")

#: Wie die beiden Befehle beim Hub heissen. Nicht `turn_on`/`turn_off`:
#: Ein Rauchmelder, den man «einschaltet», klingt nach «scharf stellen» -
#: gemeint ist «mach jetzt Lärm». Der Name steht später in jedem Ablauf,
#: und er wird nie wieder geändert.
SIRENE_BEFEHLE = ("sound_alarm", "silence_alarm")

#: Wie lange ein Signal läuft, wenn im Ablauf nichts anderes steht.
#: Endlich und nicht dauerhaft: Beim `warning`-Standard hört das Gerät
#: von selbst wieder auf, und eine Sirene, die nur ein zweiter Befehl
#: stoppt, läuft nach einem Stromausfall im Hub weiter.
SIGNAL_SEKUNDEN = 30


def sirene_art(exposes: Any) -> str | None:
    """Womit dieses Gerät ein Signal gibt - oder None (rein, testbar).

    Gefragt im Haus: «Ich kann in den Abläufen nicht machen, dass wenn
    etwas passiert, der Rauchwarnmelder ein Signal gibt.» Er konnte es
    nicht, weil ein Melder für den Hub bis dahin nur etwas *meldete* -
    Befehle hatte er keine, und ohne Befehl steht ein Gerät im
    Ablauf-Editor gar nicht zur Wahl.

    Ob er es *kann*, hängt am Modell und nicht am Wunsch: Ein Melder
    ohne eingebaute Sirene (oder einer, dessen Sirene nur er selbst
    auslöst) hat hier nichts zu melden, und ein Knopf dafür wäre eine
    Attrappe. Darum die Frage ans Gerät und nicht an eine Liste von
    Modellnamen.
    """
    schreibbar = schreibbare_merkmale(exposes)
    for name in SIRENEN:
        if name in schreibbar:
            return name
    return None


def art_und_befehle(exposes: Any) -> tuple[str, list[str]]:
    """Was für ein Gerät ist das, und was kann man damit tun?

    (rein, testbar)

    Ein Gerät ist das, was man mit ihm *tut*: Ein Bewegungsmelder, der
    nebenbei die Temperatur misst, ist ein Bewegungsmelder. Deshalb
    entscheidet die erste Fähigkeit, die eine Bedienung hat - und erst
    danach, was er misst.
    """
    merkmale = _merkmale(exposes)

    if "type:light" in merkmale:
        befehle = ["turn_on", "turn_off", "toggle"]
        if "brightness" in merkmale:
            befehle.append("set_brightness")
        if "color_temp" in merkmale:
            befehle.append("set_color_temp")
        if "color_xy" in merkmale or "color_hs" in merkmale:
            befehle.append("set_color")
        return EntityKind.LIGHT, befehle
    if "type:cover" in merkmale:
        befehle = ["open", "close", "stop"]
        if "position" in merkmale:
            befehle.append("set_position")
        return EntityKind.COVER, befehle
    if "type:lock" in merkmale:
        return EntityKind.LOCK, ["lock", "unlock"]
    if "type:switch" in merkmale or ("state" in merkmale and "type:climate" not in merkmale):
        return EntityKind.SWITCH, ["turn_on", "turn_off", "toggle"]
    if "action" in merkmale:
        # Ein Wandtaster hat keinen Zustand, den man ablesen könnte - er
        # meldet einen Druck.
        return EntityKind.BUTTON, []
    # Ein Melder mit eingebauter Sirene bleibt ein Melder - im Alltag ist
    # er das, was er meldet. Er bekommt aber Befehle, und erst damit
    # steht er im Ablauf-Editor überhaupt zur Wahl (Punkt 543).
    laerm = SIRENE_BEFEHLE if sirene_art(exposes) else []
    for name in MELDER:
        if name in merkmale:
            return EntityKind.BINARY_SENSOR, list(laerm)
    return EntityKind.SENSOR, list(laerm)


def melder_klasse(exposes: Any) -> str | None:
    """Welcher Melder ist das? (rein, testbar)

    Die Geräteklasse ist keine Zierde: Der Wächter entscheidet daran, ob
    «offen» Heizkosten bedeutet, und die Kopfzeile zählt danach die
    offenen Fenster.
    """
    merkmale = _merkmale(exposes)
    for name, (klasse, _an, _aus) in MELDER.items():
        if name in merkmale:
            return klasse
    return None


def hauptwert(exposes: Any) -> str | None:
    """Welcher Messwert auf der Kachel gross dasteht (rein, testbar).

    Ein Sensor, der Temperatur, Feuchte, Druck und Batterie meldet,
    braucht eine Zahl im Vordergrund - sonst steht dort «unbekannt» und
    die vier Werte daneben.
    """
    merkmale = _merkmale(exposes)
    for name in ("temperature", "humidity", "illuminance_lux", "illuminance", "pressure", "battery"):
        if name in merkmale:
            return MESSWERTE[name]
    return None


def geraete_aus_bridge(payload: Any, ignorieren: set[str] | None = None) -> list[dict[str, Any]]:
    """Die Geräteliste von `bridge/devices` lesen (rein, testbar).

    Übersprungen wird, was keine Kachel verdient: der Koordinator selbst
    (der Stick), nicht unterstützte Geräte (Zigbee2MQTT kennt sie nicht,
    der Hub kann es dann auch nicht) und was in `ignore` steht.
    """
    weg = {str(name).strip().lower() for name in (ignorieren or set())}
    raus: list[dict[str, Any]] = []
    for eintrag in payload or []:
        if not isinstance(eintrag, dict):
            continue
        if str(eintrag.get("type") or "").lower() == "coordinator":
            continue
        name = str(eintrag.get("friendly_name") or "").strip()
        if not name or name.lower() in weg:
            continue
        if eintrag.get("supported") is False:
            continue
        definition = eintrag.get("definition") or {}
        raus.append(
            {
                "name": name,
                "id": object_id(name),
                "exposes": definition.get("exposes"),
                "model": str(definition.get("description") or definition.get("model") or ""),
            }
        )
    return sorted(raus, key=lambda geraet: geraet["name"].lower())


def zustand_aus_payload(
    payload: dict[str, Any], kind: str, klasse: str | None, haupt: str | None
) -> dict[str, Any]:
    """Eine Zustandsmeldung in Hub-Felder übersetzen (rein, testbar)."""
    changes: dict[str, Any] = {}

    for zigbee, feld in MESSWERTE.items():
        if zigbee in payload and payload[zigbee] is not None:
            changes[feld] = payload[zigbee]

    # Sagt das Gerät selbst «Batterie schwach», gilt das. Der Prozentwert
    # ist bei Meldern oft geraten (drei Stufen, als 100/50/0 gemeldet),
    # die eigene Warnung des Geräts nicht - sie kommt vom Hersteller und
    # ist der Grund, aus dem der Melder nachts piept.
    if "battery_low" in payload and payload["battery_low"] is not None:
        changes["low_battery"] = bool(payload["battery_low"])
    elif "battery" in changes:
        try:
            changes["low_battery"] = float(changes["battery"]) <= 15
        except (TypeError, ValueError):
            pass

    for name, (_klasse, wenn_wahr, wenn_falsch) in MELDER.items():
        if name in payload:
            wert = wenn_wahr if payload[name] else wenn_falsch
            if kind == EntityKind.BINARY_SENSOR and klasse == _klasse:
                changes["state"] = wert
            else:
                changes[name] = wert

    if kind in (EntityKind.LIGHT, EntityKind.SWITCH) and "state" in payload:
        changes["state"] = "on" if str(payload["state"]).upper() == "ON" else "off"
        if "brightness" in payload and payload["brightness"] is not None:
            # Zigbee zählt 0-254, der Hub in Prozent.
            changes["brightness"] = round(float(payload["brightness"]) / 254 * 100)
        if payload.get("color_temp") is not None:
            changes["color_temp"] = payload["color_temp"]
    elif kind == EntityKind.COVER:
        if payload.get("position") is not None:
            # Dieselbe Einteilung wie bei Overkiz: «offen» heisst wirklich
            # offen, nicht «nicht ganz unten». Vorher galt jede Stellung
            # ueber null als offen - eine Store auf 5 % stand damit als
            # «Offen» da, obwohl sie fast zu war. Das trifft nicht nur die
            # Kachel: Ablaeufe, die «alles zu?» fragen, und das Widget
            # lesen denselben Zustand.
            position = max(0, min(100, int(payload["position"])))
            changes["position"] = position
            changes["state"] = (
                "open" if position >= 99 else "closed" if position <= 1 else "partial"
            )
    elif kind == EntityKind.LOCK and "state" in payload:
        changes["state"] = "locked" if str(payload["state"]).upper() == "LOCK" else "unlocked"
    elif kind == EntityKind.BUTTON and payload.get("action"):
        # Der Zustand *ist* der letzte Druck - siehe EntityKind.BUTTON.
        changes["state"] = str(payload["action"])
    elif kind == EntityKind.SENSOR and haupt and haupt in changes:
        changes["state"] = changes[haupt]

    if klasse:
        changes["device_class"] = klasse
    return changes


def sirene_nutzlast(art: str, command: str, data: dict[str, Any]) -> dict[str, Any]:
    """Was ein Signal auslöst oder abstellt (rein, testbar).

    Zwei Sprachen für dieselbe Sache. `warning` ist der Zigbee-Standard
    (IAS WD): Tonart, Lautstärke, Blitzlicht und Dauer in einem Rutsch.
    `alarm` ist das Ja/Nein vieler Tuya-Melder.

    Bei `warning` steht «feuer» (`mode: fire`) und nicht die Einbruchs-
    Tonfolge: Ein Rauchmelder, der wie eine Einbruchsirene klingt, sagt
    dem Haus das Falsche. Wo das Gerät nur Ja/Nein kennt, spielt es
    ohnehin seinen eigenen Ton.
    """
    an = command == SIRENE_BEFEHLE[0]
    if art == "alarm":
        return {"alarm": an}
    if not an:
        # «stop» und nicht `duration: 0`: Manche Geräte lesen die Null
        # als «unbegrenzt» und heulen dann erst recht weiter.
        return {"warning": {"mode": "stop", "strobe": False, "duration": 0}}
    try:
        dauer = int(data.get("duration") or SIGNAL_SEKUNDEN)
    except (TypeError, ValueError):
        dauer = SIGNAL_SEKUNDEN
    return {
        "warning": {
            "mode": "fire",
            "level": "very_high",
            "strobe": True,
            "strobe_level": "very_high",
            "duration": max(1, min(900, dauer)),
        }
    }


def set_nutzlast(
    kind: str, command: str, data: dict[str, Any], sirene: str | None = None
) -> dict[str, Any]:
    """Was in `<gerät>/set` geschrieben wird (rein, testbar)."""
    if command in SIRENE_BEFEHLE:
        if not sirene:
            raise ConfigError("Dieses Gerät kann kein Signal geben")
        return sirene_nutzlast(sirene, command, data)
    if kind == EntityKind.COVER:
        if command == "open":
            return {"state": "OPEN"}
        if command == "close":
            return {"state": "CLOSE"}
        if command == "stop":
            return {"state": "STOP"}
        if command == "set_position":
            return {"position": max(0, min(100, int(data.get("position", 0))))}
    if kind == EntityKind.LOCK:
        return {"state": "LOCK" if command == "lock" else "UNLOCK"}
    if command == "turn_on":
        return {"state": "ON"}
    if command == "turn_off":
        return {"state": "OFF"}
    if command == "toggle":
        return {"state": "TOGGLE"}
    if command == "set_brightness":
        prozent = max(0, min(100, float(data.get("brightness", 0))))
        # Aus 0 % wird «aus» und nicht «an mit Helligkeit 0»: Ein Licht,
        # das mit 0 leuchtet, ist ein Licht, das noch Strom zieht.
        if prozent <= 0:
            return {"state": "OFF"}
        return {"state": "ON", "brightness": round(prozent / 100 * 254)}
    if command == "set_color_temp":
        return {"color_temp": int(data.get("color_temp", 370))}
    if command == "set_color":
        return {"color": {"hex": str(data.get("color") or "#ffffff")}}
    raise ConfigError(f"Zigbee2MQTT kennt das Kommando '{command}' nicht")


def ist_erreichbar(payload: str) -> bool | None:
    """Die Erreichbarkeitsmeldung lesen (rein, testbar).

    Zigbee2MQTT schickt je nach Fassung schlicht «online» oder ein
    JSON-Objekt. None heisst «keine Auskunft» - dann bleibt es beim
    bisherigen Stand, statt ein Gerät auf Verdacht abzumelden.
    """
    text = str(payload or "").strip()
    if not text:
        return None
    if text.startswith("{"):
        try:
            text = str((json.loads(text) or {}).get("state") or "")
        except ValueError:
            return None
    wert = text.strip().lower()
    if wert == "online":
        return True
    if wert == "offline":
        return False
    return None


class Zigbee2MqttIntegration(Integration):
    name = "zigbee2mqtt"

    async def setup(self) -> None:
        # Als Text: aiomqtt verlangt einen str, und ohne Eintrag soll der
        # Fehler «kein Broker» lesbar aus dem Verbindungsversuch kommen,
        # nicht als Typfehler aus dem Aufbau.
        self._broker = str(self.config.get("broker") or "")
        if not self._broker:
            raise ConfigError("zigbee2mqtt braucht 'broker' in der Konfiguration")
        self._port = int(self.config.get("port", 1883))
        self._username = self.config.get("username")
        self._password = self.config.get("password")
        self._tls = bool(self.config.get("tls", False))
        self._tls_insecure = bool(self.config.get("tls_insecure", False))
        self._base = str(self.config.get("base_topic") or "zigbee2mqtt").strip("/")
        self._ignorieren = {
            str(name).strip().lower() for name in (self.config.get("ignore") or [])
        }
        self._client: aiomqtt.Client | None = None
        # Zigbee-Name → entity_id, und je Entität, was sie ist.
        self._geraete: dict[str, str] = {}
        self._namen: dict[str, str] = {}
        self._arten: dict[str, str] = {}
        self._klassen: dict[str, str | None] = {}
        self._haupt: dict[str, str | None] = {}
        # Womit dieses Gerät Lärm macht - «warning», «alarm» oder gar nicht.
        self._sirenen: dict[str, str] = {}

        self.start_task(self._connection_loop())

    def _tls_context(self) -> ssl.SSLContext | None:
        if not self._tls:
            return None
        context = ssl.create_default_context()
        if self._tls_insecure:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        return context

    async def _connection_loop(self) -> None:
        delay = 1.0
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=self._broker,
                    port=self._port,
                    username=self._username,
                    password=self._password,
                    tls_context=self._tls_context(),
                ) as client:
                    self._client = client
                    delay = 1.0
                    self.log.info("Mit dem Broker verbunden, warte auf die Geräteliste")
                    # Die Liste kommt zuerst und liegt beim Broker als
                    # «retained» - sie ist sofort da, ohne dass jemand
                    # Zigbee2MQTT neu starten muss.
                    await client.subscribe(f"{self._base}/bridge/devices")
                    await client.subscribe(f"{self._base}/+")
                    await client.subscribe(f"{self._base}/+/availability")
                    async for message in client.messages:
                        await self._nachricht(
                            str(message.topic), _decode(message.payload)
                        )
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.warning(
                    "Zigbee2MQTT-Verbindung verloren (%s), neuer Versuch in %.0fs",
                    err,
                    delay,
                )
            finally:
                self._client = None
            # Solange der Broker weg ist, wissen wir nichts über die Geräte.
            for entity_id in self._geraete.values():
                await self.hub.registry.update_state(entity_id, {}, available=False)
            await asyncio.sleep(delay)
            delay = min(60.0, delay * 2)

    async def _nachricht(self, topic: str, payload: str) -> None:
        rest = topic[len(self._base) + 1 :] if topic.startswith(self._base + "/") else ""
        if not rest:
            return
        if rest == "bridge/devices":
            await self._liste_uebernehmen(payload)
            return
        if rest.startswith("bridge/"):
            return
        if rest.endswith("/availability"):
            name = rest[: -len("/availability")]
            entity_id = self._geraete.get(name)
            erreichbar = ist_erreichbar(payload)
            if entity_id and erreichbar is not None:
                await self.hub.registry.update_state(
                    entity_id, {}, available=erreichbar
                )
            return
        entity_id = self._geraete.get(rest)
        if entity_id is None:
            return
        try:
            daten = json.loads(payload)
        except ValueError:
            return
        if not isinstance(daten, dict):
            return
        changes = zustand_aus_payload(
            daten,
            self._arten.get(entity_id, EntityKind.SENSOR),
            self._klassen.get(entity_id),
            self._haupt.get(entity_id),
        )
        if changes:
            await self.hub.registry.update_state(entity_id, changes, available=True)

    async def _liste_uebernehmen(self, payload: str) -> None:
        """Aus der Geräteliste Kacheln machen.

        Sie kommt bei jeder Änderung neu: Wer ein Gerät anlernt, sieht es
        ohne Neustart des Hubs. Bekannte bleiben, wie sie sind - ein
        Gerät neu anzulegen hiesse, seinen Raum und seine Favoriten zu
        verlieren.
        """
        try:
            roh = json.loads(payload)
        except ValueError:
            self.log.warning("Geräteliste nicht lesbar")
            return
        geraete = geraete_aus_bridge(roh, self._ignorieren)
        if not geraete:
            self.log.info("Zigbee2MQTT meldet keine Geräte")
            return
        neu = 0
        for geraet in geraete:
            if geraet["name"] in self._geraete:
                continue
            art, befehle = art_und_befehle(geraet["exposes"])
            klasse = melder_klasse(geraet["exposes"])
            haupt = hauptwert(geraet["exposes"])
            zustand: dict[str, Any] = {"state": "unknown"}
            if klasse:
                zustand["device_class"] = klasse
            entity = await self.add_entity(
                geraet["id"],
                art,
                geraet["name"],
                state=zustand,
                commands=befehle,
                # Bis die erste Meldung kommt, wissen wir nichts. Ein
                # Zigbee-Sensor meldet sich erst, wenn sich etwas ändert -
                # bei einem Fensterkontakt kann das Tage dauern.
                available=False,
            )
            self._geraete[geraet["name"]] = entity.id
            self._namen[entity.id] = geraet["name"]
            self._arten[entity.id] = art
            self._klassen[entity.id] = klasse
            self._haupt[entity.id] = haupt
            laermt = sirene_art(geraet["exposes"])
            if laermt:
                self._sirenen[entity.id] = laermt
            neu += 1
        if neu:
            self.log.info("%d Zigbee-Geräte übernommen", neu)

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        client = self._client
        if client is None:
            raise ConnectionError("Keine Verbindung zum Broker")
        name = self._namen.get(entity.id)
        if name is None:
            raise ConfigError("Dieses Gerät kennt Zigbee2MQTT nicht mehr")
        nutzlast = set_nutzlast(
            self._arten.get(entity.id, EntityKind.SWITCH),
            command,
            data,
            self._sirenen.get(entity.id),
        )
        await client.publish(f"{self._base}/{name}/set", json.dumps(nutzlast))
        # Den neuen Zustand meldet das Gerät selbst zurück - deshalb hier
        # bewusst kein optimistisches Setzen. Bei Zigbee dauert das
        # Millisekunden; ein vorweggenommener Zustand wäre nur dann
        # sichtbar, wenn er falsch ist.


def _decode(payload: Any) -> str:
    if isinstance(payload, (bytes, bytearray)):
        return payload.decode("utf-8", "ignore")
    return str(payload)


INTEGRATION = Zigbee2MqttIntegration
