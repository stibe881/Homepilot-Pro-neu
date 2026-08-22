"""Anwesenheit: zwei Quellen, eine Antwort – und ein ehrliches «weiss nicht»."""

from __future__ import annotations

import time

from homepilot.core import presence
from homepilot.integrations import geofence


def test_places_without_coordinates_are_dropped():
    orte = presence.parse_places(
        [
            {"id": "home", "latitude": 47.1, "longitude": 8.0, "radius": 150},
            {"id": "ohne", "name": "Ohne Koordinaten"},
            {"nur": "unsinn"},
        ]
    )
    assert [ort["id"] for ort in orte] == ["home"]


def test_places_are_sorted_narrowest_first():
    orte = presence.parse_places(
        [
            {"id": "quartier", "latitude": 47.1, "longitude": 8.0, "radius": 3000},
            {"id": "home", "latitude": 47.1, "longitude": 8.0, "radius": 150},
        ]
    )
    assert [ort["id"] for ort in orte] == ["home", "quartier"]


def test_the_narrowest_place_wins_over_the_wide_one():
    orte = presence.parse_places(
        [
            {"id": "home", "latitude": 47.1, "longitude": 8.0, "radius": 150},
            {"id": "quartier", "latitude": 47.1, "longitude": 8.0, "radius": 3000},
        ]
    )
    # Wer zuhause ist, ist auch im Quartier - angezeigt wird «zuhause».
    assert presence.place_state(["quartier", "home"], orte) == ("home", "home")
    assert presence.place_state(["quartier"], orte) == ("quartier", "quartier")
    assert presence.place_state([], orte) == ("away", None)


def test_a_second_zone_becomes_its_own_state():
    orte = presence.parse_places(
        [{"id": "schule", "latitude": 47.1, "longitude": 8.0, "radius": 200}]
    )
    assert presence.place_state(["schule"], orte) == ("schule", "schule")


def test_fresh_wifi_beats_the_geofence():
    jetzt = 1_000_000.0
    zusammen = presence.merge_presence(
        {"state": "away", "changed_at": jetzt - 60},
        {"state": "on", "changed_at": jetzt - 30},
        jetzt,
    )
    assert zusammen["state"] == "home"
    assert zusammen["source"] == "wifi"


def test_stale_wifi_does_not_beat_the_geofence():
    jetzt = 1_000_000.0
    zusammen = presence.merge_presence(
        {"state": "away", "changed_at": jetzt - 60},
        {"state": "on", "changed_at": jetzt - 4000},
        jetzt,
    )
    assert zusammen["state"] == "away"
    assert zusammen["source"] == "geofence"


def test_an_empty_battery_is_not_nobody_home():
    jetzt = 1_000_000.0
    alt = {"state": "away", "changed_at": jetzt - 13 * 3600}
    beruhigt = presence.settle(alt, jetzt)
    assert beruhigt["state"] == "unknown"
    assert beruhigt["stale"] is True


def test_someone_who_reported_recently_stays_away():
    jetzt = 1_000_000.0
    alt = {"state": "away", "changed_at": jetzt - 3600}
    assert presence.settle(alt, jetzt)["state"] == "away"


def test_history_forgets_after_a_week():
    jetzt = 1_000_000.0
    rows = [
        {"person": "stefan", "state": "home", "at": jetzt - 3600},
        {"person": "stefan", "state": "away", "at": jetzt - 8 * 24 * 3600},
    ]
    behalten = presence.trim_history(rows, jetzt)
    assert len(behalten) == 1


def test_the_same_state_twice_is_not_two_entries():
    jetzt = 1_000_000.0
    rows = presence.remember([], "stefan", "home", jetzt, "home")
    nochmal = presence.remember(rows, "stefan", "home", jetzt + 10, "home")
    assert len(nochmal) == 1


def test_battery_alert_only_below_the_limit():
    assert presence.battery_alert("Livia", 12) is not None
    assert presence.battery_alert("Livia", 40) is None
    assert presence.battery_alert("Livia", None) is None


def test_holiday_question_needs_everyone_away_for_a_day():
    jetzt = 1_000_000.0
    weg = [{"state": "away", "changed_at": jetzt - 30 * 3600}]
    assert presence.holiday_question(weg, False, jetzt) is True
    # Läuft die Simulation schon, gibt es nichts zu fragen.
    assert presence.holiday_question(weg, True, jetzt) is False
    # Eine unbekannte Person genügt, um zu schweigen.
    gemischt = [*weg, {"state": "unknown", "changed_at": jetzt}]
    assert presence.holiday_question(gemischt, False, jetzt) is False


def test_diagnose_names_the_silence():
    jetzt = time.time()
    zeile = presence.diagnose(
        "Livia", {"state": "away", "changed_at": jetzt - 20 * 3600}, jetzt
    )
    assert zeile["silent"] is True
    assert "Funkstille" in zeile["hint"]

    nie = presence.diagnose("Livia", {}, jetzt)
    assert nie["last_seen"] is None
    assert "Kurzbefehl" in nie["hint"]


def test_default_places_come_from_the_house_location():
    orte = geofence.default_places({"latitude": 47.2, "longitude": 8.1})
    assert [ort["id"] for ort in orte] == ["home", "quartier"]
    assert orte[0]["latitude"] == 47.2
    # Die weite Zone ist der Vorlauf: zehn Minuten statt zwei.
    assert orte[1]["radius"] > orte[0]["radius"]


def test_zones_can_name_their_wifi_source():
    zones = geofence.parse_zones([{"id": "stefan", "wifi": "unifi.iphone_stefan"}])
    assert zones[0]["wifi"] == "unifi.iphone_stefan"
