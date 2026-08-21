"""Farbtemperatur-Kurve der adaptiven Beleuchtung."""

from datetime import datetime

from homepilot.integrations.adaptive import target_mirek


def test_warm_bei_nacht():
    rise = datetime(2026, 8, 15, 6, 30)
    set_ = datetime(2026, 8, 15, 20, 40)
    nachts = datetime(2026, 8, 15, 3, 0)
    assert target_mirek(nachts, rise, set_, 400, 220) == 400


def test_kalt_zur_mittagssonne():
    rise = datetime(2026, 8, 15, 6, 30)
    set_ = datetime(2026, 8, 15, 20, 40)
    noon = rise + (set_ - rise) / 2
    assert target_mirek(noon, rise, set_, 400, 220) == 220


def test_zwischen_horizont_und_mittag():
    rise = datetime(2026, 8, 15, 6, 30)
    set_ = datetime(2026, 8, 15, 20, 40)
    mid_morning = rise + (set_ - rise) / 4  # ein Viertel in den Tag
    value = target_mirek(mid_morning, rise, set_, 400, 220)
    assert 220 < value < 400


def test_ohne_sonnenzeiten_warm():
    now = datetime(2026, 8, 15, 12, 0)
    assert target_mirek(now, None, None, 400, 220) == 400
