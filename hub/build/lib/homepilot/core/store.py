"""Persistenz in Supabase.

Der Store hängt am Event-Bus und schreibt gepuffert (nicht bei jedem
einzelnen Event) nach Supabase:

  entities        – aktueller Zustand, per Upsert
  state_history   – Zeitreihe für Charts
  automation_runs – Protokoll der Automationsläufe

Grundsatz: Der Hub muss ohne Datenbank vollständig funktionieren. Schlägt
ein Schreibvorgang fehl, bleiben die Daten in einer gedeckelten Warteschlange
und werden beim nächsten Flush erneut versucht.
"""

from __future__ import annotations

import asyncio
import fnmatch
import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from .supabase import SupabaseClient

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

MAX_PENDING_HISTORY = 5000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, hub: "Hub", client: SupabaseClient, config: dict[str, Any]) -> None:
        self.hub = hub
        self.client = client
        self.history_enabled: bool = bool(config.get("history", True))
        self.flush_interval: float = float(config.get("flush_interval", 5))
        self._history_exclude: list[str] = list(config.get("history_exclude") or [])

        self._pending_entities: dict[str, dict[str, Any]] = {}
        self._pending_history: list[dict[str, Any]] = []
        self._pending_runs: list[dict[str, Any]] = []
        self._restored: dict[str, dict[str, Any]] = {}
        self._unsubscribers: list[Any] = []
        self._flush_task: asyncio.Task | None = None
        self._dropped_history = 0

    # ── Lebenszyklus ───────────────────────────────────────────────────────

    async def start(self) -> None:
        await self._restore()
        self._unsubscribers = [
            self.hub.bus.subscribe("entity_added", self._on_entity_event),
            self.hub.bus.subscribe("state_changed", self._on_entity_event),
            self.hub.bus.subscribe("automation_run", self._on_automation_run),
        ]
        self._flush_task = asyncio.create_task(self._flush_loop())

    async def stop(self) -> None:
        for unsubscribe in self._unsubscribers:
            unsubscribe()
        self._unsubscribers.clear()
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except (asyncio.CancelledError, Exception):
                pass
            self._flush_task = None
        await self.flush()
        await self.client.close()

    # ── Wiederherstellen ───────────────────────────────────────────────────

    async def _restore(self) -> None:
        try:
            rows = await self.client.select("entities", {"select": "id,state"})
        except Exception as err:
            log.warning("Zustände konnten nicht aus Supabase geladen werden: %s", err)
            return
        self._restored = {
            row["id"]: row.get("state") or {} for row in rows if row.get("id")
        }
        log.info("%d gespeicherte Zustände aus Supabase geladen", len(self._restored))

    def restored_state(self, entity_id: str) -> dict[str, Any] | None:
        """Gespeicherter Zustand – füllt beim Start nur fehlende Attribute.

        Was die Integration selbst meldet, gewinnt immer: ein echtes Gerät
        ist die Wahrheit, die Datenbank nur das Gedächtnis.
        """
        return self._restored.get(entity_id)

    # ── Event-Handler ──────────────────────────────────────────────────────

    def _on_entity_event(self, event_type: str, data: dict[str, Any]) -> None:
        entity = data["entity"]
        self._pending_entities[entity["id"]] = {
            "id": entity["id"],
            "kind": entity["kind"],
            "name": entity["name"],
            "integration": entity["integration"],
            "state": entity["state"],
            "commands": entity["commands"],
            "available": entity["available"],
            "updated_at": _now_iso(),
        }
        if event_type == "state_changed" and self._records_history(entity["id"]):
            if len(self._pending_history) >= MAX_PENDING_HISTORY:
                self._pending_history.pop(0)
                self._dropped_history += 1
            self._pending_history.append(
                {
                    "entity_id": entity["id"],
                    "state": data["new_state"],
                    "recorded_at": _now_iso(),
                }
            )

    def _on_automation_run(self, _event_type: str, data: dict[str, Any]) -> None:
        self._pending_runs.append(
            {
                "automation_id": data["automation_id"],
                "alias": data.get("alias"),
                "success": data.get("success", True),
                "error": data.get("error"),
                "triggered_at": _now_iso(),
            }
        )

    def _records_history(self, entity_id: str) -> bool:
        if not self.history_enabled:
            return False
        return not any(
            fnmatch.fnmatch(entity_id, pattern) for pattern in self._history_exclude
        )

    # ── Schreiben ──────────────────────────────────────────────────────────

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(self.flush_interval)
            await self.flush()

    async def flush(self) -> None:
        if not (self._pending_entities or self._pending_history or self._pending_runs):
            return

        entities = list(self._pending_entities.values())
        history = self._pending_history
        runs = self._pending_runs
        # Erst nach erfolgreichem Schreiben verwerfen – bei einem Fehler
        # sammeln wir unten wieder ein, damit nichts verloren geht.
        self._pending_entities = {}
        self._pending_history = []
        self._pending_runs = []

        try:
            await self.client.upsert("entities", entities)
            await self.client.insert("state_history", history)
            await self.client.insert("automation_runs", runs)
        except Exception as err:
            log.warning("Schreiben nach Supabase fehlgeschlagen, wird erneut versucht: %s", err)
            for row in entities:
                self._pending_entities.setdefault(row["id"], row)
            self._pending_history = (history + self._pending_history)[-MAX_PENDING_HISTORY:]
            self._pending_runs = runs + self._pending_runs
            return

        if self._dropped_history:
            log.warning(
                "%d Verlaufseinträge verworfen (Warteschlange voll)", self._dropped_history
            )
            self._dropped_history = 0

    # ── Lesen ──────────────────────────────────────────────────────────────

    async def history(self, entity_id: str, hours: float = 24, limit: int = 500) -> list[dict]:
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        return await self.client.select(
            "state_history",
            {
                "select": "state,recorded_at",
                "entity_id": f"eq.{entity_id}",
                "recorded_at": f"gte.{since.isoformat()}",
                "order": "recorded_at.desc",
                "limit": str(limit),
            },
        )
