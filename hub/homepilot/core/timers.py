"""Küchen-Timer: Minuten wählen, und der Hub meldet sich.

Der Eierwecker, den man nie suchen muss: Nach Ablauf kommt eine Push an
alle und - wo Cast-Boxen stehen - eine Durchsage.

Die Timer liegen in der ``hub.data`` und überleben damit den Neustart.
«Bewusst nur im Speicher» stand hier lange - mit der Begründung, ein
Küchen-Timer laufe Minuten, keine Tage. Das Argument übersieht, wann
dieser Hub neu startet: beim Update-Knopf, und der wird gern abends
gedrückt - genau dann, wenn in der Küche etwas im Ofen ist. Ein Wecker,
der beim Ausliefern stirbt, ist ein kaputter Wecker.

Wiederhergestellt wird ehrlich: Ein Timer, der während des Neustarts
abgelaufen ist, meldet sich sofort mit dem Hinweis, dass er verspätet
kommt - lieber eine späte Meldung als gar keine, das Essen steht ja
immer noch im Ofen.
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

#: Wo die laufenden Timer liegen (siehe persistence.py).
STORE_KEY = "kitchen_timers"

#: Länger als das darf eine Meldung nicht verspätet sein. Wer den Hub
#: einen halben Tag ausgeschaltet lässt, braucht keinen Eierwecker von
#: gestern - der Fall ist dann ohnehin gelaufen.
MAX_VERSPAETUNG = 3600.0


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
        self._merken()
        return {key: value for key, value in entry.items() if key != "task"}

    def cancel(self, timer_id: str) -> bool:
        entry = self._timers.pop(timer_id, None)
        if entry is None:
            return False
        entry["task"].cancel()
        self._merken()
        return True

    def restore(self) -> None:
        """Beim Hub-Start: gemerkte Timer wieder aufnehmen.

        Drei Fälle, drei Antworten: Was noch läuft, läuft weiter. Was
        während des Neustarts abgelaufen ist, meldet sich sofort - mit
        dem Hinweis, dass es verspätet kommt. Was länger als eine Stunde
        her ist, wird stillschweigend verworfen; ein Eierwecker von
        gestern hilft niemandem mehr.
        """
        jetzt = time.time()
        for roh in self.hub.data.get(STORE_KEY):
            if not isinstance(roh, dict) or not roh.get("id"):
                continue
            try:
                ends_at = float(roh.get("ends_at") or 0)
            except (TypeError, ValueError):
                continue
            if ends_at <= jetzt - MAX_VERSPAETUNG:
                continue
            entry: dict[str, Any] = {
                "id": str(roh["id"]),
                "text": str(roh.get("text") or "Der Timer ist um."),
                "ends_at": ends_at,
                "minutes": int(roh.get("minutes") or 0),
                "by": str(roh.get("by") or ""),
            }
            if ends_at <= jetzt:
                entry["text"] = f"{entry['text']} (verspätet - der Hub war kurz weg)"
            entry["task"] = asyncio.create_task(self._run(entry))
            self._timers[entry["id"]] = entry
        self._merken()

    def _merken(self) -> None:
        """Den Stand auf die Platte - ohne die Task-Objekte."""
        self.hub.data.set(STORE_KEY, self.list())

    async def stop(self) -> None:
        """Nur die Tasks beenden - die Einträge bleiben auf der Platte.

        `cancel` wäre hier falsch: Es räumt auch den gemerkten Stand weg,
        und genau der soll den Neustart überleben.
        """
        for entry in self._timers.values():
            entry["task"].cancel()
        self._timers.clear()

    async def _run(self, entry: dict[str, Any]) -> None:
        try:
            await asyncio.sleep(max(0.0, entry["ends_at"] - time.time()))
        except asyncio.CancelledError:
            return
        self._timers.pop(entry["id"], None)
        self._merken()
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
                data={"type": "timer", "ziel": "timer"},
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
