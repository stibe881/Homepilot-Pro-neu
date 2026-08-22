"""Feiertage im Kanton Luzern (Punkt 154 der Werkbank).

«Morgens saugen, werktags» lief bisher auch an Auffahrt - die
Wochentags-Bedingung kennt Montag bis Sonntag, aber keinen Kalender.
Hier stehen die gesetzlichen Feiertage des Kantons Luzern, offline
berechenbar: die festen Daten plus die beweglichen rund um Ostern
(Gauss'sche Osterformel).

Bewusst nur Luzern: Das Haus steht in Zell LU. Wer das Haus zügelt,
passt eine Liste an statt eine Bibliothek zu suchen.
"""

from __future__ import annotations

from datetime import date, timedelta

# Die festen Feiertage: (Monat, Tag, Name).
FESTE = (
    (1, 1, "Neujahr"),
    (1, 2, "Berchtoldstag"),
    (8, 1, "Bundesfeier"),
    (8, 15, "Mariä Himmelfahrt"),
    (11, 1, "Allerheiligen"),
    (12, 8, "Mariä Empfängnis"),
    (12, 25, "Weihnachten"),
    (12, 26, "Stephanstag"),
)


def ostern(jahr: int) -> date:
    """Ostersonntag nach der Gauss'schen Osterformel (rein, testbar)."""
    a = jahr % 19
    b, c = divmod(jahr, 100)
    d, e = divmod(b, 4)
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741 - die übliche Formelschreibweise
    m = (a + 11 * h + 22 * l) // 451
    monat, tag = divmod(h + l - 7 * m + 114, 31)
    return date(jahr, monat, tag + 1)


def feiertage(jahr: int) -> dict[date, str]:
    """Alle Luzerner Feiertage eines Jahres (rein, testbar)."""
    sonntag = ostern(jahr)
    tage = {date(jahr, monat, tag): name for monat, tag, name in FESTE}
    tage[sonntag - timedelta(days=2)] = "Karfreitag"
    tage[sonntag + timedelta(days=1)] = "Ostermontag"
    tage[sonntag + timedelta(days=39)] = "Auffahrt"
    tage[sonntag + timedelta(days=50)] = "Pfingstmontag"
    tage[sonntag + timedelta(days=60)] = "Fronleichnam"
    return tage


def ist_feiertag(tag: date) -> bool:
    """Ist dieser Tag in Luzern ein gesetzlicher Feiertag? (rein)"""
    return tag in feiertage(tag.year)
