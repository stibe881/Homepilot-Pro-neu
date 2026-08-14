"""Deklarative Automations-Engine: Trigger → Bedingungen → Aktionen.

Trigger:
  - {type: state, entity_id, attribute?: "state", from?, to?}
  - {type: interval, seconds}
  - {type: time, at: "HH:MM"}

Bedingungen:
  - {type: state, entity_id, attribute?: "state", equals? | above? | below?}
  - {type: time, after?: "HH:MM", before?: "HH:MM"}

Aktionen:
  - {type: command, entity_id, command, data?}
  - {type: delay, seconds}
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)


@dataclass
class Automation:
    id: str
    alias: str
    triggers: list[dict[str, Any]]
    conditions: list[dict[str, Any]] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "alias": self.alias,
            "triggers": self.triggers,
            "conditions": self.conditions,
            "actions": self.actions,
        }


def _as_list(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, dict):
        return [value]
    return list(value)


def parse_automations(configs: list[dict[str, Any]]) -> list[Automation]:
    automations = []
    for index, config in enumerate(configs):
        auto_id = str(config.get("id") or f"automation_{index}")
        automations.append(
            Automation(
                id=auto_id,
                alias=str(config.get("alias") or auto_id),
                triggers=_as_list(config.get("trigger")),
                conditions=_as_list(config.get("condition")),
                actions=_as_list(config.get("action")),
            )
        )
    return automations


def _parse_hhmm(value: str) -> tuple[int, int]:
    hours, minutes = str(value).split(":", 1)
    return int(hours), int(minutes)


class AutomationEngine:
    def __init__(self, hub: "Hub") -> None:
        self.hub = hub
        self.automations: list[Automation] = []
        self._unsubscribe = None
        self._timer_tasks: list[asyncio.Task] = []
        self._run_tasks: set[asyncio.Task] = set()
        self._running: set[str] = set()

    async def start(self, configs: list[dict[str, Any]]) -> None:
        self.automations = parse_automations(configs)
        self._unsubscribe = self.hub.bus.subscribe("state_changed", self._on_state_changed)
        for automation in self.automations:
            for trigger in automation.triggers:
                if trigger.get("type") == "interval":
                    task = asyncio.create_task(
                        self._interval_loop(automation, float(trigger["seconds"]))
                    )
                    self._timer_tasks.append(task)
                elif trigger.get("type") == "time":
                    task = asyncio.create_task(
                        self._time_loop(automation, str(trigger["at"]))
                    )
                    self._timer_tasks.append(task)
        if self.automations:
            log.info("%d Automationen geladen", len(self.automations))

    async def stop(self) -> None:
        if self._unsubscribe:
            self._unsubscribe()
            self._unsubscribe = None
        for task in [*self._timer_tasks, *self._run_tasks]:
            task.cancel()
        for task in [*self._timer_tasks, *self._run_tasks]:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._timer_tasks.clear()
        self._run_tasks.clear()

    # ── Trigger ────────────────────────────────────────────────────────────

    def _on_state_changed(self, _event_type: str, data: dict[str, Any]) -> None:
        for automation in self.automations:
            for trigger in automation.triggers:
                if trigger.get("type", "state") != "state":
                    continue
                if self._state_trigger_matches(trigger, data):
                    self._schedule(automation)
                    break

    @staticmethod
    def _state_trigger_matches(trigger: dict[str, Any], data: dict[str, Any]) -> bool:
        if trigger.get("entity_id") != data["entity_id"]:
            return False
        attribute = trigger.get("attribute", "state")
        old = data["old_state"].get(attribute)
        new = data["new_state"].get(attribute)
        if old == new:
            return False
        if "from" in trigger and old != trigger["from"]:
            return False
        if "to" in trigger and new != trigger["to"]:
            return False
        return True

    async def _interval_loop(self, automation: Automation, seconds: float) -> None:
        while True:
            await asyncio.sleep(seconds)
            self._schedule(automation)

    async def _time_loop(self, automation: Automation, at: str) -> None:
        hour, minute = _parse_hhmm(at)
        while True:
            now = datetime.now()
            target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if target <= now:
                target += timedelta(days=1)
            await asyncio.sleep((target - now).total_seconds())
            self._schedule(automation)

    def _schedule(self, automation: Automation) -> None:
        # Läuft die Automation bereits (z.B. in einem delay), nicht erneut starten.
        if automation.id in self._running:
            return
        task = asyncio.create_task(self._run(automation))
        self._run_tasks.add(task)
        task.add_done_callback(self._run_tasks.discard)

    # ── Ausführung ─────────────────────────────────────────────────────────

    async def _run(self, automation: Automation) -> None:
        self._running.add(automation.id)
        error: str | None = None
        executed = False
        try:
            if all(self._check_condition(c) for c in automation.conditions):
                executed = True
                log.info("Automation '%s' ausgelöst", automation.alias)
                for action in automation.actions:
                    await self._execute_action(automation, action)
        except Exception as err:
            error = str(err)
            log.exception("Automation '%s' fehlgeschlagen", automation.alias)
        finally:
            self._running.discard(automation.id)

        # Nur tatsächlich ausgeführte Läufe protokollieren – ein Trigger,
        # dessen Bedingung nicht passt, ist kein Lauf.
        if executed:
            await self.hub.bus.publish(
                "automation_run",
                {
                    "automation_id": automation.id,
                    "alias": automation.alias,
                    "success": error is None,
                    "error": error,
                },
            )

    def _check_condition(self, condition: dict[str, Any]) -> bool:
        ctype = condition.get("type", "state")
        if ctype == "state":
            entity = self.hub.registry.get(condition.get("entity_id", ""))
            if entity is None:
                return False
            value = entity.state.get(condition.get("attribute", "state"))
            if "equals" in condition:
                return value == condition["equals"]
            if "above" in condition:
                return value is not None and float(value) > float(condition["above"])
            if "below" in condition:
                return value is not None and float(value) < float(condition["below"])
            return True
        if ctype == "time":
            now = datetime.now().time()
            if "after" in condition:
                hour, minute = _parse_hhmm(condition["after"])
                if now < now.replace(hour=hour, minute=minute):
                    return False
            if "before" in condition:
                hour, minute = _parse_hhmm(condition["before"])
                if now >= now.replace(hour=hour, minute=minute):
                    return False
            return True
        log.warning("Unbekannter Bedingungstyp: %s", ctype)
        return False

    async def _execute_action(self, automation: Automation, action: dict[str, Any]) -> None:
        atype = action.get("type", "command")
        if atype == "command":
            await self.hub.integrations.dispatch_command(
                action["entity_id"], action["command"], action.get("data") or {}
            )
        elif atype == "delay":
            await asyncio.sleep(float(action["seconds"]))
        else:
            log.warning("Unbekannter Aktionstyp in '%s': %s", automation.alias, atype)
