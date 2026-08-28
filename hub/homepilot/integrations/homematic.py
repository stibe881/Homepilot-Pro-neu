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

Der häufigste Fehlgriff ist der falsche Kanal desselben Geräts. Ein
Schaltaktor mit Tasten (HmIP-BSL etwa, Markenschalter mit Signalleuchte)
hat für jede Wippe einen KEY_TRANSCEIVER *und* mehrere
SWITCH_VIRTUAL_RECEIVER für die Ausgänge. Trägt man einen Ausgang als
``button`` ein, ist alles richtig geschrieben, den Kanal gibt es - und
trotzdem kommt nie ein Druck an, weil ein Ausgang nichts sendet. Die
Kachel meldet dann bis in alle Ewigkeit «Bereit, noch kein Druck».

Drei Wege dorthin, welcher Kanal es ist:

* Der Hub sagt es beim Start. Er fragt die CCU, welche Datenpunkte der
  eingetragene Kanal überhaupt anbietet; fehlt PRESS_SHORT, nennt eine
  Warnung, was der Kanal stattdessen kann und auf welchen Kanälen dieses
  Gerät Tastendrücke meldet - und dieselbe Zeile steht auf der Kachel.
* Oder einmal auf die Taste drücken und ins Log schauen: Ein Druck von
  einem Kanal, den niemand eingetragen hat, schreibt die fertige Zeile
  für die ``config.yaml`` hin.
* Oder von Hand nachsehen, ohne den laufenden Hub zu stören::

      docker exec homepilot-hub \
          python -m homepilot.integrations.homematic \
          -c /config/config.yaml --geraet 001A58A9A24256

  Das listet jeden Kanal des Geräts mit seiner Art, seinen Datenpunkten
  und dem Vorschlag, was dafür in die ``config.yaml`` gehört.

Nach den Datenpunkten und nicht nach der Kanalart, weil die Art es nicht
sicher sagt: Ein HmIP-Eingang kann als Taster *oder* als Ja/Nein-Kontakt
eingerichtet sein (``CHANNEL_OPERATION_MODE``), und dann heisst derselbe
Kanal einmal PRESS_SHORT und einmal STATE.

Messfühler geben ihren Datenpunkt an. Die Einheit und die Bedeutung
kommen von selbst dazu (``°C``/``temperature``, ``%``/``humidity``) -
ohne beides fände die Klima-Zeile der App den Fühler nicht:

      - address: "0006D8A9B12345:1"     # HmIP-STHO (Aussenfühler)
        port: 2010
        name: Temperatur aussen
        kind: sensor
        datapoint: ACTUAL_TEMPERATURE
      - address: "0006D8A9B12345:1"     # derselbe Kanal, zweiter Wert
        port: 2010
        name: Luftfeuchtigkeit aussen
        kind: sensor
        datapoint: HUMIDITY

Zwei Einträge auf derselben Adresse sind erlaubt: Der HmIP-STHO legt
Temperatur und Feuchte auf denselben Kanal. Der zweite bekommt seinen
Datenpunkt an die Kennung gehängt (``homematic.0006D8A9B12345_1_humidity``)
- ohne das überschriebe er den ersten, lautlos.

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
import threading
import time
import xmlrpc.client
from socketserver import ThreadingMixIn
from typing import Any
from xmlrpc.server import SimpleXMLRPCServer

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError, HomePilotError
from ..core.integration import Integration

# Die Kanal-Logik wohnt in homematic_channels.py; die Namen bleiben von
# hier importierbar - die Tests beziehen sie seit je aus homematic.
from .homematic_channels import (  # noqa: F401
    ALARM_STATUS_DATAPOINTS,
    DEFAULT_DATAPOINTS,
    IDLE_ALARM_VALUES,
    ILLUMINATION_DATAPOINTS,
    KEY_TYPES,
    LEVEL,
    LOW_BAT,
    MAINTENANCE_CHANNEL,
    PING_INTERVAL,
    PING_TIMEOUT,
    POWER,
    PRESS_DATAPOINTS,
    SLOW_CALLBACK,
    SWITCHING_TYPES,
    UnknownParameter,
    battery_to_state,
    button_hinweis,
    command_error,
    command_to_value,
    describe_channels,
    druck_hinweis,
    duty_cycle_of,
    fremder_druck,
    group_by_device,
    guess_device_class,
    is_timeout,
    kanal_rat,
    key_channels,
    lesbare_datenpunkte,
    local_address_for,
    lux_to_state,
    maintenance_address,
    power_to_state,
    press_to_state,
    switch_channel,
    unit_for,
    unknown_parameter,
    value_to_state,
)


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
        # Tastendrücke von Kanälen, die niemand eingetragen hat: jeder
        # Kanal sagt es einmal. Öfter wäre es kein Hinweis mehr, sondern
        # ein Protokoll jedes Lichtschalters im Haus.
        self._fremde: set[tuple[str, str]] = set()
        # Je Adresse und Datenpunkt der Grund, warum nichts ankommt –
        # einmal zusammengestellt, dann an die Kachel gereicht.
        self._gruende: dict[tuple[str, str], str] = {}
        # Datenpunkte, die einzeln nicht herausrücken und darum über das
        # ganze Wertepaket gelesen werden (siehe _wert).
        self._ueber_paramset: set[tuple[str, str]] = set()
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
            await self._check_button_channels(port, channels)
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
                    # Prozent, aber keine Luftfeuchtigkeit: Ohne diese
                    # Angabe landete die Funkauslastung als Tropfen in
                    # der Kopfzeile der App.
                    state={
                        "state": prozent,
                        "unit": "%",
                        "device_class": "duty_cycle",
                    },
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
                    {
                        "state": werte[address],
                        "unit": "%",
                        "device_class": "duty_cycle",
                    },
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
        # Die Einheit gehört zum Datenpunkt und nicht in jede Zeile der
        # config.yaml: Homematic liefert nackte Zahlen, und ohne «°C» ist
        # ein Aussenfühler für die Klima-Zeile der App unsichtbar
        # (lib/klimachip.ts). Angeben sticht raten.
        unit = device.get("unit") or unit_for(datapoint)

        # Ein Gerät, zwei Messwerte: Der HmIP-STHO legt Temperatur *und*
        # Luftfeuchtigkeit auf denselben Kanal. Zwei Einträge mit
        # derselben Adresse ergäben zweimal dieselbe Kennung - der zweite
        # überschriebe den ersten, lautlos. Der Datenpunkt hängt sich
        # deshalb an, sobald die Kennung schon vergeben ist.
        object_id = address.replace(":", "_").replace("-", "_")
        if self.entity_id(object_id) in self._devices:
            object_id = f"{object_id}_{str(datapoint).lower()}"
            self.log.info(
                "homematic: %s ist zweimal konfiguriert - der zweite Wert "
                "läuft als %s",
                address,
                self.entity_id(object_id),
            )

        entity = await self.add_entity(
            object_id,
            kind,
            device.get("name", address),
            state={
                "state": "unknown",
                **({"device_class": device_class} if device_class else {}),
                **({"unit": unit} if unit else {}),
            },
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

    async def _check_button_channels(self, port: int, channels: dict[str, str]) -> None:
        """Sagen, wenn ein Taster auf einem Kanal steht, der nichts sendet.

        Der gemeldete Fall: ein HmIP-BSL, eingetragen auf einem seiner
        Schaltausgänge. Alles richtig geschrieben, den Kanal gibt es, die
        Kachel steht da - und meldet bis in alle Ewigkeit «Bereit, noch
        kein Druck». Das stimmt sogar: Ein Schaltausgang sendet nichts.
        Nur merkt man es nie, weil nichts anderes passiert als nichts.

        Anders als beim Schalten wird hier nicht umgebogen: Ein Gerät hat
        oft zwei Wippen, und stillschweigend die linke zu nehmen, wenn
        jemand die rechte meinte, wäre schlimmer als die Wahrheit.
        """
        for entity_id, info in self._devices.items():
            if info["port"] != port or info["kind"] != EntityKind.BUTTON:
                continue
            hinweis = await self._taster_pruefen(port, info["address"], channels)
            if hinweis is None:
                continue
            self.log.warning("%s: %s", entity_id, hinweis)
            # Und auf die Kachel: Im Log liest es, wer sucht - auf der
            # Kachel steht es dem im Weg, der sich gerade wundert.
            await self.hub.registry.update_state(entity_id, {"error": hinweis})

    async def _taster_pruefen(
        self, port: int, address: str, channels: dict[str, str]
    ) -> str | None:
        """Meldet dieser Kanal überhaupt Tastendrücke?

        Gefragt wird die CCU, nicht die Kanalart: Ein HmIP-Eingang kann
        als Taster *oder* als Ja/Nein-Kontakt eingerichtet sein
        (CHANNEL_OPERATION_MODE), und dann heisst derselbe Kanal einmal
        PRESS_SHORT und einmal STATE. Die Art sagt das nicht.

        Einmal beim Start, je Taster ein Aufruf. Antwortet die CCU nicht,
        bleibt der gröbere Weg über die Kanalart - lieber ein Hinweis aus
        zweiter Hand als gar keiner.
        """
        try:
            beschreibung = await self._call(
                "getParamsetDescription", address, "VALUES", port=port
            )
        except Exception as err:
            self.log.debug("%s: Datenpunkte nicht lesbar (%s)", address, err)
            return button_hinweis(address, channels)
        if not isinstance(beschreibung, dict):
            return button_hinweis(address, channels)
        punkte = lesbare_datenpunkte(beschreibung)
        return druck_hinweis(address, channels.get(address, "?"), punkte, channels)

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
            # Warum nichts ankommt – leer, solange alles stimmt.
            problem: str | None = None
            schluessel = (info["address"], info["datapoint"])
            try:
                value = await self._wert(
                    info["address"], info["datapoint"], port, schluessel
                )
                changes.update(value_to_state(value, info["datapoint"], info["dimmable"]))
                self._warned.discard(schluessel)
                self._gruende.pop(schluessel, None)
            except Exception as err:
                # Den Grund nur beim ersten Mal zusammenstellen: Die
                # Nachfrage bei der CCU, welche Namen der Kanal kennt,
                # ist ein eigener Aufruf. Bei einem dauerhaft kaputten
                # Datenpunkt liefe der sonst alle fünf Minuten mit, ohne
                # dass jemand die Antwort noch einmal läse.
                grund = self._gruende.get(schluessel)
                if grund is None:
                    grund = (
                        f"{info['address']} liefert kein {info['datapoint']} "
                        f"({err}) – "
                        + await self._was_der_kanal_kennt(info["address"], port)
                    )
                    self._gruende[schluessel] = grund
                self._warn_once(schluessel, grund)
                # Und dasselbe an die Kachel: «nie gesehen» ohne Grund ist
                # eine Sackgasse - man sieht, dass etwas fehlt, aber nicht
                # was zu tun ist. Der Satz steht im Log; hier steht er
                # dort, wo man das Gerät anschaut. Bewusst *neben*
                # `changes`: Ob ein Gerät erreichbar ist, entscheidet
                # sich an echten Werten, nicht an einer Fehlermeldung.
                problem = grund

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
                await self.hub.registry.update_state(
                    entity_id, {**changes, "problem": problem}, available=True
                )
            else:
                await self.hub.registry.update_state(
                    entity_id, {"problem": problem}, available=False
                )

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

    async def _wert(
        self, address: str, datapoint: str, port: int, schluessel: tuple[str, str]
    ) -> Any:
        """Einen Datenpunkt lesen – notfalls über das ganze Wertepaket.

        Der Fall, an dem die Rack-Fühler hingen: Die CCU antwortete auf
        `getValue(…, "HUMIDITY")` mit «Fault -5: Unknown Parameter», und
        die Beschreibung desselben Kanals zählte HUMIDITY seelenruhig
        mit auf. Kein Widerspruch, sondern zwei verschiedene Fragen:
        `getValue` liefert aus dem Wertespeicher der CCU, und der ist für
        einen Datenpunkt leer, bis das Gerät zum ersten Mal gesendet hat
        – bei einem batteriebetriebenen HmIP-Fühler nach jedem CCU-Neustart
        also erst einmal für alle.

        `getParamset(…, "VALUES")` liest dasselbe Paket am Stück und gibt
        zurück, was da ist. Genau diesen Weg gehen andere Anbindungen
        auch. Er kostet einen Aufruf mehr – darum nur, wenn der erste
        Weg an genau diesem Fehler scheitert, und danach gemerkt: Ein
        Kanal, der es einmal so brauchte, braucht es immer so.
        """
        if schluessel not in self._ueber_paramset:
            try:
                return await self._call("getValue", address, datapoint, port=port)
            except Exception as err:
                if not unknown_parameter(err):
                    raise
                self._ueber_paramset.add(schluessel)
                self.log.info(
                    "%s gibt %s nicht einzeln her – ab jetzt über das "
                    "Wertepaket (getParamset)",
                    address,
                    datapoint,
                )
        paket = await self._call("getParamset", address, "VALUES", port=port)
        if isinstance(paket, dict) and datapoint in paket:
            return paket[datapoint]
        # Auch das Paket kennt ihn nicht: Dann ist es wirklich der
        # falsche Name, und der Aufrufer soll seine Warnung bauen.
        raise UnknownParameter(
            f"weder einzeln noch im Wertepaket lesbar: {datapoint}"
        )

    async def _was_der_kanal_kennt(self, address: str, port: int) -> str:
        """Der zweite Satz der Warnung: Welche Datenpunkte hat der Kanal?

        «liefert kein ACTUAL_TEMPERATURE» beantwortet die Frage nicht, die
        man dann hat - nämlich wie der Wert bei *diesem* Gerät heisst. Die
        CCU weiss es: getParamsetDescription zählt die Namen des Kanals
        auf. Einmal nachfragen ist die Antwort, die man sonst im Netz
        sucht.

        Scheitert auch das, bleibt der alte Hinweis: Bei HmIP liegt der
        gesuchte Wert oft auf einem anderen Kanal desselben Geräts.
        """
        namen: list[str] = []
        try:
            beschreibung = await self._call(
                "getParamsetDescription", address, "VALUES", port=port
            )
            if isinstance(beschreibung, dict):
                namen = sorted(str(name) for name in beschreibung)
        except Exception as err:
            self.log.debug("Kein Paramset für %s: %s", address, err)
        if namen:
            return f"dieser Kanal kennt: {', '.join(namen)}"
        return (
            "bei HmIP liegt der gesuchte Wert oft auf einem anderen Kanal "
            "desselben Geräts (siehe Kanalliste oben)"
        )

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
                self._fremden_druck_melden(address, key, value)
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

    def _fremden_druck_melden(self, address: str, key: str, value: Any) -> None:
        """Einen Tastendruck von einem nicht eingetragenen Kanal ins Log.

        Die nützlichste Zeile, die dieser Hub schreibt: Wer nicht weiss,
        welcher Kanal seines Schalters sendet, drückt einmal darauf und
        liest hier nach - samt der Zeile, die in die config.yaml gehört.
        Ohne das blieb nur Raten, und ein Kanal mehr oder weniger sieht in
        der Kanalliste gleich aus.

        Nur echte Drücke: Das Loslassen meldet die CCU als zweites
        Ereignis mit False, und je Kanal genügt es einmal.
        """
        if key not in PRESS_DATAPOINTS or value is False:
            return
        if (address, key) in self._fremde:
            return
        self._fremde.add((address, key))
        self.log.info("homematic: %s", fremder_druck(address, key))

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


def _kanal_main(config_path: str, geraet: str) -> int:
    """Die CCU selbst fragen, was ein Gerät hergibt.

    Aufruf:  docker exec homepilot-hub \
                 python -m homepilot.integrations.homematic \
                 -c /config/config.yaml --geraet 001A58A9A24256

    «Der Taster tut nichts» hat mehrere mögliche Ursachen, und von aussen
    sehen sie gleich aus: der falsche Kanal, die falsche ``kind``, oder
    ein Kanal, der als Ja/Nein-Kontakt statt als Taster eingerichtet ist
    (HmIP-Eingänge können beides, CHANNEL_OPERATION_MODE). Die Kanalart
    allein entscheidet das nicht - erst die Datenpunkte, die der Kanal
    anbietet, sagen es sicher.

    Hier steht beides nebeneinander, samt der Zeile, die in die
    config.yaml gehört. Der laufende Hub merkt davon nichts: Es wird nur
    gelesen.
    """
    from ..core.config import load_config
    from ..core.stand import stand_zeile

    # Als Erstes, damit man nicht die Ausgabe eines alten Abbilds deutet.
    print(stand_zeile())

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "homematic"]
    if not blocks:
        print("In der config.yaml steht keine homematic-Integration.")
        return 1
    block = blocks[0]
    host = block.get("host")
    if not host:
        print("Der homematic-Block hat kein 'host'.")
        return 1

    serial = geraet.split(":", 1)[0]
    # Beide Schnittstellen: klassisches BidCos auf 2001, Homematic IP auf
    # 2010. Welche das Gerät führt, weiss man vorher gerade nicht - das
    # ist ja oft die Frage.
    ports = sorted(
        {int(block.get("port", 2001))}
        | {int(g["port"]) for g in (block.get("devices") or []) if g.get("port")}
        | {2001, 2010}
    )

    gefunden = False
    for port in ports:
        proxy = xmlrpc.client.ServerProxy(
            f"http://{host}:{port}", transport=_TimeoutTransport(10.0)
        )
        try:
            devices = proxy.listDevices()
        except Exception as err:
            print(f"Port {port}: nicht erreichbar ({err})")
            continue
        kanaele = [
            device
            for device in devices
            if str(device.get("ADDRESS", "")).split(":", 1)[0] == serial
            and device.get("PARENT")
        ]
        if not kanaele:
            continue
        gefunden = True
        eltern = next(
            (d for d in devices if str(d.get("ADDRESS")) == serial),
            {},
        )
        print(f"\n{serial} auf Port {port} - {eltern.get('TYPE') or 'unbekannter Typ'}")
        print(f"{'Kanal':<8}{'Art':<32}{'Rat':<34}Datenpunkte")
        print("-" * 110)

        def nummer(device: dict[str, Any]) -> int:
            teil = str(device.get("ADDRESS", "")).split(":", 1)
            return int(teil[1]) if len(teil) > 1 and teil[1].isdigit() else 0

        for device in sorted(kanaele, key=nummer):
            adresse = str(device["ADDRESS"])
            art = str(device.get("TYPE") or "?")
            try:
                beschreibung = proxy.getParamsetDescription(adresse, "VALUES")
                punkte = lesbare_datenpunkte(beschreibung)
            except Exception as err:
                print(f"{nummer(device):<8}{art:<32}{'?':<34}nicht lesbar ({err})")
                continue
            rat = kanal_rat(art, punkte)
            # Der Betriebsmodus, wo es ihn gibt: Derselbe Kanal heisst je
            # nach Einstellung einmal PRESS_SHORT und einmal STATE.
            modus = ""
            try:
                master = proxy.getParamset(adresse, "MASTER")
                wert = master.get("CHANNEL_OPERATION_MODE")
                if wert is not None:
                    modus = f"  [CHANNEL_OPERATION_MODE={wert}]"
            except Exception:
                pass
            print(
                f"{nummer(device):<8}{art:<32}{rat:<34}"
                f"{', '.join(sorted(punkte)) or '-'}{modus}"
            )

    if not gefunden:
        print(
            f"\nKein Gerät {serial} gefunden. Steht die Seriennummer richtig da? "
            "Die Kanalliste aller Geräte schreibt der Hub beim Start ins Log."
        )
        return 1
    print(
        "\nDie Spalte «Rat» folgt den Datenpunkten, nicht der Kanalart: "
        "PRESS_SHORT heisst Taster, STATE heisst Schalten oder Melden."
    )
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Homematic für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml")
    parser.add_argument(
        "--geraet",
        metavar="SERIENNUMMER",
        help="Kanäle und Datenpunkte eines Geräts zeigen "
        "(stört den laufenden Hub nicht)",
    )
    args = parser.parse_args()
    if not args.geraet:
        parser.print_help()
        sys.exit(2)
    sys.exit(_kanal_main(args.config, args.geraet))


INTEGRATION = HomematicIntegration
