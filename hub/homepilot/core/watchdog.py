"""Wächter: meldet Ausfälle und schwache Batterien als Push statt still im Log.

Drei Dinge werden im Minutentakt geprüft:

  - Fällt eine ganze Integration aus (und bleibt es über eine Karenzzeit),
    geht eine Push-Nachricht raus; kommt sie zurück, ebenfalls.
  - Einzelne *überwachte* Geräte, die längere Zeit nicht antworten. Nicht
    alle: Bei hundert Geräten wäre jede Störung eine Nachricht. Überwacht
    ist, was die Alarmanlage bewacht – das hat jemand bewusst als wichtig
    eingestuft – und was ausdrücklich markiert wurde.
  - Schwache Batterien. Ein Rauchmelder mit leerer Batterie ist still, und
    genau das darf man nicht zufällig entdecken.

Die letzten Ausfälle stehen im System-Screen.
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
# So lange darf ein einzelnes Gerät schweigen, bevor es gemeldet wird.
# Grosszügiger als bei Integrationen: Ein Funkgerät verpasst mal eine Runde.
DEVICE_GRACE_ROUNDS = 30
# So lange nach dem Programmende wird an die volle Maschine erinnert.
# Zwei Stunden: lang genug, dass man nicht wegen des Wegs vom Keller
# gemahnt wird, kurz genug, dass die Wäsche nicht über Nacht knittert.
APPLIANCE_REMINDER = 2 * 3600
# Integrationen ohne eigene Verbindung, die nie „ausfallen“ können.
IGNORE = frozenset({"demo", "helpers", "group", "adaptive", "presence_sim", "alarm"})


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


def watched_entities(entities: list[Any], guarded: set[str]) -> list[Any]:
    """Welche Geräte einzeln überwacht werden (rein, testbar).

    Alles zu melden wäre Lärm; nichts zu melden hiesse, einen toten
    Rauchmelder erst beim Brand zu bemerken. Überwacht wird deshalb, was
    die Alarmanlage bewacht – diese Auswahl hat jemand bewusst getroffen.
    """
    return [entity for entity in entities if entity.id in guarded]


def low_batteries(entities: list[Any]) -> list[Any]:
    """Geräte, die eine schwache Batterie melden (rein, testbar)."""
    return [entity for entity in entities if entity.state.get("low_battery") is True]


class Watchdog:
    def __init__(self, hub: "Hub") -> None:
        self.hub = hub
        # Integration → Anzahl Fehlrunden in Folge.
        self._strikes: dict[str, int] = {}
        # Gerät → Fehlrunden in Folge, und was schon gemeldet wurde.
        self._device_strikes: dict[str, int] = {}
        self._reported_down: set[str] = set()
        self._reported_battery: set[str] = set()
        # Haushaltgeräte: Zustand der letzten Runde, Zeitpunkt des
        # Programmendes und was schon erinnert wurde.
        self._last_state: dict[str, str] = {}
        self._finished_at: dict[str, float] = {}
        self._reminded: set[str] = set()
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

    def _guarded(self) -> set[str]:
        """Die Sensoren, die der Alarmanlage zugeordnet sind."""
        alarm = self.hub.integrations.get("alarm")
        sensors = getattr(alarm, "_sensors", None)
        if not isinstance(sensors, dict):
            return set()
        return {
            entity_id
            for entity_id, entry in sensors.items()
            if entry.get("modes")
        }

    async def check(self) -> None:
        entities = self.hub.registry.all()
        await self._check_appliances(entities)
        await self._check_devices(entities)
        await self._check_batteries(entities)
        down = down_integrations(entities)

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

    async def _check_devices(self, entities: list[Any]) -> None:
        """Einzelne überwachte Geräte, die nicht mehr antworten."""
        watched = watched_entities(entities, self._guarded())
        for entity in watched:
            if entity.available:
                self._device_strikes.pop(entity.id, None)
                if entity.id in self._reported_down:
                    self._reported_down.discard(entity.id)
                    await self._notify(
                        f"{entity.name} wieder da",
                        "Der Sensor meldet sich wieder.",
                    )
                continue
            strikes = self._device_strikes.get(entity.id, 0) + 1
            self._device_strikes[entity.id] = strikes
            if strikes == DEVICE_GRACE_ROUNDS and entity.id not in self._reported_down:
                self._reported_down.add(entity.id)
                await self._notify(
                    f"{entity.name} antwortet nicht",
                    f"Seit {round(DEVICE_GRACE_ROUNDS * INTERVAL / 60)} Minuten "
                    "keine Meldung – die Alarmanlage hat dort einen blinden Fleck.",
                )

    async def _check_appliances(self, entities: list[Any]) -> None:
        """An die fertige, aber noch volle Maschine erinnern.

        Die Push beim Programmende schickt das Gerät selbst – die geht im
        Alltag unter, wenn man gerade nicht kann. Erinnert wird deshalb
        erst später, und nur einmal je Programm: Wer die Maschine ausräumt,
        startet sie irgendwann neu, und damit ist der Merker wieder frei.
        """
        now = time.time()
        for entity in entities:
            if entity.kind != "appliance":
                continue
            state = str(entity.state.get("state") or "")
            before = self._last_state.get(entity.id)
            self._last_state[entity.id] = state

            if state == "running":
                self._finished_at.pop(entity.id, None)
                self._reminded.discard(entity.id)
                continue
            if before == "running" and state == "idle":
                self._finished_at[entity.id] = now
                continue

            since = self._finished_at.get(entity.id)
            if since is None or entity.id in self._reminded:
                continue
            if now - since >= APPLIANCE_REMINDER:
                self._reminded.add(entity.id)
                hours = round((now - since) / 3600)
                await self._notify(
                    f"{entity.name} ist noch voll",
                    f"Seit {hours} Stunden fertig und seither nicht wieder "
                    "gelaufen.",
                )

    async def _check_batteries(self, entities: list[Any]) -> None:
        """Schwache Batterien – einmal melden, nicht jede Minute."""
        weak = {entity.id for entity in low_batteries(entities)}
        for entity in low_batteries(entities):
            if entity.id in self._reported_battery:
                continue
            self._reported_battery.add(entity.id)
            await self._notify(
                f"Batterie schwach: {entity.name}",
                "Das Gerät meldet eine schwache Batterie. Danach ist es still, "
                "ohne sich abzumelden.",
            )
        # Gewechselte Batterien wieder scharf stellen für die nächste Warnung.
        self._reported_battery &= weak

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
