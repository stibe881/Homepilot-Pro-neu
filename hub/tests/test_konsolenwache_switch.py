"""Konsolenzeit an der Switch: Die Zeit kommt vom Kind, Nintendo setzt die Höchstzeit.

Gezählt wird ab «Ich spiele jetzt» bis «Fertig» - nicht nach dem, was die
Konsole meldet: Die Erwachsenen spielen an denselben Geräten.
"""

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


async def test_the_switch_time_comes_from_the_childs_sign_in_not_from_nintendos_minutes(wache, hub):
    """Nintendo zählt auch, was die Erwachsenen spielen."""
    wache.spielen("Maja", SWITCH, um(16, 0))
    spielzeit(hub, 40)  # Nintendo zählt 30 min mehr - angemeldet war das Kind 3 min
    for sekunde in range(15, 181, 15):
        await wache.tick(um(16, 0) + sekunde)
    assert wache.lage("Maja", um(16, 3))["heute"]["gesamt_s"] == 180


async def test_the_limit_is_what_nintendo_counted_plus_what_the_child_has_left(wache):
    wache.spielen("Maja", SWITCH, um(16, 0))
    await wache.tick(um(16, 0, 15))
    # 10 min schon gezählt + 45 min Rest (abgerundet auf ganze Minuten: 44).
    assert wache.wirkungen["limits"] == [54]


async def test_the_limit_is_not_resent_every_tick(wache):
    wache.spielen("Maja", SWITCH, um(16, 0))
    for sekunde in range(15, 75, 15):
        await wache.tick(um(16, 0) + sekunde)
    assert len(wache.wirkungen["limits"]) <= 2


async def test_grown_ups_on_the_switch_lift_the_limit(wache):
    wache.eltern_spielen(SWITCH, um(21, 0))
    await wache.tick(um(21, 0, 15))
    assert wache.wirkungen["limits"] == [-1]


async def test_when_the_child_is_done_the_parents_own_limit_is_put_back(wache):
    wache.spielen("Maja", SWITCH, um(16, 0))
    await wache.tick(um(16, 0, 15))
    wache.stoppen("Maja", um(16, 10))
    await wache.tick(um(16, 10, 15))
    assert wache.wirkungen["limits"][-1] == "zurueck"


async def test_an_unattended_switch_is_left_alone_unless_the_parents_chose_to_lock_it(wache):
    await wache.tick(um(17, 0))
    assert wache.wirkungen["limits"] == []
    wache.einstellungen_setzen(nintendo_sperren=True)
    await wache.tick(um(17, 1))
    assert wache.wirkungen["limits"] == [10]  # Grenze = Gespieltes: nichts mehr übrig


async def test_when_time_is_up_the_switch_is_locked_and_the_parents_are_told_nintendo_ends_it(wache):
    wache.spielen("Maja", SWITCH, um(18, 15))
    wache._zeile("Maja", datetime(2026, 11, 10).date())["gesamt"] = 44 * 60 + 50
    wache._sitzungen["maja"]["zuletzt"] = um(18, 15)
    await wache.tick(um(18, 15, 30))
    assert wache.wirkungen["limits"][-1] == 10  # gespielt gemäss Nintendo, nichts übrig
    titel, text = wache.wirkungen["pushes"][0]
    assert titel == "Maja: Konsolenzeit aufgebraucht"
    assert "Nintendo beendet das Spiel." in text


async def test_the_lock_after_time_is_up_holds_until_somebody_signs_in_again(wache):
    wache.spielen("Maja", SWITCH, um(18, 15))
    wache._zeile("Maja", datetime(2026, 11, 10).date())["gesamt"] = 45 * 60 - 10
    wache._sitzungen["maja"]["zuletzt"] = um(18, 15)
    await wache.tick(um(18, 15, 30))
    await wache.tick(um(18, 16))
    await wache.tick(um(18, 30))
    assert "zurueck" not in wache.wirkungen["limits"]
    wache.eltern_spielen(SWITCH, um(18, 35))
    await wache.tick(um(18, 36))
    assert wache.wirkungen["limits"][-1] == -1


def test_the_nintendo_limit_rule_rounds_down_and_stays_in_bounds():
    assert kz.nintendo_limit(10, 45 * 60) == 55
    assert kz.nintendo_limit(10, 45 * 60 + 59) == 55
    assert kz.nintendo_limit(10, None) == -1
    assert kz.nintendo_limit(10, -5) == 10
    assert kz.nintendo_limit(350, 3600) == 360
