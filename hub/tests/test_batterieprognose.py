"""Batterie-Prognose: die Frage ist «wann kaufen?», nicht «wie viel Prozent?»."""

from datetime import date, timedelta

from homepilot.core.batterieprognose import (
    WOCHEN,
    aufnehmen,
    resttage,
    restwort,
)


def woechentlich(start: date, staende: list[float], entity_id: str = "demo.a") -> list:
    rows: list = []
    for index, stand in enumerate(staende):
        rows = aufnehmen(rows, entity_id, stand, start + timedelta(weeks=index))
    return rows


def test_ein_wert_je_woche_der_juengste_gewinnt():
    tag = date(2026, 8, 24)
    rows = aufnehmen([], "demo.a", 80.0, tag)
    rows = aufnehmen(rows, "demo.a", 79.0, tag + timedelta(days=2))
    assert len(rows) == 1
    assert rows[0]["percent"] == 79.0


def test_das_tempo_des_geraets_bestimmt_die_antwort():
    """Ein Prozent pro Woche heisst: bei 88 Prozent noch gut anderthalb
    Jahre - aber gedeckelt, weiter voraus ist geraten."""
    rows = woechentlich(date(2026, 1, 5), [94, 93, 92, 91, 90])
    tage = resttage(rows, "demo.a")
    assert tage is not None
    # 1 %/Woche bei 90 %: rund 630 Tage.
    assert 550 <= tage <= 730


def test_zwei_punkte_sind_keine_kurve():
    rows = woechentlich(date(2026, 1, 5), [94, 92])
    assert resttage(rows, "demo.a") is None


def test_ein_stabiler_stand_bekommt_keine_erfundene_frist():
    rows = woechentlich(date(2026, 1, 5), [90, 90, 90, 90])
    assert resttage(rows, "demo.a") is None


def test_der_wechsel_beginnt_eine_neue_reihe():
    """Die alte Batterie sagt nichts über die neue."""
    rows = woechentlich(date(2026, 1, 5), [20, 15, 10])
    rows = aufnehmen(rows, "demo.a", 100.0, date(2026, 1, 5) + timedelta(weeks=3))
    eigene = [row for row in rows if row["entity_id"] == "demo.a"]
    assert len(eigene) == 1
    assert eigene[0]["percent"] == 100.0


def test_die_reihe_bleibt_gedeckelt():
    rows = woechentlich(date(2025, 1, 6), [float(100 - i) for i in range(WOCHEN + 10)])
    assert len([row for row in rows if row["entity_id"] == "demo.a"]) == WOCHEN


def test_die_worte_bleiben_grob():
    assert restwort(None) is None
    assert restwort(7) == "reicht noch wenige Tage"
    assert restwort(42) == "reicht noch ~6 Wochen"
    assert restwort(200) == "reicht noch ~7 Monate"
