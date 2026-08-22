"""Zusammengefasste Leuchten und Geofence-Meldungen.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
)

from ...core.errors import UnknownEntityError
from ...core.users import Capability
from ...integrations import group as group_module
from ..context import ApiContext
from ..models import GeofenceRequest, LightGroupRequest

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require

    # ── Zusammengefasste Leuchten ──────────────────────────────────────────
    #
    # Eine Deckenlampe mit fünf Spots ist ein Licht, nicht fünf. Was hier
    # entsteht, schaltet alle Mitglieder gemeinsam; die Mitglieder
    # verschwinden aus Räumen, Suche und Zählung und bleiben nur unter
    # Geräte einzeln bedienbar.

    def group_service() -> Any:
        service = hub.integrations.get("group")
        if service is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Die group-Integration ist nicht eingerichtet. In der "
                    "config.yaml genügt die Zeile '- integration: group'."
                ),
            )
        return service

    @app.get("/api/lightgroups")
    async def list_light_groups(request: Request) -> dict[str, Any]:
        current_user(request)
        return {"groups": hub.data.get("light_groups")}

    @app.post("/api/lightgroups")
    async def create_light_group(
        body: LightGroupRequest, request: Request
    ) -> dict[str, Any]:
        user = require(request, Capability.EDIT_CONFIG)
        service = group_service()
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Die Leuchte braucht einen Namen")
        if len(body.members) < 2:
            raise HTTPException(
                status_code=400,
                detail="Eine Leuchte fasst mindestens zwei Lampen zusammen",
            )
        taken: set[str] = set()
        for existing in hub.data.get("light_groups"):
            taken.update(str(m) for m in existing.get("members", []))
        for entity_id in body.members:
            entity = hub.registry.get(entity_id)
            if entity is None:
                raise HTTPException(
                    status_code=404, detail=f"Unbekanntes Gerät: {entity_id}"
                )
            if entity.integration == "group":
                raise HTTPException(
                    status_code=400,
                    detail="Eine Leuchte lässt sich nicht in eine andere stecken",
                )
            if entity_id in taken:
                # Sonst wäre unklar, welche Leuchte den Spot schaltet, und
                # er verschwände aus beiden Ansichten halb.
                raise HTTPException(
                    status_code=409,
                    detail=f"'{entity.name}' gehört schon zu einer Leuchte",
                )
        object_id = group_module.slug(name)
        rows = hub.data.get("light_groups")
        if any(row.get("id") == object_id for row in rows):
            raise HTTPException(
                status_code=409, detail=f"Eine Leuchte '{name}' gibt es schon"
            )
        rows.append(
            {
                "id": object_id,
                "name": name,
                "members": list(body.members),
                "kind": "switch" if body.kind == "switch" else "light",
                "hide_members": bool(body.hide_members),
            }
        )
        hub.data.set("light_groups", rows)
        await service.rebuild()
        log.warning("%s hat die Leuchte '%s' angelegt", user.name, name)
        return {"ok": True, "id": f"group.{object_id}"}

    @app.put("/api/lightgroups/{group_id}")
    async def update_light_group(
        group_id: str, body: LightGroupRequest, request: Request
    ) -> dict[str, Any]:
        """Eine bestehende Leuchte ändern: Name, Mitglieder, Sichtbarkeit.

        Ohne das blieb nur auflösen und neu anlegen - und dabei geht die
        Kennung verloren, an der Szenen, Abläufe und die Raumzuordnung
        hängen. Genau deshalb bleibt sie hier unangetastet, auch wenn der
        Name sich ändert: Aus «Decke» wird «Deckenlampe», und alles, was
        auf sie zeigt, zeigt weiter auf sie.
        """
        user = require(request, Capability.EDIT_CONFIG)
        service = group_service()
        wanted = group_id.split(".", 1)[-1]
        rows = hub.data.get("light_groups")
        treffer = next((row for row in rows if row.get("id") == wanted), None)
        if treffer is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Diese Leuchte kennt der Hub nicht - steht sie in der "
                    "config.yaml, gehört sie auch dort geändert."
                ),
            )

        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Die Leuchte braucht einen Namen")
        if len(body.members) < 2:
            raise HTTPException(
                status_code=400,
                detail="Eine Leuchte fasst mindestens zwei Lampen zusammen",
            )

        # Mitglieder anderer Leuchten bleiben tabu - die eigenen sind es
        # naturgemäss nicht, sonst liesse sich nie eine Lampe behalten.
        fremd: set[str] = set()
        for row in rows:
            if row.get("id") != wanted:
                fremd.update(str(m) for m in row.get("members", []))
        for entity_id in body.members:
            entity = hub.registry.get(entity_id)
            if entity is None:
                raise HTTPException(
                    status_code=404, detail=f"Unbekanntes Gerät: {entity_id}"
                )
            if entity.integration == "group":
                raise HTTPException(
                    status_code=400,
                    detail="Eine Leuchte lässt sich nicht in eine andere stecken",
                )
            if entity_id in fremd:
                raise HTTPException(
                    status_code=409,
                    detail=f"'{entity.name}' gehört schon zu einer Leuchte",
                )

        treffer["name"] = name
        treffer["members"] = list(body.members)
        treffer["kind"] = "switch" if body.kind == "switch" else "light"
        treffer["hide_members"] = bool(body.hide_members)
        hub.data.set("light_groups", rows)
        # Die Raumzuordnung hängt an der Entität, nicht an dieser Zeile:
        # Der Neuaufbau legt sie neu an, also vorher merken und danach
        # zurückgeben - sonst stünde die Leuchte plötzlich raumlos da.
        entity = hub.registry.get(f"group.{wanted}")
        raum = entity.room if entity is not None else None
        await service.rebuild()
        if raum:
            try:
                await hub.registry.set_room(f"group.{wanted}", raum)
            except UnknownEntityError:
                pass
        log.warning("%s hat die Leuchte '%s' geändert", user.name, name)
        return {"ok": True, "id": f"group.{wanted}"}

    @app.delete("/api/lightgroups/{group_id}")
    async def delete_light_group(group_id: str, request: Request) -> dict[str, Any]:
        user = require(request, Capability.EDIT_CONFIG)
        service = group_service()
        # Auch "group.decke" akzeptieren - so lässt sich die Kennung aus
        # der Geräteliste direkt weiterreichen.
        wanted = group_id.split(".", 1)[-1]
        rows = [row for row in hub.data.get("light_groups") if row.get("id") != wanted]
        if len(rows) == len(hub.data.get("light_groups")):
            raise HTTPException(
                status_code=404,
                detail=(
                    "Diese Leuchte kennt der Hub nicht - steht sie in der "
                    "config.yaml, gehört sie auch dort geändert."
                ),
            )
        hub.data.set("light_groups", rows)
        await service.rebuild()
        log.warning("%s hat die Leuchte '%s' aufgelöst", user.name, wanted)
        return {"ok": True}

    # ── Geofence ───────────────────────────────────────────────────────────

    @app.post("/api/presence/geofence")
    async def report_geofence(body: GeofenceRequest, request: Request) -> dict[str, Any]:
        """Das Telefon meldet Ankommen oder Weggehen.

        Aufgerufen von den iOS-Kurzbefehlen («Wenn ich ankomme» → Inhalte
        von URL abrufen) oder von Tasker. Bewusst ein eigener Endpunkt und
        kein Kommando: Eine Zone ist nichts, was sich schalten lässt.
        """
        user = current_user(request)
        service = hub.integrations.get("geofence")
        if service is None:
            raise HTTPException(
                status_code=503,
                detail="Die geofence-Integration ist nicht eingerichtet",
            )
        # Ohne Angabe gilt der eigene Name - so genügt im Kurzbefehl die
        # Adresse plus das Ereignis.
        zone = body.zone or user.name.lower()
        try:
            state = await service.report(zone, body.event)
        except KeyError:
            raise HTTPException(
                status_code=404, detail=f"Unbekannte Zone: {zone}"
            ) from None
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        return {"ok": True, "zone": zone, "state": state}

