"""Wer hat was eingerichtet - und wann.

Das Zugriffsprotokoll (core/audit.py) beantwortet «wer hat geschaltet».
Die andere Hälfte fehlte: wer etwas *eingerichtet* hat. Umbenannt,
ausgeblendet, einen Ablauf geändert, eine Szene gelöscht, jemandem eine
Rolle gegeben. Bei vier Personen im Haus ist «seit wann heisst das so?»
eine reale Frage - und «warum läuft der Ablauf nicht mehr?» erst recht.

Bewusst getrennt vom Zugriffsprotokoll: Das eine ist Bedienung und
passiert hundertmal am Tag, das andere ist Einrichtung und passiert
selten. In einer Liste zusammen wäre die seltene nicht mehr zu finden.

Was hier steht, ist absichtlich grob: *was* geändert wurde, nicht der
alte und der neue Wert. Ein vollständiger Verlauf jeder Einstellung wäre
eine zweite Datenbank; die Frage, die man wirklich stellt, ist «wer war
das» - und die Antwort steht damit da.
"""

from __future__ import annotations

import time
from typing import Any

#: Wo das Protokoll liegt (core/persistence.py legt den Schlüssel selbst
#: an, sobald zum ersten Mal etwas hineingeschrieben wird).
KEY = "config_log"

#: So viele Einträge bleiben. Einrichtung passiert selten - das reicht
#: über Jahre und hält die Datei klein.
LIMIT = 400

#: Wie eine Änderung heisst, wenn man sie vorliest. Der Schlüssel steht
#: im Eintrag, das Wort in der App - so bleibt der Bestand lesbar, auch
#: wenn sich die Formulierung ändert.
ARTEN: dict[str, str] = {
    "geraet": "Gerät",
    "haus": "Ansicht des Hauses",
    "ablauf": "Ablauf",
    "szene": "Szene",
    "benutzer": "Benutzer",
    "leuchte": "Leuchtengruppe",
    "alarm": "Alarmanlage",
    "regel": "Benachrichtigung",
    "konfiguration": "Konfiguration",
}


def eintrag(user: str, art: str, was: str, ziel: str = "") -> dict[str, Any]:
    """Eine Zeile fürs Protokoll (rein, testbar)."""
    row: dict[str, Any] = {
        "at": time.time(),
        "user": user or "?",
        "art": art,
        "was": was,
    }
    if ziel:
        row["ziel"] = ziel
    return row


def trim(rows: list[dict[str, Any]], limit: int = LIMIT) -> list[dict[str, Any]]:
    """Auf die jüngsten ``limit`` Einträge kürzen (rein, testbar)."""
    return rows[-limit:] if len(rows) > limit else rows


## Die Felder der Haus-Einstellungen in Worten. Ohne sie stünde im
## Protokoll «widgetButtons geändert» - richtig, aber niemand sucht
## danach.
HAUS_FELDER: dict[str, str] = {
    "order": "Kachel-Reihenfolge",
    "hidden": "ausgeblendete Geräte",
    "familyHidden": "ausgeblendete Familien-Kacheln",
    "locked": "gesperrte Geräte",
    "ungezaehlt": "Zählung in der Kopfzeile",
    "bioLock": "Face-ID-Hürde",
    "doorConfirm": "Rückfrage vor dem Türöffnen",
    "widgetData": "Hausstand im Widget",
    "widgetButtons": "Widget-Knöpfe",
    "widgetDirect": "direkt schaltende Widget-Knöpfe",
    "widgetKarten": "eigene Widgets",
}


def haus_beschreiben(alt: dict[str, Any], neu: dict[str, Any]) -> str:
    """Was sich an den Haus-Einstellungen geändert hat (rein, testbar).

    Nur die Felder, die wirklich anders sind: Die App schickt seit dem
    Umbau nur noch das Geänderte, aber ein älterer Stand schickt den
    ganzen Bestand - und «alles geändert» wäre keine Auskunft.

    Leer heisst: nichts hat sich geändert. Dann gehört auch keine Zeile
    ins Protokoll.
    """
    geaendert = [
        HAUS_FELDER.get(feld, feld)
        for feld in neu
        if alt.get(feld) != neu.get(feld)
    ]
    if not geaendert:
        return ""
    if len(geaendert) <= 3:
        return ", ".join(geaendert)
    return f"{', '.join(geaendert[:3])} und {len(geaendert) - 3} weitere"


class Aenderungsprotokoll:
    """Das Protokoll selbst - dünn, weil das Rechnen oben steht."""

    def __init__(self, hub: Any) -> None:
        self.hub = hub

    def merken(self, user: Any, art: str, was: str, ziel: str = "") -> None:
        """Eine Änderung festhalten.

        Fehler hier dürfen nie durchschlagen: Ein Protokoll, das das
        Einrichten verhindert, ist schlimmer als keines - dieselbe Regel
        wie beim Zugriffsprotokoll.
        """
        try:
            name = getattr(user, "name", None) or (user if isinstance(user, str) else "")
            rows = self.hub.data.get(KEY)
            rows.append(eintrag(str(name), art, was, ziel))
            self.hub.data.set(KEY, trim(rows))
        except Exception:  # noqa: BLE001 - siehe oben
            import logging

            logging.getLogger(__name__).exception(
                "Änderungsprotokoll nicht schreibbar"
            )

    def eintraege(self, limit: int = 200) -> list[dict[str, Any]]:
        """Jüngste zuerst."""
        rows = self.hub.data.get(KEY)
        rows.reverse()
        return rows[: max(1, limit)]
