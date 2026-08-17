"""Tagesverbrauch mitschreiben, damit sich Monate vergleichen lassen.

Die Messsteckdosen melden nur `energy_today` und setzen sich um Mitternacht
zurück. Ohne Mitschrift ist der gestrige Verbrauch danach für immer weg –
und die Frage «brauchen wir mehr als letzten Monat?» nicht zu beantworten.

Bewusst in der JSON-Datei neben der Konfiguration und nicht in Supabase:
Der Hub läuft absichtlich auch ohne Datenbank, und ein Zahlenpaar je Tag
kostet dort nichts.

Die Funktionen hier sind rein: Listen rein, Listen raus.
"""

from __future__ import annotations

from typing import Any

# Gut dreizehn Monate – genug für den Vergleich mit dem Vorjahresmonat,
# und immer noch eine kleine Datei.
DAY_LIMIT = 400


def total_today(entities: list[Any]) -> float:
    """Summe der heute verbrauchten kWh über alle messenden Geräte (rein).

    Geräte ohne Zähler bleiben aussen vor; ein negativer Wert wäre ein
    Messfehler und zählt ebenfalls nicht mit.
    """
    total = 0.0
    for entity in entities:
        try:
            value = float(entity.state.get("energy_today"))
        except (TypeError, ValueError):
            continue
        if value >= 0:
            total += value
    return round(total, 3)


def record_day(days: list[dict], day: str, kwh: float) -> list[dict]:
    """Den Tageswert festhalten – als Höchststand des Tages (rein, testbar).

    Der Höchststand und nicht der zuletzt gesehene Wert: Die Zähler setzen
    sich um Mitternacht zurück, und wer den letzten Stand schreibt, hat für
    den Vortag am Ende eine 0 stehen.
    """
    entries: list[dict] = []
    found = False
    for entry in days or []:
        if not isinstance(entry, dict) or not entry.get("day"):
            continue
        copy = dict(entry)
        if copy["day"] == day:
            found = True
            try:
                before = float(copy.get("kwh") or 0)
            except (TypeError, ValueError):
                before = 0.0
            copy["kwh"] = round(max(before, kwh), 3)
        entries.append(copy)
    if not found:
        entries.append({"day": day, "kwh": round(kwh, 3)})
    entries.sort(key=lambda entry: str(entry["day"]))
    return entries[-DAY_LIMIT:]


def previous_month(month: str) -> str:
    """«2026-01» → «2025-12» (rein, testbar)."""
    year, number = int(month[:4]), int(month[5:7])
    return f"{year - 1}-12" if number == 1 else f"{year}-{number - 1:02d}"


def month_totals(days: list[dict], today: str) -> dict[str, Any]:
    """Diesen Monat mit dem letzten vergleichen (rein, testbar).

    Neben dem ganzen Vormonat steht bewusst auch derselbe Zeitraum: Am 3.
    des Monats den bisherigen Verbrauch mit einem vollen Vormonat zu
    vergleichen, sähe nach einer Ersparnis aus, die es nicht gibt.
    """
    month = today[:7]
    last = previous_month(month)
    day_number = int(today[8:10])

    this_days = []
    last_total = 0.0
    last_so_far = 0.0
    for entry in days or []:
        day = str(entry.get("day") or "")
        if len(day) < 10:
            continue
        try:
            kwh = float(entry.get("kwh") or 0)
        except (TypeError, ValueError):
            continue
        if day[:7] == month:
            this_days.append({"day": day, "kwh": round(kwh, 3)})
        elif day[:7] == last:
            last_total += kwh
            if int(day[8:10]) <= day_number:
                last_so_far += kwh

    return {
        "month": month,
        "last_month": last,
        "this_month_kwh": round(sum(entry["kwh"] for entry in this_days), 3),
        "last_month_kwh": round(last_total, 3),
        "last_month_so_far_kwh": round(last_so_far, 3),
        "days": this_days,
    }
