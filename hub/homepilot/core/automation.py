"""Deklarative Automations-Engine: Trigger → Bedingungen → Aktionen.

Trigger:
  - {type: state, entity_id, attribute?: "state", from?, to?}
  - {type: state, entity_id, attribute, above? | below?}   # Schwelle gekreuzt
  - {type: interval, seconds}
  - {type: time, at: "HH:MM"}
  - {type: sun, event: "sunrise"|"sunset", offset?: minuten}  # +/- Versatz

Bedingungen:
  - {type: state, entity_id, attribute?: "state", equals? | above? | below?}
  - {type: time, after?: "HH:MM", before?: "HH:MM", weekdays?: [0..6]}
  - {type: sun, state: "up"|"down"}   # steht die Sonne über dem Horizont?

Aktionen:
  - {type: command, entity_id, command, data?}
  - {type: delay, seconds}
  - {type: scene, scene} / {type: hue_scene, scene}
  - {type: notify, title?, body?, to?, camera?}
  - {type: wait_until, ...Bedingung, timeout?: sekunden}

Passt eine Bedingung nicht, kann statt der Aktionen ein zweiter Satz
laufen (``otherwise``) – sonst bräuchte «sonst mach das andere» zwei
Abläufe mit gegenteiliger Bedingung, die man beim Ändern beide anfassen
muss.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from . import astro
from . import snapshots
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
    # Was stattdessen läuft, wenn die Bedingungen nicht passen. Leer =
    # nichts, wie bisher.
    otherwise: list[dict[str, Any]] = field(default_factory=list)
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
            "otherwise": self.otherwise,
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
            "otherwise": self.otherwise,
            "enabled": self.enabled,
            "match": self.match,
            "category": self.category,
        }


# So viele Läufe merkt sich der Hub – genug, um einen Abend nachzuvollziehen.
RUN_LIMIT = 100

# «Warten bis»: wie oft nachgesehen wird, und wie lange höchstens, wenn im
# Ablauf keine eigene Frist steht. Eine Frist muss sein – sonst bliebe ein
# Ablauf für immer stehen, wenn die Tür offen bleibt.
WAIT_POLL = 1.0
WAIT_TIMEOUT = 300.0


WEEKDAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def parse_weekdays(raw: Any) -> set[int]:
    """Erlaubte Wochentage einlesen (rein, testbar).

    0 ist Montag, wie bei ``datetime.weekday()``. Eine leere oder kaputte
    Angabe heisst «alle Tage» und nicht «kein Tag»: Wer sich vertippt, soll
    einen Ablauf haben, der zu oft läuft und auffällt – nicht einen, der
    stumm bleibt und den man erst im Winter vermisst.
    """
    days: set[int] = set()
    for entry in raw or []:
        try:
            number = int(entry)
        except (TypeError, ValueError):
            continue
        if 0 <= number <= 6:
            days.add(number)
    return days


def weekday_label(days: set[int]) -> str:
    """«Mo, Di, Mi» – oder «Werktage» bzw. «Wochenende» (rein, testbar)."""
    if not days or len(days) == 7:
        return "jeden Tag"
    if days == {0, 1, 2, 3, 4}:
        return "Werktage"
    if days == {5, 6}:
        return "Wochenende"
    return ", ".join(WEEKDAYS[day] for day in sorted(days))


def describe_target(condition: dict[str, Any], named: Any = str) -> str:
    """Worauf eine Bedingung hinauswill – bejahend (rein, testbar).

    Das Gegenstück zu ``describe_condition``, die sagt, warum etwas *nicht*
    passte. Beim Warten will man das Ziel lesen, nicht den Fehlschlag.
    """
    name = named(condition.get("entity_id"))
    if "above" in condition:
        return f"{name} über {condition['above']} steht"
    if "below" in condition:
        return f"{name} unter {condition['below']} steht"
    if "equals" in condition:
        return f"{name} «{condition['equals']}» ist"
    return f"{name} sich meldet"


def describe_action(action: dict[str, Any], name_of: Any = None) -> str:
    """Eine Aktion in einem Satz – für den Trockenlauf (rein, testbar).

    ``name_of`` bildet eine Entitäts-Kennung auf den Anzeigenamen ab; ohne
    sie steht die Kennung da. Der Trockenlauf soll zeigen, was passieren
    *würde*, und dafür muss man es lesen können.
    """
    def named(entity_id: Any) -> str:
        text = str(entity_id or "?")
        return str(name_of(text)) if name_of else text

    atype = action.get("type", "command")
    if atype == "command":
        data = action.get("data") or {}
        extra = ""
        if "brightness" in data:
            extra = f" auf {data['brightness']} %"
        elif "position" in data:
            extra = f" auf {data['position']} %"
        return f"{named(action.get('entity_id'))}: {action.get('command', '?')}{extra}"
    if atype == "delay":
        return f"{action.get('seconds', 0)} Sekunden warten"
    if atype == "wait_until":
        timeout = action.get("timeout")
        grenze = f" (höchstens {timeout} s)" if timeout else ""
        return f"warten bis {describe_target(action, named)}{grenze}"
    if atype == "scene":
        return f"Szene «{action.get('scene', '?')}»"
    if atype == "hue_scene":
        return f"Hue-Szene «{action.get('scene', '?')}»"
    if atype == "notify":
        wer = action.get("to") or "alle"
        bild = " mit Kamerabild" if action.get("camera") else ""
        return f"Nachricht an {wer}: «{action.get('title') or action.get('body') or ''}»{bild}"
    if atype == "broadcast":
        boxen = action.get("speakers") or []
        wo = f" auf {len(boxen)} Box(en)" if boxen else " auf allen Boxen"
        return f"Durchsage{wo}: «{action.get('text') or ''}»"
    return f"unbekannte Aktion «{atype}»"


def describe_condition(condition: dict[str, Any], value: Any) -> str:
    """Warum eine Bedingung nicht passte, in einem Satz (rein, testbar).

    «Bedingung 2 war falsch» hilft niemandem. «Helligkeit war 44, verlangt
    ist unter 30» beantwortet die Frage sofort.
    """
    ctype = condition.get("type", "state")
    if ctype == "time":
        days = parse_weekdays(condition.get("weekdays"))
        if days and datetime.now().weekday() not in days:
            return f"Heute ist {WEEKDAYS[datetime.now().weekday()]}, verlangt sind {weekday_label(days)}"
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
                otherwise=_as_list(config.get("otherwise")),
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


def opposing(first: str, second: str) -> bool:
    """Heben sich zwei Befehle gegenseitig auf? (rein, testbar)"""
    pairs = (
        {"turn_on", "turn_off"},
        {"open", "close"},
        {"lock", "unlock"},
        {"arm", "disarm"},
        {"start", "stop"},
        {"play", "pause"},
    )
    return any({first, second} == pair for pair in pairs)


def _targets(actions: list[dict[str, Any]]) -> dict[str, set[str]]:
    """Gerät → Befehle, die dieser Ablauf darauf loslässt (rein)."""
    result: dict[str, set[str]] = {}
    for action in actions or []:
        if not isinstance(action, dict):
            continue
        entity_id = action.get("entity_id")
        command = action.get("command")
        if isinstance(entity_id, str) and isinstance(command, str):
            result.setdefault(entity_id, set()).add(command)
    return result


def find_conflicts(automations: list[Any]) -> list[dict[str, Any]]:
    """Abläufe, die dasselbe Gerät gegensätzlich schalten (rein, testbar).

    Kein Fehler, sondern ein Hinweis: Manchmal ist genau das gewollt (der
    eine schaltet ein, der andere später aus). Aber wenn nachts das Licht
    von selbst angeht, sucht man genau diese Liste - und findet sie sonst
    erst nach einer halben Stunde Lesen.
    """
    rows: list[dict[str, Any]] = []
    enabled = [a for a in automations if getattr(a, "enabled", True)]
    for index, first in enumerate(enabled):
        first_targets = _targets(
            list(getattr(first, "actions", [])) + list(getattr(first, "otherwise", []))
        )
        for second in enabled[index + 1 :]:
            second_targets = _targets(
                list(getattr(second, "actions", []))
                + list(getattr(second, "otherwise", []))
            )
            for entity_id, commands in first_targets.items():
                other = second_targets.get(entity_id)
                if not other:
                    continue
                clashing = sorted(
                    {
                        f"{one}/{two}"
                        for one in commands
                        for two in other
                        if opposing(one, two)
                    }
                )
                if clashing:
                    rows.append(
                        {
                            "entity_id": entity_id,
                            "commands": clashing,
                            "automations": [
                                {"id": first.id, "alias": first.alias},
                                {"id": second.id, "alias": second.alias},
                            ],
                        }
                    )
    return rows


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
        # Laufende «bleibt so für X»-Wartezeiten je (Automation, Auslöser).
        self._held_tasks: dict[tuple[str, int], asyncio.Task] = {}
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
        self._restore_runs()
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
        for task in [*self._timer_tasks, *self._run_tasks, *self._held_tasks.values()]:
            task.cancel()
        for task in [*self._timer_tasks, *self._run_tasks, *self._held_tasks.values()]:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._timer_tasks.clear()
        self._run_tasks.clear()
        self._held_tasks.clear()

    # ── Trigger ────────────────────────────────────────────────────────────

    def _on_state_changed(self, _event_type: str, data: dict[str, Any]) -> None:
        for automation in self.automations:
            if not automation.enabled:
                continue
            for index, trigger in enumerate(automation.triggers):
                if trigger.get("type", "state") != "state":
                    continue
                if self._state_trigger_matches(trigger, data):
                    hold = float(trigger.get("for") or 0)
                    if hold > 0:
                        # «bleibt so für X»: erst warten, dann prüfen, ob
                        # der Zustand noch gilt - «alle weg» heisst erst
                        # nach zehn Minuten wirklich alle weg, nicht beim
                        # kurzen Gang zum Briefkasten.
                        self._schedule_held(automation, index, trigger, hold)
                    else:
                        self._schedule(automation)
                    break

    def _schedule_held(
        self,
        automation: Automation,
        index: int,
        trigger: dict[str, Any],
        hold: float,
    ) -> None:
        key = (automation.id, index)
        pending = self._held_tasks.get(key)
        if pending is not None and not pending.done():
            # Es läuft schon eine Wartezeit für genau diesen Auslöser -
            # ein Flackern startet sie nicht neu.
            return

        async def wait_and_check() -> None:
            await asyncio.sleep(hold)
            if self._trigger_still_holds(trigger):
                self._schedule(automation)

        task = asyncio.create_task(wait_and_check())
        self._held_tasks[key] = task
        task.add_done_callback(lambda _t: self._held_tasks.pop(key, None))

    def _trigger_still_holds(self, trigger: dict[str, Any]) -> bool:
        """Gilt der Zielzustand des Auslösers immer noch? (für ``for``)

        Nur der Zielzustand zählt - «from» ist nach der Wartezeit
        naturgemäss Geschichte. Ohne prüfbares Ziel (bare Trigger) gilt
        die Wartezeit als bestanden.
        """
        entity = self.hub.registry.get(str(trigger.get("entity_id") or ""))
        if entity is None:
            return False
        value = entity.state.get(trigger.get("attribute", "state"))
        if "above" in trigger or "below" in trigger:
            try:
                number = float(value)
            except (TypeError, ValueError):
                return False
            if "above" in trigger and not number > float(trigger["above"]):
                return False
            if "below" in trigger and not number < float(trigger["below"]):
                return False
            return True
        if "to" in trigger:
            return value == trigger["to"]
        return True

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

    def _restore_runs(self) -> None:
        """Den Verlauf früherer Läufe zurückholen (jüngste zuerst)."""
        try:
            stored = self.hub.data.get("automation_runs")
        except Exception:
            return
        if stored:
            self.runs = list(stored)[:RUN_LIMIT]

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
            # Der «sonst»-Zweig ist ein vollwertiger Lauf und wird auch als
            # solcher protokolliert: Ein Ablauf, der etwas getan hat, darf im
            # Protokoll nicht als «übersprungen» stehen.
            actions = automation.actions if held else automation.otherwise
            if actions:
                executed = True
                log.info(
                    "Automation '%s' ausgelöst%s",
                    automation.alias,
                    "" if held else " (sonst-Zweig)",
                )
                # Alles, was jetzt folgt, wird der Automation zugeschrieben.
                with as_source(automation_source(automation.id, automation.alias)):
                    for action in actions:
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
        # Auch auf die Platte: Nach einem Neustart ist sonst genau die
        # Spur weg, der man nachgeht - «heute Nacht ging das Licht an, und
        # jetzt weiss niemand, warum».
        try:
            self.hub.data.set("automation_runs", self.runs)
        except Exception:
            log.debug("Ablauf-Verlauf nicht schreibbar", exc_info=True)

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

    def dry_run(self, automation: Automation) -> dict[str, Any]:
        """Was *würde* passieren – ohne dass etwas passiert.

        Der Testlauf über /trigger führt wirklich aus; das schreckt bei
        allem ab, was die Storen bewegt oder die Familie anpiepst. Hier
        werden die Bedingungen gegen den jetzigen Zustand geprüft und die
        Aktionen bloss aufgezählt.
        """
        held, failed = self._conditions_hold(automation)
        actions = automation.actions if held else automation.otherwise

        def name_of(entity_id: str) -> str:
            entity = self.hub.registry.get(entity_id)
            return entity.name if entity else entity_id

        return {
            "conditions_hold": held,
            "skipped": failed,
            "branch": "aktionen" if held else "sonst",
            "would_run": [describe_action(action, name_of) for action in actions],
        }

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
            days = parse_weekdays(condition.get("weekdays"))
            if days and datetime.now().weekday() not in days:
                return False
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
        elif atype == "wait_until":
            await self._wait_until(automation, action)
        elif atype == "scene":
            await self.hub.scenes.activate(action["scene"])
        elif atype == "hue_scene":
            # Szenen der Hue-Bridge: Farben und Helligkeiten stecken dort,
            # und nur die Bridge kann sie in einem Zug setzen.
            hue = self.hub.integrations.get("hue")
            if hue is None or not hasattr(hue, "activate_scene"):
                log.warning("Hue-Szene in '%s', aber keine Hue-Bridge", automation.alias)
                return
            await hue.activate_scene(str(action.get("scene") or ""))
        elif atype == "notify":
            await self._notify(automation, action)
        elif atype == "broadcast":
            # Durchsage auf die Cast-Boxen: «Es hat geklingelt»,
            # «Waschmaschine ist fertig». Die Quelle bleibt der Ablauf -
            # say.speak() überschreibt sie nicht.
            from . import say

            await say.speak(
                self.hub,
                str(action.get("text") or ""),
                speakers=[str(s) for s in action.get("speakers") or []] or None,
                volume=action.get("volume"),
            )
        else:
            log.warning("Unbekannter Aktionstyp in '%s': %s", automation.alias, atype)

    async def _wait_until(self, automation: Automation, action: dict[str, Any]) -> None:
        """Warten, bis eine Bedingung zutrifft – statt auf gut Glück lange
        genug zu warten.

        «Erst scharf schalten, wenn die Tür zu ist» liess sich bisher nur
        mit einer geschätzten Verzögerung nachbauen. Zu kurz gewählt
        scheitert die Aktion, zu lang ärgert sie.

        Die Frist ist Pflicht, nicht Kür: Ohne sie bliebe ein Ablauf für
        immer stehen, wenn die Tür offen bleibt – und blockierte damit
        auch jeden weiteren Lauf desselben Ablaufs.
        """
        timeout = float(action.get("timeout") or WAIT_TIMEOUT)
        deadline = time.monotonic() + max(1.0, timeout)
        while True:
            if self._check_condition({**action, "type": action.get("wait_type", "state")}):
                return
            if time.monotonic() >= deadline:
                log.info(
                    "Automation '%s': Wartezeit abgelaufen, %s",
                    automation.alias,
                    describe_condition(action, self._value_of(action)),
                )
                return
            await asyncio.sleep(WAIT_POLL)

    async def _notify(self, automation: Automation, action: dict[str, Any]) -> None:
        tokens = self.hub.push.recipients(
            self.hub.users.users, str(action.get("to", "all")), "automation"
        )
        camera = str(action.get("camera") or "") or None
        await self.hub.push.send(
            tokens,
            title=str(action.get("title") or automation.alias),
            body=str(action.get("body") or ""),
            data={
                "automation_id": automation.id,
                **({"camera": camera} if camera else {}),
            },
            image=await self._snapshot_url(camera),
        )

    async def _snapshot_url(self, camera: str | None) -> str | None:
        """Ein Standbild für die Nachricht selbst – etwa wer vor der Tür steht.

        Aufgenommen wird jetzt und nicht beim Anschauen: Der Besucher ist
        längst weg, bis jemand das Telefon aus der Tasche zieht.

        Jeder Fehlschlag endet still in ``None``. Ein Ablauf darf nicht
        daran scheitern, dass eine Kamera gerade schweigt – die Nachricht
        geht dann eben ohne Bild raus. Ohne ``push.public_url`` in der
        Konfiguration entsteht gar keine Adresse; siehe core/snapshots.py.
        """
        public_url = (self.hub.config.push or {}).get("public_url")
        if not camera or not public_url:
            return None
        try:
            entity = self.hub.registry.get(camera)
            integration = self.hub.integrations.get(entity.integration) if entity else None
            image = await integration.snapshot(entity) if integration else None
        except Exception as err:
            log.warning("Kein Bild für die Nachricht aus einem Ablauf: %s", err)
            return None
        if not image:
            return None
        return snapshots.image_url(public_url, self.hub.snapshots.put(image))
