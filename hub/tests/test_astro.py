"""Sonnenauf-/-untergang – Plausibilität für Zell LU."""

from datetime import date, datetime

from homepilot.core import astro

ZELL = (47.1445, 8.0675)


def test_sommer_reihenfolge_und_taglaenge():
    # Zeitzonenunabhängig: Reihenfolge und Taglänge, nicht die Ortszeit
    # (die vom TZ der Testmaschine abhängt).
    day = date(2026, 8, 15)
    rise = astro.sun_event(day, *ZELL, sunset=False)
    set_ = astro.sun_event(day, *ZELL, sunset=True)
    assert rise is not None and set_ is not None
    assert rise < set_
    hours = (set_ - rise).total_seconds() / 3600
    assert 13.5 < hours < 15  # Mitte August in der Schweiz ~14 h Tag


def test_winter_tag_kuerzer_als_sommer():
    summer = date(2026, 6, 21)
    winter = date(2026, 12, 21)
    s_len = (
        astro.sun_event(summer, *ZELL, sunset=True)
        - astro.sun_event(summer, *ZELL, sunset=False)
    ).total_seconds()
    w_len = (
        astro.sun_event(winter, *ZELL, sunset=True)
        - astro.sun_event(winter, *ZELL, sunset=False)
    ).total_seconds()
    assert s_len > w_len


def test_next_event_ist_in_der_zukunft():
    now = datetime(2026, 8, 15, 12, 0, 0)
    nxt = astro.next_sun_event(now, *ZELL, sunset=True, offset_minutes=-30)
    assert nxt is not None and nxt > now


def test_offset_verschiebt():
    now = datetime(2026, 8, 15, 0, 0, 0)
    base = astro.next_sun_event(now, *ZELL, sunset=True, offset_minutes=0)
    early = astro.next_sun_event(now, *ZELL, sunset=True, offset_minutes=-30)
    assert (base - early).total_seconds() == 30 * 60
