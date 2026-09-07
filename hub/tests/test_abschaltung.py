"""Die Restzeit: «geht in 12 Min aus», wenn der Ablauf es sagt.

Der gemeldete Fall: Ein Ablauf schaltet das Licht nach dreissig Minuten
aus, und im Kinderzimmer steht man davor und rät.
"""

import asyncio
import time

from homepilot.core import abschaltung
from homepilot.core.automation import Automation
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

LICHT = "demo.light_livingroom"


# ── Die reine Hälfte ─────────────────────────────────────────────────────


def test_only_what_the_current_wait_switches_off():
    actions = [
        {"type": "command", "entity_id": "a", "command": "turn_on"},
        {"type": "delay", "seconds": 1800},
        {"type": "command", "entity_id": "a", "command": "turn_off"},
        {"type": "command", "entity_id": "b", "command": "turn_off"},
        # Ab hier ein zweiter Abschnitt - er gehört nicht zu dieser Frist.
        {"type": "delay", "seconds": 600},
        {"type": "command", "entity_id": "c", "command": "turn_off"},
    ]
    assert abschaltung.ziele_nach(actions, 1) == ["a", "b"]
    assert abschaltung.ziele_nach(actions, 4) == ["c"]


def test_a_scene_at_the_end_promises_nothing():
    # Was eine Szene in dreissig Minuten tut, hängt vom Zustand dann ab -
    # eine Restzeit, die sich als falsch herausstellt, ist schlimmer als
    # keine.
    actions = [
        {"type": "delay", "seconds": 60},
        {"type": "scene", "scene": "Nacht"},
        {"type": "command", "entity_id": "a", "command": "turn_on"},
    ]
    assert abschaltung.ziele_nach(actions, 0) == []


def test_the_remainder_is_none_once_it_is_over():
    assert abschaltung.rest(1000.0, 940.0) == 60.0
    assert abschaltung.rest(1000.0, 1000.0) is None
    assert abschaltung.rest(None, 940.0) is None
    assert abschaltung.rest("gleich", 940.0) is None
    assert abschaltung.rest(True, 940.0) is None


# ── Am laufenden Hub ─────────────────────────────────────────────────────


async def _hub() -> Hub:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    return hub


async def test_the_light_carries_its_deadline_while_it_waits():
    hub = await _hub()
    try:
        hub.automations.automations.append(
            Automation(
                id="nacht",
                alias="Licht mit Frist",
                triggers=[],
                actions=[
                    {"type": "command", "entity_id": LICHT, "command": "turn_on"},
                    {"type": "delay", "seconds": 1800},
                    {"type": "command", "entity_id": LICHT, "command": "turn_off"},
                ],
                countdown=True,
            )
        )
        hub.automations._schedule(hub.automations.automations[-1])
        await asyncio.sleep(0.05)
        entity = hub.registry.get(LICHT)
        rest = abschaltung.rest(entity.state.get(abschaltung.FELD), time.time())
        assert rest is not None and 1700 < rest <= 1800
    finally:
        await hub.stop()


async def test_without_the_switch_nothing_is_promised():
    hub = await _hub()
    try:
        hub.automations.automations.append(
            Automation(
                id="still",
                alias="Ohne Restzeit",
                triggers=[],
                actions=[
                    {"type": "command", "entity_id": LICHT, "command": "turn_on"},
                    {"type": "delay", "seconds": 1800},
                    {"type": "command", "entity_id": LICHT, "command": "turn_off"},
                ],
            )
        )
        hub.automations._schedule(hub.automations.automations[-1])
        await asyncio.sleep(0.05)
        assert hub.registry.get(LICHT).state.get(abschaltung.FELD) is None
    finally:
        await hub.stop()


async def test_switching_off_by_hand_takes_the_countdown_with_it():
    """Sonst stünde «geht in 12 Min aus» an einem längst dunklen Licht."""
    hub = await _hub()
    try:
        hub.automations.automations.append(
            Automation(
                id="hand",
                alias="Licht mit Frist",
                triggers=[],
                actions=[
                    {"type": "command", "entity_id": LICHT, "command": "turn_on"},
                    {"type": "delay", "seconds": 1800},
                    {"type": "command", "entity_id": LICHT, "command": "turn_off"},
                ],
                countdown=True,
            )
        )
        hub.automations._schedule(hub.automations.automations[-1])
        await asyncio.sleep(0.05)
        assert hub.registry.get(LICHT).state.get(abschaltung.FELD) is not None
        await hub.integrations.dispatch_command(LICHT, "turn_off", {})
        await asyncio.sleep(0.05)
        assert hub.registry.get(LICHT).state.get(abschaltung.FELD) is None
    finally:
        await hub.stop()


async def test_a_cancelled_run_leaves_no_promise_behind():
    """«Von vorn beginnen» bricht den Durchgang ab - die Anzeige des
    abgebrochenen Laufs darf nicht stehen bleiben."""
    hub = await _hub()
    try:
        hub.automations.automations.append(
            Automation(
                id="ab",
                alias="Licht mit Frist",
                triggers=[],
                actions=[
                    {"type": "command", "entity_id": LICHT, "command": "turn_on"},
                    {"type": "delay", "seconds": 1800},
                    {"type": "command", "entity_id": LICHT, "command": "turn_off"},
                ],
                countdown=True,
            )
        )
        hub.automations._schedule(hub.automations.automations[-1])
        await asyncio.sleep(0.05)
        assert hub.registry.get(LICHT).state.get(abschaltung.FELD) is not None
        for task in list(hub.automations._run_tasks):
            task.cancel()
        await asyncio.sleep(0.05)
        assert hub.registry.get(LICHT).state.get(abschaltung.FELD) is None
    finally:
        await hub.stop()
