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


# Zwei Tage Stundenwerte - genug für «heute gegen gestern», und die
# Datei bleibt klein. Alles Ältere steckt in den Tageswerten.
HOUR_LIMIT = 48


def record_hour(hours: list[dict], day: str, hour: int, kwh: float) -> list[dict]:
    """Den Zählerstand je Stunde festhalten (rein, testbar).

    Der Tageswert sagt *wie viel*, aber nicht *wann* - und «warum war
    gestern so hoch?» beantwortet erst der Blick auf die Stunden (der
    Backofen um 18 Uhr, nicht der Kühlschrank). Wie beim Tag zählt der
    Höchststand der Stunde: Der Zähler wächst nur, also ist er zugleich
    der Stand am Stundenende.
    """
    entries: list[dict] = []
    found = False
    for entry in hours or []:
        if not isinstance(entry, dict) or not entry.get("day"):
            continue
        copy = dict(entry)
        if copy["day"] == day and int(copy.get("hour") or 0) == hour:
            found = True
            try:
                before = float(copy.get("kwh") or 0)
            except (TypeError, ValueError):
                before = 0.0
            copy["kwh"] = round(max(before, kwh), 3)
        entries.append(copy)
    if not found:
        entries.append({"day": day, "hour": int(hour), "kwh": round(kwh, 3)})
    entries.sort(key=lambda entry: (str(entry["day"]), int(entry.get("hour") or 0)))
    return entries[-HOUR_LIMIT:]


def hourly_usage(hours: list[dict], day: str) -> list[dict]:
    """Der Verbrauch je Stunde eines Tages (rein, testbar).

    Gespeichert sind Zählerstände; die Anzeige will Differenzen. Der
    Bezugspunkt jeder Stunde ist der letzte davor bekannte Stand desselben
    Tages (um Mitternacht steht der Zähler auf 0). Fehlt eine Stunde -
    Hub war aus - trägt die nächste den Nachholwert; das ist ehrlicher,
    als Löcher zu glätten.
    """
    stunden = sorted(
        (
            entry
            for entry in hours or []
            if isinstance(entry, dict) and str(entry.get("day") or "") == day
        ),
        key=lambda entry: int(entry.get("hour") or 0),
    )
    rows: list[dict] = []
    vorher = 0.0
    for entry in stunden:
        try:
            stand = float(entry.get("kwh") or 0)
        except (TypeError, ValueError):
            continue
        rows.append(
            {
                "hour": int(entry.get("hour") or 0),
                # Ein Rückwärtssprung wäre ein Messfehler - dann lieber 0.
                "kwh": round(max(0.0, stand - vorher), 3),
            }
        )
        vorher = max(vorher, stand)
    return rows


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


def days_in_month(month: str) -> int:
    """Tage des Monats «2026-02» (rein, testbar)."""
    year, number = int(month[:4]), int(month[5:7])
    if number == 12:
        return 31
    from datetime import date

    return (date(year + (number // 12), (number % 12) + 1, 1) - date(year, number, 1)).days


def forecast(totals: dict[str, Any], today: str) -> dict[str, Any]:
    """Hochrechnung aufs Monatsende plus Vorjahresmonat (rein, testbar).

    Gerechnet wird mit dem Tagesschnitt der bisherigen Tage – nicht mit
    dem letzten Tag: Ein Waschtag hochgerechnet ergäbe eine Zahl, die
    niemanden weiterbringt.
    """
    month = totals.get("month") or today[:7]
    day_number = max(1, int(today[8:10]))
    total = float(totals.get("this_month_kwh") or 0)
    total_days = days_in_month(month)
    per_day = total / day_number
    return {
        "per_day_kwh": round(per_day, 3),
        "projected_kwh": round(per_day * total_days, 1),
        "days_done": day_number,
        "days_total": total_days,
    }


def year_ago(days: list[dict], month: str) -> float:
    """Verbrauch desselben Monats im Vorjahr (rein, testbar).

    Null heisst «wissen wir nicht» – ein Jahr Mitschrift hat man erst nach
    einem Jahr, und das darf die Anzeige nicht als Ersparnis ausgeben.
    """
    year, number = int(month[:4]), int(month[5:7])
    wanted = f"{year - 1}-{number:02d}"
    total = 0.0
    for entry in days or []:
        if str(entry.get("day") or "")[:7] == wanted:
            try:
                total += float(entry.get("kwh") or 0)
            except (TypeError, ValueError):
                continue
    return round(total, 3)


def top_consumers(entities: list[Any], limit: int = 10) -> list[dict[str, Any]]:
    """Rangliste nach heutigem Verbrauch (rein, testbar).

    Beantwortet «wohin gehen die Kilowattstunden» – die Frage, die man
    stellt, bevor man irgendwo etwas ändert.
    """
    rows = []
    for entity in entities:
        try:
            kwh = float(entity.state.get("energy_today"))
        except (TypeError, ValueError):
            continue
        if kwh <= 0:
            continue
        power = entity.state.get("power")
        rows.append(
            {
                "entity_id": entity.id,
                "name": entity.label,
                "room": entity.room,
                "kwh": round(kwh, 3),
                "watts": round(float(power), 1) if isinstance(power, (int, float)) else None,
            }
        )
    rows.sort(key=lambda row: row["kwh"], reverse=True)
    return rows[:limit]


# Ab dieser Dauerleistung gilt ein Gerät als Dauerverbraucher, das nie aus
# ist. Unter 2 W sind Messfehler und Netzteile, über 200 W ist es kein
# Standby mehr, sondern etwas, das arbeitet (Kühlschrank, Server).
STANDBY_MIN_WATTS = 2.0
STANDBY_MAX_WATTS = 200.0


def standby_costs(
    entities: list[Any], price_per_kwh: float = 0.0, limit: int = 10
) -> list[dict[str, Any]]:
    """Geräte, die dauernd ziehen – mit Jahreskosten (rein, testbar).

    Gerechnet wird aus der aktuellen Leistung aufs Jahr: eine Momentaufnahme,
    aber genau die richtige Grössenordnung für die Frage «lohnt sich hier
    eine schaltbare Steckdose».
    """
    rows = []
    for entity in entities:
        power = entity.state.get("power")
        if not isinstance(power, (int, float)):
            continue
        watts = float(power)
        if not (STANDBY_MIN_WATTS <= watts <= STANDBY_MAX_WATTS):
            continue
        kwh_year = watts * 24 * 365 / 1000
        rows.append(
            {
                "entity_id": entity.id,
                "name": entity.label,
                "room": entity.room,
                "watts": round(watts, 1),
                "kwh_year": round(kwh_year, 1),
                "cost_year": round(kwh_year * price_per_kwh, 2) if price_per_kwh else None,
            }
        )
    rows.sort(key=lambda row: row["watts"], reverse=True)
    return rows[:limit]
