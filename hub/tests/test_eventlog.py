"""Ereignisprotokoll je Gerät: Schaltvorgänge samt Quelle, Sensoren nicht."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.eventlog import EventLog, worth_recording
from homepilot.core.hub import Hub

from .conftest import make_config


def test_worth_recording_filters_noise():
    # Ein echter Schaltvorgang zählt …
    assert worth_recording("light", {"state": "off"}, {"state": "on"}) is True
    # … Attribut-Zappelei beim ohnehin brennenden Licht nicht …
    assert (
        worth_recording(
            "light", {"state": "on", "brightness": 40}, {"state": "on", "brightness": 80}
        )
        is False
    )
    # … und Messwerte fluten das Protokoll nicht.
    assert worth_recording("sensor", {"state": 21.0}, {"state": 21.5}) is False


def test_for_entity_returns_newest_first():
    log = EventLog()
    for state in ("on", "off", "on"):
        log.record(
            "state_changed",
            {
                "entity_id": "hue.lampe",
                "entity": {"kind": "light"},
                "old_state": {"state": "x"},
                "new_state": {"state": state},
                "source": {"kind": "user", "label": "Stefan"},
            },
        )
    events = log.for_entity("hue.lampe")
    assert [event["state"] for event in events] == ["on", "off", "on"][::-1]
    assert events[0]["source"]["label"] == "Stefan"
    assert log.for_entity("andere.lampe") == []


def test_events_over_the_api():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        # Schalten erzeugt einen Eintrag mit Quelle.
        client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on"},
        )
        events = client.get("/api/entities/demo.light_livingroom/log").json()["events"]
        assert events and events[0]["state"] == "on"
        # Unbekanntes Gerät bleibt ein sauberes 404.
        assert client.get("/api/entities/nope.nope/log").status_code == 404


def test_span_says_the_log_is_young_and_not_full():
    """Ein frisches Protokoll: Anfang bekannt, Puffer nicht übergelaufen."""
    log = EventLog()
    leer = log.span()
    assert leer["count"] == 0
    assert leer["oldest"] is None
    assert leer["full"] is False
    assert leer["started"] > 0

    log.record(
        "state_changed",
        {
            "entity_id": "hue.lampe",
            "entity": {"kind": "light"},
            "old_state": {"state": "off"},
            "new_state": {"state": "on"},
            "source": {"kind": "user", "label": "Stefan"},
        },
    )
    voll = log.span()
    assert voll["count"] == 1
    # Der älteste Eintrag kann nicht vor dem Start des Protokolls liegen.
    assert voll["oldest"] >= leer["started"]


def test_span_reaches_the_api():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on"},
        )
        body = client.get("/api/entities/demo.light_livingroom/log").json()
        assert body["log"]["count"] >= 1
        assert body["log"]["limit"] == 2000
