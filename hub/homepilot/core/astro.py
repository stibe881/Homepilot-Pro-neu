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


# ── Sonnenstand ──────────────────────────────────────────────────────────


def sun_position(when: datetime, lat: float, lon: float) -> tuple[float, float]:
    """Höhe und Azimut der Sonne in Grad (rein, testbar).

    Höhe: 0 am Horizont, 90 im Zenit, negativ nach dem Untergang.
    Azimut: 0 = Norden, 90 = Osten, 180 = Süden, 270 = Westen.

    Für die Beschattung braucht es beides: Ob die Sonne aufs Fenster
    scheint, hängt von der Himmelsrichtung ab, und ob sie blendet, von der
    Höhe. Der Sonnenauf- und -untergang allein sagt darüber nichts – im
    Sommer steht die Sonne um acht Uhr längst am Himmel, aber noch im
    Osten.

    Dieselbe Näherung wie oben (NOAA), gut auf ein Zehntelgrad – für
    Storen ist das reichlich genau.
    """
    stamp = when.astimezone(timezone.utc)
    # Julianisches Datum.
    jd = stamp.timestamp() / 86400.0 + 2440587.5
    d = jd - 2451545.0

    # Mittlere Länge und Anomalie der Sonne.
    mean_long = _norm(280.460 + 0.9856474 * d, 360.0)
    anomaly = math.radians(_norm(357.528 + 0.9856003 * d, 360.0))
    # Ekliptikale Länge.
    ecliptic = math.radians(
        mean_long + 1.915 * math.sin(anomaly) + 0.020 * math.sin(2 * anomaly)
    )
    obliquity = math.radians(23.439 - 0.0000004 * d)

    declination = math.asin(math.sin(obliquity) * math.sin(ecliptic))
    right_ascension = math.atan2(
        math.cos(obliquity) * math.sin(ecliptic), math.cos(ecliptic)
    )

    # Sternzeit am Ort, daraus der Stundenwinkel.
    sidereal = math.radians(_norm(280.46061837 + 360.98564736629 * d + lon, 360.0))
    hour_angle = sidereal - right_ascension

    lat_rad = math.radians(lat)
    elevation = math.asin(
        math.sin(lat_rad) * math.sin(declination)
        + math.cos(lat_rad) * math.cos(declination) * math.cos(hour_angle)
    )
    azimuth = math.atan2(
        math.sin(hour_angle),
        math.cos(hour_angle) * math.sin(lat_rad) - math.tan(declination) * math.cos(lat_rad),
    )
    return round(math.degrees(elevation), 2), round(_norm(math.degrees(azimuth) + 180.0, 360.0), 2)


def within_arc(azimuth: float, start: float, end: float) -> bool:
    """Liegt die Sonne im Fensterbereich? (rein, testbar)

    Der Bereich darf über Norden hinweggehen (z.B. 300° bis 60°) – ein
    nach Norden zeigendes Fenster ist selten, aber ein Bereich, der bei
    350 beginnt und bei 20 endet, ist keine Ausnahme, sondern der Normalfall
    an einer schräg stehenden Fassade.
    """
    start = _norm(start, 360.0)
    end = _norm(end, 360.0)
    azimuth = _norm(azimuth, 360.0)
    if start <= end:
        return start <= azimuth <= end
    return azimuth >= start or azimuth <= end
