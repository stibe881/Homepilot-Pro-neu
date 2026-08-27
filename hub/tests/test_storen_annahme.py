"""Eine Store, die nie zurückmeldet, stand dauerhaft auf «offen».

Somfy RTS funkt nur in eine Richtung: Das Gateway schickt Befehle, das
Gerät meldet nie etwas. Der Hub wusste deshalb nichts, sagte «unknown» -
und die App machte daraus 100 % und schrieb «Offen» auf eine Store, die
seit gestern unten war.

Der letzte Befehl ist die beste Auskunft, die es gibt. Sie ist nicht
sicher, und deshalb reist `angenommen` mit.
"""

from __future__ import annotations

from homepilot.integrations.overkiz import annahme, cover_state


def test_zu_heisst_geschlossen():
    assert annahme("close") == {"position": 0, "state": "closed", "angenommen": True}


def test_auf_heisst_offen():
    assert annahme("open") == {"position": 100, "state": "open", "angenommen": True}


def test_eine_position_dazwischen_ist_teilweise():
    assert annahme("set_position", {"position": 40}) == {
        "position": 40,
        "state": "partial",
        "angenommen": True,
    }


def test_ausserhalb_der_skala_wird_eingefangen():
    """Ein Ablauf darf keine 150 % in den Zustand schreiben."""
    assert annahme("set_position", {"position": 150})["position"] == 100
    assert annahme("set_position", {"position": -20})["position"] == 0


def test_halt_ergibt_keine_annahme():
    """«Irgendwo dazwischen» ist keine Zahl – lieber nichts sagen."""
    assert annahme("stop") == {}
    assert annahme("set_tilt", {"tilt": 50}) == {}


def test_eine_meldung_des_geraets_raeumt_die_annahme_weg():
    """Sonst bliebe «angenommen» kleben, sobald es einmal dastand.

    `update_state` merged – ein Feld, das verschwinden muss, gehört
    ausdrücklich als None hinein (siehe core/registry.py).
    """
    gemeldet = cover_state({"core:ClosureState": 100})
    assert gemeldet["state"] == "closed"
    assert gemeldet["angenommen"] is None


def test_schweigen_ueberschreibt_die_annahme_nicht():
    """Der eigentliche Fehler: Nichts zu sagen ist keine Aussage."""
    assert cover_state({}) == {}
