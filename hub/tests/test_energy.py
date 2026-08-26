"""Tagesverbrauch mitschreiben und Monate vergleichen.

Die Zähler der Messsteckdosen setzen sich um Mitternacht zurück – ohne
Mitschrift ist der gestrige Verbrauch danach für immer weg.
"""

from homepilot.core.energy import (
    month_totals,
    previous_month,
    record_day,
    total_today,
)


class FakeEntity:
    def __init__(self, state):
        self.state = state


def test_only_meters_count():
    entities = [
        FakeEntity({"energy_today": 1.5}),
        FakeEntity({"energy_today": "0.25"}),
        FakeEntity({"state": "on"}),
        FakeEntity({"energy_today": None}),
    ]
    assert total_today(entities) == 1.75


def test_a_negative_reading_is_a_measuring_error_not_a_credit():
    assert total_today([FakeEntity({"energy_today": -3})]) == 0.0


def test_the_highest_value_of_the_day_wins():
    """Der zuletzt gesehene Wert wäre nach Mitternacht eine 0 – und der
    Vortag damit für immer verloren."""
    days = record_day([], "2026-08-17", 2.4)
    days = record_day(days, "2026-08-17", 5.1)
    days = record_day(days, "2026-08-17", 0.0)
    assert days == [{"day": "2026-08-17", "kwh": 5.1}]


def test_days_stay_sorted_and_bounded():
    days: list[dict] = []
    for number in range(1, 29):
        days = record_day(days, f"2026-01-{number:02d}", number)
    assert days[0]["day"] == "2026-01-01"
    assert days[-1]["day"] == "2026-01-28"
    assert len(days) == 28


def test_recording_leaves_the_original_list_alone():
    """Sonst stünde die Änderung schon in der Datei, bevor sie geschrieben
    ist – und ein Fehler beim Schreiben bliebe unbemerkt."""
    days = [{"day": "2026-08-17", "kwh": 1.0}]
    record_day(days, "2026-08-17", 9.0)
    assert days == [{"day": "2026-08-17", "kwh": 1.0}]


def test_january_looks_back_into_the_old_year():
    assert previous_month("2026-01") == "2025-12"
    assert previous_month("2026-08") == "2026-07"


def test_the_same_period_is_compared_not_a_half_month_with_a_whole_one():
    days = [
        # Vormonat: 10 Tage à 1 kWh, danach noch einmal 20.
        *[{"day": f"2026-07-{number:02d}", "kwh": 1.0} for number in range(1, 11)],
        {"day": "2026-07-20", "kwh": 20.0},
        # Dieser Monat: drei Tage.
        {"day": "2026-08-01", "kwh": 2.0},
        {"day": "2026-08-02", "kwh": 3.0},
        {"day": "2026-08-03", "kwh": 1.0},
    ]
    result = month_totals(days, "2026-08-03")
    assert result["month"] == "2026-08"
    assert result["last_month"] == "2026-07"
    assert result["this_month_kwh"] == 6.0
    assert result["last_month_kwh"] == 30.0
    # Nur der 1. bis 3. Juli – sonst sähe der 3. August nach einer Ersparnis
    # von 80 % aus, obwohl doppelt so viel verbraucht wurde.
    assert result["last_month_so_far_kwh"] == 3.0
    assert [entry["day"] for entry in result["days"]] == [
        "2026-08-01",
        "2026-08-02",
        "2026-08-03",
    ]


def test_without_any_history_nothing_breaks():
    result = month_totals([], "2026-08-03")
    assert result["this_month_kwh"] == 0.0
    assert result["last_month_kwh"] == 0.0
    assert result["days"] == []


def test_broken_entries_are_skipped_not_guessed():
    days = [{"day": "2026-08-01", "kwh": "viel"}, {"kwh": 3}, {"day": "2026-08-02", "kwh": 2}]
    assert month_totals(days, "2026-08-05")["this_month_kwh"] == 2.0


def test_forecast_projects_from_the_daily_average():
    """Hochgerechnet wird mit dem Schnitt, nicht mit dem letzten Tag - ein
    Waschtag hochgerechnet ergäbe eine Zahl, die niemanden weiterbringt."""
    from homepilot.core.energy import forecast

    totals = {"month": "2026-04", "this_month_kwh": 30.0}
    result = forecast(totals, "2026-04-10")
    assert result["per_day_kwh"] == 3.0
    assert result["days_total"] == 30
    assert result["projected_kwh"] == 90.0


def test_days_in_month_handles_february_and_december():
    from homepilot.core.energy import days_in_month

    assert days_in_month("2026-02") == 28
    assert days_in_month("2024-02") == 29
    assert days_in_month("2026-12") == 31


def test_year_ago_is_zero_without_data():
    from homepilot.core.energy import year_ago

    days = [{"day": "2025-08-01", "kwh": 4.0}, {"day": "2025-08-02", "kwh": 6.0}]
    assert year_ago(days, "2026-08") == 10.0
    # Kein Vorjahr vorhanden: 0 heisst «wissen wir nicht», keine Ersparnis.
    assert year_ago(days, "2026-03") == 0.0


class _Meter:
    def __init__(self, entity_id, name, kwh=None, watts=None, room=None):
        self.id = entity_id
        # `label` ist, was ein Mensch liest - bei einer echten Entität der
        # selbst vergebene Name, sonst der der Integration.
        self.name = self.label = name
        self.room = room
        self.state = {}
        if kwh is not None:
            self.state["energy_today"] = kwh
        if watts is not None:
            self.state["power"] = watts


def test_top_consumers_ranks_by_energy():
    from homepilot.core.energy import top_consumers

    rows = top_consumers(
        [
            _Meter("a", "Tumbler", kwh=2.4),
            _Meter("b", "Router", kwh=0.3),
            _Meter("c", "Sensor"),  # ohne Zähler
            _Meter("d", "Kühlschrank", kwh=1.1),
        ]
    )
    assert [row["name"] for row in rows] == ["Tumbler", "Kühlschrank", "Router"]


def test_standby_costs_ignores_the_extremes():
    from homepilot.core.energy import standby_costs

    rows = standby_costs(
        [
            _Meter("a", "Fernseher aus", watts=12.0),
            _Meter("b", "Messfehler", watts=0.4),  # zu klein
            _Meter("c", "Backofen", watts=2200.0),  # kein Standby
            _Meter("d", "Router", watts=8.0),
        ],
        price_per_kwh=0.28,
    )
    assert [row["name"] for row in rows] == ["Fernseher aus", "Router"]
    # 12 W rund um die Uhr sind gut 105 kWh im Jahr.
    assert rows[0]["kwh_year"] == 105.1
    assert rows[0]["cost_year"] == 29.43


def test_hourly_counter_readings_become_usage_per_hour():
    """Gespeichert sind Zählerstände, die Anzeige will Differenzen – und
    eine ausgefallene Stunde trägt ihren Nachholwert, statt geglättet zu
    werden."""
    from homepilot.core.energy import HOUR_LIMIT, hourly_usage, record_hour

    hours: list = []
    # Zählerstände über den Morgen: 0.4 → 0.9 → (Loch) → 2.1 kWh.
    hours = record_hour(hours, "2026-08-22", 7, 0.4)
    hours = record_hour(hours, "2026-08-22", 8, 0.9)
    hours = record_hour(hours, "2026-08-22", 10, 2.1)
    # Zweimal dieselbe Stunde: der Höchststand gewinnt.
    hours = record_hour(hours, "2026-08-22", 10, 1.8)
    # Ein anderer Tag stört nicht.
    hours = record_hour(hours, "2026-08-21", 23, 9.9)

    verlauf = hourly_usage(hours, "2026-08-22")
    assert verlauf == [
        {"hour": 7, "kwh": 0.4},
        {"hour": 8, "kwh": 0.5},
        {"hour": 10, "kwh": 1.2},
    ]

    # Die Liste bleibt bei zwei Tagen Stunden gedeckelt.
    for hour in range(24):
        hours = record_hour(hours, "2026-08-23", hour, hour * 0.1 + 0.1)
        hours = record_hour(hours, "2026-08-24", hour, hour * 0.1 + 0.1)
        hours = record_hour(hours, "2026-08-25", hour, hour * 0.1 + 0.1)
    assert len(hours) == HOUR_LIMIT
    # Und was hinausfällt, ist das Älteste.
    assert all(entry["day"] >= "2026-08-24" for entry in hours)
