"""Lautstärke nach Tageszeit – der Plan, der vier Abläufe ersetzt."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from homepilot.api.server import create_app
from homepilot.core import lautplan
from homepilot.core.entity import Entity
from homepilot.core.errors import HomePilotError
from homepilot.core.hub import Hub

from .conftest import make_config

STUFEN = [
    {"at": "07:00", "volume": 20},
    {"at": "10:00", "volume": 70},
    {"at": "20:00", "volume": 20},
    {"at": "23:45", "volume": 10},
]
PLAN = {"id": "p1", "name": "Lautsprecher", "on": True, "entities": [], "steps": STUFEN}


def um(hhmm: str) -> int:
    wert = lautplan.minuten(hhmm)
    assert wert is not None
    return wert


# ── Welche Stufe gerade gilt ──────────────────────────────────────────


def test_the_morning_step_holds_until_the_day_step() -> None:
    assert lautplan.stufe_jetzt(STUFEN, um("08:30"))["volume"] == 20
    assert lautplan.stufe_jetzt(STUFEN, um("09:59"))["volume"] == 20


def test_a_step_takes_effect_on_its_own_minute() -> None:
    assert lautplan.stufe_jetzt(STUFEN, um("10:00"))["volume"] == 70


def test_the_last_step_of_the_day_carries_over_midnight() -> None:
    # Ein Plan ohne diesen Umschlag hätte zwischen Mitternacht und der
    # ersten Stufe ein Loch - und genau dort liegt die Nacht.
    assert lautplan.stufe_jetzt(STUFEN, um("02:00"))["volume"] == 10
    assert lautplan.stufe_jetzt(STUFEN, um("06:59"))["volume"] == 10


def test_an_unsorted_plan_is_read_in_the_right_order() -> None:
    durcheinander = list(reversed(STUFEN))
    assert lautplan.stufe_jetzt(durcheinander, um("12:00"))["volume"] == 70


def test_a_plan_without_steps_says_nothing() -> None:
    assert lautplan.stufe_jetzt([], um("12:00")) is None
    assert lautplan.stufe_jetzt([{"at": "Unsinn", "volume": 5}], um("12:00")) is None


# ── Für welche Boxen ──────────────────────────────────────────────────


def test_an_empty_selection_means_every_speaker() -> None:
    # Der Normalfall im Haushalt - wer ihn eintippen müsste, tippt elf
    # Kennungen ab.
    assert lautplan.gilt_fuer(PLAN, "cast.irgendeine") is True


def test_a_named_selection_leaves_the_others_alone() -> None:
    plan = {**PLAN, "entities": ["cast.bad"]}
    assert lautplan.gilt_fuer(plan, "cast.bad") is True
    assert lautplan.gilt_fuer(plan, "cast.buero") is False


def test_a_switched_off_plan_covers_nothing() -> None:
    assert lautplan.gilt_fuer({**PLAN, "on": False}, "cast.bad") is False


def test_the_target_is_the_value_of_the_hour() -> None:
    assert lautplan.sollwert([PLAN], "cast.bad", um("11:00")) == 70
    assert lautplan.sollwert([PLAN], "cast.bad", um("21:00")) == 20


def test_the_first_matching_plan_wins() -> None:
    eigener = {"id": "p0", "on": True, "entities": ["cast.bad"], "steps": [{"at": "00:00", "volume": 5}]}
    assert lautplan.sollwert([eigener, PLAN], "cast.bad", um("11:00")) == 5
    assert lautplan.sollwert([eigener, PLAN], "cast.buero", um("11:00")) == 70


def test_no_plan_no_target() -> None:
    assert lautplan.sollwert([], "cast.bad", um("11:00")) is None


# ── Was gespeichert wird ──────────────────────────────────────────────


def test_times_are_normalised() -> None:
    geprueft = lautplan.plan_pruefen({"steps": [{"at": "7:5", "volume": 20}]})
    assert geprueft["steps"] == [{"at": "07:05", "volume": 20}]


def test_a_typo_in_the_time_is_refused() -> None:
    with pytest.raises(HomePilotError, match="keine Uhrzeit"):
        lautplan.plan_pruefen({"steps": [{"at": "25:00", "volume": 20}]})


def test_a_volume_outside_its_range_is_refused() -> None:
    with pytest.raises(HomePilotError, match="zwischen 0 und 100"):
        lautplan.plan_pruefen({"steps": [{"at": "07:00", "volume": 150}]})


def test_two_values_for_the_same_time_are_a_typo_not_a_plan() -> None:
    geprueft = lautplan.plan_pruefen(
        {"steps": [{"at": "07:00", "volume": 20}, {"at": "07:00", "volume": 70}]}
    )
    assert geprueft["steps"] == [{"at": "07:00", "volume": 70}]


def test_steps_come_back_sorted() -> None:
    geprueft = lautplan.plan_pruefen({"steps": list(reversed(STUFEN))})
    assert [s["at"] for s in geprueft["steps"]] == ["07:00", "10:00", "20:00", "23:45"]


def test_too_many_steps_are_no_longer_a_time_of_day() -> None:
    viele = [{"at": f"{h:02d}:00", "volume": 20} for h in range(14)]
    with pytest.raises(HomePilotError, match="Höchstens"):
        lautplan.plan_pruefen({"steps": viele})


# ── Am laufenden Hub ──────────────────────────────────────────────────


async def hub_mit_box(zustand: str = "idle", volume: int = 55) -> Hub:
    hub = Hub(make_config(integrations=[{"integration": "demo"}]))
    await hub.start()
    await hub.registry.add(
        Entity(
            id="test.box",
            kind="media_player",
            name="Nest Badezimmer",
            integration="demo",
            state={"state": zustand, "volume": volume},
            commands=["set_volume", "play", "pause"],
        )
    )
    return hub


def uhr(hhmm: str) -> float:
    """Ein Zeitstempel, der lokal auf dieser Uhrzeit liegt."""
    import time as zeit

    heute = zeit.localtime()
    stunde, minute = (int(teil) for teil in hhmm.split(":"))
    return zeit.mktime(
        (heute.tm_year, heute.tm_mon, heute.tm_mday, stunde, minute, 0, 0, 0, -1)
    )


async def test_a_silent_speaker_is_set_at_the_step() -> None:
    hub = await hub_mit_box()
    try:
        hub.data.set(lautplan.KEY, [PLAN])
        await hub.lautplan.anwenden(uhr("11:00"))
        assert hub.registry.get("test.box").state["volume"] == 70
    finally:
        await hub.stop()


async def test_a_playing_speaker_is_skipped() -> None:
    hub = await hub_mit_box(zustand="playing")
    try:
        hub.data.set(lautplan.KEY, [PLAN])
        await hub.lautplan.anwenden(uhr("11:00"))
        assert hub.registry.get("test.box").state["volume"] == 55
    finally:
        await hub.stop()


async def test_the_step_is_set_once_and_not_every_minute() -> None:
    """Sonst zöge der Plan jeden Handgriff am Regler innerhalb einer
    Minute wieder zurück."""
    hub = await hub_mit_box()
    try:
        hub.data.set(lautplan.KEY, [PLAN])
        await hub.lautplan.anwenden(uhr("11:00"))
        await hub.registry.update_state("test.box", {"volume": 90})
        await hub.lautplan.anwenden(uhr("11:30"))
        assert hub.registry.get("test.box").state["volume"] == 90
    finally:
        await hub.stop()


async def test_the_next_step_asserts_itself_again() -> None:
    hub = await hub_mit_box()
    try:
        hub.data.set(lautplan.KEY, [PLAN])
        await hub.lautplan.anwenden(uhr("11:00"))
        await hub.registry.update_state("test.box", {"volume": 90})
        await hub.lautplan.anwenden(uhr("20:05"))
        assert hub.registry.get("test.box").state["volume"] == 20
    finally:
        await hub.stop()


async def test_when_the_music_stops_the_value_of_that_hour_applies() -> None:
    """Läuft das Radio von sieben bis elf, gilt beim Ausschalten der
    Tag-Wert - nicht der Morgen-Wert, den die Box verpasst hat."""
    hub = await hub_mit_box(zustand="playing")
    try:
        hub.data.set(lautplan.KEY, [PLAN])
        await hub.lautplan.anwenden(uhr("07:00"))
        assert hub.registry.get("test.box").state["volume"] == 55

        # Es ist jetzt elf, und die Musik geht aus.
        import time as zeit

        echte_zeit = hub.lautplan.jetzt_min
        hub.lautplan.jetzt_min = lambda jetzt=None: um("11:00")  # type: ignore[method-assign]
        try:
            await hub.registry.update_state("test.box", {"state": "idle"})
            await asyncio.sleep(0.05)
        finally:
            hub.lautplan.jetzt_min = echte_zeit  # type: ignore[method-assign]
        assert zeit is not None
        assert hub.registry.get("test.box").state["volume"] == 70
    finally:
        await hub.stop()


async def test_a_television_is_not_a_speaker() -> None:
    hub = await hub_mit_box()
    try:
        await hub.registry.add(
            Entity(
                id="test.tv",
                kind="media_player",
                name="Wohnzimmer TV",
                integration="demo",
                state={"state": "idle", "volume": 40, "has_screen": True},
                commands=["set_volume"],
            )
        )
        hub.data.set(lautplan.KEY, [PLAN])
        await hub.lautplan.anwenden(uhr("11:00"))
        # Seine Lautstärke gehört zum Bild, nicht zur Tageszeit.
        assert hub.registry.get("test.tv").state["volume"] == 40
        assert hub.registry.get("test.box").state["volume"] == 70
    finally:
        await hub.stop()


# ── Über die Route ────────────────────────────────────────────────────


def test_the_route_stores_and_returns_the_plan() -> None:
    with TestClient(create_app(Hub(make_config()))) as client:
        antwort = client.put("/api/media/volumeplan", json={"plans": [PLAN]})
        assert antwort.status_code == 200
        assert antwort.json()["plans"][0]["steps"][0] == {"at": "07:00", "volume": 20}
        daten = client.get("/api/media/volumeplan").json()
        assert daten["plans"][0]["name"] == "Lautsprecher"
        # «Was gälte jetzt» - damit man die Stufen nicht im Kopf gegen
        # die Uhr halten muss.
        assert daten["now"][0]["volume"] in (10, 20, 70)


def test_the_route_refuses_a_typo() -> None:
    with TestClient(create_app(Hub(make_config()))) as client:
        antwort = client.put(
            "/api/media/volumeplan",
            json={"plans": [{"steps": [{"at": "25:00", "volume": 20}]}]},
        )
        assert antwort.status_code == 400
        assert "Uhrzeit" in antwort.json()["detail"]


# ── Was ein Plan anfassen kann ────────────────────────────────────────
#
# Hier lagen zwei Listen auseinander: Der Hub stellte
# Lautsprechergruppen mit, die App bot sie nicht zur Wahl an. Wer eine
# Gruppe aus dem Plan nehmen wollte, fand sie nirgends.


def geraet(entity_id: str, state: str = "idle", **stand: object) -> Entity:
    return Entity(
        id=entity_id,
        kind="media_player",
        name=entity_id,
        integration="demo",
        state={"state": state, **stand},
        commands=["set_volume", "play"],
        available=True,
    )


def test_a_speaker_that_takes_a_volume_is_a_candidate() -> None:
    assert lautplan.kandidat(geraet("cast.bad")) is True


def test_a_group_is_a_candidate_too() -> None:
    # Sie war es beim Hub immer schon - nur die App zeigte sie nicht.
    assert lautplan.kandidat(geraet("cast.haus", is_group=True)) is True


def test_a_television_is_a_candidate_too() -> None:
    # Ob er gestellt wird, entscheidet die Auswahl - nicht dieser Filter.
    assert lautplan.kandidat(geraet("cast.tv", has_screen=True)) is True


def test_a_device_without_a_volume_is_none() -> None:
    stumm = Entity(
        id="demo.klingel",
        kind="media_player",
        name="Klingel",
        integration="demo",
        state={"state": "idle"},
        commands=["play"],
    )
    assert lautplan.kandidat(stumm) is False


def test_an_unreachable_device_is_none() -> None:
    weg = geraet("cast.weg")
    weg.available = False
    assert lautplan.kandidat(weg) is False


def test_a_named_television_is_covered() -> None:
    """Was in der Auswahl steht, muss auch gelten - eine Auswahl, die
    etwas anzeigt, das der Hub dann doch nicht anfasst, ist schlimmer
    als gar keine."""
    plan = {**PLAN, "entities": ["cast.tv"]}
    assert lautplan.gilt_fuer(plan, "cast.tv", bildschirm=True) is True


def test_all_speakers_does_not_mean_the_television() -> None:
    # Seine Lautstärke gehört zum Bild und nicht zur Tageszeit.
    assert lautplan.gilt_fuer(PLAN, "cast.tv", bildschirm=True) is False
    assert lautplan.gilt_fuer(PLAN, "cast.bad", bildschirm=False) is True


async def test_the_plan_leaves_an_unnamed_television_alone() -> None:
    hub = await hub_mit_box()
    try:
        await hub.registry.add(geraet("cast.tv", has_screen=True, volume=40))
        hub.data.set(lautplan.KEY, [PLAN])
        await hub.lautplan.anwenden(uhr("11:00"))
        assert hub.registry.get("cast.tv").state["volume"] == 40
    finally:
        await hub.stop()


async def test_a_named_television_is_set_after_all() -> None:
    hub = await hub_mit_box()
    try:
        await hub.registry.add(geraet("cast.tv", has_screen=True, volume=40))
        hub.data.set(lautplan.KEY, [{**PLAN, "entities": ["cast.tv"]}])
        await hub.lautplan.anwenden(uhr("11:00"))
        assert hub.registry.get("cast.tv").state["volume"] == 70
    finally:
        await hub.stop()


async def test_a_group_is_set_like_any_other_box() -> None:
    hub = await hub_mit_box()
    try:
        await hub.registry.add(geraet("cast.haus", is_group=True, volume=40))
        hub.data.set(lautplan.KEY, [PLAN])
        await hub.lautplan.anwenden(uhr("11:00"))
        assert hub.registry.get("cast.haus").state["volume"] == 70
    finally:
        await hub.stop()


# ── Und wenn die Wiedergabe endet ─────────────────────────────────────
#
# Der Fehler, den erst der Betrieb zeigte: Die Rücksicht auf den
# Fernseher stand nur im Stufenwechsel. Endete auf ihm ein Film, holte
# er sich den Wert des Plans - der Weg über _on_state fragte gar nicht
# erst nach dem Bildschirm.


async def test_a_television_does_not_grab_the_value_when_the_film_ends() -> None:
    hub = await hub_mit_box()
    try:
        await hub.registry.add(
            geraet("cast.tv", has_screen=True, volume=40, state="playing")
        )
        hub.data.set(lautplan.KEY, [PLAN])
        echte_zeit = hub.lautplan.jetzt_min
        hub.lautplan.jetzt_min = lambda jetzt=None: um("11:00")  # type: ignore[method-assign]
        try:
            await hub.registry.update_state("cast.tv", {"state": "idle"})
            await asyncio.sleep(0.05)
        finally:
            hub.lautplan.jetzt_min = echte_zeit  # type: ignore[method-assign]
        assert hub.registry.get("cast.tv").state["volume"] == 40
    finally:
        await hub.stop()


async def test_a_named_television_does_take_it() -> None:
    """Wer genannt ist, ist dabei - auch beim Ende der Wiedergabe."""
    hub = await hub_mit_box()
    try:
        await hub.registry.add(
            geraet("cast.tv", has_screen=True, volume=40, state="playing")
        )
        hub.data.set(lautplan.KEY, [{**PLAN, "entities": ["cast.tv"]}])
        echte_zeit = hub.lautplan.jetzt_min
        hub.lautplan.jetzt_min = lambda jetzt=None: um("11:00")  # type: ignore[method-assign]
        try:
            await hub.registry.update_state("cast.tv", {"state": "idle"})
            await asyncio.sleep(0.05)
        finally:
            hub.lautplan.jetzt_min = echte_zeit  # type: ignore[method-assign]
        assert hub.registry.get("cast.tv").state["volume"] == 70
    finally:
        await hub.stop()


async def test_a_speaker_still_takes_it_when_the_music_ends() -> None:
    hub = await hub_mit_box()
    try:
        await hub.registry.update_state("test.box", {"state": "playing"})
        hub.data.set(lautplan.KEY, [PLAN])
        echte_zeit = hub.lautplan.jetzt_min
        hub.lautplan.jetzt_min = lambda jetzt=None: um("11:00")  # type: ignore[method-assign]
        try:
            await hub.registry.update_state("test.box", {"state": "idle"})
            await asyncio.sleep(0.05)
        finally:
            hub.lautplan.jetzt_min = echte_zeit  # type: ignore[method-assign]
        assert hub.registry.get("test.box").state["volume"] == 70
    finally:
        await hub.stop()
