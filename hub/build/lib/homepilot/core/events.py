"""Asynchroner Event-Bus.

Alles im Hub kommuniziert über Events ("state_changed", "entity_added",
...). Listener können auf einen Event-Typ oder mit "*" auf alles
subscriben. Fehler in Listenern werden geloggt, brechen aber nie das
Publizieren ab.
"""

from __future__ import annotations

import inspect
import logging
from collections import defaultdict
from typing import Any, Callable

log = logging.getLogger(__name__)

Callback = Callable[[str, dict[str, Any]], Any]


class EventBus:
    def __init__(self) -> None:
        self._listeners: dict[str, list[Callback]] = defaultdict(list)

    def subscribe(self, event_type: str, callback: Callback) -> Callable[[], None]:
        """Registriert einen Listener und gibt eine Unsubscribe-Funktion zurück."""
        self._listeners[event_type].append(callback)

        def unsubscribe() -> None:
            try:
                self._listeners[event_type].remove(callback)
            except ValueError:
                pass

        return unsubscribe

    async def publish(self, event_type: str, data: dict[str, Any]) -> None:
        callbacks = list(self._listeners.get(event_type, []))
        callbacks += list(self._listeners.get("*", []))
        for callback in callbacks:
            try:
                result = callback(event_type, data)
                if inspect.isawaitable(result):
                    await result
            except Exception:
                log.exception("Event-Listener für %s fehlgeschlagen", event_type)
