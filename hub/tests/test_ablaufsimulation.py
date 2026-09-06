"""Zeitraum-Simulation (Punkt 254 der Werkbank).

«Wie oft hätte dieser Ablauf in den letzten n Tagen gefeuert?» - exakt
für Zeit, Sonne und Kalenderbedingungen, aus dem Ereignisprotokoll für
Zustände, und ehrlich «not_simulatable», wo beides nicht reicht.
"""

from datetime import datetime

from homepilot.core.ablaufsimulation import (
    bedingung_gilt,
    bedingung_simulierbar,
    simulieren,
)

# Zell LU - derselbe Standard-Standort wie in der Engine.
LAT, LON = 47.13844, 7.92059

# Ein fester Sonntagabend: Simulationen über die Vergangenheit müssen im
# Test auf die Minute reproduzierbar sein - datetime.now() wäre ein
# Würfel.
SONNTAG_ABEND = datetime(2026, 9, 6, 23, 0)


def test_a_time_trigger_with_weekday_condition_counts_only_weekdays():
    ergebnis = simulieren(
        [{"type": "time", "at": "06:30"}],
        [{"type": "time", "weekdays": [0, 1, 2, 3, 4]}],
        "all",
        7,
        SONNTAG_ABEND,
        LAT,
        LON,
    )
    # 31.08. (Mo) bis 06.09. (So): fünf Werktage.
    assert ergebnis["total"] == 5
    assert ergebnis["from"] == "2026-08-31"
    assert ergebnis["to"] == "2026-09-06"
    assert len(ergebnis["days"]) == 7
    montag = ergebnis["days"][0]
    assert montag == {"date": "2026-08-31", "times": ["06:30"], "count": 1}
    sonntag = ergebnis["days"][-1]
    assert sonntag["count"] == 0
    assert ergebnis["not_simulatable"] == []


def test_only_times_that_already_passed_count_for_today():
    frueh = datetime(2026, 9, 6, 6, 0)
    noch_nicht = simulieren(
        [{"type": "time", "at": "06:30"}], [], "all", 1, frueh, LAT, LON
    )
    assert noch_nicht["total"] == 0
    schon = simulieren(
        [{"type": "time", "at": "05:30"}], [], "all", 1, frueh, LAT, LON
    )
    assert schon["total"] == 1


def test_a_sun_trigger_fires_once_per_day():
    ergebnis = simulieren(
        [{"type": "sun", "event": "sunset", "offset": 15}],
        [],
        "all",
        7,
        SONNTAG_ABEND,
        LAT,
        LON,
    )
    assert ergebnis["total"] == 7
    for tag in ergebnis["days"]:
        assert tag["count"] == 1
        # Anfang September geht die Sonne in Zell abends unter - die
        # Uhrzeit muss vom Kalendertag stammen, nicht erfunden sein. Die
        # Spanne ist bewusst weit: astro rechnet in der Ortszeit des
        # Rechners, und der Prüfstand läuft in UTC, das Haus in CH-Zeit.
        stunde = int(tag["times"][0].split(":")[0])
        assert 17 <= stunde <= 21


def test_a_state_trigger_without_log_entries_is_reported_honestly():
    """Der Kern von Punkt 254: keine Schätzung. Eine geschätzte Zahl wäre
    eine Lüge mit Nachkommastellen."""
    ergebnis = simulieren(
        [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
        [],
        "all",
        7,
        SONNTAG_ABEND,
        LAT,
        LON,
        events=[],
    )
    assert ergebnis["total"] == 0
    assert len(ergebnis["not_simulatable"]) == 1
    eintrag = ergebnis["not_simulatable"][0]
    assert eintrag["type"] == "state"
    assert eintrag["entity_id"] == "demo.motion_hall"
    assert "Ereignisprotokoll" in eintrag["reason"]


def test_a_state_trigger_is_counted_from_the_event_log():
    tag = datetime(2026, 9, 5, 8, 0).timestamp()
    events = [
        {"entity_id": "demo.motion_hall", "state": "on", "at": tag},
        {"entity_id": "demo.motion_hall", "state": "off", "at": tag + 60},
        {"entity_id": "demo.motion_hall", "state": "on", "at": tag + 7200},
        # Ein anderes Gerät zählt nicht mit.
        {"entity_id": "demo.switch_coffee", "state": "on", "at": tag + 60},
    ]
    ergebnis = simulieren(
        [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
        [],
        "all",
        7,
        SONNTAG_ABEND,
        LAT,
        LON,
        events=events,
        log_start=tag - 7 * 24 * 3600,
    )
    assert ergebnis["total"] == 2
    samstag = next(t for t in ergebnis["days"] if t["date"] == "2026-09-05")
    assert samstag["count"] == 2
    assert ergebnis["not_simulatable"] == []


def test_a_holiday_condition_skips_the_holiday():
    """1. August 2026 - Bundesfeier. «ausser an Feiertagen» muss ihn beim
    Nachrechnen genauso auslassen wie im Betrieb."""
    ergebnis = simulieren(
        [{"type": "time", "at": "08:00"}],
        [{"type": "time", "except_holidays": True}],
        "all",
        3,
        datetime(2026, 8, 3, 12, 0),
        LAT,
        LON,
    )
    # 1.8. fällt weg, 2.8. und 3.8. bleiben.
    assert ergebnis["total"] == 2
    erster_august = next(t for t in ergebnis["days"] if t["date"] == "2026-08-01")
    assert erster_august["count"] == 0


def test_a_school_holiday_condition_is_computed_per_day():
    rows = [{"name": "Sommerferien", "from": "2026-07-04", "to": "2026-08-09"}]
    ergebnis = simulieren(
        [{"type": "time", "at": "08:00"}],
        [
            {
                "type": "state",
                "entity_id": "schulferien.heute",
                "equals": "ferien",
            }
        ],
        "all",
        3,
        datetime(2026, 8, 10, 12, 0),
        LAT,
        LON,
        schulferien_rows=rows,
    )
    # 8.8. und 9.8. sind Ferien, der 10.8. ist wieder Schule.
    assert ergebnis["total"] == 2
    montag = next(t for t in ergebnis["days"] if t["date"] == "2026-08-10")
    assert montag["count"] == 0


def test_a_device_condition_is_reported_as_unchecked_upper_bound():
    """Was die Helligkeit vorgestern war, weiss heute niemand mehr - die
    Bedingung gilt als erfüllt und steht ausgewiesen in der Antwort."""
    ergebnis = simulieren(
        [{"type": "time", "at": "08:00"}],
        [{"type": "state", "entity_id": "demo.light_livingroom", "equals": "off"}],
        "all",
        2,
        SONNTAG_ABEND,
        LAT,
        LON,
    )
    assert ergebnis["total"] == 2
    assert ergebnis["unchecked_conditions"] == [
        {"type": "state", "entity_id": "demo.light_livingroom"}
    ]


def test_which_conditions_are_simulatable():
    assert bedingung_simulierbar({"type": "time", "weekdays": [0]}) is True
    assert bedingung_simulierbar({"type": "sun", "state": "down"}) is True
    assert (
        bedingung_simulierbar(
            {"type": "state", "entity_id": "schulferien.heute", "equals": "ferien"}
        )
        is True
    )
    assert (
        bedingung_simulierbar(
            {"type": "state", "entity_id": "demo.light_livingroom", "equals": "on"}
        )
        is False
    )
    # Eine Gruppe ist nur so gut wie ihr schwächstes Glied.
    assert (
        bedingung_simulierbar(
            {
                "type": "group",
                "conditions": [
                    {"type": "time"},
                    {"type": "state", "entity_id": "demo.a", "equals": "on"},
                ],
            }
        )
        is False
    )


def test_the_sun_condition_knows_day_and_night_for_a_past_moment():
    mittag = datetime(2026, 9, 2, 12, 0)
    mitternacht = datetime(2026, 9, 2, 0, 30)
    assert bedingung_gilt({"type": "sun", "state": "up"}, mittag, LAT, LON) is True
    assert bedingung_gilt({"type": "sun", "state": "up"}, mitternacht, LAT, LON) is False
    assert bedingung_gilt({"type": "sun", "state": "down"}, mitternacht, LAT, LON) is True


def test_the_simulation_route_answers_and_caps_the_days():
    from fastapi.testclient import TestClient

    from homepilot.api import create_app
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
            integrations=[{"integration": "demo"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        angelegt = client.post(
            "/api/automations",
            json={
                "alias": "Morgens",
                "trigger": [{"type": "time", "at": "06:30"}],
                "action": [
                    {"entity_id": "demo.light_livingroom", "command": "turn_on"}
                ],
            },
            headers=headers,
        ).json()["automation"]

        antwort = client.get(
            f"/api/automations/{angelegt['id']}/simulation?days=7", headers=headers
        )
        assert antwort.status_code == 200
        daten = antwort.json()
        assert len(daten["days"]) == 7
        assert daten["total"] >= 6  # heute zählt nur bis jetzt
        assert daten["not_simulatable"] == []

        # Obergrenze: mehr als ein Monat ist keine Simulation mehr.
        assert (
            client.get(
                f"/api/automations/{angelegt['id']}/simulation?days=40",
                headers=headers,
            ).status_code
            == 400
        )
        assert (
            client.get(
                "/api/automations/gibtsnicht/simulation?days=7", headers=headers
            ).status_code
            == 404
        )
