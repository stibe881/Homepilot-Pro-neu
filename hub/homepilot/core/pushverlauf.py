"""Was der Hub gemeldet hat – zum Nachlesen in der App.

Eine weggewischte Mitteilung ist heute weg: Das Telefon vergisst sie,
und die App weiss nicht einmal, dass es sie gab. «Was hat vorhin
gebrummt?» ist danach nicht mehr zu beantworten - und genau dann will
man es wissen, wenn man am Steuer sass oder das Telefon in der Jacke
steckte.

Deshalb behält der Hub die letzten Meldungen: Titel, Text, Art, Zeit,
und an wen sie gingen. Bewusst begrenzt und mit Verfallszeit - das ist
ein Zettel zum Nachlesen, kein zweites Protokoll. Bilder bleiben
draussen: Sie leben ohnehin nur Minuten (core/snapshots.py).

Reines Rechnen über Listen; wer schreibt, ist der Push-Dienst.
"""

from __future__ import annotations

from typing import Any

#: Wo die Meldungen liegen.
STORE_KEY = "push_verlauf"

#: Mehr behält der Hub nicht - der Zettel soll lesbar bleiben.
HOECHSTENS = 50

#: Und nicht länger als eine Woche: Was älter ist, ist keine Frage von
#: «was hat vorhin gebrummt?» mehr.
TAGE = 7.0


def anhaengen(
    rows: Any, eintrag: dict[str, Any], jetzt: float
) -> list[dict[str, Any]]:
    """Eine verschickte Meldung vermerken (rein, testbar)."""
    frisch = [
        row
        for row in (rows or [])
        if isinstance(row, dict)
        and jetzt - float(row.get("at") or 0) <= TAGE * 86400
    ]
    frisch.append(
        {
            "title": str(eintrag.get("title") or ""),
            "body": str(eintrag.get("body") or ""),
            "category": str(eintrag.get("category") or "") or None,
            # Leer heisst: an alle. Sonst die Namen der Empfänger.
            "to": sorted(str(name) for name in (eintrag.get("to") or [])),
            "at": float(jetzt),
        }
    )
    return frisch[-HOECHSTENS:]


def fuer(rows: Any, name: str) -> list[dict[str, Any]]:
    """Die Meldungen, die diese Person bekommen hat – jüngste zuerst (rein).

    Eine Meldung ohne Empfängerliste ging an alle. Was nur an andere
    ging, gehört nicht auf diesen Zettel: Dass Lina ans Medikament
    erinnert wurde, geht die übrigen Telefone nichts an.
    """
    eigene = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and (not row.get("to") or name in row.get("to", []))
    ]
    return sorted(eigene, key=lambda row: -float(row.get("at") or 0))
