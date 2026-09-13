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
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from .supabase import SupabaseClient, SupabaseError

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

MAX_PENDING_HISTORY = 5000
#: Auch der Ablauf-Verlauf ist gedeckelt (Fehler aus der Runde 579 der
#: Werkbank): Er war es als Einziger nicht und wuchs bei einer Störung
#: ohne Grenze.
MAX_PENDING_RUNS = 500


def dauerhaft_abgelehnt(err: BaseException) -> bool:
    """Hilft ein zweiter Versuch mit denselben Zeilen? (rein, testbar)

    Fehler aus der Runde 579 der Werkbank: Jede Ausnahme reihte alles
    wieder ein und versuchte es alle fünf Sekunden - auch einen Rumpf,
    den Supabase mit 400 abgewiesen hatte, etwa nach einer Spaltenänderung.
    Der wurde unendlich wiederholt, und 720 gleiche Warnungen pro Stunde
    füllten den Log-Ring von 300 Zeilen.

    Abgelehnt ist, was am Rumpf liegt: 400 (kaputter Rumpf), 404 (Tabelle
    weg), 409 (Konflikt), 422 (Spalte passt nicht). Ein 401/403 (Schlüssel)
    und 429 (zu schnell) sind keine Aussage über die Zeilen; 5xx und
    Netzfehler auch nicht - die werden weiter versucht.
    """
    if not isinstance(err, SupabaseError):
        return False
    return err.status in (400, 404, 409, 422)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class Store:
    def __init__(self, hub: Hub, client: SupabaseClient, config: dict[str, Any]) -> None:
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
        # Ob gerade eine Störung läuft: Die erste Warnung sagt es, die
        # weiteren Versuche bleiben still, das Ende wird einmal gemeldet.
        self._gestoert = False
        # Je Tabelle, wie viele Zeilen Supabase abgelehnt hat - für den
        # Log und für die Frage «warum fehlt der Verlauf seit Dienstag?».
        self.abgelehnt: dict[str, int] = {}

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

        # Drei Tabellen, drei Versuche (Fehler aus der Runde 579): Vorher
        # stand alles in einem try, und ein abgelehnter Verlaufs-Rumpf
        # riss die Zustände und den Ablauf-Verlauf mit in die Schleife.
        if not await self._versuch("entities", self.client.upsert("entities", entities), len(entities)):
            for row in entities:
                self._pending_entities.setdefault(row["id"], row)
        if not await self._versuch(
            "state_history", self.client.insert("state_history", history), len(history)
        ):
            self._pending_history = (history + self._pending_history)[-MAX_PENDING_HISTORY:]
        if not await self._versuch(
            "automation_runs", self.client.insert("automation_runs", runs), len(runs)
        ):
            self._pending_runs = (runs + self._pending_runs)[-MAX_PENDING_RUNS:]

        if self._dropped_history and not self._gestoert:
            log.warning(
                "%d Verlaufseinträge verworfen (Warteschlange voll)", self._dropped_history
            )
            self._dropped_history = 0

    async def _versuch(self, table: str, schreiben: Any, anzahl: int) -> bool:
        """Eine Tabelle schreiben. True heisst: nichts wieder einreihen -
        geschrieben, oder von Supabase endgültig abgelehnt."""
        try:
            await schreiben
        except Exception as err:
            if dauerhaft_abgelehnt(err):
                # Ein zweiter Versuch mit denselben Zeilen brächte dieselbe
                # Antwort. Verwerfen, einmal laut sagen, danach zählen.
                bisher = self.abgelehnt.get(table, 0)
                self.abgelehnt[table] = bisher + anzahl
                if bisher == 0:
                    log.warning(
                        "Supabase lehnt %s ab - %d Zeilen verworfen, weitere werden nur "
                        "noch gezählt: %s", table, anzahl, err,
                    )
                else:
                    log.debug("Supabase lehnt %s weiter ab (%d Zeilen)", table, anzahl)
                return True
            if not self._gestoert:
                self._gestoert = True
                log.warning(
                    "Schreiben nach Supabase fehlgeschlagen, wird weiter versucht: %s", err
                )
            else:
                log.debug("Supabase weiterhin nicht erreichbar: %s", err)
            return False
        if self._gestoert:
            self._gestoert = False
            log.info("Supabase wieder erreichbar - Warteschlange wird nachgeschrieben")
        return True

    # ── Lesen ──────────────────────────────────────────────────────────────

    async def history(self, entity_id: str, hours: float = 24, limit: int = 500) -> list[dict]:
        since = datetime.now(UTC) - timedelta(hours=hours)
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
