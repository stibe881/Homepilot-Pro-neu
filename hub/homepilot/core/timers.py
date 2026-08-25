"""Küchen-Timer: Minuten wählen, und der Hub meldet sich.

Der Eierwecker, den man nie suchen muss: Nach Ablauf kommt eine Push an
alle und - wo Cast-Boxen stehen - eine Durchsage. Bewusst nur im
Speicher: Ein Timer über einen Hub-Neustart hinweg wäre ohnehin
Glückssache, und ein Küchen-Timer läuft Minuten, keine Tage.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from typing import TYPE_CHECKING, Any

from .errors import HomePilotError

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

MAX_MINUTES = 180
MAX_TEXT = 100


class KitchenTimers:
    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        # id → {id, text, ends_at, by, task}
        self._timers: dict[str, dict[str, Any]] = {}

    def list(self) -> list[dict[str, Any]]:
        """Laufende Timer, der nächste zuerst - ohne die Task-Objekte."""
        entries = [
            {key: value for key, value in entry.items() if key != "task"}
            for entry in self._timers.values()
        ]
        return sorted(entries, key=lambda entry: entry["ends_at"])

    def start(self, minutes: float, text: str, by: str) -> dict[str, Any]:
        cleaned = (text or "").strip()[:MAX_TEXT]
        if not (0 < minutes <= MAX_MINUTES):
            raise HomePilotError(
                f"Zwischen einer Minute und {MAX_MINUTES} Minuten - ein "
                "Küchen-Timer ist kein Kalender."
            )
        entry: dict[str, Any] = {
            "id": secrets.token_urlsafe(8),
            "text": cleaned or "Der Timer ist um.",
            "ends_at": time.time() + minutes * 60,
            "minutes": round(minutes),
            "by": by,
        }
        entry["task"] = asyncio.create_task(self._run(entry))
        self._timers[entry["id"]] = entry
        return {key: value for key, value in entry.items() if key != "task"}

    def cancel(self, timer_id: str) -> bool:
        entry = self._timers.pop(timer_id, None)
        if entry is None:
            return False
        entry["task"].cancel()
        return True

    async def stop(self) -> None:
        for timer_id in list(self._timers):
            self.cancel(timer_id)

    async def _run(self, entry: dict[str, Any]) -> None:
        try:
            await asyncio.sleep(max(0.0, entry["ends_at"] - time.time()))
        except asyncio.CancelledError:
            return
        self._timers.pop(entry["id"], None)
        await self._announce(entry)

    async def _announce(self, entry: dict[str, Any]) -> None:
        """Push an alle, Durchsage wo möglich - jeder Weg für sich.

        Ein Timer, der wegen fehlender Boxen auch die Push verschluckt,
        wäre ein kaputter Wecker.
        """
        try:
            tokens = self.hub.push.recipients(self.hub.users.users, "all", "timer")
            await self.hub.push.send(
                tokens,
                title="⏰ Küchen-Timer",
                body=entry["text"],
                data={"type": "timer"},
                category="timer",
            )
        except Exception:
            log.exception("Timer-Push nicht zustellbar")
        try:
            from . import say

            await say.speak(self.hub, entry["text"])
        except Exception as err:
            # Keine Boxen, kein Internet, keine bekannte Adresse - alles
            # kein Grund zur Aufregung, die Push kam ja.
            log.info("Timer ohne Durchsage: %s", err)
