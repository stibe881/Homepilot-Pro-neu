"""Luzerner Feiertage - offline berechnet, Ostern nach Gauss."""

from datetime import date

from homepilot.core.feiertage import feiertage, ist_feiertag, ostern


def test_easter_dates_match_the_calendar():
    """Die Osterformel gegen bekannte Jahre - falsch gerechnet wäre jeder
    bewegliche Feiertag falsch."""
    assert ostern(2024) == date(2024, 3, 31)
    assert ostern(2025) == date(2025, 4, 20)
    assert ostern(2026) == date(2026, 4, 5)
    assert ostern(2038) == date(2038, 4, 25)  # der späteste mögliche Termin


def test_the_moving_holidays_hang_on_easter():
    tage = feiertage(2026)
    assert tage[date(2026, 4, 3)] == "Karfreitag"
    assert tage[date(2026, 4, 6)] == "Ostermontag"
    assert tage[date(2026, 5, 14)] == "Auffahrt"
    assert tage[date(2026, 5, 25)] == "Pfingstmontag"
    assert tage[date(2026, 6, 4)] == "Fronleichnam"


def test_fixed_days_and_ordinary_days():
    assert ist_feiertag(date(2026, 8, 1)) is True  # Bundesfeier
    assert ist_feiertag(date(2026, 12, 26)) is True  # Stephanstag
    assert ist_feiertag(date(2026, 8, 22)) is False  # ein gewöhnlicher Samstag
    # Tag der Arbeit ist in Luzern KEIN gesetzlicher Feiertag.
    assert ist_feiertag(date(2026, 5, 1)) is False
