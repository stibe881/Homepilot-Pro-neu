"""Wartungserinnerungen: Filter, Batterien, Entkalken.

Der Unterschied zu einer Aufgabe in der Familienliste: Diese Dinge
wiederholen sich in Monaten, nicht in Tagen, und niemand denkt daran.
Der Wasserfilter hält ein halbes Jahr – und genau deshalb steht er in
keinem Kalender.

Zwei Entscheidungen:

*Quittieren statt Abhaken.* «Erledigt» setzt die nächste Fälligkeit vom
heutigen Tag aus neu, nicht von der alten Frist. Wer den Filter drei
Wochen zu spät wechselt, hat danach wieder ein volles halbes Jahr – bei
Verschleiss zählt, wann es getan wurde, nicht wann es geplant war. Genau
umgekehrt als bei den wiederkehrenden Aufgaben (core/chores.py), wo der
Montags-Abfall montags bleiben soll.

*Vorwarnung.* Gemeldet wird nicht am Fälligkeitstag, sondern ein paar
Tage vorher. Ein Filter, den man erst am Stichtag bestellt, ist zu spät
bestellt.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

# So viele Tage im Voraus wird erinnert.
LEAD_DAYS = 7
# Obergrenze für ein Intervall: fünf Jahre. Alles darüber ist ein
# Tippfehler, kein Wartungsplan.
MAX_INTERVAL_DAYS = 1825


def parse_date(value: Any) -> date | None:
    """«2026-08-20» → date. Alles andere → None (rein)."""
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        year, month, day = (int(part) for part in text.split("-"))
        return date(year, month, day)
    except (ValueError, TypeError):
        return None


def clean_interval(value: Any) -> int:
    """Ein brauchbares Intervall in Tagen (rein).

    Null oder Unfug ergibt 90 Tage – lieber eine Erinnerung zu viel als
    ein Eintrag, der nie wieder auftaucht.
    """
    try:
        days = int(value)
    except (TypeError, ValueError):
        return 90
    if days < 1:
        return 90
    return min(days, MAX_INTERVAL_DAYS)


def next_after(done: Any, interval_days: Any) -> str:
    """Die nächste Fälligkeit nach dem Quittieren (rein, testbar).

    Gerechnet ab dem Tag der Erledigung: Ein Filter, der drei Wochen zu
    spät gewechselt wurde, hält danach trotzdem wieder ein halbes Jahr.
    """
    basis = parse_date(done) or date.today()
    return (basis + timedelta(days=clean_interval(interval_days))).isoformat()


def due_items(rows: list[dict[str, Any]], today: date | None = None) -> list[dict[str, Any]]:
    """Was ansteht – fällig oder in den nächsten Tagen (rein, testbar).

    Die Liste ist nach Dringlichkeit sortiert: Überfälliges zuerst.
    """
    heute = today or date.today()
    faellig = []
    for row in rows:
        frist = parse_date(row.get("due"))
        if frist is None:
            continue
        tage = (frist - heute).days
        if tage <= LEAD_DAYS:
            faellig.append({**row, "days_left": tage})
    return sorted(faellig, key=lambda row: row["days_left"])


def describe(row: dict[str, Any]) -> str:
    """Ein Satz für die Nachricht (rein)."""
    name = str(row.get("text") or "Wartung")
    tage = int(row.get("days_left", 0))
    if tage < 0:
        return f"{name}: seit {abs(tage)} Tagen fällig"
    if tage == 0:
        return f"{name}: heute fällig"
    return f"{name}: in {tage} Tagen fällig"
