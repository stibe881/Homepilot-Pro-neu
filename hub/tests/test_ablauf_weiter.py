"""Ein hängender Schritt hält den Ablauf nicht mehr an.

Der Fall aus dem Haus: «Niemand mehr zuhause» stellt der Reihe nach
sechzig Geräte ab und schliesst zuletzt die Türe. Eine Box, auf der
gerade nichts lief, meldete «Failed to execute pause.» - und der Lauf
war zu Ende. Die Wohnung blieb offen und unscharf, und im Protokoll
stand nur «Fehlgeschlagen».
"""

from __future__ import annotations

import pytest

from homepilot.core.automation import Automation, stolpersatz
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

# ── Der Satz, der übrig bleibt ────────────────────────────────────────


def test_a_single_stumble_names_the_step_and_says_the_rest_ran() -> None:
    satz = stolpersatz([("Küche Lautsprecher pause", "Failed to execute pause.")], 60)
    assert "Küche Lautsprecher pause" in satz
    assert "Failed to execute pause." in satz
    assert "Der Rest lief durch." in satz


def test_several_stumbles_are_counted() -> None:
    satz = stolpersatz([("A", "kaputt"), ("B", "auch")], 60)
    assert "2 von 60 Schritten hingen" in satz
    assert "zuerst A" in satz


def test_no_stumble_no_sentence() -> None:
    assert stolpersatz([], 60) == ""


# ── Am laufenden Hub ──────────────────────────────────────────────────


async def lauf(actions: list[dict]) -> tuple[Hub, dict]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    await hub.automations._run(
        Automation(id="a", alias="Niemand mehr zuhause", triggers=[], actions=actions)
    )
    return hub, hub.automations.runs[0]


@pytest.mark.asyncio
async def test_the_door_still_locks_after_a_speaker_failed() -> None:
    hub, protokoll = await lauf(
        [
            {"entity_id": "demo.light_livingroom", "command": "turn_on"},
            # Die Box, auf der nichts läuft - hier vertreten durch ein
            # Gerät, das es gar nicht gibt.
            {"entity_id": "gibts.nicht", "command": "pause"},
            {"entity_id": "demo.light_livingroom", "command": "turn_off"},
        ]
    )
    try:
        # Der wichtigste Teil: Der Schritt *nach* dem Fehler lief.
        assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
        assert protokoll["executed"] is True
        assert len(protokoll["steps"]) == 3
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_the_failure_is_still_reported_with_its_step() -> None:
    hub, protokoll = await lauf(
        [
            {"entity_id": "gibts.nicht", "command": "pause"},
            {"entity_id": "demo.light_livingroom", "command": "turn_off"},
        ]
    )
    try:
        # Nicht verschluckt: Der Fehler steht am Lauf und am Schritt -
        # und er nennt jetzt das Gerät, was «Fehlgeschlagen: Failed to
        # execute pause.» nie tat.
        assert protokoll["error"]
        assert "Der Rest lief durch." in protokoll["error"]
        assert protokoll["steps"][0].get("error")
        assert protokoll["steps"][1].get("error") is None
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_a_clean_run_stays_clean() -> None:
    hub, protokoll = await lauf(
        [{"entity_id": "demo.light_livingroom", "command": "turn_on"}]
    )
    try:
        assert protokoll["error"] is None
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_every_later_step_runs_even_after_several_stumbles() -> None:
    hub, protokoll = await lauf(
        [
            {"entity_id": "gibts.nicht", "command": "pause"},
            {"entity_id": "auch.nicht", "command": "pause"},
            {"entity_id": "demo.light_livingroom", "command": "turn_on"},
        ]
    )
    try:
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
        assert "2 von 3 Schritten hingen" in protokoll["error"]
    finally:
        await hub.stop()
