"""Homematic-Geräte über die XML-RPC-Schnittstelle der CCU.

Konfiguration:
  - integration: homematic
    host: 192.168.1.15
    port: 2001              # 2001 BidCos-RF (Funk), 2010 Homematic IP, 2000 Wired
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
import xmlrpc.client
from socketserver import ThreadingMixIn
from typing import Any
from xmlrpc.server import SimpleXMLRPCServer

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Der Hauptdatenpunkt je Entitätsart, wenn nichts anderes konfiguriert ist.
DEFAULT_DATAPOINTS = {
    EntityKind.SWITCH: "STATE",
    EntityKind.LIGHT: "STATE",
    EntityKind.BINARY_SENSOR: "STATE",
}
LEVEL = "LEVEL"


def value_to_state(value: Any, datapoint: str, dimmable: bool) -> dict[str, Any]:
    """Übersetzt einen CCU-Wert in Entitäts-Attribute.

    Homematic gibt Dimmwerte als Fliesskomma 0…1 an, die App rechnet in
    Prozent – umgerechnet wird deshalb hier, an genau einer Stelle.
    """
    if dimmable and datapoint == LEVEL:
        level = float(value or 0)
        return {"state": "on" if level > 0 else "off", "brightness": round(level * 100)}
    if datapoint == "STATE" and isinstance(value, bool):
        return {"state": "on" if value else "off"}
    return {"state": value}


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
        self._interval = float(self.config.get("scan_interval", 300))
        self._callback_port = int(self.config.get("callback_port", 9125))
        self._interface_id = f"homepilot-{self._port}"
        self._server: _CallbackServer | None = None
        self._callback_url: str | None = None
        self._loop = asyncio.get_running_loop()

        self._proxy = xmlrpc.client.ServerProxy(
            f"http://{self._host}:{self._port}",
            transport=_TimeoutTransport(15.0),
            allow_none=True,
        )

        # (Adresse, Datenpunkt) → entity_id, plus Stammdaten je Entität
        self._by_datapoint: dict[tuple[str, str], str] = {}
        self._devices: dict[str, dict[str, Any]] = {}

        for device in self.config.get("devices") or []:
            await self._add_device(device)

        await self._log_available_channels()
        await self._refresh_all()

        if self._callback_port:
            await self._start_callbacks()
        self.start_task(self._poll_loop())

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
            raise ConfigError(
                f"homematic: {address} braucht einen 'datapoint' (z.B. ACTUAL_TEMPERATURE)"
            )

        commands: list[str] = []
        if kind in (EntityKind.SWITCH, EntityKind.LIGHT):
            commands = ["turn_on", "turn_off", "toggle"]
            if dimmable:
                commands.append("set_brightness")

        entity = await self.add_entity(
            address.replace(":", "_").replace("-", "_"),
            kind,
            device.get("name", address),
            state={"state": "unknown"},
            commands=commands,
            available=False,
        )
        self._devices[entity.id] = {
            "address": address,
            "datapoint": datapoint,
            "dimmable": dimmable,
        }
        self._by_datapoint[(address, datapoint)] = entity.id

    # ── CCU → Hub ──────────────────────────────────────────────────────────

    async def _call(self, method: str, *args: Any) -> Any:
        """XML-RPC ist blockierend – deshalb in einem Thread ausführen."""
        return await asyncio.to_thread(getattr(self._proxy, method), *args)

    async def _log_available_channels(self) -> None:
        """Listet Kanäle der CCU – hilft beim Ausfüllen der Konfiguration."""
        try:
            devices = await self._call("listDevices")
        except Exception as err:
            self.log.warning("CCU nicht erreichbar: %s", err)
            return

        channels = {
            device["ADDRESS"]: device.get("TYPE", "")
            for device in devices
            if device.get("PARENT")
        }
        configured = {info["address"] for info in self._devices.values()}
        missing = configured - set(channels)
        if missing:
            self.log.warning(
                "Diese Adressen kennt die CCU nicht: %s", ", ".join(sorted(missing))
            )
        self.log.info(
            "CCU meldet %d Kanäle: %s",
            len(channels),
            ", ".join(f"{address} ({kind})" for address, kind in sorted(channels.items())[:40]),
        )

    async def _refresh_all(self) -> None:
        for entity_id, info in self._devices.items():
            try:
                value = await self._call("getValue", info["address"], info["datapoint"])
            except Exception as err:
                self.log.debug("getValue für %s fehlgeschlagen: %s", info["address"], err)
                await self.hub.registry.update_state(entity_id, {}, available=False)
                continue
            await self.hub.registry.update_state(
                entity_id,
                value_to_state(value, info["datapoint"], info["dimmable"]),
                available=True,
            )

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
        try:
            await self._call("init", self._callback_url, self._interface_id)
            self.log.info("Bei der CCU für Events angemeldet (%s)", self._callback_url)
        except Exception as err:
            self.log.warning(
                "Event-Anmeldung fehlgeschlagen (%s) – es wird nur gepollt", err
            )

    def _on_event(self, _interface_id: str, address: str, key: str, value: Any) -> str:
        """Wird von einem Thread des Callback-Servers aufgerufen."""
        entity_id = self._by_datapoint.get((address, key))
        if entity_id is not None:
            info = self._devices[entity_id]
            changes = value_to_state(value, key, info["dimmable"])
            # Zurück in den Event-Loop des Hubs, der nicht threadsicher ist.
            asyncio.run_coroutine_threadsafe(
                self.hub.registry.update_state(entity_id, changes, available=True),
                self._loop,
            )
        return ""

    async def teardown(self) -> None:
        if self._server is not None:
            try:
                # Abmelden über dieselbe URL wie bei der Anmeldung, mit leerer
                # Interface-ID – daran erkennt die CCU den Eintrag wieder.
                await self._call("init", self._callback_url, "")
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
        await self._call("setValue", info["address"], datapoint, value)
        # Die CCU meldet die Änderung per Event zurück; ohne Callback-Betrieb
        # ziehen wir den Zustand direkt nach.
        if self._server is None:
            await self.hub.registry.update_state(
                entity.id, value_to_state(value, datapoint, info["dimmable"])
            )


INTEGRATION = HomematicIntegration
