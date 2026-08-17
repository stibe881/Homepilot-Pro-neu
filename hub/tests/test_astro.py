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


# ── Sonnenstand für die Beschattung ────────────────────────────────────────


def test_the_sun_stands_in_the_south_at_noon():
    """Nicht die Uhrzeit entscheidet, sondern die Himmelsrichtung: Im
    Sommer steht die Sonne um acht Uhr längst am Himmel, aber im Osten."""
    from datetime import datetime, timezone

    from homepilot.core.astro import sun_position

    # 21. Juni, 12:00 UTC über Zell LU – Sonnenhöchststand knapp danach.
    mittag = datetime(2026, 6, 21, 12, 0, tzinfo=timezone.utc)
    elevation, azimuth = sun_position(mittag, 47.1445, 8.0675)
    assert 60 < elevation < 70          # hoch im Sommer
    assert 160 < azimuth < 200          # ungefähr Süden

    morgen = datetime(2026, 6, 21, 5, 0, tzinfo=timezone.utc)
    elevation, azimuth = sun_position(morgen, 47.1445, 8.0675)
    assert 0 < elevation < 25           # noch flach
    assert 60 < azimuth < 100           # im Osten


def test_the_sun_is_below_the_horizon_at_night():
    from datetime import datetime, timezone

    from homepilot.core.astro import sun_position

    nacht = datetime(2026, 1, 15, 1, 0, tzinfo=timezone.utc)
    elevation, _ = sun_position(nacht, 47.1445, 8.0675)
    assert elevation < 0


def test_an_arc_may_cross_north():
    """Ein Bereich von 350 bis 20 Grad ist an einer schräg stehenden
    Fassade der Normalfall, keine Ausnahme."""
    from homepilot.core.astro import within_arc

    assert within_arc(0, 350, 20)
    assert within_arc(355, 350, 20)
    assert within_arc(15, 350, 20)
    assert not within_arc(180, 350, 20)
    # Und der gewöhnliche Fall bleibt gewöhnlich.
    assert within_arc(150, 90, 200)
    assert not within_arc(220, 90, 200)
