"""Wohin ein Tipp auf eine Nachricht führt.

Der Mangel, den es behebt: «Milch steht auf der Einkaufsliste» öffnete
die App auf der Startseite - genauso wie «Wasser im Keller».
"""

from homepilot.core.pushziel import ZIELE, ziel_fuer
from homepilot.core.push import CATEGORIES


def test_jede_kategorie_hat_ein_ziel():
    """Sonst bleibt beim nächsten neuen Melder wieder jemand auf der
    Startseite stehen."""
    fehlend = sorted(set(CATEGORIES) - set(ZIELE))
    assert fehlend == []


def test_das_geraet_sticht_die_kategorie():
    # Ein offenes Fenster schliesst man im Raum, nicht in einer Liste.
    assert ziel_fuer("open", "zigbee.fenster") == "geraet:zigbee.fenster"
    assert ziel_fuer("leak", "zigbee.keller") == "geraet:zigbee.keller"


def test_ohne_geraet_bleibt_die_kategorie():
    assert ziel_fuer("open", None) == "offen"


def test_beim_sammelplatz_gewinnt_die_kategorie():
    """Batterie und ausgefallenes Gerät: Dort steht der Knopf zum
    Quittieren, und der ist der Grund, warum man tippt."""
    assert ziel_fuer("battery", "hue.a") == "batterien"
    assert ziel_fuer("device_down", "hue.a") == "sorgen"


def test_familie_kommt_in_ihre_kachel():
    assert ziel_fuer("shopping") == "familie:shopping"
    assert ziel_fuer("medication") == "familie:medications"


def test_ohne_kategorie_kein_ziel():
    # Abläufe entscheiden selbst, wohin es geht.
    assert ziel_fuer(None) is None
    assert ziel_fuer("") is None


def test_unbekannte_kategorie_faellt_durch():
    assert ziel_fuer("gibtsnicht") is None
