"""Die reine Kanal-Logik der Homematic-Anbindung.

580 Zeilen entscheidbare Logik, auf denen jede Homematic-Kachel im Haus
steht - und bis hierher ohne einen einzigen Test. Die Fälle unten sind
die, die in den Docstrings als Begründungen stehen: Sie waren also alle
schon einmal falsch.
"""

from __future__ import annotations

import pytest

from homepilot.integrations.homematic_channels import (
    battery_to_state,
    button_hinweis,
    command_error,
    command_to_value,
    describe_channels,
    druck_hinweis,
    duty_cycle_of,
    group_by_device,
    guess_device_class,
    is_timeout,
    kanal_rat,
    key_channels,
    lesbare_datenpunkte,
    lux_to_state,
    maintenance_address,
    power_to_state,
    press_to_state,
    switch_channel,
    unit_for,
    unknown_parameter,
    value_to_state,
)

# Eine HmIP-PSM (Schalt-Messsteckdose), wie die CCU sie meldet: Kanal 0
# ist Wartung, 3 der Schaltkanal, 6 der Messkanal - und die Sendekanäle
# dazwischen kann man nicht schalten.
PSM = {
    "ABC123:0": "MAINTENANCE",
    "ABC123:1": "SWITCH_TRANSMITTER",
    "ABC123:2": "SWITCH_TRANSMITTER",
    "ABC123:3": "SWITCH_VIRTUAL_RECEIVER",
    "ABC123:4": "SWITCH_VIRTUAL_RECEIVER",
    "ABC123:6": "ENERGIE_METER_TRANSMITTER",
}

# Ein HmIP-BSL (Markenschalter mit Signalleuchte): Tastenkanäle und
# Schaltausgänge am selben Gerät - der Grund für button_hinweis.
BSL = {
    "DEF456:0": "MAINTENANCE",
    "DEF456:1": "KEY_TRANSCEIVER",
    "DEF456:2": "KEY_TRANSCEIVER",
    "DEF456:3": "DIMMER_VIRTUAL_RECEIVER",
}


# ── Kanäle bündeln ─────────────────────────────────────────────────────────


def test_channels_are_grouped_by_serial_and_sorted_by_number():
    devices = group_by_device(PSM)
    assert list(devices) == ["ABC123"]
    assert devices["ABC123"][0] == (0, "MAINTENANCE")
    assert devices["ABC123"][-1] == (6, "ENERGIE_METER_TRANSMITTER")


def test_a_channel_without_number_counts_as_zero_and_empty_kind_is_named():
    devices = group_by_device({"XYZ": ""})
    assert devices == {"XYZ": [(0, "UNBEKANNT")]}


def test_describe_channels_makes_one_line():
    assert describe_channels([(0, "MAINTENANCE"), (3, "SWITCH")]) == (
        "0 MAINTENANCE, 3 SWITCH"
    )


# ── Welcher Kanal schaltet ─────────────────────────────────────────────────


def test_a_channel_that_already_switches_needs_no_replacement():
    assert switch_channel("ABC123:3", PSM) is None


def test_the_meter_channel_redirects_to_the_smallest_switching_channel():
    # Der klassische Einrichtungsfehler bei der HmIP-PSM: Kanal 6
    # eingetragen, und jedes setValue endet in Fault -5.
    assert switch_channel("ABC123:6", PSM) == "ABC123:3"


def test_an_unknown_address_gives_no_switch_channel():
    assert switch_channel("NIEMAND:1", PSM) is None


def test_a_device_without_switching_channels_gives_none():
    nur_taster = {"GHI789:1": "KEY", "GHI789:2": "KEY"}
    assert switch_channel("GHI789:1", nur_taster) is None


def test_key_channels_come_sorted_and_only_from_the_same_device():
    beide = {**PSM, **BSL}
    assert key_channels("DEF456:3", beide) == ["DEF456:1", "DEF456:2"]
    assert key_channels("ABC123:3", beide) == []


# ── Warum ein Taster schweigt ──────────────────────────────────────────────


def test_a_real_key_channel_gets_no_hint():
    assert button_hinweis("DEF456:1", BSL) is None
    # Unbekannte Adressen sind Sache der Kanalliste, nicht dieses Hinweises.
    assert button_hinweis("NIEMAND:1", BSL) is None


def test_a_switching_output_points_to_the_key_channels_next_door():
    hinweis = button_hinweis("DEF456:3", BSL)
    assert hinweis is not None
    assert "DEF456:1, DEF456:2" in hinweis


def test_a_device_without_any_key_channel_hints_at_the_wrong_device():
    hinweis = button_hinweis("ABC123:3", PSM)
    assert hinweis is not None
    assert "anderen Geräts" in hinweis


def test_druck_hinweis_is_quiet_when_the_channel_reports_presses():
    assert druck_hinweis("DEF456:1", "KEY_TRANSCEIVER", {"PRESS_SHORT"}, BSL) is None


def test_druck_hinweis_names_the_actual_datapoints_and_the_way_out():
    # Der HmIP-Eingang im Kontakt-Modus: richtiger Kanal, falscher
    # Betriebsmodus - derselbe Kanal kennt dann STATE statt PRESS_SHORT.
    hinweis = druck_hinweis("DEF456:3", "DIMMER_VIRTUAL_RECEIVER", {"LEVEL"}, BSL)
    assert hinweis is not None
    assert "LEVEL" in hinweis
    assert "DEF456:1" in hinweis


# ── Werte in Zustände ──────────────────────────────────────────────────────


def test_a_dimmer_level_becomes_state_and_percent_brightness():
    assert value_to_state(0.5, "LEVEL", dimmable=True) == {
        "state": "on",
        "brightness": 50,
    }
    assert value_to_state(0.0, "LEVEL", dimmable=True) == {
        "state": "off",
        "brightness": 0,
    }


def test_a_smoke_alarm_status_is_off_only_in_idle():
    ruhe = value_to_state(0, "SMOKE_DETECTOR_ALARM_STATUS", dimmable=False)
    assert ruhe["state"] == "off"
    alarm = value_to_state(1, "SMOKE_DETECTOR_ALARM_STATUS", dimmable=False)
    assert alarm == {"state": "on", "alarm_status": 1}


def test_booleans_become_on_off_whatever_the_datapoint_is_called():
    # Ein rohes True auf MOTION sähe die Alarmanlage nie - sie sucht «on».
    assert value_to_state(True, "MOTION", dimmable=False) == {"state": "on"}
    assert value_to_state(False, "PRESENCE_DETECTION_STATE", dimmable=False) == {
        "state": "off"
    }


def test_other_values_pass_through_unchanged():
    assert value_to_state(21.5, "ACTUAL_TEMPERATURE", dimmable=False) == {
        "state": 21.5
    }


def test_lux_accepts_numbers_and_rejects_everything_else():
    assert lux_to_state(123.45) == {"illumination": 123.5}
    assert lux_to_state("17") == {"illumination": 17.0}
    # «stockdunkel» wäre eine Behauptung, kein Messwert.
    assert lux_to_state(None) == {}
    assert lux_to_state(True) == {}
    assert lux_to_state("kaputt") == {}


def test_battery_state_never_claims_a_full_battery_on_garbage():
    assert battery_to_state(True) == {"low_battery": True}
    assert battery_to_state("0") == {"low_battery": False}
    assert battery_to_state("true") == {"low_battery": True}
    assert battery_to_state(None) == {}
    assert battery_to_state("vielleicht") == {}


def test_the_maintenance_channel_is_always_channel_zero():
    assert maintenance_address("ABC123:6") == "ABC123:0"
    assert maintenance_address("ABC123") == "ABC123:0"


def test_a_press_carries_its_timestamp_so_the_second_press_counts():
    assert press_to_state("PRESS_LONG", 1000.0) == {
        "state": "long",
        "last_press": 1000.0,
    }
    assert press_to_state("PRESS_SHORT", 2000.0)["state"] == "short"


def test_power_rejects_unreadable_values_instead_of_overwriting():
    assert power_to_state(42.34) == {"power": 42.3}
    assert power_to_state(None) == {}
    assert power_to_state("") == {}


# ── Einheiten und Geräteklassen ────────────────────────────────────────────


def test_units_are_looked_up_case_insensitively_and_never_guessed():
    assert unit_for("actual_temperature") == "°C"
    assert unit_for("ILLUMINATION") == "lx"
    assert unit_for("RAIN_COUNTER") == "mm"
    assert unit_for("IRGENDWAS") is None
    assert unit_for(None) is None


def test_device_classes_cover_only_the_unambiguous_cases():
    assert guess_device_class("STATE") == "contact"
    assert guess_device_class("motion") == "motion"
    assert guess_device_class("WATER_DETECTED") == "moisture"
    assert guess_device_class("LEVEL") is None
    assert guess_device_class(None) is None


# ── Kommandos ──────────────────────────────────────────────────────────────


def test_toggle_reads_the_current_state():
    assert command_to_value("toggle", {}, False, {"state": "on"}) == ("STATE", False)
    assert command_to_value("toggle", {}, False, {"state": "off"}) == ("STATE", True)


def test_a_dimmer_turns_on_at_its_last_brightness():
    datapoint, value = command_to_value("turn_on", {}, True, {"brightness": 40})
    assert (datapoint, value) == ("LEVEL", 0.4)
    # Ohne Erinnerung: volle Helligkeit statt eines dunklen «an».
    assert command_to_value("turn_on", {}, True, {}) == ("LEVEL", 1.0)


def test_brightness_is_clamped_to_the_valid_range():
    assert command_to_value("set_brightness", {"brightness": 250}, True, {}) == (
        "LEVEL",
        1.0,
    )
    assert command_to_value("set_brightness", {"brightness": -5}, True, {}) == (
        "LEVEL",
        0.0,
    )


def test_turn_off_is_level_zero_for_dimmers_and_state_false_otherwise():
    assert command_to_value("turn_off", {}, True, {}) == ("LEVEL", 0.0)
    assert command_to_value("turn_off", {}, False, {}) == ("STATE", False)


def test_an_unsupported_command_raises():
    with pytest.raises(ValueError):
        command_to_value("play_url", {}, False, {})


# ── CCU-Fehler lesbar machen ───────────────────────────────────────────────


class Fault(Exception):
    def __init__(self, code: int, text: str) -> None:
        super().__init__(text)
        self.faultCode = code
        self.faultString = text


def test_a_radio_timeout_is_recognized_in_the_fault_text():
    assert is_timeout(Fault(-1, "Generic error (TIMEOUT)"))
    assert not is_timeout(Fault(-5, "Invalid parameter or value"))


def test_command_errors_explain_the_two_common_faults():
    timeout = command_error("ABC123:3", "STATE", Fault(-1, "Generic error (TIMEOUT)"))
    assert "Funk-Timeout" in timeout
    falsch = command_error("ABC123:6", "STATE", Fault(-5, "Invalid parameter"))
    assert "Messkanal" in falsch
    sonst = command_error("ABC123:3", "STATE", Fault(-2, "Unbekanntes"))
    assert "Unbekanntes" in sonst


def test_unknown_parameter_is_told_apart_by_its_text():
    assert unknown_parameter(Fault(-5, "Unknown parameter"))
    assert not unknown_parameter(Fault(-5, "Invalid parameter or value"))


def test_duty_cycle_keeps_only_readable_percentages():
    interfaces = [
        {"ADDRESS": "A", "DUTY_CYCLE": 12.6},
        {"ADDRESS": "B", "DUTY_CYCLE": -1},  # «kenne ich nicht»
        {"ADDRESS": "C", "DUTY_CYCLE": True},  # kein Messwert
        {"ADDRESS": "", "DUTY_CYCLE": 5},
        {"ADDRESS": "D", "DUTY_CYCLE": "kaputt"},
        "unfug",
        {"ADDRESS": "E", "DUTY_CYCLE": 0},
    ]
    assert duty_cycle_of(interfaces) == {"A": 13, "E": 0}
    assert duty_cycle_of(None) == {}


# ── Rat fürs Nachsehen an der CCU ──────────────────────────────────────────


def test_kanal_rat_prefers_the_datapoints_over_the_channel_kind():
    assert kanal_rat("MULTI_MODE_INPUT_TRANSMITTER", {"PRESS_SHORT"}) == "kind: button"
    assert (
        kanal_rat("MULTI_MODE_INPUT_TRANSMITTER", {"STATE"})
        == "kind: binary_sensor, datapoint: STATE"
    )


def test_kanal_rat_warns_about_transmitter_channels():
    # Sendekanäle führen dieselben Datenpunkte wie ihr Empfänger und
    # lassen sich trotzdem nicht schalten - der Fault-5-Klassiker.
    assert kanal_rat("SWITCH_TRANSMITTER", {"STATE"}) == "Sendekanal - nicht eintragen"
    assert (
        kanal_rat("SWITCH_VIRTUAL_RECEIVER", {"STATE"}) == "kind: light oder switch"
    )


def test_kanal_rat_knows_dimmers_maintenance_and_empty_channels():
    assert (
        kanal_rat("DIMMER_VIRTUAL_RECEIVER", {"LEVEL"})
        == "kind: light, dimmable: true"
    )
    assert kanal_rat("MAINTENANCE", {"LOW_BAT"}) == "Wartungskanal - liest der Hub selbst"
    assert kanal_rat("IRGENDWAS", set()) == "nichts - dieser Kanal gibt nichts her"
    assert (
        kanal_rat("IRGENDWAS", {"ACTUAL_TEMPERATURE"})
        == "kind: sensor, datapoint: ACTUAL_TEMPERATURE"
    )


def test_lesbare_datenpunkte_filters_write_only_entries():
    beschreibung = {
        "STATE": {"OPERATIONS": 7},  # lesbar und meldend
        "NUR_SCHREIBEN": {"OPERATIONS": 2},
        "OHNE_ANGABE": {},
        "ROH": "kein dict",
    }
    assert lesbare_datenpunkte(beschreibung) == {"STATE", "OHNE_ANGABE", "ROH"}
