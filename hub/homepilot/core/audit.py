"""Wer hat wann was geschaltet – über Neustarts hinweg.

Die Live-Liste «Zuletzt passiert» in der App ist flüchtig: Sie beginnt bei
jedem Verbinden neu. Für die Fragen, die man wirklich stellt – «wer hat
die Türe um halb drei geöffnet», «wann wurde die Anlage unscharf
geschaltet» –, braucht es ein Protokoll, das den Neustart überlebt.

Bewusst nur Befehle von Menschen und nur die sicherheitsrelevanten dazu
mit Adresse: Ein vollständiges Protokoll aller Zustandswechsel wäre nach
einer Woche unlesbar und stünde vor allem im Weg.
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

# So viele Einträge bleiben erhalten. Bei normalem Gebrauch sind das
# mehrere Wochen; die Datei bleibt dabei im niedrigen dreistelligen
# Kilobyte-Bereich.
LIMIT = 1000

# Gerätearten, bei denen zusätzlich die Adresse festgehalten wird. Bei
# einer Lampe interessiert niemanden, von wo sie geschaltet wurde; beim
# Türschloss schon.
SENSITIVE_KINDS = frozenset({"lock", "alarm"})


def entry(
    user: str,
    entity_id: str,
    entity_name: str,
    command: str,
    kind: str = "",
    address: str | None = None,
) -> dict[str, Any]:
    """Ein Protokoll-Eintrag (rein, testbar)."""
    row: dict[str, Any] = {
        "at": time.time(),
        "user": user,
        "entity_id": entity_id,
        "entity": entity_name,
        "command": command,
    }
    if kind in SENSITIVE_KINDS and address:
        row["address"] = address
    return row


def trim(rows: list[dict[str, Any]], limit: int = LIMIT) -> list[dict[str, Any]]:
    """Auf die jüngsten ``limit`` Einträge kürzen (rein, testbar)."""
    return rows[-limit:] if len(rows) > limit else rows


class AuditLog:
    def __init__(self, hub: Hub) -> None:
        self.hub = hub

    def record(
        self,
        user: str,
        entity: Any,
        command: str,
        address: str | None = None,
    ) -> None:
        """Einen Befehl festhalten. Fehler hier dürfen nie durchschlagen –
        ein Protokoll, das die Bedienung stört, ist schlimmer als keines."""
        try:
            rows = self.hub.data.get("audit")
            rows.append(
                entry(
                    user=user,
                    entity_id=getattr(entity, "id", "?"),
                    entity_name=getattr(entity, "name", "?"),
                    command=command,
                    kind=str(getattr(entity, "kind", "")),
                    address=address,
                )
            )
            self.hub.data.set("audit", trim(rows))
        except Exception:
            log.exception("Zugriffsprotokoll nicht schreibbar")

    def entries(self, limit: int = 200, entity_id: str | None = None) -> list[dict[str, Any]]:
        """Jüngste zuerst, optional auf ein Gerät eingegrenzt."""
        rows = self.hub.data.get("audit")
        if entity_id:
            rows = [row for row in rows if row.get("entity_id") == entity_id]
        rows.reverse()
        return rows[: max(1, limit)]
