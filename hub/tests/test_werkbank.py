"""Die beiden Werkbank-Dateien (Punkt 505 der Werkbank).

Die Nummernregel ist die älteste Abmachung im Repo: «Punkt NNN der
Werkbank» im Code zeigt auf genau diese Nummer, deshalb wird nie
umnummeriert. Seit die Liste in «offen» und «erledigt» geteilt ist, gibt
es zwei Arten, sie zu brechen - doppelt einsortieren und eine Nummer
zweimal vergeben -, und beide sehen in der einzelnen Datei richtig aus.
"""

import importlib.util
from pathlib import Path

import pytest

WURZEL = Path(__file__).resolve().parent.parent.parent


def _werkbank():
    pfad = WURZEL / "scripts" / "werkbank.py"
    spec = importlib.util.spec_from_file_location("werkbank", pfad)
    assert spec is not None and spec.loader is not None
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


werkbank = _werkbank()


def test_keine_nummer_steht_in_beiden_dateien():
    """Der Fall: Beim Erledigen wird kopiert statt verschoben. Danach
    steht ein Punkt in «offen» und in «erledigt», und beide Dateien
    sehen für sich richtig aus."""
    offen = werkbank.nummern(werkbank.OFFEN)
    archiv = werkbank.nummern(werkbank.ARCHIV)
    assert werkbank.pruefen(offen, archiv) == []


def test_keine_nummer_wird_zweimal_vergeben():
    """Ein späterer «Punkt 273» zeigte sonst im Code auf etwas anderes
    als gemeint - auch bei Nummern, die nie gebaut wurden."""
    alle = werkbank.nummern(werkbank.OFFEN) + werkbank.nummern(werkbank.ARCHIV)
    assert len(alle) == len(set(alle))


def test_die_offene_liste_bleibt_kurz():
    """Der Sinn der Teilung: «Was ist offen?» in dreissig Sekunden. Vier
    Kapitel Begründung, die wieder hineinwachsen, machen die Frage
    wieder unbeantwortbar - dann gehört erledigt, was erledigt ist."""
    zeilen = werkbank.OFFEN.read_text(encoding="utf-8").count("\n")
    assert zeilen < 900, f"werkbank.md hat {zeilen} Zeilen - ins Archiv damit"


@pytest.mark.parametrize(
    "offen, archiv, erwartet",
    [
        ([1, 2], [3], 0),
        ([1, 2], [2], 1),  # in beiden
        ([1, 1], [2], 1),  # doppelt in einer
    ],
)
def test_die_pruefung_meldet_genau_die_beiden_faelle(offen, archiv, erwartet):
    assert len(werkbank.pruefen(offen, archiv)) == erwartet
