"""Wartungserinnerungen: Filter, Batterien, Entkalken."""

from datetime import date

from homepilot.core.maintenance import (
    clean_interval,
    describe,
    due_items,
    next_after,
)


def test_the_clock_restarts_when_it_was_actually_done():
    """Wer den Filter drei Wochen zu spät wechselt, hat danach wieder ein
    volles halbes Jahr - bei Verschleiss zählt, wann es getan wurde, nicht
    wann es geplant war. Genau umgekehrt als bei den wiederkehrenden
    Aufgaben, wo der Montags-Abfall montags bleiben soll."""
    assert next_after("2026-08-20", 180) == "2027-02-16"
    assert next_after("2026-08-20", 30) == "2026-09-19"


def test_a_nonsense_interval_becomes_something_usable():
    """Ein Eintrag ohne brauchbares Intervall taucht sonst nie wieder auf -
    lieber eine Erinnerung zu viel."""
    assert clean_interval(0) == 90
    assert clean_interval(-5) == 90
    assert clean_interval("quatsch") == 90
    assert clean_interval(None) == 90
    # Und nach oben gedeckelt: alles über fünf Jahre ist ein Tippfehler.
    assert clean_interval(99999) == 1825
    assert clean_interval(180) == 180


def test_reminders_come_early_enough_to_act_on():
    """Ein Filter, den man erst am Stichtag bestellt, ist zu spät
    bestellt."""
    heute = date(2026, 8, 20)
    zeilen = [
        {"text": "Wasserfilter", "due": "2026-08-25"},   # in 5 Tagen
        {"text": "Kalkschutz", "due": "2026-08-18"},     # 2 Tage überfällig
        {"text": "Lüftung", "due": "2026-12-01"},        # weit weg
        {"text": "Ohne Frist"},
    ]
    faellig = due_items(zeilen, heute)
    # Überfälliges zuerst, Fernes gar nicht.
    assert [row["text"] for row in faellig] == ["Kalkschutz", "Wasserfilter"]
    assert faellig[0]["days_left"] == -2


def test_the_wording_says_how_dringend_it_is():
    assert "seit 2 Tagen fällig" in describe({"text": "Kalk", "days_left": -2})
    assert "heute fällig" in describe({"text": "Kalk", "days_left": 0})
    assert "in 5 Tagen" in describe({"text": "Kalk", "days_left": 5})
