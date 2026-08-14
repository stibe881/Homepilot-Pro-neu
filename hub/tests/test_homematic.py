import pytest

from homepilot.integrations.homematic import command_to_value, value_to_state


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
