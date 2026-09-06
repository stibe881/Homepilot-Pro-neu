"""Zeitraum-Simulation für Abläufe (Punkt 254 der Werkbank).

Der Trockenlauf kennt nur das Jetzt: «Würde der Ablauf in diesem Moment
laufen?» Die Frage beim Einrichten ist aber oft eine andere - «wie oft
hätte er in der letzten Woche gefeuert?». Ein Weckerablauf mit
Wochentags- und Ferienbedingung lässt sich nur so prüfen, ohne eine
Woche zu warten.

Deterministische Auslöser (Zeit, Sonne, Kalender) und Bedingungen
(Wochentage, Uhrzeitfenster, Feiertage, Schulferien, Sonnenstand) werden
über den Zeitraum exakt durchgerechnet. Zustands-Auslöser werden aus dem
Ereignisprotokoll (core/eventlog.py) gezählt, wo es die Wechsel hergibt.

Wo es sie nicht hergibt, steht der Auslöser ehrlich als
``not_simulatable`` mit Grund in der Antwort. Warum keine Schätzung:
Eine geschätzte Zahl wäre eine Lüge mit Nachkommastellen - wer «3,2
Läufe pro Woche» liest, glaubt der Zahl, nicht dem Kleingedruckten, und
richtet danach seine Nachtruhe ein.

Alles hier ist reine Rechnung: Zeitpunkt, Standort, Protokoll und
Ferientermine kommen als Argumente herein - die Engine reicht sie in
``AutomationEngine.simulation`` durch.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from . import astro, feiertage, schulferien
from .automation import parse_hhmm, parse_weekdays, time_in_window

#: Mehr als ein Monat rückwärts ist keine Simulation mehr, sondern eine
#: Statistik - und das Ereignisprotokoll reicht ohnehin nicht so weit.
MAX_TAGE = 31


def bedingung_simulierbar(condition: dict[str, Any]) -> bool:
    """Lässt sich diese Bedingung für die Vergangenheit nachrechnen?

    (rein, testbar)

    Ja für alles, was nur am Kalender und am Himmel hängt: Zeitfenster,
    Wochentage, Feiertage, Sonnenstand - und der Schulferien-Sensor,
    dessen Zustand sich für jeden Tag aus den abgelegten Terminen ergibt
    (core/schulferien.py). Nein für jeden anderen Gerätezustand: Was die
    Helligkeit vorgestern um 06:30 war, weiss heute niemand mehr.
    """
    ctype = str(condition.get("type", "state"))
    if ctype in ("time", "sun"):
        return True
    if ctype == "group":
        subs = [c for c in condition.get("conditions") or [] if isinstance(c, dict)]
        return all(bedingung_simulierbar(c) for c in subs)
    if ctype == "state":
        if "above" in condition or "below" in condition:
            return False
        return str(condition.get("entity_id") or "").startswith("schulferien.")
    return False


def bedingung_gilt(
    condition: dict[str, Any],
    wann: datetime,
    lat: float,
    lon: float,
    ferien_rows: Any = None,
) -> bool:
    """Gilt eine simulierbare Bedingung zu diesem Zeitpunkt? (rein, testbar)

    Dieselben Regeln wie in der Engine (automation._check_condition),
    nur mit hineingereichter Zeit statt ``datetime.now()`` - genau dieser
    Unterschied macht die Vergangenheit rechenbar.
    """
    ctype = str(condition.get("type", "state"))
    if ctype == "group":
        subs = [c for c in condition.get("conditions") or [] if isinstance(c, dict)]
        if not subs:
            return True
        if str(condition.get("match", "all")) == "any":
            return any(bedingung_gilt(c, wann, lat, lon, ferien_rows) for c in subs)
        return all(bedingung_gilt(c, wann, lat, lon, ferien_rows) for c in subs)
    if ctype == "time":
        days = parse_weekdays(condition.get("weekdays"))
        if days and wann.weekday() not in days:
            return False
        if condition.get("except_holidays") and feiertage.ist_feiertag(wann.date()):
            return False
        return time_in_window(wann, condition.get("after"), condition.get("before"))
    if ctype == "sun":
        rise = astro.sun_event(wann.date(), lat, lon, sunset=False)
        set_ = astro.sun_event(wann.date(), lat, lon, sunset=True)
        if rise is None or set_ is None:
            return False
        up = rise <= wann <= set_
        return up if str(condition.get("state", "up")) == "up" else not up
    if ctype == "state":
        # Nur der Schulferien-Sensor - alles andere fällt schon in
        # ``bedingung_simulierbar`` heraus.
        stand = schulferien.lage(ferien_rows, wann.date())["state"]
        if "equals" in condition:
            return stand == condition["equals"]
        return True
    return False


def _kalender_zeitpunkte(
    events: list[dict[str, Any]] | None, trigger: dict[str, Any]
) -> list[datetime]:
    """Wann dieser Kalender-Auslöser feuert - je Termin ein Zeitpunkt.

    (rein, testbar) - dieselben Regeln wie automation.calendar_due, nur
    ohne Fenster und Gedächtnis: Hier wird nicht gefeuert, sondern
    gezählt.
    """
    needle = str(trigger.get("contains") or "").strip().lower()
    kind = str(trigger.get("event") or "start")
    try:
        vorlauf = float(trigger.get("minutes_before") or 0)
    except (TypeError, ValueError):
        vorlauf = 0.0
    zeitpunkte: list[datetime] = []
    for event in events or []:
        summary = str(event.get("summary") or "")
        if needle and needle not in summary.lower():
            continue
        grenze = event.get("end" if kind == "end" else "start")
        if not grenze:
            continue
        try:
            zeitpunkt = datetime.fromisoformat(str(grenze).replace("Z", "+00:00"))
        except ValueError:
            continue
        if zeitpunkt.tzinfo is not None:
            zeitpunkt = zeitpunkt.astimezone().replace(tzinfo=None)
        zeitpunkte.append(zeitpunkt - timedelta(minutes=vorlauf))
    return zeitpunkte


def _nicht_simulierbar(trigger: dict[str, Any], grund: str) -> dict[str, Any]:
    """Der ehrliche Eintrag für einen Auslöser, den niemand nachrechnen
    kann (rein)."""
    eintrag: dict[str, Any] = {
        "type": str(trigger.get("type", "state")),
        "reason": grund,
    }
    if trigger.get("entity_id"):
        eintrag["entity_id"] = str(trigger["entity_id"])
    return eintrag


def simulieren(
    triggers: list[dict[str, Any]],
    conditions: list[dict[str, Any]],
    match: str,
    tage: int,
    jetzt: datetime,
    lat: float,
    lon: float,
    schulferien_rows: Any = None,
    events: list[dict[str, Any]] | None = None,
    log_start: float | None = None,
    calendar_events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Wie oft hätte der Ablauf in den letzten ``tage`` Tagen gefeuert?

    (rein, testbar)

    ``events`` ist das Ereignisprotokoll (Zeilen mit entity_id, state,
    at), ``log_start``, seit wann es zählt. Zurück kommt je Tag die
    Liste der Zeitpunkte samt Zähler, die Summe und die Auslöser, die
    sich nicht nachrechnen lassen - mit Grund statt mit Schätzwert.
    """
    tage = max(1, min(MAX_TAGE, int(tage)))
    start_tag = jetzt.date() - timedelta(days=tage - 1)
    start = datetime.combine(start_tag, datetime.min.time())

    # Bedingungen teilen: Was sich nachrechnen lässt, wird je Zeitpunkt
    # geprüft; der Rest gilt als erfüllt und steht ausgewiesen in der
    # Antwort. Die Zahl ist damit eine obere Schranke - das sagt die
    # Antwort auch, statt so zu tun, als wäre sie exakt.
    simulierbare = [c for c in conditions or [] if bedingung_simulierbar(c)]
    ungeprueft = [c for c in conditions or [] if not bedingung_simulierbar(c)]

    def passt(wann: datetime) -> bool:
        if not conditions:
            return True
        treffer = [
            bedingung_gilt(c, wann, lat, lon, schulferien_rows) for c in simulierbare
        ]
        if str(match) == "any":
            # «eine genügt»: Eine erfüllte prüfbare genügt - und eine
            # ungeprüfte könnte erfüllt gewesen sein (obere Schranke).
            return any(treffer) or bool(ungeprueft)
        return all(treffer)

    je_tag: dict[date, list[datetime]] = {
        start_tag + timedelta(days=i): [] for i in range(tage)
    }
    not_simulatable: list[dict[str, Any]] = []
    log_luecke = False

    def zaehlen(wann: datetime) -> None:
        if wann < start or wann > jetzt:
            return
        if passt(wann):
            je_tag[wann.date()].append(wann)

    for trigger in triggers or []:
        art = str(trigger.get("type", "state"))
        if art == "time":
            zeit = parse_hhmm(trigger.get("at"))
            if zeit is None:
                not_simulatable.append(
                    _nicht_simulierbar(trigger, "keine lesbare Uhrzeit in «at»")
                )
                continue
            # Der Zufalls-Versatz (jitter) bleibt aussen vor - wie bei
            # next_run: Gerechnet wird der Zielpunkt, gewürfelt wird
            # erst beim Feuern.
            for tag in je_tag:
                zaehlen(datetime.combine(tag, datetime.min.time()).replace(
                    hour=zeit[0], minute=zeit[1]
                ))
        elif art == "sun":
            sunset = str(trigger.get("event", "sunset")) != "sunrise"
            try:
                versatz = float(trigger.get("offset", 0) or 0)
            except (TypeError, ValueError):
                versatz = 0.0
            for tag in je_tag:
                ereignis = astro.sun_event(tag, lat, lon, sunset=sunset)
                if ereignis is not None:
                    zaehlen(ereignis + timedelta(minutes=versatz))
        elif art == "calendar":
            if not calendar_events:
                not_simulatable.append(
                    _nicht_simulierbar(
                        trigger, "kein Kalender mit Terminen angebunden"
                    )
                )
                continue
            for zeitpunkt in _kalender_zeitpunkte(calendar_events, trigger):
                zaehlen(zeitpunkt)
        elif art == "state":
            attribut = str(trigger.get("attribute", "state"))
            if attribut != "state" or "above" in trigger or "below" in trigger:
                not_simulatable.append(
                    _nicht_simulierbar(
                        trigger,
                        "das Ereignisprotokoll führt nur Zustandswechsel, "
                        "keine Messwerte oder Einzelfelder",
                    )
                )
                continue
            entity_id = str(trigger.get("entity_id") or "")
            zeilen = [
                zeile
                for zeile in events or []
                if str(zeile.get("entity_id") or "") == entity_id
                and isinstance(zeile.get("at"), (int, float))
            ]
            if not zeilen:
                not_simulatable.append(
                    _nicht_simulierbar(
                        trigger,
                        f"im Ereignisprotokoll steht kein Eintrag zu «{entity_id}» - "
                        "ob nichts geschah oder das Gerät dort gar nicht geführt "
                        "wird, lässt sich nicht unterscheiden",
                    )
                )
                continue
            if log_start is not None and log_start > start.timestamp():
                # Das Protokoll beginnt mitten im Zeitraum: Die Zählung
                # stimmt ab da, davor fehlt sie - das gehört gesagt.
                log_luecke = True
            zeilen.sort(key=lambda zeile: float(zeile["at"]))
            vorher: Any = None
            for zeile in zeilen:
                zustand = zeile.get("state")
                wann = datetime.fromtimestamp(float(zeile["at"]))
                treffer = True
                if "to" in trigger and str(zustand) != str(trigger["to"]):
                    treffer = False
                if "from" in trigger and (
                    vorher is None or str(vorher) != str(trigger["from"])
                ):
                    treffer = False
                if treffer:
                    zaehlen(wann)
                vorher = zustand
        elif art == "interval":
            not_simulatable.append(
                _nicht_simulierbar(
                    trigger,
                    "läuft im Takt seit dem Hub-Start, nicht am Kalender - "
                    "vergangene Läufe hängen an der Laufzeit, nicht am Datum",
                )
            )
        elif art == "availability":
            not_simulatable.append(
                _nicht_simulierbar(
                    trigger,
                    "Erreichbarkeits-Flanken stehen nicht im Ereignisprotokoll",
                )
            )
        elif art == "presence":
            not_simulatable.append(
                _nicht_simulierbar(
                    trigger,
                    "Anwesenheitswechsel stehen nicht im Ereignisprotokoll",
                )
            )
        elif art == "weather_warning":
            not_simulatable.append(
                _nicht_simulierbar(
                    trigger, "vergangene Wetterwarnungen speichert der Hub nicht"
                )
            )
        else:
            not_simulatable.append(
                _nicht_simulierbar(trigger, f"unbekannte Auslöser-Art «{art}»")
            )

    days = []
    total = 0
    for tag in sorted(je_tag):
        zeitpunkte = sorted(je_tag[tag])
        total += len(zeitpunkte)
        days.append(
            {
                "date": tag.isoformat(),
                "times": [wann.strftime("%H:%M") for wann in zeitpunkte],
                "count": len(zeitpunkte),
            }
        )

    ergebnis: dict[str, Any] = {
        "from": start_tag.isoformat(),
        "to": jetzt.date().isoformat(),
        "days": days,
        "total": total,
        "not_simulatable": not_simulatable,
        # Nicht prüfbare Bedingungen machen die Zahl zur oberen
        # Schranke - die App soll das dazuschreiben können.
        "unchecked_conditions": [
            {
                "type": str(c.get("type", "state")),
                **(
                    {"entity_id": str(c["entity_id"])}
                    if c.get("entity_id")
                    else {}
                ),
            }
            for c in ungeprueft
        ],
    }
    if log_luecke and log_start is not None:
        ergebnis["log_start"] = log_start
        ergebnis["hinweis"] = (
            "Das Ereignisprotokoll beginnt erst am "
            f"{datetime.fromtimestamp(log_start).strftime('%d.%m. %H:%M')} - "
            "Zustandswechsel davor fehlen in der Zählung."
        )
    return ergebnis
