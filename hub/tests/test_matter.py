"""Matter: reine Übersetzungslogik plus End-to-End gegen einen
nachgebauten Matter-Dienst (dasselbe WebSocket-Protokoll wie
matterjs-server, nur mit festen Antworten)."""

import asyncio
import json

import pytest
from aiohttp import WSMsgType, web

from homepilot.core.config import load_config
from homepilot.core.hub import Hub
from homepilot.integrations.matter import (
    battery_percent,
    node_lines,
    classify,
    endpoint_device_types,
    endpoint_name,
    endpoint_state,
    has_unbolt,
    lock_commands,
    lock_state,
    node_endpoints,
)

# ── Reine Funktionen ─────────────────────────────────────────────────────


def test_classify_maps_device_types():
    assert classify([257]) == "light"
    assert classify([266]) == "switch"
    assert classify([770]) == "sensor"
    assert classify([263]) == "binary_sensor"
    assert classify([22, 999]) is None  # Root-Node/Unbekanntes: keine Entität


def test_endpoint_device_types_accepts_both_serialisations():
    by_name = {"1/29/0": [{"deviceType": 257, "revision": 2}]}
    by_index = {"1/29/0": [{"0": 257, "1": 2}]}
    assert endpoint_device_types(by_name, 1) == [257]
    assert endpoint_device_types(by_index, 1) == [257]
    assert endpoint_device_types({}, 1) == []


def test_endpoint_state_light_with_brightness():
    attributes = {"1/6/0": True, "1/8/0": 127}
    state = endpoint_state(attributes, 1, "light")
    assert state["state"] == "on"
    assert state["brightness"] == 50


def test_endpoint_state_sensors():
    assert endpoint_state({"2/1026/0": 2154}, 2, "sensor") == {"state": 21.5, "unit": "°C"}
    assert endpoint_state({"2/1029/0": 4562}, 2, "sensor") == {"state": 46, "unit": "%"}
    # 10000*log10(300 lx)+1 = 24772
    assert endpoint_state({"2/1024/0": 24772}, 2, "sensor")["state"] == 300


def test_endpoint_state_binary_sensors():
    assert endpoint_state({"1/1030/0": 1}, 1, "binary_sensor")["state"] == "on"
    assert endpoint_state({"1/1030/0": 0}, 1, "binary_sensor")["state"] == "off"
    # BooleanState: True = geschlossen → ruhig
    assert endpoint_state({"1/69/0": True}, 1, "binary_sensor")["state"] == "off"
    assert endpoint_state({"1/69/0": False}, 1, "binary_sensor")["state"] == "on"


def test_binary_sensors_carry_their_kind():
    """Tür-/Fensterkontakt und Bewegungsmelder sind auseinanderzuhalten."""
    assert endpoint_state({"1/1030/0": 1}, 1, "binary_sensor")["device_class"] == "motion"
    assert endpoint_state({"1/69/0": False}, 1, "binary_sensor")["device_class"] == "contact"


def test_battery_percent_from_power_source_cluster():
    # BatPercentRemaining zählt in halben Prozent.
    assert battery_percent({"0/47/12": 170}) == 85
    assert battery_percent({"1/47/12": 200}) == 100
    assert battery_percent({"1/69/0": False}) is None
    assert battery_percent({"0/47/12": None}) is None

    state = endpoint_state({"1/69/0": False, "0/47/12": 170}, 1, "binary_sensor")
    assert state == {"state": "on", "device_class": "contact", "battery": 85}


def test_node_endpoints_and_name():
    node = {
        "node_id": 5,
        "attributes": {
            "0/29/0": [{"deviceType": 22, "revision": 1}],   # Root – ignorieren
            "0/40/3": "Hue Bridge",
            "1/29/0": [{"deviceType": 257, "revision": 2}],
            "1/57/5": "Stehlampe",
            "1/6/0": True,
        },
    }
    assert node_endpoints(node) == [(1, "light")]
    assert endpoint_name(node["attributes"], 5, 1) == "Stehlampe"
    # Ohne Endpunkt-Label fällt der Name auf den Knoten zurück.
    assert endpoint_name({"0/40/3": "Sensor XY"}, 5, 2) == "Sensor XY"
    assert endpoint_name({}, 5, 2) == "Matter 5-2"


def test_the_listing_names_what_it_cannot_use():
    """Ein Gerät, das der Hub nicht versteht, darf nicht unsichtbar sein.

    Vorher fehlte es in der App - und die Liste im Terminal schwieg
    ebenfalls, weil sie nur zeigte, was sie erkannte. Damit sieht die Suche
    aus wie «gar nicht gekoppelt», obwohl das Gerät längst da ist.
    """
    node = {
        "node_id": 1,
        "attributes": {
            # Endpunkt 0 ist die Verwaltung jedes Knotens, kein Gerät.
            "0/29/0": [{"0": 22}],
            "0/40/5": "Smart Lock Pro",
            "1/29/0": [{"0": 10}],
            "2/29/0": [{"0": 999}],
        },
    }
    zeilen = node_lines(node)
    assert zeilen[0] == "Knoten 1 Endpunkt 1: Smart Lock Pro (lock)"
    assert "Gerätetyp 999 wird noch nicht unterstützt" in zeilen[1]
    assert not any("Endpunkt 0" in zeile for zeile in zeilen)


def test_a_node_without_usable_endpoints_says_so():
    """Schweigen wäre hier dasselbe wie «nichts gefunden»."""
    zeilen = node_lines({"node_id": 9, "attributes": {"0/29/0": [{"0": 22}]}})
    assert zeilen == ["Knoten 9: kein nutzbarer Endpunkt gefunden"]


# ── Türschloss ───────────────────────────────────────────────────────────


def _schloss(lock_state_value, *, unbolt=True, door=None, battery=None, level=None):
    attributes = {
        "1/29/0": [{"0": 10, "1": 1}],
        "1/257/0": lock_state_value,
        "1/257/65532": (1 << 12) if unbolt else 0,
    }
    if door is not None:
        attributes["1/257/3"] = door
    if battery is not None:
        attributes["1/47/12"] = battery
    if level is not None:
        attributes["1/47/14"] = level
    return attributes


def test_a_door_lock_is_recognised_as_such():
    """Ohne diesen Eintrag taucht ein Matter-Schloss nirgends auf - es
    fehlt einfach, ohne Fehlermeldung."""
    assert classify([10]) == "lock"
    assert node_endpoints({"attributes": _schloss(1)}) == [(1, "lock")]


def test_lock_states_read_the_safe_way():
    """«Nicht ganz verschlossen» ist nicht verschlossen.

    Matter kennt für den Zwischenzustand einen eigenen Wert. Ihn als
    «unbekannt» zu lesen hiesse, die Kachel grau zu lassen, wo sie rot
    gehört - die Türe steht dann eben nicht sicher zu.
    """
    assert lock_state(_schloss(1), 1)["state"] == "locked"
    assert lock_state(_schloss(2), 1)["state"] == "unlocked"
    assert lock_state(_schloss(0), 1)["state"] == "unlocked"
    assert lock_state(_schloss(3), 1)["state"] == "unlatched"
    assert lock_state(_schloss(None), 1)["state"] == "unknown"


def test_lock_reports_door_and_battery():
    """Türsensor und Akku stehen in derselben Kachel wie beim Nuki über
    dessen eigene Schnittstelle - der Umzug soll nichts wegnehmen."""
    state = lock_state(_schloss(1, door=0, battery=150, level=0), 1)
    assert state["door"] == "open"
    assert state["battery"] == 75
    assert "battery_critical" not in state

    state = lock_state(_schloss(1, door=1, battery=20, level=2), 1)
    assert state["door"] == "closed"
    assert state["battery"] == 10
    assert state["battery_critical"] is True


def test_unlatch_only_where_it_differs_from_unlock():
    """Zwei Knöpfe, die dasselbe tun, sind ein Knopf zu viel."""
    assert lock_commands(_schloss(1, unbolt=True), 1) == ["lock", "unlock", "unlatch"]
    assert lock_commands(_schloss(1, unbolt=False), 1) == ["lock", "unlock"]
    assert has_unbolt(_schloss(1, unbolt=True), 1) is True
    assert has_unbolt({"1/257/0": 1}, 1) is False


# ── End-to-End gegen den nachgebauten Dienst ─────────────────────────────

NODE = {
    "node_id": 12,
    "available": True,
    "attributes": {
        "0/40/5": "Wohnzimmer Lampe",
        "1/29/0": [{"deviceType": 257, "revision": 2}],
        "1/6/0": False,
        "1/8/0": 254,
    },
}


class FakeMatterServer:
    """Spricht das Protokoll des Controller-Dienstes nach.

    Der Begrüssungsrahmen ist der von matterjs-server: Schema 13, dazu die
    kleinste Fassung, die er noch bedient. Der frühere python-matter-server
    meldete dasselbe Feld mit kleinerer Zahl - beide werden gelesen.
    """

    def __init__(self, nodes=None, schema: int = 13):
        self.commands: list[dict] = []
        self.ws: web.WebSocketResponse | None = None
        self.nodes = nodes if nodes is not None else [NODE]
        self.schema = schema

    async def handler(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.ws = ws
        await ws.send_json(
            {
                "fabric_id": 1,
                "schema_version": self.schema,
                "min_supported_schema_version": 11,
                "sdk_version": "matter-server/1.4.0 (matter.js/1.6.0)",
            }
        )
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                break
            data = json.loads(msg.data)
            self.commands.append(data)
            if data["command"] == "start_listening":
                await ws.send_json(
                    {"message_id": data["message_id"], "result": self.nodes}
                )
            else:
                await ws.send_json({"message_id": data["message_id"], "result": None})
        return ws

    async def send_event(self, event, data):
        await self.ws.send_json({"event": event, "data": data})


# Ein Tür-/Fensterkontakt, wie matterjs-server ihn liefert: Die
# DeviceTypeList kommt tag-basiert, also mit den TLV-Feldnummern als
# Schlüssel statt mit Namen ("0" = deviceType, "1" = revision). Genau
# daran scheitert ein Parser, der nur "deviceType" kennt - und dann steht
# der Sensor nirgends, ohne dass irgendwo ein Fehler auftaucht.
KONTAKT = {
    "node_id": 7,
    "available": True,
    "attributes": {
        "0/40/5": "Balkontüre",
        "1/29/0": [{"0": 21, "1": 1}],
        # BooleanState: True heisst Kontakt geschlossen.
        "1/69/0": True,
        "1/47/12": 176,
    },
}


async def _serve(server):
    app = web.Application()
    app.router.add_get("/ws", server.handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    server.port = runner.addresses[0][1]
    return runner


@pytest.fixture
async def fake_server():
    server = FakeMatterServer()
    app = web.Application()
    app.router.add_get("/ws", server.handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    server.port = runner.addresses[0][1]
    yield server
    await runner.cleanup()


async def _wait_for(condition, timeout=5.0):
    async with asyncio.timeout(timeout):
        while not condition():
            await asyncio.sleep(0.02)


async def test_matter_end_to_end(fake_server, tmp_path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "api: { host: 127.0.0.1, port: 18131, token: t }\n"
        "integrations:\n"
        "  - integration: matter\n"
        f"    url: ws://127.0.0.1:{fake_server.port}/ws\n"
    )
    hub = Hub(load_config(str(config_file)))
    await hub.start()
    try:
        await _wait_for(lambda: hub.registry.get("matter.12_1") is not None)
        entity = hub.registry.get("matter.12_1")
        assert entity.kind == "light"
        assert entity.name == "Wohnzimmer Lampe"
        assert entity.state == {"state": "off", "brightness": 100}
        assert entity.available is True

        # Dienst meldet eine Attributänderung → Entität folgt.
        await fake_server.send_event("attribute_updated", [12, "1/6/0", True])
        await _wait_for(lambda: hub.registry.get("matter.12_1").state["state"] == "on")

        # Kommando aus dem Hub landet als device_command beim Dienst.
        await hub.integrations.dispatch_command("matter.12_1", "turn_off")
        commands = [c for c in fake_server.commands if c["command"] == "device_command"]
        assert commands and commands[-1]["args"]["command_name"] == "Off"
        assert commands[-1]["args"]["node_id"] == 12
        assert commands[-1]["args"]["cluster_id"] == 6

        # Helligkeit → MoveToLevelWithOnOff mit Level 0..254.
        await hub.integrations.dispatch_command(
            "matter.12_1", "turn_on", {"brightness": 50}
        )
        commands = [c for c in fake_server.commands if c["command"] == "device_command"]
        assert commands[-1]["args"]["command_name"] == "MoveToLevelWithOnOff"
        assert commands[-1]["args"]["payload"]["level"] == 127
    finally:
        await hub.stop()


async def test_contact_sensor_from_a_tag_based_service(tmp_path):
    """Stefans Aqara-Kontakt, so wie matterjs-server ihn meldet.

    Der Weg von der Wohnungstüre bis in die App führt über drei Stellen,
    die alle stimmen müssen: die tag-basierte Gerätetypliste, der
    BooleanState (True = zu) und der Batteriestand in halben Prozent. Geht
    eine davon schief, fehlt entweder der Sensor ganz oder er meldet das
    Gegenteil - und «Tür offen» auf der Startseite wäre eine Falschaussage.
    """
    server = FakeMatterServer(nodes=[KONTAKT])
    runner = await _serve(server)
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "api: { host: 127.0.0.1, port: 18132, token: t }\n"
        "integrations:\n"
        "  - integration: matter\n"
        f"    url: ws://127.0.0.1:{server.port}/ws\n"
    )
    hub = Hub(load_config(str(config_file)))
    await hub.start()
    try:
        await _wait_for(lambda: hub.registry.get("matter.7_1") is not None)
        entity = hub.registry.get("matter.7_1")
        assert entity.kind == "binary_sensor"
        assert entity.name == "Balkontüre"
        # Zu, also nicht «aktiv» - und als Kontakt erkannt, sonst hielte
        # die Startseite ihn für einen Bewegungsmelder.
        assert entity.state["state"] == "off"
        assert entity.state["device_class"] == "contact"
        assert entity.state["battery"] == 88

        # Türe geht auf.
        await server.send_event("attribute_updated", [7, "1/69/0", False])
        await _wait_for(lambda: hub.registry.get("matter.7_1").state["state"] == "on")
    finally:
        await hub.stop()
        await runner.cleanup()


async def test_an_old_service_is_named_in_the_log(tmp_path, caplog):
    """Ein zu alter Dienst soll als Satz im Protokoll stehen.

    Sonst zeigt sich der Bruch als leere Geräteliste, und die Suche
    beginnt beim Falschen.
    """
    server = FakeMatterServer(schema=4)
    runner = await _serve(server)
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "api: { host: 127.0.0.1, port: 18133, token: t }\n"
        "integrations:\n"
        "  - integration: matter\n"
        f"    url: ws://127.0.0.1:{server.port}/ws\n"
    )
    hub = Hub(load_config(str(config_file)))
    with caplog.at_level("WARNING"):
        await hub.start()
        try:
            await _wait_for(lambda: hub.registry.get("matter.12_1") is not None)
        finally:
            await hub.stop()
            await runner.cleanup()
    assert any("Schema 4" in record.getMessage() for record in caplog.records)


SCHLOSS_NODE = {
    "node_id": 3,
    "available": True,
    "attributes": {
        "0/40/5": "Wohnungstüre",
        "1/29/0": [{"0": 10, "1": 1}],
        "1/257/0": 1,
        "1/257/3": 1,
        "1/257/65532": 1 << 12,
        "1/47/12": 180,
    },
}


async def test_door_lock_end_to_end(tmp_path):
    """Der Weg von der Kachel bis zum Schloss.

    Drei Befehle, drei verschiedene Matter-Kommandos - und «Aufschliessen»
    darf die Türe gerade nicht aufziehen. Wer das vertauscht, öffnet die
    Wohnungstüre, wo jemand nur den Riegel lösen wollte.
    """
    server = FakeMatterServer(nodes=[SCHLOSS_NODE])
    runner = await _serve(server)
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "api: { host: 127.0.0.1, port: 18134, token: t }\n"
        "integrations:\n"
        "  - integration: matter\n"
        f"    url: ws://127.0.0.1:{server.port}/ws\n"
    )
    hub = Hub(load_config(str(config_file)))
    await hub.start()
    try:
        await _wait_for(lambda: hub.registry.get("matter.3_1") is not None)
        entity = hub.registry.get("matter.3_1")
        assert entity.kind == "lock"
        assert entity.name == "Wohnungstüre"
        assert entity.state["state"] == "locked"
        assert entity.state["door"] == "closed"
        assert entity.state["battery"] == 90
        assert entity.commands == ["lock", "unlock", "unlatch"]

        async def letztes(command):
            await hub.integrations.dispatch_command("matter.3_1", command)
            befehle = [c for c in server.commands if c["command"] == "device_command"]
            return befehle[-1]["args"]

        args = await letztes("unlock")
        assert args["command_name"] == "UnboltDoor", "nur der Riegel, nicht die Falle"
        assert args["cluster_id"] == 257

        args = await letztes("unlatch")
        assert args["command_name"] == "UnlockDoor"

        args = await letztes("lock")
        assert args["command_name"] == "LockDoor"

        # Das Schloss meldet «aufgeschlossen» - die Kachel folgt.
        await server.send_event("attribute_updated", [3, "1/257/0", 2])
        await _wait_for(lambda: hub.registry.get("matter.3_1").state["state"] == "unlocked")
    finally:
        await hub.stop()
        await runner.cleanup()


async def test_a_simple_lock_gets_no_unlatch_button(tmp_path):
    """Ein Schloss ohne getrennten Riegel bekommt zwei Knöpfe, nicht drei -
    und «unlock» geht dort an UnlockDoor, weil es nichts anderes gibt."""
    node = {
        "node_id": 4,
        "available": True,
        "attributes": {
            "0/40/5": "Kellertüre",
            "1/29/0": [{"0": 10, "1": 1}],
            "1/257/0": 1,
            "1/257/65532": 0,
        },
    }
    server = FakeMatterServer(nodes=[node])
    runner = await _serve(server)
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "api: { host: 127.0.0.1, port: 18135, token: t }\n"
        "integrations:\n"
        "  - integration: matter\n"
        f"    url: ws://127.0.0.1:{server.port}/ws\n"
    )
    hub = Hub(load_config(str(config_file)))
    await hub.start()
    try:
        await _wait_for(lambda: hub.registry.get("matter.4_1") is not None)
        assert hub.registry.get("matter.4_1").commands == ["lock", "unlock"]
        await hub.integrations.dispatch_command("matter.4_1", "unlock")
        befehle = [c for c in server.commands if c["command"] == "device_command"]
        assert befehle[-1]["args"]["command_name"] == "UnlockDoor"
    finally:
        await hub.stop()
        await runner.cleanup()


async def test_a_pin_is_sent_when_configured(tmp_path):
    """Manche Schlösser weisen Befehle aus der Ferne ohne PIN ab."""
    server = FakeMatterServer(nodes=[SCHLOSS_NODE])
    runner = await _serve(server)
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "api: { host: 127.0.0.1, port: 18136, token: t }\n"
        "integrations:\n"
        "  - integration: matter\n"
        f"    url: ws://127.0.0.1:{server.port}/ws\n"
        "    pin: '123456'\n"
    )
    hub = Hub(load_config(str(config_file)))
    await hub.start()
    try:
        await _wait_for(lambda: hub.registry.get("matter.3_1") is not None)
        await hub.integrations.dispatch_command("matter.3_1", "lock")
        befehle = [c for c in server.commands if c["command"] == "device_command"]
        assert befehle[-1]["args"]["payload"]["pinCode"] == "123456"
    finally:
        await hub.stop()
        await runner.cleanup()

