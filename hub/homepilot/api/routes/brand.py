"""Die Brandmeldeanlage (Punkt 445): Überblick, Quittieren, Stumm, Probe.

Anders als bei der Alarmanlage darf hier jeder Bewohner hinein: Wer
nachts vom Rauchmelder geweckt wird, muss quittieren und stummschalten
können, ohne die Besitzerin zu wecken. Die Einstellungen (was beim
Auslösen geschaltet wird) bleiben bei denen, die das Haus einrichten.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request

from ...core.users import Capability
from ..context import ApiContext

log = logging.getLogger(__name__)


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    require = ctx.require

    def anlage():
        service = hub.integrations.get("brand")
        if service is None:
            raise HTTPException(status_code=503, detail="Brandmeldeanlage nicht geladen")
        return service

    def ueberblick() -> dict[str, Any]:
        service = anlage()
        return {
            "state": service._entity.as_dict()["state"],
            **service.config_dict(),
            "detectors": service.melderliste(),
            "history": service.history,
            # Ob eine Durchsage überhaupt möglich ist: Ohne Box bleibt der
            # Schalter zwar stehen, die App sagt aber dazu, dass niemand spricht.
            "speakers": len(
                [e for e in hub.registry.all() if "play_url" in e.commands]
            ),
        }

    @app.get("/api/brand")
    async def brand_overview(request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        return ueberblick()

    @app.put("/api/brand")
    async def brand_configure(body: dict[str, Any], request: Request) -> dict[str, Any]:
        user = require(request, Capability.EDIT_CONFIG)
        await anlage().update_config(body)
        hub.aenderungen.merken(user, "brand", "eingestellt")
        return {"ok": True, **ueberblick()}

    @app.post("/api/brand/quittieren")
    async def brand_quittieren(request: Request) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        return await anlage().quittieren(by=user.name)

    @app.post("/api/brand/stumm")
    async def brand_stumm(request: Request) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        return await anlage().stumm(by=user.name)

    @app.post("/api/brand/probealarm")
    async def brand_probealarm(request: Request) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        return await anlage().probealarm(by=user.name)

    @app.post("/api/brand/melder/{entity_id}/getestet")
    async def brand_melder_getestet(entity_id: str, request: Request) -> dict[str, Any]:
        """«Getestet»: Prüftaste gedrückt, Datum gemerkt, Erinnerung von vorn."""
        user = require(request, Capability.CONTROL)
        if hub.registry.get(entity_id) is None:
            raise HTTPException(status_code=404, detail="Diesen Melder kennt der Hub nicht")
        await anlage().melder_getestet(entity_id, by=user.name)
        return {"ok": True, **ueberblick()}

    @app.post("/api/brand/melder/{entity_id}/selbsttest")
    async def brand_melder_selbsttest(entity_id: str, request: Request) -> dict[str, Any]:
        """Den Selbsttest eines Melders anstossen, wo das Gerät ihn kennt."""
        require(request, Capability.CONTROL)
        entity = hub.registry.get(entity_id)
        if entity is None or "self_test" not in entity.commands:
            raise HTTPException(status_code=404, detail="Dieser Melder kennt keinen Selbsttest")
        await hub.integrations.dispatch_command(entity_id, "self_test", {})
        return {"ok": True}
