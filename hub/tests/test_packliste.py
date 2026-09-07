"""Die Packliste der Kinder: Was morgen in den Thek gehört."""

from datetime import date

from homepilot.core import packliste

# 2026-09-08 ist ein Dienstag in KW 37 (ungerade → Woche A).
DIENSTAG_A = date(2026, 9, 8)
DIENSTAG_B = date(2026, 9, 15)

GEAR = [
    {"member": "Levin", "text": "Turnsack", "day": "Di"},
    {"member": "Levin", "text": "Flöte", "day": "Di", "week": "A"},
    {"member": "Lina", "text": "Malschürze", "day": "Di"},
    {"member": "Levin", "text": "Fussballschuhe", "day": "Mi"},
    {"member": "", "text": "Herrenlos", "day": "Di"},
]


def test_tomorrows_gear_respects_day_and_ab_week():
    zeilen = packliste.morgen_zeilen(GEAR, DIENSTAG_A)
    assert zeilen == {"Levin": ["Turnsack", "Flöte"], "Lina": ["Malschürze"]}
    # In der B-Woche bleibt die Flöte zuhause.
    zeilen = packliste.morgen_zeilen(GEAR, DIENSTAG_B)
    assert zeilen["Levin"] == ["Turnsack"]
    assert packliste.morgen_zeilen(None, DIENSTAG_A) == {}


def test_the_evening_sentence_reads_like_a_person_wrote_it():
    assert packliste.satz({"Levin": ["Turnsack", "Flöte"], "Lina": ["Malschürze"]}) == (
        "Levin: Turnsack und Flöte · Lina: Malschürze"
    )
    # Bei einem Kind fällt die Doppelpunkt-Liste weg - wessen Thek
    # gemeint ist, ist dann keine Frage.
    assert packliste.satz({"Levin": ["Turnsack"]}) == "Levin braucht morgen: Turnsack."
    assert packliste.satz({}) is None


def test_the_ab_week_matches_the_app():
    """Dieselbe Rechnung wie lib/kindseite.ts (ungerade ISO-Woche = A) -
    zwei verschiedene Rechnungen wären irgendwann zwei Wochen."""
    assert packliste.woche_von(date(2026, 9, 8)) == "A"  # KW 37
    assert packliste.woche_von(date(2026, 9, 15)) == "B"  # KW 38
    assert packliste.tag_von(date(2026, 9, 8)) == "Di"
