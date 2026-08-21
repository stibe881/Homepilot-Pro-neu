"""Matter – Geräte über den Matter-Controller-Dienst.

Konfiguration:
  - integration: matter
    url: ws://127.0.0.1:5580/ws

Matter braucht einen Controller, der dauerhaft die "Fabric" hält (Schlüssel,
Zertifikate, Thread/WLAN-Zugänge). Das übernimmt ein eigener Dienst neben
dem Hub – der Block dazu steht in der docker-compose.yml. Diese Integration
ist nur ein WebSocket-Client darauf und braucht keine zusätzliche
Bibliothek.

Welcher Dienst: **matterjs-server** (matter.js). Der frühere
python-matter-server ist seit dem 23. Juni 2026 eingestellt; 8.1.2 war die
letzte Fassung. Der Nachfolger spricht dieselbe Schnittstelle – dieselben
Befehle, dieselben Ereignisse, dieselben Attributpfade – und übernimmt beim
ersten Start ein vorhandenes Datenverzeichnis. Wer noch den alten laufen
hat, wird also weiter bedient; neu aufgesetzt wird der neue.

    docker run -d --name matterjs-server --restart unless-stopped \
        --network host -v /opt/homepilot/matter:/data \
        ghcr.io/matter-js/matterjs-server:stable

Drei Dinge, an denen es sonst scheitert: Der Dienst braucht **host-Netz**
(mDNS geht nicht durch ein Bridge-Netz) und **IPv6 auf dem Host** – er
bindet mDNS an [::]:5353 und startet ohne IPv6 gar nicht. Und **kein
Bluetooth ohne Adapter**: Wer ihm NOBLE_BINDINGS=dbus mitgibt, ohne dass
ein bluez-Dienst läuft, bekommt keinen Dienst ohne Bluetooth, sondern gar
keinen – der Container stirbt an «write EPIPE».

Gerät koppeln (Code steht auf dem Gerät oder in dessen App):
    python -m homepilot.integrations.matter -c config.yaml --pair MT:Y.K90-Q...
    # oder der 11-stellige Zahlencode: --pair 34970112332

Danach erscheinen die Endpunkte automatisch als Entitäten. Unterstützt:
Lichter (an/aus, Helligkeit), Steckdosen, Temperatur-/Feuchte-/Licht-
Sensoren, Anwesenheits- und Kontaktsensoren sowie Türschlösser
(abschliessen, aufschliessen, aufziehen).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Matter-Gerätetypen (Descriptor-Cluster) → Entitätsart.
DEVICE_TYPE_KINDS = {
    256: EntityKind.LIGHT,   # On/Off Light
    257: EntityKind.LIGHT,   # Dimmable Light
    268: EntityKind.LIGHT,   # Color Temperature Light
    269: EntityKind.LIGHT,   # Extended Color Light
    266: EntityKind.SWITCH,  # On/Off Plug-in Unit
    267: EntityKind.SWITCH,  # Dimmable Plug-in Unit
    770: EntityKind.SENSOR,  # Temperature Sensor
    775: EntityKind.SENSOR,  # Humidity Sensor
    262: EntityKind.SENSOR,  # Light Sensor
    263: EntityKind.BINARY_SENSOR,  # Occupancy Sensor
    21: EntityKind.BINARY_SENSOR,   # Contact Sensor
    10: EntityKind.LOCK,            # Door Lock
}

# Kleinste Schema-Fassung des Dienstes, mit der diese Integration umgehen
# kann. Darunter sahen Knoten und Attribute anders aus; darüber ist die
# Schnittstelle bisher abwärtskompatibel geblieben - der Dienst nennt
# seinerseits, ab welcher Fassung er noch bedient (min_supported_schema).
# Geprüft wird das beim Verbinden, damit ein Bruch als Satz im Protokoll
# steht und nicht als rätselhaft leere Geräteliste.
MIN_SCHEMA = 6

# Cluster-IDs (dezimal, wie in den Attributpfaden "endpunkt/cluster/attribut").
ON_OFF = 6
LEVEL = 8
DESCRIPTOR = 29
BASIC_INFO = 40
BRIDGED_INFO = 57
BOOLEAN_STATE = 69
POWER_SOURCE = 47
DOOR_LOCK = 257
ILLUMINANCE = 1024
TEMPERATURE = 1026
HUMIDITY = 1029
OCCUPANCY = 1030


def _attr(attributes: dict[str, Any], endpoint: int, cluster: int, attr: int) -> Any:
    return attributes.get(f"{endpoint}/{cluster}/{attr}")


# ── Türschloss ────────────────────────────────────────────────────────────
# Matter kennt beim Schloss zwei verschiedene «auf»: den Riegel
# zurückfahren (UnboltDoor) und zusätzlich die Falle ziehen, sodass die
# Türe aufgeht (UnlockDoor). Ein Nuki Smart Lock Pro kann beides; einfache
# Schlösser kennen nur UnlockDoor, und das schliesst dann bloss auf.
#
# Welches Verhalten gilt, sagt das Gerät selbst über sein Unbolt-Merkmal
# in der FeatureMap. Danach richten sich auch die Knöpfe in der App: «Auf
# + öffnen» erscheint nur, wo es etwas anderes tut als «Aufschliessen».

LOCK_STATE_ATTR = 0
LOCK_DOOR_STATE_ATTR = 3
FEATURE_MAP_ATTR = 0xFFFC
BAT_CHARGE_LEVEL_ATTR = 14

# Bit 12 der FeatureMap: Das Schloss kann den Riegel getrennt von der
# Falle bewegen.
UNBOLT_FEATURE = 1 << 12

LOCK_STATES = {
    # Weder ganz zu noch ganz auf. Bewusst als «aufgeschlossen» gelesen
    # und nicht als «unbekannt»: Was nicht sicher verschlossen ist, soll
    # in der App rot dastehen, nicht beruhigend grau.
    0: "unlocked",
    1: "locked",
    2: "unlocked",
    3: "unlatched",
}

# DoorState (nur mit Türsensor im Schloss): steht die Türe selbst offen?
DOOR_STATES = {0: "open", 1: "closed"}


def has_unbolt(attributes: dict[str, Any], endpoint: int) -> bool:
    """Kann das Schloss den Riegel getrennt von der Falle bewegen? (rein)"""
    features = _attr(attributes, endpoint, DOOR_LOCK, FEATURE_MAP_ATTR)
    try:
        return bool(int(features) & UNBOLT_FEATURE)
    except (TypeError, ValueError):
        return False


def lock_commands(attributes: dict[str, Any], endpoint: int) -> list[str]:
    """Welche Knöpfe dieses Schloss verdient (rein, testbar).

    «unlatch» nur, wo es etwas anderes tut als «unlock» – sonst stünden
    zwei Knöpfe da, die dasselbe auslösen.
    """
    if has_unbolt(attributes, endpoint):
        return ["lock", "unlock", "unlatch"]
    return ["lock", "unlock"]


def lock_state(attributes: dict[str, Any], endpoint: int) -> dict[str, Any]:
    """Attribute eines Schloss-Endpunkts → Entitäts-Zustand (rein, testbar).

    Dieselben Namen wie bei der Nuki-Web-API, damit die Kachel in der App
    dieselbe bleibt – wer von dort auf Matter umzieht, soll nicht eine
    andere Anzeige bekommen.
    """
    raw = _attr(attributes, endpoint, DOOR_LOCK, LOCK_STATE_ATTR)
    state: dict[str, Any] = {"state": LOCK_STATES.get(raw, "unknown")}

    door = DOOR_STATES.get(_attr(attributes, endpoint, DOOR_LOCK, LOCK_DOOR_STATE_ATTR))
    if door is not None:
        state["door"] = door

    battery = battery_percent(attributes)
    if battery is not None:
        state["battery"] = battery
    # BatChargeLevel: 0 in Ordnung, 1 Warnung, 2 kritisch. Ein Schloss,
    # dessen Akku leer wird, ist kein Schönheitsfehler - deshalb steht es
    # in der Kachel, auch wenn der Prozentwert fehlt.
    for path, value in attributes.items():
        parts = str(path).split("/")
        if (
            len(parts) == 3
            and parts[1] == str(POWER_SOURCE)
            and parts[2] == str(BAT_CHARGE_LEVEL_ATTR)
        ):
            try:
                if int(value) > 0:
                    state["battery_critical"] = True
            except (TypeError, ValueError):
                pass
            break
    return state


def endpoint_device_types(attributes: dict[str, Any], endpoint: int) -> list[int]:
    """Gerätetypen eines Endpunkts aus dem Descriptor-Cluster (rein, testbar).

    Der Dienst liefert die DeviceTypeList je nach Version als Dicts mit
    Feldnamen ("deviceType") oder TLV-Feldnummern ("0") – beides abdecken.
    """
    raw = _attr(attributes, endpoint, DESCRIPTOR, 0) or []
    types = []
    for item in raw:
        if isinstance(item, dict):
            value = item.get("deviceType", item.get("0", item.get(0)))
        else:
            value = item
        if isinstance(value, int):
            types.append(value)
    return types


def classify(device_types: list[int]) -> str | None:
    """Entitätsart eines Endpunkts – None für Unbekanntes (rein, testbar)."""
    for device_type in device_types:
        if device_type in DEVICE_TYPE_KINDS:
            return DEVICE_TYPE_KINDS[device_type]
    return None


def endpoint_name(attributes: dict[str, Any], node_id: int, endpoint: int) -> str:
    """Bester verfügbarer Name: Endpunkt-Label (Bridge), Knoten-Label,
    Produktname, sonst generisch."""
    for candidate in (
        _attr(attributes, endpoint, BRIDGED_INFO, 5),
        _attr(attributes, 0, BASIC_INFO, 5),
        _attr(attributes, 0, BASIC_INFO, 3),
    ):
        if candidate and str(candidate).strip():
            return str(candidate).strip()
    return f"Matter {node_id}-{endpoint}"


def battery_percent(attributes: dict[str, Any]) -> int | None:
    """Akkustand aus dem Power-Source-Cluster (rein, testbar).

    Matter zählt BatPercentRemaining in halben Prozent (0…200). Auf welchem
    Endpunkt der Cluster sitzt, ist je nach Gerät verschieden – deshalb wird
    nach dem Attributpfad gesucht statt einen Endpunkt zu raten.
    """
    for path, value in attributes.items():
        parts = str(path).split("/")
        if len(parts) == 3 and parts[1] == str(POWER_SOURCE) and parts[2] == "12":
            try:
                return round(float(value) / 2)
            except (TypeError, ValueError):
                return None
    return None


def endpoint_state(attributes: dict[str, Any], endpoint: int, kind: str) -> dict[str, Any]:
    """Attribute eines Endpunkts → Entitäts-Zustand (rein, testbar)."""
    if kind == EntityKind.LOCK:
        return lock_state(attributes, endpoint)

    if kind in (EntityKind.LIGHT, EntityKind.SWITCH):
        on = _attr(attributes, endpoint, ON_OFF, 0)
        state: dict[str, Any] = {"state": "on" if on else "off"}
        level = _attr(attributes, endpoint, LEVEL, 0)
        if level is not None:
            state["brightness"] = round(level / 254 * 100)
        return state

    if kind == EntityKind.BINARY_SENSOR:
        occupancy = _attr(attributes, endpoint, OCCUPANCY, 0)
        if occupancy is not None:
            state = {"state": "on" if occupancy & 1 else "off", "device_class": "motion"}
        else:
            contact = _attr(attributes, endpoint, BOOLEAN_STATE, 0)
            # BooleanState: True = geschlossen/Kontakt – "aktiv" heisst offen.
            # 'contact' unterscheidet Tür-/Fensterkontakte von Bewegungsmeldern;
            # daraus baut die App den Hinweis «Tür offen» auf der Startseite.
            state = {
                "state": "off" if contact else "on",
                "device_class": "contact",
            }
        battery = battery_percent(attributes)
        if battery is not None:
            state["battery"] = battery
        return state

    # Sensoren: erster vorhandener Messwert entscheidet.
    temperature = _attr(attributes, endpoint, TEMPERATURE, 0)
    if temperature is not None:
        return {"state": round(temperature / 100, 1), "unit": "°C"}
    humidity = _attr(attributes, endpoint, HUMIDITY, 0)
    if humidity is not None:
        return {"state": round(humidity / 100), "unit": "%"}
    illuminance = _attr(attributes, endpoint, ILLUMINANCE, 0)
    if illuminance is not None:
        # Matter speichert 10000*log10(Lux)+1.
        return {"state": round(10 ** ((illuminance - 1) / 10000)), "unit": "lx"}
    return {"state": None}


def node_endpoints(node: dict[str, Any]) -> list[tuple[int, str]]:
    """Alle nutzbaren Endpunkte eines Knotens: (Endpunkt, Art) (rein, testbar)."""
    attributes = node.get("attributes") or {}
    endpoints: set[int] = set()
    for path in attributes:
        try:
            endpoints.add(int(str(path).split("/", 1)[0]))
        except ValueError:
            continue
    result = []
    for endpoint in sorted(endpoints):
        kind = classify(endpoint_device_types(attributes, endpoint))
        if kind is not None:
            result.append((endpoint, kind))
    return result


def node_lines(node: dict[str, Any]) -> list[str]:
    """Ein Knoten als Zeilen fürs Terminal (rein, testbar).

    Genannt werden auch Endpunkte, mit denen der Hub nichts anfangen kann.
    Vorher tauchten sie nirgends auf - ein Gerät fehlte dann in der App,
    und die Liste hier schwieg dazu ebenfalls. Wer den Gerätetyp sieht,
    weiss wenigstens, wonach er fragen muss.
    """
    attributes = node.get("attributes") or {}
    node_id = node.get("node_id")
    zeilen: list[str] = []
    endpoints: set[int] = set()
    for path in attributes:
        try:
            endpoints.add(int(str(path).split("/", 1)[0]))
        except ValueError:
            continue
    for endpoint in sorted(endpoints):
        typen = endpoint_device_types(attributes, endpoint)
        if not typen:
            continue
        name = endpoint_name(attributes, node_id, endpoint)
        kind = classify(typen)
        if kind is not None:
            zeilen.append(f"Knoten {node_id} Endpunkt {endpoint}: {name} ({kind})")
        elif endpoint != 0:
            # Endpunkt 0 ist die Verwaltung jedes Knotens und nie ein Gerät.
            liste = ", ".join(str(t) for t in typen)
            zeilen.append(
                f"Knoten {node_id} Endpunkt {endpoint}: {name} "
                f"- Gerätetyp {liste} wird noch nicht unterstützt"
            )
    if not zeilen:
        zeilen.append(f"Knoten {node_id}: kein nutzbarer Endpunkt gefunden")
    return zeilen


class MatterIntegration(Integration):
    name = "matter"

    async def setup(self) -> None:
        self._url = self.config.get("url") or "ws://127.0.0.1:5580/ws"
        if not str(self._url).startswith(("ws://", "wss://")):
            raise ConfigError("matter.url muss mit ws:// oder wss:// beginnen")
        # Manche Schlösser verlangen für Befehle aus der Ferne einen
        # PIN-Code. Ohne ihn weisen sie ab, mit falschem ebenso - deshalb
        # steht er in der Konfiguration und nicht im Code.
        pin = self.config.get("pin")
        self._pin = str(pin) if pin not in (None, "") else None
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=None))
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._message_id = 0
        self._pending: dict[str, asyncio.Future] = {}
        # node_id → Node-Dict des Dienstes; entity_id → (node_id, endpoint, kind)
        self._nodes: dict[int, dict[str, Any]] = {}
        self._entities: dict[str, tuple[int, int, str]] = {}
        self.start_task(self._connect_loop())

    # ── Dienst → Hub ───────────────────────────────────────────────────────

    async def _connect_loop(self) -> None:
        versuche = 0
        while True:
            try:
                async with self._session.ws_connect(self._url, heartbeat=30) as ws:
                    self._ws = ws
                    info = await ws.receive_json()
                    self.log.info(
                        "Mit Matter-Dienst verbunden (Schema %s, mindestens %s, SDK %s)",
                        info.get("schema_version"),
                        info.get("min_supported_schema_version"),
                        info.get("sdk_version"),
                    )
                    schema = info.get("schema_version")
                    if isinstance(schema, int) and schema < MIN_SCHEMA:
                        self.log.warning(
                            "Der Matter-Dienst meldet Schema %s, diese Integration "
                            "erwartet mindestens %s. Geräte könnten fehlen oder "
                            "falsch dastehen - den Dienst aktualisieren "
                            "(ghcr.io/matter-js/matterjs-server:stable).",
                            schema, MIN_SCHEMA,
                        )
                    versuche = 0
                    # Lesen muss parallel laufen, sonst käme die Antwort auf
                    # start_listening nie an (Deadlock).
                    reader = asyncio.create_task(self._read_loop(ws))
                    try:
                        nodes = await self._command("start_listening")
                        for node in nodes or []:
                            await self._sync_node(node)
                        await reader
                    finally:
                        reader.cancel()
                raise ConnectionError("Verbindung beendet")
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self._ws = None
                for future in self._pending.values():
                    if not future.done():
                        future.set_exception(ConnectionError("Matter-Dienst getrennt"))
                self._pending.clear()
                for entity_id in self._entities:
                    await self.hub.registry.update_state(entity_id, {}, available=False)
                # Beim ersten Mal laut, danach leise: Ein Dienst, der nicht
                # läuft, ist eine Meldung wert - aber keine alle 30 Sekunden.
                # Der Hinweis auf IPv6 steht dabei, weil das der Grund ist,
                # aus dem der Dienst am häufigsten gar nicht erst startet:
                # Er bindet mDNS an [::]:5353.
                if versuche == 0:
                    self.log.warning(
                        "Matter-Dienst %s nicht erreichbar (%s). Läuft der "
                        "Container? Er braucht host-Netz und IPv6 auf dem "
                        "Rechner - ohne IPv6 startet er nicht.",
                        self._url, err,
                    )
                else:
                    self.log.debug(
                        "Matter-Dienst %s weiterhin nicht erreichbar (%s), "
                        "Versuch %s",
                        self._url, err, versuche + 1,
                    )
                versuche += 1
                await asyncio.sleep(30)

    async def _read_loop(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        async for message in ws:
            if message.type != aiohttp.WSMsgType.TEXT:
                break
            await self._handle_message(json.loads(message.data))

    async def _handle_message(self, msg: dict[str, Any]) -> None:
        if "message_id" in msg:
            future = self._pending.pop(msg["message_id"], None)
            if future and not future.done():
                if "error_code" in msg:
                    future.set_exception(RuntimeError(str(msg.get("details") or msg["error_code"])))
                else:
                    future.set_result(msg.get("result"))
            return

        event, data = msg.get("event"), msg.get("data")
        if event in ("node_added", "node_updated"):
            await self._sync_node(data)
        elif event == "attribute_updated":
            node_id, path, value = data
            node = self._nodes.get(node_id)
            if node is not None:
                node.setdefault("attributes", {})[path] = value
                endpoint = int(str(path).split("/", 1)[0])
                await self._push_endpoint(node, endpoint)
        elif event == "node_removed":
            for entity_id, (node_id, _, _) in list(self._entities.items()):
                if node_id == data:
                    await self.hub.registry.update_state(entity_id, {}, available=False)
            self._nodes.pop(data, None)

    async def _sync_node(self, node: dict[str, Any]) -> None:
        node_id = node["node_id"]
        self._nodes[node_id] = node
        attributes = node.get("attributes") or {}
        for endpoint, kind in node_endpoints(node):
            entity_id = self.entity_id(f"{node_id}_{endpoint}")
            if entity_id not in self._entities:
                self._entities[entity_id] = (node_id, endpoint, kind)
                if kind == EntityKind.LOCK:
                    commands = lock_commands(attributes, endpoint)
                elif kind in (EntityKind.LIGHT, EntityKind.SWITCH):
                    commands = ["turn_on", "turn_off", "toggle"]
                else:
                    commands = []
                await self.add_entity(
                    f"{node_id}_{endpoint}",
                    kind,
                    endpoint_name(attributes, node_id, endpoint),
                    state=endpoint_state(attributes, endpoint, kind),
                    commands=commands,
                    available=bool(node.get("available", True)),
                )
            else:
                await self._push_endpoint(node, endpoint)

    async def _push_endpoint(self, node: dict[str, Any], endpoint: int) -> None:
        entity_id = self.entity_id(f"{node['node_id']}_{endpoint}")
        entry = self._entities.get(entity_id)
        if entry is None:
            return
        await self.hub.registry.update_state(
            entity_id,
            endpoint_state(node.get("attributes") or {}, endpoint, entry[2]),
            available=bool(node.get("available", True)),
        )

    # ── Hub → Dienst ───────────────────────────────────────────────────────

    async def _command(self, command: str, **args: Any) -> Any:
        if self._ws is None:
            raise ConnectionError("Matter-Dienst ist nicht verbunden")
        self._message_id += 1
        message_id = str(self._message_id)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[message_id] = future
        await self._ws.send_json(
            {"message_id": message_id, "command": command, "args": args}
        )
        try:
            return await asyncio.wait_for(future, timeout=30)
        finally:
            self._pending.pop(message_id, None)

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        node_id, endpoint, kind = self._entities[entity.id]

        if kind == EntityKind.LOCK:
            await self._lock_command(node_id, endpoint, command)
            return

        if command == "toggle":
            command = "turn_off" if entity.state.get("state") == "on" else "turn_on"

        brightness = data.get("brightness")
        if command == "turn_on" and brightness is not None:
            payload = {
                "level": max(1, round(float(brightness) / 100 * 254)),
                "transitionTime": 0,
                "optionsMask": 0,
                "optionsOverride": 0,
            }
            await self._command(
                "device_command",
                node_id=node_id, endpoint_id=endpoint, cluster_id=LEVEL,
                command_name="MoveToLevelWithOnOff", payload=payload,
            )
            return
        await self._command(
            "device_command",
            node_id=node_id, endpoint_id=endpoint, cluster_id=ON_OFF,
            command_name="On" if command == "turn_on" else "Off", payload={},
        )


    # ── Für die App (siehe api/server.py, /api/matter) ─────────────────────

    def uebersicht(self) -> dict[str, Any]:
        """Was die App über den Matter-Teil des Hauses zeigen soll.

        Bewusst aus dem Stand, den diese Integration ohnehin hält, statt
        den Dienst neu zu fragen: Der Bildschirm soll sofort dastehen, und
        was hier steht, ist genau das, woraus auch die Kacheln entstehen.
        """
        knoten = []
        for node_id, node in sorted(self._nodes.items()):
            attributes = node.get("attributes") or {}
            geraete = [
                {
                    "entity_id": self.entity_id(f"{node_id}_{endpoint}"),
                    "name": endpoint_name(attributes, node_id, endpoint),
                    "kind": kind,
                }
                for endpoint, kind in node_endpoints(node)
            ]
            knoten.append(
                {
                    "node_id": node_id,
                    "name": endpoint_name(attributes, node_id, 0),
                    "available": bool(node.get("available", True)),
                    "battery": battery_percent(attributes),
                    "entities": geraete,
                }
            )
        return {
            "available": True,
            "connected": self._ws is not None,
            "url": self._url,
            "nodes": knoten,
        }

    async def pair(self, code: str) -> dict[str, Any]:
        """Ein Gerät in die Fabric aufnehmen.

        Der Code ist ein Geheimnis auf Zeit und taucht deshalb nirgends im
        Protokoll auf - weder hier noch in der Fehlermeldung, die die App
        zu sehen bekommt.
        """
        self.log.info("Matter: koppele ein neues Gerät …")
        node = await self._command("commission_with_code", code=code.strip())
        node_id = (node or {}).get("node_id")
        self.log.info("Matter: Gerät als Knoten %s aufgenommen", node_id)
        if node:
            await self._sync_node(node)
        return {"node_id": node_id}

    async def unpair(self, node_id: int) -> None:
        """Ein Gerät aus der Fabric entfernen.

        Die Entitäten verschwinden über das node_removed-Ereignis des
        Dienstes - nicht hier von Hand, damit es nur einen Weg gibt, auf
        dem Geräte gehen.
        """
        self.log.info("Matter: entferne Knoten %s", node_id)
        await self._command("remove_node", node_id=node_id)

    async def _lock_command(self, node_id: int, endpoint: int, command: str) -> None:
        """Abschliessen, aufschliessen, aufziehen.

        «unlock» ist die Stelle, an der Matter zwei Wege kennt: Wo das
        Schloss den Riegel getrennt bewegen kann, fährt UnboltDoor nur ihn
        zurück - die Türe bleibt zu und muss aufgedrückt werden. UnlockDoor
        zieht zusätzlich die Falle. Wo es das Merkmal nicht gibt, ist
        UnlockDoor schlicht «aufschliessen».

        Ein Schloss, das für Fernbedienung einen PIN verlangt, weist die
        Befehle sonst zurück; dafür gibt es `pin` in der Konfiguration.
        """
        attributes = (self._nodes.get(node_id) or {}).get("attributes") or {}
        unbolt = has_unbolt(attributes, endpoint)
        if command == "lock":
            name = "LockDoor"
        elif command == "unlatch":
            name = "UnlockDoor"
        elif command == "unlock":
            name = "UnboltDoor" if unbolt else "UnlockDoor"
        else:
            raise ValueError(f"Unbekannter Schloss-Befehl: {command}")

        payload: dict[str, Any] = {}
        if self._pin:
            payload["pinCode"] = self._pin
        await self._command(
            "device_command",
            node_id=node_id, endpoint_id=endpoint, cluster_id=DOOR_LOCK,
            command_name=name, payload=payload,
        )


INTEGRATION = MatterIntegration


# ── Kopplungs-Helfer ───────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.matter -c config.yaml [--pair CODE]
# Ohne --pair: verbundene Knoten auflisten. Mit --pair: Gerät in die Fabric
# aufnehmen (QR-Code-Inhalt "MT:..." oder der 11-stellige Zahlencode).


async def _cli_main(config_path: str, pair_code: str | None) -> int:
    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "matter"]
    url = (blocks[0].get("url") if blocks else None) or "ws://127.0.0.1:5580/ws"

    # Dieses Werkzeug spricht den Matter-Dienst direkt an - der Hub daneben
    # tut das nur, wenn die Integration in der config.yaml steht. Ohne
    # diesen Hinweis sieht man hier ein sauber gekoppeltes Gerät und in der
    # App nichts, und nichts erklärt den Unterschied.
    if not blocks:
        print(f"⚠ In {config_path} steht kein matter-Block.")
        print("  Dieser Aufruf funktioniert trotzdem - der Hub bindet die")
        print("  Geräte aber erst ein, wenn dort steht:")
        print("    - integration: matter")
        print("      url: ws://127.0.0.1:5580/ws")
        print("  Danach den Hub neu starten.")
        print()

    async with aiohttp.ClientSession() as session:
        try:
            ws = await session.ws_connect(url)
        except Exception as err:
            print(f"✗ Matter-Dienst unter {url} nicht erreichbar: {err}")
            print("  Läuft der python-matter-server? (siehe Kopf von matter.py)")
            return 1
        async with ws:
            info = await ws.receive_json()
            print(f"✓ Matter-Dienst verbunden (Schema {info.get('schema_version')})")

            async def command(cmd: str, **args: Any) -> Any:
                await ws.send_json({"message_id": "cli", "command": cmd, "args": args})
                while True:
                    msg = await ws.receive_json()
                    if msg.get("message_id") == "cli":
                        if "error_code" in msg:
                            raise RuntimeError(str(msg.get("details") or msg["error_code"]))
                        return msg.get("result")

            if pair_code:
                print("→ Kopple Gerät – das kann eine Minute dauern …")
                try:
                    node = await command("commission_with_code", code=pair_code)
                except Exception as err:
                    print(f"✗ Kopplung fehlgeschlagen: {err}")
                    return 1
                print(f"✓ Gerät aufgenommen als Knoten {node.get('node_id')}.")
                return 0

            nodes = await command("get_nodes")
            if not nodes:
                # Ohne spitze Klammern: Die Zeile wird kopiert und
                # eingefügt, und eine Shell liest «<» als Umleitung.
                print(
                    "Noch keine Geräte gekoppelt. Koppeln mit: "
                    "--pair 34970112332 (der Code aus der App des Geräts)"
                )
                return 0
            for node in nodes:
                for zeile in node_lines(node):
                    print(f"  {zeile}")
            return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Matter-Kopplung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    parser.add_argument("--pair", help="Kopplungscode (QR-Inhalt MT:… oder Zahlencode)")
    args = parser.parse_args()
    sys.exit(asyncio.run(_cli_main(args.config, args.pair)))
