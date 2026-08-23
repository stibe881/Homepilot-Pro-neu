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


def test_the_wifi_is_no_longer_a_presence_source():
    """Es gab einmal merge_presence, das eine WLAN-Anmeldung über die
    Ortsmeldung stellte. «Gerät im Netz» ist nicht «Mensch zuhause» –
    darum gibt es die Funktion nicht mehr, und der Test hält fest, dass
    sie nicht zurückkommt."""
    assert not hasattr(presence, "merge_presence")
    assert not hasattr(presence, "WIFI_FRESH")


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


def test_the_default_location_is_the_actual_house():
    """Die Voreinstellung muss im Zonenradius des echten Hauses liegen.

    Zweimal passiert: Erst lag sie 11 km neben Zell, dann – nach der
    ersten Korrektur – immer noch 170 m daneben. Bei 150 m Radius heisst
    das «unterwegs», während man in der Küche steht, und niemand sieht
    der Zahl im Code an, dass sie das falsche Haus meint. Der Abstand
    hier ist die Prüfung, die ein Blick auf die Koordinaten nicht ist.
    """
    from homepilot.integrations.life360 import abstand_meter

    meter = abstand_meter(
        geofence.DEFAULT_LAT, geofence.DEFAULT_LON, 47.1384361, 7.9205897
    )
    assert meter < geofence.DEFAULT_RADIUS / 2


def test_default_places_come_from_the_house_location():
    orte = geofence.default_places({"latitude": 47.2, "longitude": 8.1})
    assert [ort["id"] for ort in orte] == ["home", "quartier"]
    assert orte[0]["latitude"] == 47.2
    # Die weite Zone ist der Vorlauf: zehn Minuten statt zwei.
    assert orte[1]["radius"] > orte[0]["radius"]


def test_an_old_wifi_entry_is_read_over_instead_of_breaking_the_start():
    """Wer `wifi:` in der config.yaml stehen hat, soll nach dem Update
    keinen Startfehler bekommen – die Zeile gilt nur nicht mehr."""
    zones = geofence.parse_zones([{"id": "stefan", "wifi": "unifi.iphone_stefan"}])
    assert zones == [{"id": "stefan", "name": "stefan"}]


# ── Welche Zone gehört zu welchem Benutzer ───────────────────────────────


def test_a_user_finds_the_zone_with_the_same_name():
    from homepilot.core.presence import zone_fuer

    assert zone_fuer("Stefan", {"stefan": "Stefan", "livia": "Livia"}) == "stefan"


def test_upper_and_lower_case_and_spaces_do_not_matter():
    from homepilot.core.presence import zone_fuer

    # «  stefan  » und «Stefan» sind dieselbe Person; alles andere wäre
    # eine Falle beim Eintippen in der config.yaml.
    assert zone_fuer("  stefan ", {"z1": "STEFAN"}) == "z1"


def test_without_a_name_on_the_zone_the_id_counts():
    from homepilot.core.presence import zone_fuer

    # «- id: stefan» ohne 'name': soll trotzdem passen.
    assert zone_fuer("Stefan", {"stefan": ""}) == "stefan"


def test_the_name_beats_the_id():
    from homepilot.core.presence import zone_fuer

    # Sonst gewönne eine Zone, die zufällig so heisst wie eine fremde
    # Kennung.
    zonen = {"livia": "Stefan", "stefan": "Jemand anders"}
    assert zone_fuer("Stefan", zonen) == "livia"


def test_a_user_without_a_zone_gets_nothing():
    from homepilot.core.presence import zone_fuer

    assert zone_fuer("Sandra", {"stefan": "Stefan"}) is None
    assert zone_fuer("", {"stefan": "Stefan"}) is None
    assert zone_fuer("Stefan", {}) is None
def test_anyone_home_state() -> None:
    """Ein leerer Akku ist kein «niemand zuhause».

    Die Vorsicht ist der ganze Punkt: Aus dieser Entität wird «alles
    aus, Alarm scharf». Wer daraus bei Nichtwissen ein «weg» macht,
    schaltet irgendwann das Haus ab, während jemand darin sitzt.
    """
    from homepilot.core.presence import anyone_home_state

    assert anyone_home_state(["home", "away"]) == "on"
    assert anyone_home_state(["away", "away"]) == "off"
    # Ein anderer Ort ist auch weg - nur eben ein benannter.
    assert anyone_home_state(["schule", "away"]) == "off"
    assert anyone_home_state(["unknown", "away"]) == "on"
    assert anyone_home_state(["", "away"]) == "on"
    assert anyone_home_state([]) == "on"
    assert anyone_home_state(None) == "on"
