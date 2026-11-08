"""Konsolenzeit an der Switch: Nintendo zählt, der Hub stellt die Höchstzeit."""

from __future__ import annotations

from datetime import datetime

import pytest

from homepilot.core import konsolenzeit as kz
from homepilot.core.entity import Entity, EntityKind

SWITCH = "nintendo.switch"
PS5 = "playstation.wohnzimmer"


def um(stunde: int, minute: int = 0, sekunde: int = 0) -> float:
    return datetime(2026, 11, 10, stunde, minute, sekunde).timestamp()


PLAN = {
    "aktiv": True,
    "konsolen": [SWITCH, PS5],
    "tage": [{"an": True, "von": 960, "bis": 1140, "minuten": 45}] * 7,
    "monat": 1200,
}


@pytest.fixture
async def wache(hub, monkeypatch):
    hub.konsolenwache._sitzungen.clear()
    await hub.registry.add(
        Entity(
            id=SWITCH, kind=EntityKind.MEDIA_PLAYER, name="Switch 2", integration="nintendo",
            state={"state": "on", "playing_min": 10, "limit_min": None}, commands=["set_limit"],
        )
    )
    hub.konsolenwache.plan_setzen("Maja", PLAN)
    wirkungen = {"limits": [], "pushes": []}

    async def dispatch(entity_id, command, data=None):
        if command == "set_limit":
            wirkungen["limits"].append((data or {}).get("minutes", "zurueck"))
        return hub.registry.get(entity_id)

    async def melden(titel, text):
        wirkungen["pushes"].append((titel, text))

    async def ansage(konsole_id, text):
        pass

    monkeypatch.setattr(hub.integrations, "dispatch_command", dispatch)
    monkeypatch.setattr(hub.konsolenwache, "_eltern_melden", melden)
    monkeypatch.setattr(hub.konsolenwache, "_ansage", ansage)
    hub.konsolenwache.wirkungen = wirkungen
    return hub.konsolenwache


def spielzeit(hub, minuten):
    hub.registry.get(SWITCH).state["playing_min"] = minuten


async def test_the_switch_time_is_booked_from_nintendos_own_minutes(wache, hub):
    wache.spielen("Maja", SWITCH, um(16, 0))
    spielzeit(hub, 13)  # 3 min seit der Anmeldung (Basis 10)
    await wache.tick(um(16, 3))
    assert wache.lage("Maja", um(16, 3))["heute"]["konsolen"] == {SWITCH: 180}
    # Ein zweiter Takt ohne neue Minute bucht nichts dazu.
    await wache.tick(um(16, 3, 30))
    assert wache.lage("Maja", um(16, 3, 30))["heute"]["gesamt_s"] == 180


async def test_minutes_played_before_signing_in_are_not_the_childs(wache, hub):
    spielzeit(hub, 40)  # die Eltern haben vorhin 40 min gespielt
    wache.spielen("Maja", SWITCH, um(16, 0))
    await wache.tick(um(16, 1))
    assert wache.lage("Maja", um(16, 1))["heute"]["gesamt_s"] == 0


async def test_the_limit_is_what_nintendo_counted_plus_what_the_child_has_left(wache, hub):
    wache.spielen("Maja", SWITCH, um(16, 0))
    await wache.tick(um(16, 0, 15))
    # 10 min schon gezählt + 45 min Rest.
    assert wache.wirkungen["limits"] == [55]
    spielzeit(hub, 20)
    await wache.tick(um(16, 10))
    # Das Kind hat 10 min gespielt: Rest 35, gezählt 20 - dieselbe Summe.
    assert wache.wirkungen["limits"] == [55]


async def test_the_limit_is_not_resent_every_tick(wache):
    wache.spielen("Maja", SWITCH, um(16, 0))
    for sekunde in range(15, 120, 15):
        await wache.tick(um(16, 0) + sekunde)
    assert wache.wirkungen["limits"] == [55]


async def test_grown_ups_on_the_switch_lift_the_limit(wache):
    wache.eltern_spielen(SWITCH, um(21, 0))
    await wache.tick(um(21, 0, 15))
    assert wache.wirkungen["limits"] == [-1]


async def test_when_the_child_is_done_the_parents_own_limit_is_put_back(wache):
    wache.spielen("Maja", SWITCH, um(16, 0))
    await wache.tick(um(16, 0, 15))
    wache.stoppen("Maja", um(16, 10))
    await wache.tick(um(16, 10, 15))
    assert wache.wirkungen["limits"] == [55, "zurueck"]


async def test_an_unattended_switch_is_left_alone_unless_the_parents_chose_to_lock_it(wache):
    await wache.tick(um(17, 0))
    assert wache.wirkungen["limits"] == []
    wache.einstellungen_setzen(nintendo_sperren=True)
    await wache.tick(um(17, 1))
    assert wache.wirkungen["limits"] == [10]  # Grenze = Gespieltes: nichts mehr übrig


async def test_when_time_is_up_the_switch_is_locked_and_the_parents_are_told_nintendo_ends_it(wache, hub):
    wache.spielen("Maja", SWITCH, um(16, 0))
    spielzeit(hub, 55)  # 45 min seit Basis 10: alles aufgebraucht
    await wache.tick(um(16, 45))
    assert wache.wirkungen["limits"][-1] == 55
    titel, text = wache.wirkungen["pushes"][0]
    assert titel == "Maja: Konsolenzeit aufgebraucht"
    assert "Nintendo beendet das Spiel." in text


async def test_the_lock_after_time_is_up_holds_until_somebody_signs_in_again(wache, hub):
    wache.spielen("Maja", SWITCH, um(16, 0))
    spielzeit(hub, 55)
    await wache.tick(um(16, 45))
    await wache.tick(um(16, 46))
    await wache.tick(um(17, 0))
    assert wache.wirkungen["limits"] == [55]  # nie «zurueck» dazwischen
    wache.eltern_spielen(SWITCH, um(17, 5))
    await wache.tick(um(17, 6))
    assert wache.wirkungen["limits"][-1] == -1


async def test_a_new_day_on_the_switch_does_not_book_negative_time(wache, hub):
    wache.plan_setzen("Maja", {**PLAN, "tage": [{"an": True, "von": 0, "bis": 1440, "minuten": 120}] * 7})
    wache.spielen("Maja", SWITCH, um(23, 50))
    spielzeit(hub, 12)
    await wache.tick(um(23, 55))
    spielzeit(hub, 2)  # Mitternacht: Nintendo zählt von vorn
    await wache.tick(um(23, 59))
    assert wache.lage("Maja", um(23, 59))["heute"]["gesamt_s"] >= 0


def test_the_nintendo_limit_rule_rounds_down_and_stays_in_bounds():
    assert kz.nintendo_limit(10, 45 * 60) == 55
    assert kz.nintendo_limit(10, 45 * 60 + 59) == 55
    assert kz.nintendo_limit(10, None) == -1
    assert kz.nintendo_limit(10, -5) == 10
    assert kz.nintendo_limit(350, 3600) == 360
