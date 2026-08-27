"""Schulferien: ist heute ein Schultag – als Antwort, nicht als Kalender.

«Wecker nur an Schultagen» liess sich bisher nicht bauen: Die
Wochentags-Bedingung kennt Montag bis Freitag, aber weder Sportferien
noch Auffahrt. Die Ferientermine holt die Integration
(integrations/schulferien.py) von openholidaysapi.org und legt sie in
die Datendatei - einmal im Tag, und danach geht alles offline: Ob heute
Schule ist, darf nicht an der Internetleitung hängen.

Das Ergebnis ist ein Sensor mit drei Zuständen: «schultag»,
«wochenende», «ferien». Bewusst ein Gerät und kein neuer
Bedingungstyp: Damit kann jeder Ablauf über die vorhandene
Zustands-Bedingung danach fragen, und die Kachel zeigt nebenbei, wann
die nächsten Ferien beginnen.

Feiertage zählen als Ferien: Für den Wecker ist Auffahrt dasselbe wie
ein Ferientag - kein Schulweg.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from . import feiertage

#: Wo die geholten Termine liegen.
STORE_KEY = "schulferien"

SCHULTAG = "schultag"
WOCHENENDE = "wochenende"
FERIEN = "ferien"


def lesen(rows: Any) -> list[dict[str, Any]]:
    """Die abgelegten Termine, bereinigt (rein, testbar)."""
    raus: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        try:
            von = date.fromisoformat(str(row.get("from"))[:10])
            bis = date.fromisoformat(str(row.get("to"))[:10])
        except (TypeError, ValueError):
            continue
        if bis < von:
            continue
        raus.append({"name": str(row.get("name") or "Ferien"), "von": von, "bis": bis})
    return sorted(raus, key=lambda row: row["von"])


def aus_antwort(payload: Any) -> list[dict[str, Any]]:
    """Die Antwort von openholidaysapi.org in Ablagezeilen (rein, testbar)."""
    raus: list[dict[str, Any]] = []
    for eintrag in payload or []:
        if not isinstance(eintrag, dict):
            continue
        namen = eintrag.get("name") or []
        name = next(
            (
                str(teil.get("text"))
                for teil in namen
                if isinstance(teil, dict) and teil.get("text")
            ),
            "Ferien",
        )
        raus.append(
            {
                "name": name,
                "from": str(eintrag.get("startDate") or "")[:10],
                "to": str(eintrag.get("endDate") or "")[:10],
            }
        )
    return raus


def ferien_am(rows: Any, tag: date) -> str | None:
    """Der Name der Ferien an diesem Tag – oder None (rein, testbar)."""
    for eintrag in lesen(rows):
        if eintrag["von"] <= tag <= eintrag["bis"]:
            return eintrag["name"]
    return None


def lage(rows: Any, tag: date) -> dict[str, Any]:
    """Der Zustand des Sensors für diesen Tag (rein, testbar)."""
    ferien = ferien_am(rows, tag)
    if ferien is None and feiertage.ist_feiertag(tag):
        # Für den Wecker ist Auffahrt dasselbe wie ein Ferientag.
        ferien = "Feiertag"
    if ferien is not None:
        stand = FERIEN
    elif tag.weekday() >= 5:
        stand = WOCHENENDE
    else:
        stand = SCHULTAG
    naechste = next(
        (eintrag for eintrag in lesen(rows) if eintrag["von"] > tag), None
    )
    return {
        "state": stand,
        "name": ferien,
        "next": naechste["name"] if naechste else None,
        "next_in_days": (naechste["von"] - tag).days if naechste else None,
    }


def veraltet(rows: Any, tag: date) -> bool:
    """Reichen die abgelegten Termine noch weit genug? (rein, testbar)

    Wenn keine Ferien mehr in der Zukunft liegen, ist die Ablage
    abgelaufen - dann muss die Integration nachladen, sonst hiesse
    jeder Tag «Schule».
    """
    return not any(eintrag["bis"] >= tag + timedelta(days=30) for eintrag in lesen(rows))
