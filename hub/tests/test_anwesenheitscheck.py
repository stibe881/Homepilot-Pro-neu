"""Warum hat die Anlage erst um 16:51 scharf geschaltet?

Der gemeldete Fall (Punkt 638 der Werkbank): «Diese Meldungen sind um
16:51 gekommen. Es ist aber seit ca. 13:00 niemand mehr zuhause.»
"""

from homepilot.anwesenheitscheck import alter, uhr


def test_das_alter_wird_ab_einer_stunde_in_stunden_gelesen():
    """«vor 13860 s» beantwortet die Frage nicht, um die es geht."""
    assert alter(30) == "vor 30 s"
    assert alter(600) == "vor 10 min"
    assert alter(13860) == "vor 3 Std 51 min"


def test_ohne_meldung_bleibt_ein_strich():
    """Ein Telefon, von dem nie etwas kam, soll nicht «vor 0 s» heissen -
    das läse sich wie eine frische Meldung."""
    assert alter(None) == "–"
    assert uhr(None) == "?"
    assert uhr("kaputt") == "?"
