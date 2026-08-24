"""Was schon gemeldet wurde – über den Neustart hinweg.

Der Fall: «Die Geburtstagsbenachrichtigung ist zwei Mal gekommen.» Der
Wächter merkte sich im Arbeitsspeicher, was er heute schon geschickt
hat – und jeder Neustart des Hubs setzte das zurück. Wer während der
Meldestunde ein Update einspielt, bekommt den Gruss ein zweites Mal.

Das trifft nicht nur den Geburtstag: Frostwarnung, Medikamente,
Wochenausblick, ablaufende Zugänge – jede Meldung, die «einmal am Tag»
heisst, hing an demselben flüchtigen Gedächtnis.

Hier steht nur das Rechnen: hinein die gemerkten Zeilen und eine Marke,
heraus die neue Liste. Wo sie liegt, weiss der Wächter.
"""

from __future__ import annotations

from typing import Any

# So lange bleibt eine Marke liegen. Vierzig Tage decken jede Meldung
# ab, die «einmal am Tag» oder «einmal im Monat» heisst; wer seltener
# meldet (das Notfallblatt einmal im Jahr), hat seine eigene Bedingung
# und braucht die Marke nur für den einen Tag.
TAGE = 40

# Und eine Obergrenze, damit ein Fehler in einer Schleife die Datei
# nicht sprengt. Bei rund fünfzehn Meldungsarten am Tag reichen 2000
# Zeilen für weit mehr als die vierzig Tage.
HOECHSTENS = 2000


def schon(rows: Any, marke: str) -> bool:
    """Ist diese Meldung schon raus? (rein, testbar)"""
    if not marke:
        return False
    return any(
        isinstance(row, dict) and row.get("mark") == marke for row in rows or []
    )


def merke(rows: Any, marke: str, at: float, tage: int = TAGE) -> list[dict[str, Any]]:
    """Eine Meldung als erledigt vormerken (rein, testbar).

    Die neueste nach vorn, Doppelte fallen weg, und was älter ist als
    `tage`, wird vergessen. Ohne das Vergessen wüchse die Datei mit
    jedem Tag, den der Hub läuft.
    """
    grenze = at - tage * 24 * 3600
    behalten = []
    for row in rows or []:
        if not isinstance(row, dict) or row.get("mark") == marke:
            continue
        try:
            wann = float(row.get("at") or 0)
        except (TypeError, ValueError):
            continue
        if wann >= grenze:
            behalten.append(row)
    return [{"mark": marke, "at": at}, *behalten][:HOECHSTENS]
