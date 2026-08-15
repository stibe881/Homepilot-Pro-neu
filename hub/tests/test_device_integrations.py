"""Tests der reinen Übersetzungslogik von UniFi, Twinkly und V-ZUG.

Die Netzwerkteile brauchen echte Geräte; hier wird geprüft, was auch ohne
Hardware verifizierbar ist: dass Geräteantworten korrekt in Entitäts-
Zustände übersetzt werden.
"""

from homepilot.core.integration import load_integration_class
from homepilot.integrations.twinkly import state_from_mode
from homepilot.integrations.unifi import normalise_mac, presence_from_clients
from homepilot.integrations.vzug import parse_device_status

ALL_INTEGRATIONS = [
    "demo",
    "meteoalarm",
    "hue",
    "mqtt",
    "homematic",
    "unifi",
    "unifi_protect",
    "hue_sync",
    "spotify",
    "roborock",
    "google_cast",
    "google_calendar",
    "twinkly",
    "vzug",
]


def test_every_integration_is_loadable():
    """Fängt fehlendes INTEGRATION-Attribut und falsch gesetzte Namen ab."""
    for name in ALL_INTEGRATIONS:
        cls = load_integration_class(name)
        assert cls.name == name


# ── UniFi ────────────────────────────────────────────────────────────────


def test_normalise_mac():
    assert normalise_mac("AA-BB-CC-DD-EE-FF") == "aa:bb:cc:dd:ee:ff"
    assert normalise_mac("  aa:BB:cc:dd:ee:ff ") == "aa:bb:cc:dd:ee:ff"


def test_presence_from_clients():
    clients = [
        {"mac": "AA:BB:CC:DD:EE:FF", "hostname": "iphone"},
        {"mac": "99:99:99:99:99:99"},
    ]
    presence = presence_from_clients(
        clients, ["aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"]
    )
    assert presence == {"aa:bb:cc:dd:ee:ff": True, "11:22:33:44:55:66": False}


def test_presence_with_empty_client_list():
    assert presence_from_clients([], ["aa:bb:cc:dd:ee:ff"]) == {
        "aa:bb:cc:dd:ee:ff": False
    }


# ── Twinkly ──────────────────────────────────────────────────────────────


def test_state_from_mode():
    assert state_from_mode("off") == "off"
    assert state_from_mode("movie") == "on"
    assert state_from_mode("color") == "on"
    assert state_from_mode(None) == "off"


# ── V-ZUG ────────────────────────────────────────────────────────────────


def test_parse_device_status_running():
    payload = {
        "DeviceName": "Adora",
        "Serial": "11021 123456",
        "Inactive": "false",
        "Program": "Eco",
        "Status": "Programm läuft",
        "ProgramEnd": {"End": "1h 20min", "EndType": "1"},
        "deviceUuid": "0000123456",
    }
    assert parse_device_status(payload) == {
        "state": "running",
        "program": "Eco",
        "status": "Programm läuft",
        "program_end": "1h 20min",
        "serial": "11021 123456",
    }


def test_parse_device_status_idle():
    payload = {
        "DeviceName": "",
        "Serial": "11021 123456",
        "Inactive": "true",
        "Program": "",
        "Status": "",
        "ProgramEnd": {"End": "", "EndType": "0"},
    }
    parsed = parse_device_status(payload)
    assert parsed["state"] == "idle"
    # Leere Strings werden zu None, damit die App nichts Leeres anzeigt.
    assert parsed["program"] is None
    assert parsed["program_end"] is None


def test_parse_device_status_tolerates_missing_fields():
    assert parse_device_status({})["state"] == "idle"
