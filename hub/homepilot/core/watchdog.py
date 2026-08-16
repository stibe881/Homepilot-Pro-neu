"""Integrations-Wächter: meldet Ausfälle als Push statt still im Log.

Alle 60 Sekunden wird je Integration geprüft, ob noch mindestens eine ihrer
Entitäten erreichbar ist. Fällt eine Integration komplett aus (und bleibt es
über eine Karenzzeit), geht eine Push-Nachricht an Besitzer und Mitbewohner;
kommt sie zurück, ebenfalls. Die letzten Ausfälle stehen im System-Screen.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

# Erst nach zwei Fehlrunden melden – ein einzelner Timeout ist kein Ausfall.
GRACE_ROUNDS = 2
INTERVAL = 60.0
# Integrationen ohne eigene Verbindung, die nie „ausfallen“ können.
IGNORE = frozenset({"demo", "helpers", "group", "adaptive", "presence_sim"})


def down_integrations(entities: list[Any]) -> set[str]:
    """Integrationen, deren Entitäten allesamt nicht erreichbar sind (rein).

    Eine Integration ganz ohne Entitäten zählt nicht als ausgefallen – sie
    ist entweder noch am Starten oder liefert bewusst nichts.
    """
    seen: dict[str, bool] = {}
    for entity in entities:
        name = entity.integration
        seen[name] = seen.get(name, False) or entity.available
    return {
        name for name, any_available in seen.items()
        if not any_available and name not in IGNORE
    }


class Watchdog:
    def __init__(self, hub: "Hub") -> None:
        self.hub = hub
        # Integration → Anzahl Fehlrunden in Folge.
        self._strikes: dict[str, int] = {}
        # Aktuell als ausgefallen gemeldete Integrationen (seit Zeitstempel).
        self.down_since: dict[str, float] = {}
        # Protokoll der letzten Ausfälle für die App (jüngste zuerst).
        self.outages: list[dict[str, Any]] = []
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(INTERVAL)
            try:
                await self.check()
            except Exception:
                log.exception("Wächter-Runde fehlgeschlagen")

    async def check(self) -> None:
        down = down_integrations(self.hub.registry.all())

        # Strikes hochzählen bzw. zurücksetzen.
        for name in down:
            self._strikes[name] = self._strikes.get(name, 0) + 1
        for name in list(self._strikes):
            if name not in down:
                self._strikes.pop(name)

        # Neu ausgefallen (Karenz überschritten)?
        for name, strikes in self._strikes.items():
            if strikes == GRACE_ROUNDS and name not in self.down_since:
                self.down_since[name] = time.time()
                self._log_outage(name, ended=None)
                await self._notify(
                    f"{name} nicht erreichbar",
                    f"Die Integration '{name}' antwortet seit "
                    f"{round(GRACE_ROUNDS * INTERVAL / 60)} Minuten nicht mehr.",
                )

        # Wieder zurück?
        for name in list(self.down_since):
            if name not in down:
                started = self.down_since.pop(name)
                minutes = max(1, round((time.time() - started) / 60))
                self._close_outage(name)
                await self._notify(
                    f"{name} wieder da",
                    f"Die Integration '{name}' ist nach {minutes} Minuten wieder erreichbar.",
                )

    def _log_outage(self, name: str, ended: float | None) -> None:
        self.outages.insert(
            0, {"integration": name, "since": time.time(), "ended": ended}
        )
        del self.outages[20:]

    def _close_outage(self, name: str) -> None:
        for entry in self.outages:
            if entry["integration"] == name and entry["ended"] is None:
                entry["ended"] = time.time()
                break

    async def _notify(self, title: str, body: str) -> None:
        log.warning("%s – %s", title, body)
        try:
            tokens = self.hub.push.recipients(self.hub.users.users, "all")
            await self.hub.push.send(tokens, title=title, body=body)
        except Exception:
            log.exception("Wächter-Push nicht zustellbar")
