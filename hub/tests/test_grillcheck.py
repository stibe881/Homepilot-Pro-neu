"""Warum der Grill nicht antwortet - und ob die Live-Karte käme.

Der Anlass: «Die Pit-Boss-Integration funktioniert nicht. Der Smoker ist
eingeschaltet und läuft.» Unter «Ausfälle» stand «noch ausgefallen» und
sonst nichts.
"""

from __future__ import annotations

from homepilot.grillcheck import kartenlage
from homepilot.integrations.pitboss import fehlergrund


def test_die_zeitueberschreitung_sagt_wo_man_nachsieht():
    """`TimeoutError()` hat gar keinen Text.

    Auf der Kachel stünde damit «Fehler lokal über 10.10.1.60: » - ein
    Doppelpunkt und nichts dahinter.
    """
    satz = fehlergrund(TimeoutError(), "lokal über 10.10.1.60")
    assert "10.10.1.60" in satz
    assert "Strom" in satz


def test_die_verbindung_nennt_den_weg_und_den_grund():
    satz = fehlergrund(ConnectionRefusedError("Connection refused"), "lokal über 10.10.1.60")
    assert "Keine Verbindung lokal über 10.10.1.60" in satz
    assert "Connection refused" in satz


def test_ein_namenloser_fehler_nennt_wenigstens_seine_art():
    """Sonst steht dort ein Satz, der mitten im Wort aufhört."""
    class Eigenartig(Exception):
        pass

    assert "Eigenartig" in fehlergrund(Eigenartig(), "über die Pit-Boss-Wolke")


def test_die_live_karte_erscheint_wenn_alles_stimmt():
    lage = kartenlage({"state": "running", "target": 110}, True)
    assert lage.startswith("Live-Karte: erscheint (")


def test_die_live_karte_sagt_warum_sie_fehlt():
    """Die zweite Hälfte derselben Frage - und meist dieselbe Antwort.

    «Ich möchte auch so eine Live-Aktivität»: Die gibt es längst
    (core/livekarten.py, karten_grill), sie hängt nur an denselben
    Werten wie die Kachel.
    """
    lage = kartenlage({"state": "off", "target": None}, False)
    assert "erscheint nicht" in lage
    assert "nicht erreichbar" in lage
    assert "«off»" in lage
    assert "Temperaturziel" in lage
