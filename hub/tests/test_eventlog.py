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


# ── Der Verlauf überlebt den Neustart ────────────────────────────────────
#
# Hier stand einmal, das Protokoll sei bewusst flüchtig. Das war der
# falsche Handel: Nach jedem Update war der Verlauf leer - also genau
# dann, wenn man ihn braucht, weil sich etwas geändert hat.


def _schalten(log, entity_id="light.kueche", state="on"):
    log.record(
        "state_changed",
        {
            "entity_id": entity_id,
            "entity": {"kind": "light", "name": "Küche"},
            "old_state": {"state": "off" if state == "on" else "on"},
            "new_state": {"state": state},
            "source": {"kind": "user", "label": "Stefan"},
        },
    )


def test_verlauf_wird_gesichert_und_geladen(tmp_path):
    pfad = tmp_path / "geraete-verlauf.json"
    log = EventLog(pfad)
    _schalten(log, state="on")
    _schalten(log, state="off")
    log.save(force=True)
    assert pfad.is_file()

    # Der Neustart.
    zweiter = EventLog(pfad)
    zeilen = zweiter.for_entity("light.kueche")
    assert [zeile["state"] for zeile in zeilen] == ["off", "on"]
    # Und die Quelle steht noch dabei - sonst wäre «warum ging das an?»
    # nach dem Neustart wieder unbeantwortbar.
    assert zeilen[0]["source"]["label"] == "Stefan"


def test_der_anfang_bleibt_der_erste_start(tmp_path):
    """Sonst behauptete die App nach jedem Neustart, alles Ältere sei nie
    passiert - «nichts aufgezeichnet» statt «nichts passiert»."""
    pfad = tmp_path / "verlauf.json"
    erster = EventLog(pfad)
    _schalten(erster)
    erster.save(force=True)

    zweiter = EventLog(pfad)
    assert zweiter.started == erster.started


def test_gesichert_wird_gedrosselt(tmp_path):
    pfad = tmp_path / "verlauf.json"
    log = EventLog(pfad)
    _schalten(log)
    log.save(force=True)
    erste_groesse = pfad.stat().st_size

    # Gleich danach noch ein Ereignis - ohne force wird nicht geschrieben.
    _schalten(log, state="off")
    log.save()
    assert pfad.stat().st_size == erste_groesse
    # Mit force schon.
    log.save(force=True)
    assert pfad.stat().st_size != erste_groesse


def test_ohne_aenderung_wird_nicht_geschrieben(tmp_path):
    pfad = tmp_path / "verlauf.json"
    log = EventLog(pfad)
    log.save(force=True)
    # Nichts passiert, nichts zu sichern - kein leeres Dateigerippe.
    assert not pfad.exists()


def test_ein_kaputter_stand_haelt_den_hub_nicht_auf(tmp_path):
    pfad = tmp_path / "verlauf.json"
    pfad.write_text("{kein json", encoding="utf-8")
    log = EventLog(pfad)
    assert log.all() == []
    # Und er lässt sich danach normal weiterbenutzen.
    _schalten(log)
    log.save(force=True)
    assert EventLog(pfad).all()


def test_ohne_pfad_bleibt_alles_wie_frueher():
    log = EventLog()
    _schalten(log)
    log.save(force=True)
    assert len(log.all()) == 1
