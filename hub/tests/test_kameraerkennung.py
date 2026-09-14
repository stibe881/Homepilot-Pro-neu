"""Erkennungen der Kameras: wann sie vorbei sind."""

from homepilot.integrations.unifi_protect import erkennung_abgestanden


def test_eine_erkennung_ohne_ende_verjaehrt():
    """Punkt 578: «Diese Bewegung war aber vor fast einer Stunde.» Geht
    die Ende-Meldung verloren, muss die Abfrage nach einer Höchstdauer
    aufräumen dürfen - sonst steht das Männchen den ganzen Abend."""
    assert erkennung_abgestanden(1000.0, 1000.0 + 60) is False
    assert erkennung_abgestanden(1000.0, 1000.0 + 6 * 60) is True
    # Ohne bekannten Anfang gilt sie als vorbei - ein Rest aus einer
    # früheren Fassung, den niemand mehr beenden könnte.
    assert erkennung_abgestanden(None, 1000.0) is True
