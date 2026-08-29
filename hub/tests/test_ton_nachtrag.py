"""Lautstärke nachreichen, statt in laufende Musik hineinzustellen.

Ein Ablauf, der morgens alle Boxen auf 20 % stellt, meint die stillen
Boxen - nicht die, auf der gerade Radio läuft.
"""

from __future__ import annotations

import asyncio

from homepilot.core import ton
from homepilot.core.entity import Entity
from homepilot.core.hub import Hub
from homepilot.core.source import as_source, automation_source, scene_source, user_source

from .conftest import make_config

ABLAUF = automation_source("a1", "Lautstärke Lautsprecher Morgen")


# ── Die reine Entscheidung ────────────────────────────────────────────


def test_an_automation_waits_for_a_playing_speaker() -> None:
    assert ton.soll_warten("media_player", "playing", "set_volume", "automation") is True


def test_a_buffering_speaker_counts_as_playing() -> None:
    # Zwischen «gleich» und «jetzt» soll niemand hineinstellen.
    assert ton.soll_warten("media_player", "buffering", "set_volume", "automation") is True


def test_a_silent_speaker_is_exactly_what_the_automation_means() -> None:
    assert ton.soll_warten("media_player", "idle", "set_volume", "automation") is False


def test_a_hand_on_the_dial_wants_it_now() -> None:
    # Wer selbst dreht, während Musik läuft, will es jetzt lauter.
    assert ton.soll_warten("media_player", "playing", "set_volume", "user") is False


def test_a_scene_is_pressed_by_somebody() -> None:
    assert ton.soll_warten("media_player", "playing", "set_volume", "scene") is False


def test_an_announcement_must_be_heard() -> None:
    # play_url trägt auch eine Lautstärke - die darf nicht warten.
    assert ton.soll_warten("media_player", "playing", "play_url", "automation") is False


def test_louder_without_a_number_is_a_handle_not_a_baseline() -> None:
    assert ton.soll_warten("media_player", "playing", "volume_up", "automation") is False


def test_a_lamp_never_waits() -> None:
    assert ton.soll_warten("light", "on", "set_volume", "automation") is False


def test_the_switch_turns_the_whole_thing_off() -> None:
    assert (
        ton.soll_warten("media_player", "playing", "set_volume", "automation", an=False)
        is False
    )


# ── Das reine Gedächtnis ──────────────────────────────────────────────


def test_the_newest_wish_beats_the_older_one() -> None:
    # Um sieben 20 %, um zehn 70 %, und die ganze Zeit läuft Radio:
    # Beim Ausschalten gilt 70 %. Eine Warteschlange spielte am Ende die
    # ganze Tageskurve in zwei Sekunden ab.
    liste = ton.nachtrag_setzen([], "demo.box", 20, ABLAUF, 100.0)
    liste = ton.nachtrag_setzen(liste, "demo.box", 70, ABLAUF, 200.0)
    assert len(liste) == 1
    assert liste[0]["volume"] == 70


def test_every_speaker_keeps_its_own_wish() -> None:
    liste = ton.nachtrag_setzen([], "demo.bad", 20, ABLAUF, 100.0)
    liste = ton.nachtrag_setzen(liste, "demo.buero", 70, ABLAUF, 100.0)
    assert {zeile["entity_id"] for zeile in liste} == {"demo.bad", "demo.buero"}


def test_the_source_travels_with_the_wish() -> None:
    # Damit am Gerät später der Ablauf steht und nicht «Gerät».
    liste = ton.nachtrag_setzen([], "demo.box", 20, ABLAUF, 100.0)
    assert liste[0]["source"]["label"] == "Lautstärke Lautsprecher Morgen"


def test_nonsense_is_not_remembered() -> None:
    assert ton.nachtrag_setzen([], "demo.box", None, ABLAUF, 100.0) == []


def test_a_volume_is_forced_into_its_range() -> None:
    assert ton.nachtrag_setzen([], "demo.box", 150, ABLAUF, 100.0)[0]["volume"] == 100


def test_forgetting_leaves_the_others_alone() -> None:
    liste = ton.nachtrag_setzen([], "demo.a", 20, ABLAUF, 100.0)
    liste = ton.nachtrag_setzen(liste, "demo.b", 30, ABLAUF, 100.0)
    assert [z["entity_id"] for z in ton.nachtrag_ohne(liste, "demo.a")] == ["demo.b"]


# ── Am laufenden Hub ──────────────────────────────────────────────────


async def box(hub: Hub, entity_id: str, zustand: str, volume: int = 55) -> Entity:
    entity = Entity(
        id=entity_id,
        kind="media_player",
        name="Nest Badezimmer",
        integration="demo",
        state={"state": zustand, "volume": volume},
        commands=["set_volume", "play", "pause"],
    )
    await hub.registry.add(entity)
    return entity


async def gestartet() -> Hub:
    hub = Hub(make_config(integrations=[{"integration": "demo"}]))
    await hub.start()
    return hub


async def test_the_wish_is_kept_instead_of_cutting_into_the_music() -> None:
    hub = await gestartet()
    try:
        entity = await box(hub, "test.radio", "playing")
        with as_source(ABLAUF):
            await hub.integrations.dispatch_command("test.radio", "set_volume", {"volume": 20})
        # Die Box steht noch, wo sie stand - der Wunsch liegt auf Halde.
        assert entity.state["volume"] == 55
        assert hub.ton.nachtrag()[0]["volume"] == 20
    finally:
        await hub.stop()


async def test_the_wish_arrives_when_the_music_stops() -> None:
    hub = await gestartet()
    try:
        await box(hub, "test.radio", "playing")
        with as_source(ABLAUF):
            await hub.integrations.dispatch_command("test.radio", "set_volume", {"volume": 20})
        await hub.registry.update_state("test.radio", {"state": "idle"})
        # Das Nachreichen läuft als eigene Aufgabe - einmal durchatmen.
        await asyncio.sleep(0.05)
        assert hub.registry.get("test.radio").state["volume"] == 20
        assert hub.ton.nachtrag() == []
    finally:
        await hub.stop()


async def test_a_silent_speaker_is_set_right_away() -> None:
    hub = await gestartet()
    try:
        await box(hub, "test.box", "idle")
        with as_source(ABLAUF):
            await hub.integrations.dispatch_command("test.box", "set_volume", {"volume": 20})
        assert hub.registry.get("test.box").state["volume"] == 20
        assert hub.ton.nachtrag() == []
    finally:
        await hub.stop()


async def test_a_hand_on_the_dial_goes_through_immediately() -> None:
    hub = await gestartet()
    try:
        await box(hub, "test.radio", "playing")
        with as_source(user_source("Stibe")):
            await hub.integrations.dispatch_command("test.radio", "set_volume", {"volume": 80})
        assert hub.registry.get("test.radio").state["volume"] == 80
        assert hub.ton.nachtrag() == []
    finally:
        await hub.stop()


async def test_a_scene_goes_through_immediately() -> None:
    hub = await gestartet()
    try:
        await box(hub, "test.radio", "playing")
        with as_source(scene_source("s1", "Party")):
            await hub.integrations.dispatch_command("test.radio", "set_volume", {"volume": 85})
        assert hub.registry.get("test.radio").state["volume"] == 85
    finally:
        await hub.stop()


async def test_a_later_direct_set_drops_the_stale_wish() -> None:
    """Sonst spränge die Box beim nächsten Musikende auf einen Wert von
    vorgestern."""
    hub = await gestartet()
    try:
        await box(hub, "test.radio", "playing")
        with as_source(ABLAUF):
            await hub.integrations.dispatch_command("test.radio", "set_volume", {"volume": 20})
        assert hub.ton.nachtrag()
        # Jemand dreht selbst - damit ist der aufgeschobene Wunsch weg.
        with as_source(user_source("Stibe")):
            await hub.integrations.dispatch_command("test.radio", "set_volume", {"volume": 60})
        assert hub.ton.nachtrag() == []
        await hub.registry.update_state("test.radio", {"state": "idle"})
        await asyncio.sleep(0.05)
        assert hub.registry.get("test.radio").state["volume"] == 60
    finally:
        await hub.stop()


async def test_fading_is_not_deferred_even_under_an_automation() -> None:
    """Einblenden betrifft die laufende Wiedergabe - verschieben hiesse
    abschaffen."""
    hub = await gestartet()
    try:
        await box(hub, "test.radio", "playing", volume=0)
        with as_source(ABLAUF):
            await hub.ton.einblenden("test.radio", 40, dauer=0.2)
            await asyncio.sleep(1.2)
        assert hub.registry.get("test.radio").state["volume"] == 40
        assert hub.ton.nachtrag() == []
    finally:
        await hub.stop()


async def test_the_switch_makes_the_wish_go_through() -> None:
    hub = await gestartet()
    try:
        await box(hub, "test.radio", "playing")
        hub.ton.warten_setzen(False)
        with as_source(ABLAUF):
            await hub.integrations.dispatch_command("test.radio", "set_volume", {"volume": 20})
        assert hub.registry.get("test.radio").state["volume"] == 20
    finally:
        await hub.stop()


async def test_switching_it_off_also_clears_what_still_waits() -> None:
    """Ein Wunsch von heute früh, der Wochen später zuschlägt, wäre ein
    Gespenst."""
    hub = await gestartet()
    try:
        await box(hub, "test.radio", "playing")
        with as_source(ABLAUF):
            await hub.integrations.dispatch_command("test.radio", "set_volume", {"volume": 20})
        hub.ton.warten_setzen(False)
        assert hub.ton.nachtrag() == []
    finally:
        await hub.stop()


async def test_a_progress_update_does_not_trigger_the_wish() -> None:
    """Ein Player, der zehnmal je Minute seinen Fortschritt meldet, darf
    die Lautstärke nicht zehnmal setzen."""
    hub = await gestartet()
    try:
        await box(hub, "test.radio", "playing")
        with as_source(ABLAUF):
            await hub.integrations.dispatch_command("test.radio", "set_volume", {"volume": 20})
        await hub.registry.update_state("test.radio", {"track": "Nächster Titel"})
        await asyncio.sleep(0.05)
        assert hub.registry.get("test.radio").state["volume"] == 55
        assert hub.ton.nachtrag()
    finally:
        await hub.stop()


async def test_the_deferred_set_runs_under_the_automations_name() -> None:
    """Am Gerät soll später der Ablauf stehen, der es wollte, und nicht
    «Gerät» - sonst führt die Frage «warum ist das so leise?» ins Leere."""
    from homepilot.core import source as quellmodul

    hub = await gestartet()
    try:
        await box(hub, "test.radio", "playing")
        with as_source(ABLAUF):
            await hub.integrations.dispatch_command("test.radio", "set_volume", {"volume": 20})

        gesehen: list[dict] = []
        echt = hub.integrations.dispatch_command

        async def merken(entity_id, command, data=None):
            gesehen.append(quellmodul.current())
            return await echt(entity_id, command, data)

        hub.integrations.dispatch_command = merken  # type: ignore[method-assign]
        await hub.registry.update_state("test.radio", {"state": "idle"})
        await asyncio.sleep(0.05)
        assert gesehen and gesehen[0]["label"] == "Lautstärke Lautsprecher Morgen"
        assert gesehen[0]["kind"] == "automation"
    finally:
        await hub.stop()
