"""Deklarative Automations-Engine: Trigger → Bedingungen → Aktionen.

Trigger:
  - {type: state, entity_id, attribute?: "state", from?, to?}
  - {type: state, entity_id, attribute, above? | below?}   # Schwelle gekreuzt
  - {type: interval, seconds}
  - {type: time, at: "HH:MM"}
  - {type: sun, event: "sunrise"|"sunset", offset?: minuten}  # +/- Versatz

Bedingungen:
  - {type: state, entity_id, attribute?: "state", equals? | above? | below?}
  - {type: time, after?: "HH:MM", before?: "HH:MM"}
  - {type: sun, state: "up"|"down"}   # steht die Sonne über dem Horizont?

Aktionen:
  - {type: command, entity_id, command, data?}
  - {type: delay, seconds}
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from . import astro
from .source import as_source, automation_source

if TYPE_CHECKING:
    from .hub import Hub

# Standard-Standort (Zell LU), falls in der Config keiner steht.
DEFAULT_LAT = 47.1445
DEFAULT_LON = 8.0675

log = logging.getLogger(__name__)


def crosses_threshold(
    old: Any, new: Any, above: Any = None, below: Any = None
) -> bool:
    """Wurde eine Schwelle gerade überschritten? (rein, testbar)

    Für Messwerte, die sich dauernd ändern – Leistung, Temperatur. Ein
    Trigger soll dann genau beim Übertritt auslösen, nicht bei jeder
    Schwankung darunter: Der Tumbler ist fertig, wenn die Leistung von
    «über 5 W» auf «unter 5 W» fällt, nicht jedes Mal, wenn 2.1 W zu 2.0 W
    wird. Ein unbekannter alter Wert zählt nicht als Übertritt.
    """
    try:
        new_value = float(new)
        old_value = float(old)
    except (TypeError, ValueError):
        return False
    if above is not None:
        return old_value <= float(above) < new_value
    if below is not None:
        return new_value < float(below) <= old_value
    return False


# Wandtaster melden bei jedem Druck denselben Wert – «kurz gedrückt» bleibt
# «kurz gedrückt». Damit der zweite Druck nicht als «nichts geändert»
# durchfällt, tragen solche Entitäten den Zeitpunkt des Drucks mit.
PRESS_MARKER = "last_press"


def _pressed_again(data: dict[str, Any]) -> bool:
    """Ein neues Ereignis trotz gleichen Zustands? (rein, testbar)

    Ohne das hätte ein Wandtaster genau einmal funktioniert: Beim zweiten
    Druck auf dieselbe Taste steht wieder «short» da, und die Prüfung
    «hat sich etwas geändert?» hätte ihn verworfen.
    """
    new = data.get("new_state") or {}
    if PRESS_MARKER not in new:
        return False
    return (data.get("old_state") or {}).get(PRESS_MARKER) != new[PRESS_MARKER]


@dataclass
class Automation:
    id: str
    alias: str
    triggers: list[dict[str, Any]]
    conditions: list[dict[str, Any]] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)
    # Aus der config.yaml stammende sind in der App nur lesbar.
    editable: bool = False
    # Ausgeschaltete Abläufe bleiben stehen, laufen aber nicht. Besser als
    # löschen: Ein Ablauf, den man im Sommer nicht braucht, ist im Winter
    # sonst neu zu bauen.
    enabled: bool = True
    # Wie die Bedingungen verknüpft sind: «all» = alle müssen stimmen,
    # «any» = eine genügt. Auslöser sind davon nicht betroffen – sie sind
    # Ereignisse und können gar nicht gleichzeitig eintreten, ein «und»
    # zwischen ihnen wäre also nie erfüllt.
    match: str = "all"
    # Frei benannte Kategorie zum Gruppieren in der App. Es gibt keine
    # Liste erlaubter Namen: Wer einen neuen tippt, hat ihn damit angelegt –
    # eine Kategorie ohne Einträge braucht niemand.
    category: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "alias": self.alias,
            "triggers": self.triggers,
            "conditions": self.conditions,
            "actions": self.actions,
            "editable": self.editable,
            "enabled": self.enabled,
            "match": self.match,
            "category": self.category,
        }

    def as_config(self) -> dict[str, Any]:
        """Zurück in die Form, in der sie gespeichert wird."""
        return {
            "id": self.id,
            "alias": self.alias,
            "trigger": self.triggers,
            "condition": self.conditions,
            "action": self.actions,
            "enabled": self.enabled,
            "match": self.match,
            "category": self.category,
        }


# So viele Läufe merkt sich der Hub – genug, um einen Abend nachzuvollziehen.
RUN_LIMIT = 100


def describe_condition(condition: dict[str, Any], value: Any) -> str:
    """Warum eine Bedingung nicht passte, in einem Satz (rein, testbar).

    «Bedingung 2 war falsch» hilft niemandem. «Helligkeit war 44, verlangt
    ist unter 30» beantwortet die Frage sofort.
    """
    ctype = condition.get("type", "state")
    if ctype == "time":
        window = " bis ".join(
            part for part in (condition.get("after"), condition.get("before")) if part
        )
        return f"Uhrzeit ausserhalb {window or '(kein Fenster)'}"
    if ctype == "sun":
        want = "Tag" if str(condition.get("state", "up")) == "up" else "Nacht"
        return f"Es ist nicht {want}"
    name = condition.get("entity_id", "Gerät")
    shown = "nichts" if value is None else f"«{value}»"
    if "above" in condition:
        return f"{name} ist {shown}, verlangt ist über {condition['above']}"
    if "below" in condition:
        return f"{name} ist {shown}, verlangt ist unter {condition['below']}"
    if "equals" in condition:
        return f"{name} ist {shown}, verlangt ist «{condition['equals']}»"
    return f"{name} passt nicht"


def _as_list(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, dict):
        return [value]
    return list(value)


def parse_automations(
    configs: list[dict[str, Any]], editable: bool = False
) -> list[Automation]:
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
                editable=editable,
                enabled=config.get("enabled", True) is not False,
                match="any" if str(config.get("match")) == "any" else "all",
                category=str(config["category"]) if config.get("category") else None,
            )
        )
    return automations


def _parse_hhmm(value: str) -> tuple[int, int]:
    hours, minutes = str(value).split(":", 1)
    return int(hours), int(minutes)


class AutomationEngine:
    def __init__(self, hub: "Hub") -> None:
        # Protokoll der letzten Läufe, jüngster zuerst – auch der nicht
        # ausgeführten, denn genau die wirft man dem Hub vor.
        self.runs: list[dict[str, Any]] = []
        self.hub = hub
        self.automations: list[Automation] = []
        self._unsubscribe = None
        self._timer_tasks: list[asyncio.Task] = []
        self._run_tasks: set[asyncio.Task] = set()
        self._running: set[str] = set()
        # Bis zu diesem Zeitpunkt laufen keine Automationen – für Abende mit
        # Gästen oder wenn man selbst am Basteln ist.
        self.paused_until: datetime | None = None

    @property
    def paused(self) -> bool:
        if self.paused_until is None:
            return False
        if datetime.now() >= self.paused_until:
            self.paused_until = None
            return False
        return True

    def pause(self, seconds: float) -> datetime | None:
        """Pausiert für n Sekunden; 0 hebt die Pause auf."""
        self.paused_until = (
            datetime.now() + timedelta(seconds=seconds) if seconds > 0 else None
        )
        if self.paused_until:
            log.info("Automationen pausiert bis %s", self.paused_until.strftime("%H:%M"))
        else:
            log.info("Automationen wieder aktiv")
        return self.paused_until

    async def start(
        self,
        configs: list[dict[str, Any]],
        stored: list[dict[str, Any]] | None = None,
    ) -> None:
        # Konfigurierte zuerst, danach die in der App angelegten.
        self.automations = parse_automations(configs) + parse_automations(
            stored or [], editable=True
        )
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
                elif trigger.get("type") == "sun":
                    task = asyncio.create_task(
                        self._sun_loop(
                            automation,
                            str(trigger.get("event", "sunset")),
                            float(trigger.get("offset", 0)),
                        )
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
            if not automation.enabled:
                continue
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
        if old == new and not _pressed_again(data):
            return False
        if "above" in trigger or "below" in trigger:
            return crosses_threshold(old, new, trigger.get("above"), trigger.get("below"))
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

    def _location(self) -> tuple[float, float]:
        loc = getattr(self.hub.config, "location", None) or {}
        try:
            return float(loc.get("latitude", DEFAULT_LAT)), float(
                loc.get("longitude", DEFAULT_LON)
            )
        except (TypeError, ValueError):
            return DEFAULT_LAT, DEFAULT_LON

    async def _sun_loop(self, automation: Automation, event: str, offset: float) -> None:
        lat, lon = self._location()
        sunset = event != "sunrise"
        while True:
            nxt = astro.next_sun_event(datetime.now(), lat, lon, sunset, offset)
            if nxt is None:
                # In Polarnähe an manchen Tagen kein Ereignis – später erneut.
                await asyncio.sleep(6 * 3600)
                continue
            delay = (nxt - datetime.now()).total_seconds()
            if delay > 0:
                await asyncio.sleep(delay)
            self._schedule(automation)
            # Etwas über den Zeitpunkt hinaus schlafen, damit nicht im selben
            # Moment gleich das nächste (identische) Ziel berechnet wird.
            await asyncio.sleep(60)

    def _schedule(self, automation: Automation) -> None:
        if self.paused:
            log.debug("Automation '%s' übersprungen (pausiert)", automation.alias)
            return
        # Läuft die Automation bereits (z.B. in einem delay), nicht erneut starten.
        if automation.id in self._running:
            return
        task = asyncio.create_task(self._run(automation))
        self._run_tasks.add(task)
        task.add_done_callback(self._run_tasks.discard)

    async def trigger_now(self, automation_id: str, ignore_conditions: bool = True) -> bool:
        """Einen Ablauf sofort ausführen – für den «Testen»-Knopf der App.

        ``ignore_conditions`` führt die Aktionen auch aus, wenn die
        Bedingungen gerade nicht passen (man will beim Testen das Ergebnis
        sehen, nicht die Bedingung prüfen). Gibt False zurück, wenn es den
        Ablauf nicht gibt.
        """
        automation = next(
            (a for a in self.automations if a.id == automation_id), None
        )
        if automation is None:
            return False
        with as_source(automation_source(automation.id, automation.alias)):
            for action in automation.actions:
                await self._execute_action(automation, action)
        return True

    # ── Ausführung ─────────────────────────────────────────────────────────

    async def _run(self, automation: Automation) -> None:
        self._running.add(automation.id)
        error: str | None = None
        executed = False
        try:
            held, failed = self._conditions_hold(automation)
            if held:
                executed = True
                log.info("Automation '%s' ausgelöst", automation.alias)
                # Alles, was jetzt folgt, wird der Automation zugeschrieben.
                with as_source(automation_source(automation.id, automation.alias)):
                    for action in automation.actions:
                        await self._execute_action(automation, action)
        except Exception as err:
            error = str(err)
            log.exception("Automation '%s' fehlgeschlagen", automation.alias)
        finally:
            self._running.discard(automation.id)

        # Auch der nicht ausgeführte Lauf wird protokolliert – mit dem
        # Grund. Genau danach sucht man, wenn ein Ablauf schweigt.
        self._note(
            automation,
            executed=executed,
            error=error,
            skipped=[] if executed else failed,
        )
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

    def _note(
        self,
        automation: Automation,
        *,
        executed: bool,
        error: str | None,
        skipped: list[str],
    ) -> None:
        self.runs.insert(
            0,
            {
                "automation_id": automation.id,
                "alias": automation.alias,
                "at": time.time(),
                "executed": executed,
                "error": error,
                "skipped": skipped,
            },
        )
        del self.runs[RUN_LIMIT:]

    def _conditions_hold(self, automation: Automation) -> tuple[bool, list[str]]:
        """Stimmen die Bedingungen? Ohne Bedingungen: ja.

        Gibt zusätzlich zurück, welche Bedingungen nicht erfüllt waren.
        Ohne diese Begründung rätselt man bei einem stummen Ablauf, ob der
        Auslöser nicht kam oder eine Bedingung im Weg war – und das war
        bisher nirgends zu sehen.

        «any» ohne Bedingungen wäre sonst nie erfüllt; ein Ablauf ohne
        «nur wenn» soll aber immer laufen.
        """
        if not automation.conditions:
            return True, []
        results = [
            (condition, self._check_condition(condition))
            for condition in automation.conditions
        ]
        failed = [describe_condition(c, self._value_of(c)) for c, ok in results if not ok]
        held = (
            any(ok for _, ok in results)
            if automation.match == "any"
            else all(ok for _, ok in results)
        )
        return held, failed

    def _value_of(self, condition: dict[str, Any]) -> Any:
        """Der Istwert einer Gerätebedingung – für die Begründung."""
        if condition.get("type", "state") != "state":
            return None
        entity = self.hub.registry.get(condition.get("entity_id", ""))
        if entity is None:
            return None
        return entity.state.get(condition.get("attribute", "state"))

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
        if ctype == "sun":
            # {type: sun, state: "up"|"down"} – steht die Sonne gerade über
            # dem Horizont? Für Hitzeschutz nur bei Tag u.ä.
            now = datetime.now()
            lat, lon = self._location()
            rise = astro.sun_event(now.date(), lat, lon, sunset=False)
            set_ = astro.sun_event(now.date(), lat, lon, sunset=True)
            if rise is None or set_ is None:
                return False
            up = rise <= now <= set_
            want = str(condition.get("state", "up"))
            return up if want == "up" else not up
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
        elif atype == "scene":
            await self.hub.scenes.activate(action["scene"])
        elif atype == "notify":
            await self._notify(automation, action)
        else:
            log.warning("Unbekannter Aktionstyp in '%s': %s", automation.alias, atype)

    async def _notify(self, automation: Automation, action: dict[str, Any]) -> None:
        tokens = self.hub.push.recipients(
            self.hub.users.users, str(action.get("to", "all"))
        )
        await self.hub.push.send(
            tokens,
            title=str(action.get("title") or automation.alias),
            body=str(action.get("body") or ""),
            data={"automation_id": automation.id},
        )
