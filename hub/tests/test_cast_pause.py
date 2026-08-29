"""Pause auf einer leeren Cast-Box ist kein Fehler.

Der Fall aus dem Haus: «Niemand mehr zuhause» stellt der Reihe nach ein
Dutzend Boxen ab. Die erste, auf der ohnehin nichts lief, meldete
«Failed to execute pause.» - und der Ablauf war zu Ende, samt Türschloss
am Ende der Liste.
"""

from __future__ import annotations

from typing import Any

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.errors import ConfigError
from homepilot.core.hub import Hub
from homepilot.integrations.google_cast import GoogleCastIntegration


class FakeController:
    """Der Media-Controller einer Box - er zählt mit, was ankam."""

    def __init__(self) -> None:
        self.aufrufe: list[str] = []

    def pause(self) -> None:
        self.aufrufe.append("pause")

    def play(self) -> None:
        self.aufrufe.append("play")

    def stop(self) -> None:
        self.aufrufe.append("stop")


class FakeCast:
    def __init__(self) -> None:
        self.media_controller = FakeController()
        self.beendet = False

    def quit_app(self) -> None:
        self.beendet = True


async def _cast(zustand: str) -> tuple[Hub, GoogleCastIntegration, Entity, FakeCast]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    cast = GoogleCastIntegration(hub, {"devices": []})
    entity = Entity(
        id="google_cast.bad",
        kind=EntityKind.MEDIA_PLAYER,
        name="Nest Badezimmer",
        integration="google_cast",
        state={"state": zustand, "volume": 30},
        commands=["play", "pause", "turn_off", "set_volume"],
    )
    await hub.registry.add(entity)
    box = FakeCast()
    # `setup()` legt `_casts` an und verlangt dafür pychromecast - die
    # Bibliothek braucht es hier nicht, nur das Fach.
    cast._casts = {entity.id: box}  # type: ignore[assignment]
    return hub, cast, entity, box


@pytest.mark.asyncio
async def test_pausing_an_empty_box_does_nothing_and_says_nothing() -> None:
    hub, cast, entity, box = await _cast("idle")
    try:
        await cast.handle_command(entity, "pause", {})
        assert box.media_controller.aufrufe == []
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_pausing_a_playing_box_still_pauses() -> None:
    hub, cast, entity, box = await _cast("playing")
    try:
        await cast.handle_command(entity, "pause", {})
        assert box.media_controller.aufrufe == ["pause"]
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_a_paused_box_can_be_paused_again() -> None:
    # Der Zustand kann veraltet sein - solange eine Sitzung dasteht,
    # geht der Befehl durch.
    hub, cast, entity, box = await _cast("paused")
    try:
        await cast.handle_command(entity, "pause", {})
        assert box.media_controller.aufrufe == ["pause"]
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_playing_an_empty_box_still_says_so() -> None:
    """Die umgekehrte Antwort: Wer abspielen will, wo nichts ist, soll
    das erfahren."""
    hub, cast, entity, _ = await _cast("idle")
    try:
        with pytest.raises(ConfigError, match="läuft gerade nichts"):
            await cast.handle_command(entity, "play", {})
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_turning_off_ends_the_session_and_frees_the_box() -> None:
    hub, cast, entity, box = await _cast("playing")
    try:
        await cast.handle_command(entity, "turn_off", {})
        assert box.media_controller.aufrufe == ["stop"]
        assert box.beendet is True
        # Und die Kachel sagt es sofort, statt auf den nächsten Bericht
        # der Box zu warten.
        stand: dict[str, Any] = hub.registry.get(entity.id).state
        assert stand["state"] == "idle"
        assert stand["track"] is None
    finally:
        await hub.stop()
