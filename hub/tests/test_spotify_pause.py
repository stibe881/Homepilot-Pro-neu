"""Pause, wo nichts läuft: Spotify soll nicht den Ablauf anhalten.

«Niemand mehr zuhause» stellt der Reihe nach ein Dutzend Quellen ab und
schliesst zuletzt die Türe. Spotify antwortet auf ein Pause ohne aktives
Gerät mit einem Fehler - und der brachte den Rest zum Stehen.
"""

from __future__ import annotations

import types
from typing import Any

import pytest


def spotify(zustand: str) -> tuple[Any, Any]:
    from homepilot.integrations.spotify import SpotifyIntegration

    integration = object.__new__(SpotifyIntegration)
    integration.log = types.SimpleNamespace(
        debug=lambda *a, **k: None,
        info=lambda *a, **k: None,
        warning=lambda *a, **k: None,
    )
    gerufen: list[tuple[str, str]] = []

    async def call(method: str, path: str, json: Any = None) -> None:
        gerufen.append((method, path))
        return None

    async def announce(_werte: Any) -> None:
        return None

    integration._call = call  # type: ignore[method-assign]
    integration._announce = announce  # type: ignore[method-assign]
    integration.gerufen = gerufen  # type: ignore[attr-defined]
    entity = types.SimpleNamespace(state={"state": zustand, "volume": 20})
    return integration, entity


@pytest.mark.asyncio
async def test_pausing_a_silent_spotify_asks_nothing_of_the_api() -> None:
    integration, entity = spotify("idle")
    await integration.handle_command(entity, "pause", {})
    assert integration.gerufen == []


@pytest.mark.asyncio
async def test_pausing_while_playing_still_pauses() -> None:
    integration, entity = spotify("playing")
    await integration.handle_command(entity, "pause", {})
    assert integration.gerufen == [("PUT", "/me/player/pause")]


@pytest.mark.asyncio
async def test_playing_is_untouched() -> None:
    """Nur das Ausschalten ist nachsichtig - wer abspielen will, soll
    erfahren, wenn es nicht geht."""
    integration, entity = spotify("idle")
    await integration.handle_command(entity, "play", {})
    assert integration.gerufen == [("PUT", "/me/player/play")]
