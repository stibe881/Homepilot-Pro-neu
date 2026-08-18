"""Papierkorb für gelöschte Szenen und Abläufe.

Löschen ist der einzige Knopf in der App, der nichts zurücknehmen kann –
und Abläufe sind mühsam gebaut. Dreissig Tage Aufbewahrung kosten ein
paar Kilobyte und ersparen im Zweifel einen Abend Nacharbeit.

Nach Ablauf verschwinden die Einträge von selbst; wer sie sofort weghaben
will, leert den Korb.
"""

from __future__ import annotations

import time
from typing import Any

# So lange bleibt Gelöschtes liegen.
KEEP_DAYS = 30
KEEP_SECONDS = KEEP_DAYS * 24 * 3600
# Obergrenze, damit ein Aufräumtag den Korb nicht sprengt.
LIMIT = 100


def put(rows: list[dict[str, Any]], kind: str, item: dict[str, Any], by: str) -> list[dict[str, Any]]:
    """Einen Eintrag hineinlegen (rein, testbar)."""
    rows = list(rows)
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
    return purge(rows)


def purge(rows: list[dict[str, Any]], now: float | None = None) -> list[dict[str, Any]]:
    """Abgelaufenes entfernen und auf die Obergrenze kürzen (rein, testbar)."""
    moment = time.time() if now is None else now
    fresh = [
        row
        for row in rows or []
        if isinstance(row, dict) and moment - float(row.get("at") or 0) < KEEP_SECONDS
    ]
    return fresh[:LIMIT]


def take(rows: list[dict[str, Any]], kind: str, item_id: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Einen Eintrag herausnehmen (rein, testbar).

    Gibt den Eintrag und die verbleibende Liste zurück; None, wenn es ihn
    nicht (mehr) gibt.
    """
    for index, row in enumerate(rows or []):
        if row.get("kind") == kind and str((row.get("item") or {}).get("id")) == item_id:
            rest = list(rows)
            del rest[index]
            return row, rest
    return None, list(rows or [])
