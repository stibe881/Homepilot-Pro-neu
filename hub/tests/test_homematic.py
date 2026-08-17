import pytest

import xmlrpc.client

from homepilot.integrations.homematic import (
    HomematicIntegration,
    command_error,
    command_to_value,
    is_timeout,
    power_to_state,
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
