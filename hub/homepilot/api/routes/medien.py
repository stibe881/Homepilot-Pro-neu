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


class FavoritRequest(BaseModel):
    """Ein Favorit: ein Name, eine Art und wo er laufen soll."""

    kind: str
    name: str
    id: str = ""
    player: str = ""
    device: str = ""
    image: str = ""


class SchlummerRequest(BaseModel):
    minutes: float = 30.0


class WeckerRequest(BaseModel):
    time: str
    player: str
    id: str = ""
    on: bool = True
    days: list[int] | None = None
    device: str = ""
    volume: int = 35
    fade: float = 20.0
    kind: str = "station"
    name: str = ""
    label: str = ""


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require

    def musik() -> Any:
        buch = getattr(hub, "musik", None)
        if buch is None:  # pragma: no cover - nur in Teststummeln
            raise HTTPException(status_code=503, detail="Der Hub startet noch")
        return buch

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

    @app.get("/api/media/{entity_id}/members")
    async def group_members(entity_id: str, request: Request) -> dict[str, Any]:
        """Die Boxen, aus denen diese Gruppe besteht.

        Der Chromecast wird gefragt, statt zu raten. Antwortet er nicht -
        das kommt vor, die Abfrage baut eine eigene Verbindung auf -,
        kommt eine leere Liste; die App zeigt dann alle Einzelboxen und
        sagt dazu, dass sie raten musste.
        """
        current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None:
            raise HTTPException(status_code=404, detail="Diese Box kennt der Hub nicht")
        cast = hub.integrations.get(entity.integration)
        if cast is None or not hasattr(cast, "gruppen_mitglieder"):
            return {"members": [], "reason": "Diese Box führt keine Gruppe."}
        return {"members": await cast.gruppen_mitglieder(entity_id)}

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

    # ── Favoriten ──────────────────────────────────────────────────────

    @app.get("/api/media/favorites")
    async def favorites(request: Request) -> dict[str, Any]:
        current_user(request)
        return {"favorites": musik().favoriten()}

    @app.post("/api/media/favorites")
    async def add_favorite(body: FavoritRequest, request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        try:
            return musik().favorit_setzen(body.model_dump())
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.delete("/api/media/favorites/{favorite_id}")
    async def remove_favorite(favorite_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        if not musik().favorit_entfernen(favorite_id):
            raise HTTPException(status_code=404, detail="Diesen Favoriten gibt es nicht")
        return {"ok": True}

    @app.post("/api/media/favorites/{favorite_id}/play")
    async def play_favorite(
        favorite_id: str, request: Request, device: str = ""
    ) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        try:
            return await musik().favorit_abspielen(favorite_id, device)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    # ── Was lief zuletzt ───────────────────────────────────────────────

    @app.get("/api/media/history")
    async def history(request: Request) -> dict[str, Any]:
        """«Wie hiess das Lied vorhin?» - die Frage, die die Kachel
        allein nicht beantworten kann."""
        current_user(request)
        return {"history": musik().verlauf()}

    # ── Schlummer ──────────────────────────────────────────────────────

    @app.get("/api/media/sleep")
    async def sleep_timers(request: Request) -> dict[str, Any]:
        current_user(request)
        return {"timers": musik().schlummer_stand()}

    @app.post("/api/media/{entity_id}/sleep")
    async def start_sleep(
        entity_id: str, body: SchlummerRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        try:
            return musik().schlummer(entity_id, body.minutes)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.delete("/api/media/{entity_id}/sleep")
    async def stop_sleep(entity_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        return {"ok": musik().schlummer_abbrechen(entity_id)}

    # ── Musikwecker ────────────────────────────────────────────────────

    @app.get("/api/media/alarms")
    async def alarms(request: Request) -> dict[str, Any]:
        current_user(request)
        return {"alarms": musik().wecker()}

    @app.put("/api/media/alarms")
    async def set_alarm(body: WeckerRequest, request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        try:
            return musik().wecker_setzen(body.model_dump())
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.delete("/api/media/alarms/{alarm_id}")
    async def remove_alarm(alarm_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        if not musik().wecker_entfernen(alarm_id):
            raise HTTPException(status_code=404, detail="Diesen Wecker gibt es nicht")
        return {"ok": True}
