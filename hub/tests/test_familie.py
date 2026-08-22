"""Erinnerungen aus den Familien-Listen: Gabe, Geburtstag, Notfallblatt.

Alles reines Rechnen – das ist die Stelle, an der die Fehler entstehen,
die man sonst erst bemerkt, wenn die Nachricht ausbleibt.
"""

from datetime import date

from homepilot.core import familie


def test_a_cure_defaults_to_one_dose_in_the_morning():
    """Was schon eingetragen ist, hatte keine Tageszeiten – und soll
    weiter stimmen."""
    assert familie.slots_of({}) == ["morgens"]
    assert familie.slots_of({"times": []}) == ["morgens"]
    assert familie.slots_of({"times": ["abends", "morgens"]}) == ["morgens", "abends"]
    # Unsinn fällt heraus statt durchzurutschen.
    assert familie.slots_of({"times": ["irgendwann"]}) == ["morgens"]


def test_the_old_shape_of_taken_still_counts():
    """Früher war «taken» eine Liste von Tagen – ein Haken je Tag.

    Solche Einträge gibt es noch. Ein abgehakter Tag von damals gilt als
    vollständig genommen, sonst stünde eine beendete Kur plötzlich wieder
    offen da.
    """
    alt = {"taken": ["2026-08-19", "2026-08-20"], "days": 3}
    assert familie.taken_map(alt) == {
        "2026-08-19": ["morgens"],
        "2026-08-20": ["morgens"],
    }
    assert familie.days_done(alt) == 2
    assert familie.is_finished(alt) is False

    neu = {
        "times": ["morgens", "abends"],
        "taken": {"2026-08-20": ["morgens", "abends"], "2026-08-21": ["morgens"]},
        "days": 2,
    }
    # Nur der vollständige Tag zählt.
    assert familie.days_done(neu) == 1


def test_a_dose_is_only_due_once_its_time_has_come():
    """Die Abendgabe um acht Uhr morgens zu melden macht aus einer
    Erinnerung eine Liste, die man wegwischt."""
    med = {"id": "m1", "text": "Amoxi", "times": ["morgens", "abends"], "days": 5}
    assert familie.open_slots(med, "2026-08-21", 7) == []
    assert familie.open_slots(med, "2026-08-21", 9) == ["morgens"]
    assert familie.open_slots(med, "2026-08-21", 19) == ["morgens", "abends"]

    med["taken"] = {"2026-08-21": ["morgens"]}
    assert familie.open_slots(med, "2026-08-21", 19) == ["abends"]
    med["taken"] = {"2026-08-21": ["morgens", "abends"]}
    assert familie.open_slots(med, "2026-08-21", 19) == []


def test_a_finished_cure_stops_reminding():
    """Sonst erinnerte sie bis in alle Ewigkeit weiter."""
    med = {
        "text": "Tropfen",
        "days": 2,
        "taken": {"2026-08-20": ["morgens"], "2026-08-21": ["morgens"]},
    }
    assert familie.is_finished(med) is True
    assert familie.open_slots(med, "2026-08-22", 10) == []
    # Von Hand beendet zählt auch.
    assert familie.is_finished({"done": True}) is True


def test_due_medications_and_their_wording():
    meds = [
        {"id": "a", "text": "Amoxi", "dose": "5 ml", "member": "Lina", "times": ["abends"]},
        {"id": "b", "text": "Salbe", "times": ["morgens"], "taken": {"2026-08-21": ["morgens"]}},
        "kaputt",
    ]
    faellig = familie.due_medications(meds, "2026-08-21", 19)
    assert [med["id"] for med, _ in faellig] == ["a"]
    assert familie.describe(meds[0], ["abends"]) == "Amoxi 5 ml – abends für Lina"


def test_birthdays_ignore_the_year_and_handle_the_29th():
    kontakte = [
        {"text": "Livia", "birthday": "21.08.1985"},
        {"text": "Levin", "birthday": "2016-08-21"},
        {"text": "Lina", "birthday": "29.02.2020"},
        {"text": "Ohne", "birthday": ""},
        {"text": "Unsinn", "birthday": "irgendwann"},
    ]
    heute = familie.birthdays_on(kontakte, date(2026, 8, 21))
    assert [k["text"] for k in heute] == ["Livia", "Levin"]

    # Am 29. Februar Geborene bekommen ihren Gruss im Nicht-Schaltjahr am 28.
    assert [k["text"] for k in familie.birthdays_on(kontakte, date(2026, 2, 28))] == ["Lina"]
    # Im Schaltjahr am richtigen Tag – und am 28. dann nicht.
    assert [k["text"] for k in familie.birthdays_on(kontakte, date(2028, 2, 29))] == ["Lina"]
    assert familie.birthdays_on(kontakte, date(2028, 2, 28)) == []


def test_an_unchecked_emergency_sheet_is_overdue():
    heute = date(2026, 8, 21)
    assert familie.emergency_stale(None, heute) is True
    assert familie.emergency_stale("2026-08-01", heute) is False
    assert familie.emergency_stale("2024-01-01", heute) is True
    # Unlesbares Datum zählt als ungeprüft – lieber einmal zu viel fragen.
    assert familie.emergency_stale("irgendwann", heute) is True
