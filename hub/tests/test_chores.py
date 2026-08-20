"""Wiederkehrende Aufgaben und die Ämtli-Rotation."""

from datetime import date

from homepilot.core.chores import add_months, due_soon, next_due, rotate


def test_the_next_date_counts_from_the_old_one_not_from_today():
    """Wer den Montags-Abfall am Dienstag abhakt, will nicht künftig
    dienstags erinnert werden - sonst wandert der Termin mit jedem
    verspäteten Haken weiter durch die Woche."""
    # Frist Montag, abgehakt am Dienstag: nächste Frist bleibt Montag.
    assert next_due("2026-08-17", "weekly", today=date(2026, 8, 18)) == "2026-08-24"
    assert next_due("2026-08-20", "daily", today=date(2026, 8, 20)) == "2026-08-21"


def test_a_long_absence_does_not_pile_up_overdue_entries():
    """Nach zwei Wochen Ferien sollen nicht vierzehn überfällige Einträge
    dastehen, sondern der nächste Termin."""
    assert next_due("2026-08-01", "daily", today=date(2026, 8, 20)) == "2026-08-21"
    assert next_due("2026-06-01", "weekly", today=date(2026, 8, 20)) == "2026-08-24"


def test_monthly_keeps_the_end_of_month():
    """Der 31. Januar plus ein Monat ist der 28. Februar, nicht der 3. März -
    wer eine Frist auf den Monatsletzten legt, meint den Letzten."""
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2026, 3, 31), 1) == date(2026, 4, 30)
    assert next_due("2026-01-31", "monthly", today=date(2026, 2, 1)) == "2026-02-28"


def test_no_repeat_means_no_next_date():
    assert next_due("2026-08-20", "none") is None
    assert next_due("2026-08-20", "quatsch") is None


def test_rotation_hands_over_and_wraps_around():
    assert rotate(["Stefan", "Livia", "Levin"], "Stefan") == "Livia"
    assert rotate(["Stefan", "Livia", "Levin"], "Levin") == "Stefan"


def test_rotation_starts_over_when_the_person_is_gone():
    """Zieht jemand aus, bliebe die Reihe sonst für immer stehen."""
    assert rotate(["Stefan", "Livia"], "Wer-auch-immer") == "Stefan"
    assert rotate(["Stefan"], "Stefan") == "Stefan"
    assert rotate([], "Stefan") is None
    assert rotate(["  ", ""], "Stefan") is None


def test_due_soon_ignores_what_is_done():
    heute = date(2026, 8, 20)
    assert due_soon({"due": "2026-08-20"}, heute) is True
    assert due_soon({"due": "2026-08-19"}, heute) is True
    assert due_soon({"due": "2026-08-21"}, heute) is False
    assert due_soon({"due": "2026-08-19", "done": True}, heute) is False
    assert due_soon({}, heute) is False


def test_a_monthly_date_keeps_its_day_across_a_long_gap():
    """Der Fall, der nur beim Weiterrücken über mehrere Monate auffällt:
    Rechnet man vom zuletzt errechneten Datum, klemmt der Februar den 31.
    auf den 28. - und ab da bleibt es für immer der 28. Gerechnet wird
    deshalb ab dem Ausgangsdatum."""
    assert next_due("2026-01-31", "monthly", today=date(2026, 8, 20)) == "2026-08-31"
    assert next_due("2026-01-31", "monthly", today=date(2026, 2, 1)) == "2026-02-28"
