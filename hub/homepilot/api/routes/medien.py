"""Musik: was sich mit einem Gerätebefehl nicht ausdrücken lässt.

Lautstärke, Play und Pause sind Gerätebefehle und laufen über die
Gerätesteuerung. Hier steht das andere: die Nachtruhe (eine Einstellung
des Hauses, kein Befehl an eine Box), das Dämpfen beim Klingeln, das
Einblenden über mehrere Sekunden und der Umzug einer laufenden
Wiedergabe auf eine andere Box.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from ...core.errors import HomePilotError
from ...core.users import Capability
from ..context import ApiContext

log = logging.getLogger(__name__)


class TonEinstellung(BaseModel):
    """Nachtruhe und Dämpfen. Alles freiwillig - was fehlt, bleibt."""

    on: bool | None = None
    # Uhrzeiten als HH:MM.
    start: str | None = None
    end: str | None = None
    max: int | None = None
    duck: bool | None = None


class UmzugRequest(BaseModel):
    to: str


class EinblendRequest(BaseModel):
    volume: int
    seconds: float = 6.0


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require

    def ton() -> Any:
        meister = getattr(hub, "ton", None)
        if meister is None:  # pragma: no cover - nur in Teststummeln
            raise HTTPException(status_code=503, detail="Der Hub startet noch")
        return meister

    @app.get("/api/media/settings")
    async def media_settings(request: Request) -> dict[str, Any]:
        current_user(request)
        meister = ton()
        return {
            "night": meister.nachtruhe(),
            "duck": meister.daempfen_an(),
            # Damit die App zeigen kann, ob der Deckel gerade greift -
            # «ist eingeschaltet» und «gilt jetzt» sind zweierlei.
            "cap_now": meister.deckel(),
        }

    @app.put("/api/media/settings")
    async def set_media_settings(body: TonEinstellung, request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        meister = ton()
        werte: dict[str, Any] = {}
        if body.on is not None:
            werte["on"] = body.on
        if body.start is not None:
            werte["from"] = body.start
        if body.end is not None:
            werte["to"] = body.end
        if body.max is not None:
            werte["max"] = body.max
        try:
            nacht = meister.nachtruhe_setzen(werte) if werte else meister.nachtruhe()
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        duck = meister.daempfen_setzen(body.duck) if body.duck is not None else meister.daempfen_an()
        return {"night": nacht, "duck": duck, "cap_now": meister.deckel()}

    @app.post("/api/media/{entity_id}/move")
    async def move_playback(
        entity_id: str, body: UmzugRequest, request: Request
    ) -> dict[str, Any]:
        """Dieselbe Wiedergabe auf einer anderen Box weiterhören."""
        require(request, Capability.CONTROL)
        try:
            return await ton().verschieben(entity_id, body.to)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.post("/api/media/{entity_id}/fade")
    async def fade_in(
        entity_id: str, body: EinblendRequest, request: Request
    ) -> dict[str, Any]:
        """Langsam lauter werden - der Unterschied zwischen geweckt und
        erschreckt."""
        require(request, Capability.CONTROL)
        if hub.registry.get(entity_id) is None:
            raise HTTPException(status_code=404, detail="Diese Box kennt der Hub nicht")
        await ton().einblenden(entity_id, body.volume, body.seconds)
        return {"ok": True, "volume": body.volume, "seconds": body.seconds}
