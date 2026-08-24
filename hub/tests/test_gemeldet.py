"""Was schon gemeldet wurde – über den Neustart hinweg.

Der Fall: «Die Geburtstagsbenachrichtigung ist zwei Mal gekommen.» Der
Wächter merkte sich im Arbeitsspeicher, was heute schon raus ist, und
jeder Hub-Neustart setzte das zurück.
"""

from homepilot.core import gemeldet


def test_eine_marke_gilt_nur_einmal():
    rows = gemeldet.merke([], "birthday:2026-08-24", 1000.0)
    assert gemeldet.schon(rows, "birthday:2026-08-24")
    assert not gemeldet.schon(rows, "birthday:2026-08-25")


def test_dieselbe_marke_legt_keine_zweite_zeile_an():
    rows = gemeldet.merke([], "frost:2026-01-05", 1000.0)
    rows = gemeldet.merke(rows, "frost:2026-01-05", 2000.0)
    assert len(rows) == 1
    assert rows[0]["at"] == 2000.0


def test_altes_wird_vergessen():
    """Sonst wüchse die Datei mit jedem Tag, den der Hub läuft."""
    jetzt = 10_000_000.0
    alt = [{"mark": "birthday:alt", "at": jetzt - 41 * 24 * 3600}]
    rows = gemeldet.merke(alt, "birthday:neu", jetzt)
    assert [row["mark"] for row in rows] == ["birthday:neu"]


def test_frisches_bleibt_liegen():
    jetzt = 10_000_000.0
    frisch = [{"mark": "birthday:gestern", "at": jetzt - 24 * 3600}]
    rows = gemeldet.merke(frisch, "birthday:heute", jetzt)
    assert sorted(row["mark"] for row in rows) == ["birthday:gestern", "birthday:heute"]


def test_kaputte_zeilen_stören_nicht():
    jetzt = 1000.0
    rows = gemeldet.merke(["Unsinn", {"ohne": "marke"}, None], "x", jetzt)
    assert gemeldet.schon(rows, "x")
    assert not gemeldet.schon(None, "x")
    assert not gemeldet.schon([{"mark": "x"}], "")
