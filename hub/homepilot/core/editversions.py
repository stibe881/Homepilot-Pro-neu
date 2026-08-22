"""Frühere Fassungen bearbeiteter Szenen und Abläufe.

Der Papierkorb (trash.py) fängt das Löschen ab - das Überschreiben fing
bisher niemand. Wer einen mühsam gebauten Ablauf «kurz anpasst» und dabei
zerlegt, hatte den alten Stand nur noch im Kopf. Deshalb legt der Hub vor
jedem Speichern die bisherige Fassung hier ab; die App bietet sie unter
«Frühere Fassungen» zum Zurückholen an.

Für die config.yaml gibt es dasselbe längst (confighistory.py) - dieses
Modul ist das Gegenstück für alles, was in der App gebaut wird und in
hub.data liegt.
"""

from __future__ import annotations

import time
from typing import Any

# Je Szene/Ablauf höchstens so viele Fassungen. Mehr beantwortet keine
# Frage - wer fünf Speicherstände zurück muss, baut ohnehin neu.
KEEP_PER_ITEM = 5
# Obergrenze über alles, damit die Datei nicht unbemerkt wächst.
LIMIT = 200


def _key(row: dict[str, Any]) -> tuple[str, str]:
    return (
        str(row.get("kind") or ""),
        str((row.get("item") or {}).get("id") or ""),
    )


def remember(
    rows: list[dict[str, Any]], kind: str, item: dict[str, Any], by: str
) -> list[dict[str, Any]]:
    """Die bisherige Fassung ablegen, bevor sie überschrieben wird (rein, testbar)."""
    rows = [row for row in rows or [] if isinstance(row, dict)]
    rows.insert(
        0,
        {
            "kind": kind,
            "at": time.time(),
            "by": by,
            "name": str(item.get("alias") or item.get("name") or item.get("id") or "?"),
            "item": item,
        },
    )
    return prune(rows)


def prune(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Je Eintrag die jüngsten ``KEEP_PER_ITEM`` behalten (rein, testbar)."""
    seen: dict[tuple[str, str], int] = {}
    kept: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        key = _key(row)
        if seen.get(key, 0) >= KEEP_PER_ITEM:
            continue
        seen[key] = seen.get(key, 0) + 1
        kept.append(row)
    return kept[:LIMIT]


def versions_of(
    rows: list[dict[str, Any]], kind: str, item_id: str
) -> list[dict[str, Any]]:
    """Die Fassungen genau eines Eintrags, jüngste zuerst (rein, testbar)."""
    return [
        row
        for row in rows or []
        if isinstance(row, dict) and _key(row) == (kind, str(item_id))
    ]


def find(
    rows: list[dict[str, Any]], kind: str, item_id: str, at: float
) -> dict[str, Any] | None:
    """Eine bestimmte Fassung über ihren Zeitstempel (rein, testbar).

    Der Zeitstempel ist die Kennung: Er steht in der Liste, die die App
    anzeigt, und JSON gibt Gleitkommazahlen bitgenau wieder - ein
    Toleranzfenster würde bei zwei schnellen Speichervorgängen nur die
    falsche Fassung treffen.
    """
    for row in versions_of(rows, kind, item_id):
        if float(row.get("at") or 0) == at:
            return row
    return None
