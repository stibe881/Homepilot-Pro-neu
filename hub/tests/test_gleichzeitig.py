"""Der Stempel-Vergleich hinter Punkt 341 - rein und für sich."""

from homepilot.core.gleichzeitig import stempel_passt


def test_gleiche_stempel_passen():
    assert stempel_passt(100.0, 100.0) is True


def test_unterschiedliche_stempel_passen_nicht():
    assert stempel_passt(100.0, 99.0) is False


def test_ein_fehlender_erwarteter_stempel_wird_nicht_geprueft():
    # Ältere App-Fassung oder ein Eintrag ohne bisherigen Stempel - der
    # weiche Übergang, kein Freibrief für alle Zeit.
    assert stempel_passt(100.0, None) is True
    assert stempel_passt(None, None) is True
