import asyncio
import xmlrpc.client

import pytest

from homepilot.integrations import homematic
from homepilot.integrations.homematic import (
    HomematicIntegration,
    command_error,
    command_to_value,
    describe_channels,
    group_by_device,
    is_timeout,
    power_to_state,
    press_to_state,
    switch_channel,
    value_to_state,
)


def test_value_to_state_switch():
    assert value_to_state(True, "STATE", False) == {"state": "on"}
    assert value_to_state(False, "STATE", False) == {"state": "off"}


def test_value_to_state_dimmer():
    # Homematic liefert 0…1, die App erwartet Prozent.
    assert value_to_state(0.5, "LEVEL", True) == {"state": "on", "brightness": 50}
    assert value_to_state(0.0, "LEVEL", True) == {"state": "off", "brightness": 0}
    assert value_to_state(1.0, "LEVEL", True) == {"state": "on", "brightness": 100}


def test_value_to_state_sensor():
    assert value_to_state(21.5, "ACTUAL_TEMPERATURE", False) == {"state": 21.5}


def test_command_to_value_switch():
    assert command_to_value("turn_on", {}, False, {}) == ("STATE", True)
    assert command_to_value("turn_off", {}, False, {}) == ("STATE", False)


def test_toggle_uses_current_state():
    assert command_to_value("toggle", {}, False, {"state": "on"}) == ("STATE", False)
    assert command_to_value("toggle", {}, False, {"state": "off"}) == ("STATE", True)


def test_command_to_value_dimmer():
    assert command_to_value("set_brightness", {"brightness": 80}, True, {}) == (
        "LEVEL",
        0.8,
    )
    assert command_to_value("turn_off", {}, True, {}) == ("LEVEL", 0.0)
    # Ohne Angabe die zuletzt bekannte Helligkeit wiederherstellen.
    assert command_to_value("turn_on", {}, True, {"brightness": 40}) == ("LEVEL", 0.4)


def test_brightness_is_clamped():
    assert command_to_value("set_brightness", {"brightness": 500}, True, {}) == (
        "LEVEL",
        1.0,
    )
    assert command_to_value("set_brightness", {"brightness": -20}, True, {}) == (
        "LEVEL",
        0.0,
    )


def test_unsupported_command_raises():
    with pytest.raises(ValueError):
        command_to_value("set_brightness", {}, False, {})


def test_power_to_state():
    assert power_to_state(1451.25) == {"power": 1451.2}
    assert power_to_state("0.4") == {"power": 0.4}
    # Unlesbare Werte dürfen das bisherige Attribut nicht überschreiben.
    assert power_to_state(None) == {}
    assert power_to_state("") == {}


class _FakeCCU:
    """Ersetzt die XML-RPC-Aufrufe, merkt sich aber, was gefragt wurde."""

    def __init__(self, values: dict[tuple[str, str], object]) -> None:
        self.values = values
        self.calls: list[tuple[str, tuple, int]] = []

    async def call(self, method: str, *args, port: int = 0):
        self.calls.append((method, args, port))
        if method == "listDevices":
            return [
                {"ADDRESS": address, "TYPE": "HmIP-PSM", "PARENT": address.split(":")[0]}
                for address, _ in self.values
            ]
        if method == "getValue":
            return self.values[(args[0], args[1])]
        return ""


async def _setup(hub, ccu: _FakeCCU, devices: list[dict]) -> HomematicIntegration:
    integration = HomematicIntegration(
        hub,
        {
            "integration": "homematic",
            "host": "127.0.0.1",
            "port": 2001,
            "callback_port": 0,  # ohne Callback-Server, rein lesend
            "devices": devices,
        },
    )
    integration._call = ccu.call  # type: ignore[method-assign]
    await integration.setup()
    return integration


async def test_measuring_socket_reports_watts(hub):
    """Schalt-Messsteckdose: Schaltkanal und Messkanal ergeben eine Kachel."""
    ccu = _FakeCCU(
        {
            ("0001D3C99C6A2B:3", "STATE"): True,
            ("0001D3C99C6A2B:6", "POWER"): 1450.0,
        }
    )
    integration = await _setup(
        hub,
        ccu,
        [
            {
                "address": "0001D3C99C6A2B:3",
                "port": 2010,
                "name": "Tumbler",
                "kind": "switch",
                "power_address": "0001D3C99C6A2B:6",
            }
        ],
    )
    try:
        entity = hub.registry.get("homematic.0001D3C99C6A2B_3")
        assert entity is not None
        assert entity.state["state"] == "on"
        assert entity.state["power"] == 1450.0
        # Homematic-IP-Geräte müssen über ihren eigenen Port abgefragt werden.
        assert {port for method, _, port in ccu.calls if method == "getValue"} == {2010}
    finally:
        await integration.teardown()


async def test_power_events_update_the_same_entity(hub):
    ccu = _FakeCCU(
        {
            ("0001D3C99C6A2B:3", "STATE"): True,
            ("0001D3C99C6A2B:6", "POWER"): 1450.0,
        }
    )
    integration = await _setup(
        hub,
        ccu,
        [
            {
                "address": "0001D3C99C6A2B:3",
                "port": 2010,
                "name": "Tumbler",
                "kind": "switch",
                "power_address": "0001D3C99C6A2B:6",
            }
        ],
    )
    try:
        entity_id = "homematic.0001D3C99C6A2B_3"
        assert integration._by_power[("0001D3C99C6A2B:6", "POWER")] == entity_id
        await hub.registry.update_state(entity_id, power_to_state(3.2))
        entity = hub.registry.get(entity_id)
        # Der Schaltzustand bleibt erhalten, nur die Leistung fällt.
        assert entity is not None
        assert entity.state["state"] == "on"
        assert entity.state["power"] == 3.2
    finally:
        await integration.teardown()


async def test_devices_without_port_use_the_default(hub):
    ccu = _FakeCCU({("ABC1234567:1", "STATE"): False})
    integration = await _setup(
        hub, ccu, [{"address": "ABC1234567:1", "name": "Licht Küche", "kind": "switch"}]
    )
    try:
        assert {port for method, _, port in ccu.calls if method == "getValue"} == {2001}
    finally:
        await integration.teardown()


# Kanalliste einer HmIP-Schalt-Messsteckdose, wie die CCU sie meldet.
PSM_CHANNELS = {
    "001015699EA263:0": "MAINTENANCE",
    "001015699EA263:2": "SWITCH_TRANSMITTER",
    "001015699EA263:3": "SWITCH_VIRTUAL_RECEIVER",
    "001015699EA263:4": "SWITCH_VIRTUAL_RECEIVER",
    "001015699EA263:5": "SWITCH_VIRTUAL_RECEIVER",
    "001015699EA263:6": "ENERGIE_METER_TRANSMITTER",
}


def test_switch_channel_redirects_measuring_channel():
    # Der Messkanal kann nicht schalten – der kleinste Schaltkanal gewinnt.
    assert switch_channel("001015699EA263:6", PSM_CHANNELS) == "001015699EA263:3"
    # Auch der Sendekanal ist keiner zum Schalten.
    assert switch_channel("001015699EA263:2", PSM_CHANNELS) == "001015699EA263:3"


def test_switch_channel_leaves_working_channels_alone():
    assert switch_channel("001015699EA263:3", PSM_CHANNELS) is None
    # Unbekannte Adressen fasst der Hub nicht an.
    assert switch_channel("ABC:1", PSM_CHANNELS) is None


def test_switch_channel_without_any_switch_channel():
    only_sensor = {"XYZ:1": "ENERGIE_METER_TRANSMITTER"}
    assert switch_channel("XYZ:1", only_sensor) is None


def test_command_error_explains_fault_minus_five():
    fault = xmlrpc.client.Fault(-5, "Invalid parameter or value")
    message = command_error("001015699EA263:6", "STATE", fault)
    assert "001015699EA263:6" in message
    assert "STATE" in message
    # Der Hinweis auf den Schaltkanal ist der eigentliche Nutzen.
    assert ":3" in message


def test_command_error_passes_other_faults_through():
    fault = xmlrpc.client.Fault(-1, "Zugriff verweigert")
    assert "Zugriff verweigert" in command_error("A:1", "STATE", fault)


def test_is_timeout_recognises_the_ccu_wording():
    assert is_timeout(xmlrpc.client.Fault(-1, "Generic error (TIMEOUT)"))
    assert is_timeout(xmlrpc.client.Fault(-1, "timeout"))
    assert not is_timeout(xmlrpc.client.Fault(-5, "Invalid parameter or value"))


def test_command_error_explains_a_radio_timeout():
    fault = xmlrpc.client.Fault(-1, "Generic error (TIMEOUT)")
    message = command_error("001015699EA263:3", "STATE", fault)
    assert "001015699EA263:3" in message
    assert "Funk-Timeout" in message
    # Der Kanal ist hier gerade nicht das Problem – das darf nicht behauptet
    # werden, sonst sucht man an der falschen Stelle.
    assert "Datenpunkt" not in message


# ── Melder und Taster ──────────────────────────────────────────────────────


def test_motion_and_presence_report_on_and_off():
    """Der Punkt, an dem es sonst stillschweigend scheitert: Ein
    Bewegungsmelder meldet auf MOTION, ein Präsenzmelder auf
    PRESENCE_DETECTION_STATE. Die Alarmanlage sucht nach «on» – ein rohes
    True würde sie nie sehen."""
    assert value_to_state(True, "MOTION", False) == {"state": "on"}
    assert value_to_state(False, "MOTION", False) == {"state": "off"}
    assert value_to_state(True, "PRESENCE_DETECTION_STATE", False) == {"state": "on"}


def test_smoke_detector_alarm_status():
    # 0 = Ruhe, alles andere ist ein Alarm – welcher, steht daneben.
    assert value_to_state(0, "SMOKE_DETECTOR_ALARM_STATUS", False) == {
        "state": "off",
        "alarm_status": 0,
    }
    assert value_to_state(1, "SMOKE_DETECTOR_ALARM_STATUS", False)["state"] == "on"
    # Manche CCU-Firmware antwortet mit dem Namen statt der Zahl.
    assert value_to_state("IDLE_OFF", "SMOKE_DETECTOR_ALARM_STATUS", False)["state"] == "off"
    assert value_to_state("PRIMARY_ALARM", "SMOKE_DETECTOR_ALARM_STATUS", False)["state"] == "on"


def test_press_to_state_distinguishes_short_and_long():
    assert press_to_state("PRESS_SHORT", 100.0) == {"state": "short", "last_press": 100.0}
    assert press_to_state("PRESS_LONG", 100.0)["state"] == "long"


def test_press_to_state_carries_a_timestamp():
    """Zweimal dieselbe Taste hiesse sonst «Zustand unverändert» – der
    zweite Druck käme in keinem Ablauf an."""
    first = press_to_state("PRESS_SHORT", 100.0)
    second = press_to_state("PRESS_SHORT", 101.5)
    assert first != second


async def test_a_wall_button_is_never_polled(hub):
    """PRESS_SHORT ist ein Ereignis, kein Wert – ein getValue darauf endet
    in «Fault -5». Der Taster darf also gar nicht erst gefragt werden."""
    ccu = _FakeCCU({})
    integration = await _setup(
        hub,
        ccu,
        [
            {
                "address": "0001D8A9B12348:1",
                "port": 2010,
                "name": "Wandtaster Küche oben",
                "kind": "button",
            }
        ],
    )
    try:
        entity = hub.registry.get("homematic.0001D8A9B12348_1")
        assert entity is not None
        # Da, aber noch ohne Druck – nicht «nicht erreichbar».
        assert entity.available is True
        # Auf dem Tastenkanal wird nichts gelesen. Der Wartungskanal schon:
        # Ein Taster läuft auf Batterie, und die will man kennen.
        read = [args[0] for method, args, _ in ccu.calls if method == "getValue"]
        assert "0001D8A9B12348:1" not in read
    finally:
        await integration.teardown()


async def test_a_button_press_arrives_as_state(hub):
    ccu = _FakeCCU({})
    integration = await _setup(
        hub,
        ccu,
        [
            {
                "address": "0001D8A9B12348:1",
                "port": 2010,
                "name": "Wandtaster Küche oben",
                "kind": "button",
            }
        ],
    )
    try:
        entity_id = "homematic.0001D8A9B12348_1"
        # Kurz und lang laufen auf demselben Kanal ein.
        assert integration._by_datapoint[("0001D8A9B12348:1", "PRESS_SHORT")] == entity_id
        assert integration._by_datapoint[("0001D8A9B12348:1", "PRESS_LONG")] == entity_id

        integration._on_event("id", "0001D8A9B12348:1", "PRESS_SHORT", True)
        await asyncio.sleep(0.01)
        entity = hub.registry.get(entity_id)
        assert entity is not None
        assert entity.state["state"] == "short"
        first = entity.state["last_press"]

        integration._on_event("id", "0001D8A9B12348:1", "PRESS_LONG", True)
        await asyncio.sleep(0.01)
        assert hub.registry.get(entity_id).state["state"] == "long"

        # Das Loslassen meldet die CCU als zweites Ereignis mit False – das
        # ist kein Druck und darf nichts auslösen.
        integration._on_event("id", "0001D8A9B12348:1", "PRESS_LONG", False)
        await asyncio.sleep(0.01)
        assert hub.registry.get(entity_id).state["state"] == "long"
        assert hub.registry.get(entity_id).state["last_press"] >= first
    finally:
        await integration.teardown()


def test_group_by_device_puts_a_devices_channels_together():
    """Nach Kanalart sortiert war die Liste beim Einrichten unbrauchbar –
    bei über hundert Tastenkanälen fiel das gesuchte Gerät hinten heraus."""
    channels = {
        "00085F299F4355:0": "MAINTENANCE",
        "00085F299F4355:4": "SWITCH_VIRTUAL_RECEIVER",
        "00085F299F4355:1": "KEY_TRANSCEIVER",
        "00085F299F4355:2": "KEY_TRANSCEIVER",
        "000C18A98B90E7:1": "PRESENCEDETECTOR_TRANSCEIVER",
    }
    grouped = group_by_device(channels)
    assert set(grouped) == {"00085F299F4355", "000C18A98B90E7"}
    # Nach Kanalnummer, nicht nach Text – sonst käme 10 vor 2.
    assert describe_channels(grouped["00085F299F4355"]) == (
        "0 MAINTENANCE, 1 KEY_TRANSCEIVER, 2 KEY_TRANSCEIVER, "
        "4 SWITCH_VIRTUAL_RECEIVER"
    )


def test_group_by_device_survives_odd_addresses():
    grouped = group_by_device({"OHNEKANAL": "MAINTENANCE", "ABC:x": "KEY_TRANSCEIVER"})
    assert describe_channels(grouped["OHNEKANAL"]) == "0 MAINTENANCE"
    assert describe_channels(grouped["ABC"]) == "0 KEY_TRANSCEIVER"


async def test_a_pong_confirms_the_registration(hub, monkeypatch):
    """Die CCU vergisst ihre Clients bei jedem Dienstneustart. Der Hub
    fragt deshalb mit einem Ping nach; das PONG ist die Bestätigung."""
    monkeypatch.setattr(homematic, "PING_TIMEOUT", 1.0)
    ccu = _FakeCCU({("0001D3C99C6A2B:3", "STATE"): True})
    integration = await _setup(
        hub,
        ccu,
        [{"address": "0001D3C99C6A2B:3", "port": 2010, "name": "Tumbler", "kind": "switch"}],
    )
    try:
        async def answer():
            await asyncio.sleep(0.05)
            integration._on_event("id", "homepilot-2010", "PONG", "homepilot-2010")

        asyncio.create_task(answer())
        assert await integration._check_registration(2010) is True
        assert ("ping", ("homepilot-2010",), 2010) in ccu.calls
    finally:
        await integration.teardown()


async def test_without_a_pong_the_hub_registers_again(hub, monkeypatch):
    """Der gemeldete Fall: Nach einem Neustart der CCU kam kein einziges
    Ereignis mehr an – kein Tastendruck, keine Sensormeldung – und im Log
    stand nichts. Der Hub hatte sich einmal beim Start angemeldet und nie
    wieder nachgesehen."""
    monkeypatch.setattr(homematic, "PING_TIMEOUT", 0.3)
    ccu = _FakeCCU({("0001D3C99C6A2B:3", "STATE"): True})
    integration = await _setup(
        hub,
        ccu,
        [{"address": "0001D3C99C6A2B:3", "port": 2010, "name": "Tumbler", "kind": "switch"}],
    )
    try:
        # Niemand antwortet – die CCU kennt uns nicht mehr.
        assert await integration._check_registration(2010) is False
    finally:
        await integration.teardown()


def test_the_datapoint_tells_what_kind_of_sensor_it_is():
    """Ohne diese Zuordnung ist ein Melder für den Hub bloss ein Ja/Nein –
    und der Wächter kann weder vor einem offenen Fenster noch vor Wasser
    warnen."""
    from homepilot.integrations.homematic import guess_device_class

    assert guess_device_class("STATE") == "contact"
    assert guess_device_class("MOTION") == "motion"
    assert guess_device_class("WATER_DETECTED") == "moisture"
    assert guess_device_class("SMOKE_DETECTOR_ALARM_STATUS") == "smoke"
    # Unklares bleibt offen: Eine falsche Angabe wäre schlimmer als keine.
    assert guess_device_class("ACTUAL_TEMPERATURE") is None
    assert guess_device_class(None) is None


def test_illumination_becomes_a_measurable_value():
    """Melder messen nebenbei die Helligkeit - genau die will man in einem
    Ablauf vergleichen. «Nur wenn unter 20 Lux» ist die ehrliche Regel für
    «es ist dunkel»; der Sonnenstand weiss nichts von einem trüben
    Novembernachmittag."""
    from homepilot.integrations.homematic import lux_to_state

    assert lux_to_state(23.456) == {"illumination": 23.5}
    # Stockdunkel ist ein Messwert, kein fehlender Wert.
    assert lux_to_state(0) == {"illumination": 0.0}
    # Alles, was keine Zahl ist, wird verworfen statt als 0 Lux
    # eingetragen - sonst liefe «unter 20 Lux» am hellen Mittag.
    assert lux_to_state(None) == {}
    assert lux_to_state(True) == {}
    assert lux_to_state("") == {}
    # Manche Fassungen liefern Zahlen als Text.
    assert lux_to_state("42") == {"illumination": 42.0}


def test_duty_cycle_of_reads_only_usable_values():
    """Der Sendespeicher – aber nur, wo die CCU wirklich einen liefert."""
    from homepilot.integrations.homematic import duty_cycle_of

    werte = duty_cycle_of(
        [
            {"ADDRESS": "OEQ1234567", "DUTY_CYCLE": 12, "CONNECTED": True},
            {"ADDRESS": "HmIP-RCV-1", "DUTY_CYCLE": -1},
            {"ADDRESS": "OHNE", "DUTY_CYCLE": None},
            {"ADDRESS": "", "DUTY_CYCLE": 5},
            {"ADDRESS": "TEXT", "DUTY_CYCLE": "unbekannt"},
            {"ADDRESS": "RUND", "DUTY_CYCLE": 17.6},
        ]
    )
    assert werte == {"OEQ1234567": 12, "RUND": 18}


def test_duty_cycle_of_survives_nonsense():
    from homepilot.integrations.homematic import duty_cycle_of

    assert duty_cycle_of(None) == {}
    assert duty_cycle_of([]) == {}
    assert duty_cycle_of(["kein dict"]) == {}
    # True ist in Python eine Zahl – als Prozentwert wäre das Unsinn.
    assert duty_cycle_of([{"ADDRESS": "A", "DUTY_CYCLE": True}]) == {}


async def test_duty_cycle_becomes_a_sensor(hub):
    """Man soll das Volllaufen kommen sehen, statt vor einer stummen
    Funkstrecke zu stehen."""

    class _CCUmitInterface(_FakeCCU):
        async def call(self, method: str, *args, port: int = 0):
            if method == "listBidcosInterfaces":
                return [{"ADDRESS": "OEQ1234567", "DUTY_CYCLE": 42}]
            return await super().call(method, *args, port=port)

    ccu = _CCUmitInterface({("0001D3C99C6A2B:3", "STATE"): True})
    integration = await _setup(
        hub,
        ccu,
        [
            {
                "address": "0001D3C99C6A2B:3",
                "port": 2001,
                "name": "Tumbler",
                "kind": "switch",
            }
        ],
    )
    try:
        sensor = hub.registry.get("homematic.duty_cycle_OEQ1234567")
        assert sensor is not None
        assert sensor.state["state"] == 42
        assert sensor.state["unit"] == "%"
    finally:
        await integration.teardown()


async def test_no_duty_cycle_sensor_without_a_value(hub):
    """Eine Schnittstelle, die nichts meldet, bekommt keinen Messwert –
    einer, der ewig auf null steht, wäre schlimmer als keiner."""
    ccu = _FakeCCU({("0001D3C99C6A2B:3", "STATE"): True})
    integration = await _setup(
        hub,
        ccu,
        [
            {
                "address": "0001D3C99C6A2B:3",
                "port": 2001,
                "name": "Tumbler",
                "kind": "switch",
            }
        ],
    )
    try:
        assert not [
            entity
            for entity in hub.registry.all()
            if "duty_cycle" in entity.id
        ]
    finally:
        await integration.teardown()
