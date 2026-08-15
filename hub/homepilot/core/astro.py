"""Sonnenauf- und -untergang – reine Berechnung, ohne Zusatzbibliothek.

Nach der klassischen „Sunrise equation" (NOAA/Almanac). Rückgabe sind lokale
naive datetimes, passend zum Rest der Engine, die mit ``datetime.now()``
rechnet. Die Umrechnung UTC→lokal übernimmt das Betriebssystem über den
POSIX-Zeitstempel (inkl. Sommerzeit).
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

# Offizieller Zenit inkl. atmosphärischer Refraktion und Sonnenscheibe.
ZENITH = 90.833


def _norm(value: float, span: float) -> float:
    return value % span


def _event_ut_hours(day: date, lat: float, lon: float, sunset: bool) -> float | None:
    """Stunden (UT) des Ereignisses am Kalendertag ``day`` – oder None (Polar)."""
    n = day.toordinal() - date(day.year, 1, 1).toordinal() + 1
    lng_hour = lon / 15.0
    t = n + ((18 if sunset else 6) - lng_hour) / 24.0

    m = 0.9856 * t - 3.289
    # Wahre Länge der Sonne, auf 0…360 normiert.
    lsun = _norm(
        m + 1.916 * math.sin(math.radians(m)) + 0.020 * math.sin(math.radians(2 * m)) + 282.634,
        360.0,
    )

    # Rektaszension in dieselbe Quadrantenlage wie Lsun bringen.
    ra = _norm(math.degrees(math.atan(0.91764 * math.tan(math.radians(lsun)))), 360.0)
    ra += (math.floor(lsun / 90.0) * 90.0) - (math.floor(ra / 90.0) * 90.0)
    ra /= 15.0

    sin_dec = 0.39782 * math.sin(math.radians(lsun))
    cos_dec = math.cos(math.asin(sin_dec))
    cos_h = (math.cos(math.radians(ZENITH)) - sin_dec * math.sin(math.radians(lat))) / (
        cos_dec * math.cos(math.radians(lat))
    )
    if cos_h > 1 or cos_h < -1:
        # Sonne geht an diesem Tag nicht auf bzw. nicht unter.
        return None

    h = math.degrees(math.acos(cos_h))
    h = h if sunset else 360.0 - h
    h /= 15.0

    mean_time = h + ra - 0.06571 * t - 6.622
    return _norm(mean_time - lng_hour, 24.0)


def sun_event(day: date, lat: float, lon: float, sunset: bool) -> datetime | None:
    """Lokale naive Uhrzeit des Auf-/Untergangs am Kalendertag ``day``."""
    hours = _event_ut_hours(day, lat, lon, sunset)
    if hours is None:
        return None
    whole = int(hours)
    minute = int(round((hours - whole) * 60))
    # In seltenen Fällen rundet die Minute auf 60 – dann eine Stunde weiter.
    base = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(
        hours=whole, minutes=minute
    )
    return base.astimezone().replace(tzinfo=None)


def next_sun_event(
    now: datetime, lat: float, lon: float, sunset: bool, offset_minutes: float = 0.0
) -> datetime | None:
    """Nächstes Ereignis (heute oder morgen) ab ``now``, inkl. Versatz.

    Sucht bis zu einige Tage voraus, damit auch in Polarnähe – wo an einem Tag
    kein Auf-/Untergang stattfindet – ein gültiger Zeitpunkt gefunden wird.
    """
    for ahead in range(0, 4):
        day = (now + timedelta(days=ahead)).date()
        event = sun_event(day, lat, lon, sunset)
        if event is None:
            continue
        event = event + timedelta(minutes=offset_minutes)
        if event > now:
            return event
    return None
