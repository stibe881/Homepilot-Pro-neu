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

from ...core import presence as presence_module
from ...core import users as users_module
from ...core.errors import UnknownEntityError
from ...core.users import Capability
from ...integrations import group as group_module
from ..context import ApiContext
from ..models import GeofenceRequest, HomeRequest, LightGroupRequest

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
            state = await service.report(
                zone, body.event, place=body.place, battery=body.battery
            )
        except KeyError:
            raise HTTPException(
                status_code=404, detail=f"Unbekannte Zone: {zone}"
            ) from None
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        return {"ok": True, "zone": zone, "state": state, "place": body.place or "home"}

    @app.post("/api/presence/home")
    async def set_home(body: HomeRequest, request: Request) -> dict[str, Any]:
        """Den Hausstandort von der aktuellen Position übernehmen.

        Bisher kam er aus der config.yaml, und wenn dort keiner stand,
        aus einer Vorgabe im Quelltext. Beides ist eine Zahl, die jemand
        einmal eingetippt hat - und wenn sie um elf Kilometer daneben
        liegt, sagt das niemand: Man sieht nur, dass man laut Hub
        «unterwegs» ist, während man in der Stube sitzt.

        Wer zuhause steht, drückt hier einen Knopf. Vertippen ist
        ausgeschlossen.
        """
        require(request, Capability.EDIT_CONFIG)
        service = hub.integrations.get("geofence")
        if service is None:
            raise HTTPException(
                status_code=503,
                detail="Die geofence-Integration ist nicht eingerichtet",
            )
        heimat = await service.set_heimat(
            body.latitude, body.longitude, body.radius or 150.0
        )
        return {"ok": True, "home": heimat}

    @app.get("/api/presence/home")
    async def get_home(request: Request) -> dict[str, Any]:
        """Wo der Hub das Zuhause vermutet – und woher er das weiss."""
        current_user(request)
        service = hub.integrations.get("geofence")
        if service is None:
            raise HTTPException(
                status_code=503,
                detail="Die geofence-Integration ist nicht eingerichtet",
            )
        return {"home": service.heimat()}

    @app.get("/api/presence/zones")
    async def presence_zones(request: Request) -> dict[str, Any]:
        """Die Orte, die jedes Telefon überwachen soll.

        Bis hierher kannte jede Zone nur einen Namen - wo dieser Ort
        liegt, wusste der Hub nicht, und darum musste jede Person ihren
        Kurzbefehl selbst bauen. Mit Koordinaten hier holt sich jedes
        Gerät dieselben Orte, und eine geänderte Adresse ändert man
        einmal.
        """
        current_user(request)
        service = hub.integrations.get("geofence")
        if service is None:
            raise HTTPException(
                status_code=503,
                detail="Die geofence-Integration ist nicht eingerichtet",
            )
        return {
            "places": list(getattr(service, "places", [])),
            "zones": list(service.zone_ids()),
        }

    @app.get("/api/presence")
    async def presence_overview(request: Request) -> dict[str, Any]:
        """Wer ist da? – die meistgestellte Frage im Haushalt.

        Je Person eine Zeile mit «seit wann», allein aus der Ortsmeldung
        des Telefons (Punkt 200). Das WLAN kommt hier nicht vor – es
        beantwortet «Gerät im Netz», nicht «Mensch zuhause», und solange
        beides nebeneinanderstand, widersprachen sich Startseite und
        Liste. Ohne Karte und ohne Meterangaben: «Sandra zuhause · Stefan
        unterwegs seit 14:20» beantwortet, was man wissen will.
        """
        current_user(request)
        verlauf = hub.data.get("presence_history")
        service = hub.integrations.get("geofence")

        # Je Zone ihr Anzeigename – daran werden die Benutzer erkannt.
        zonen: dict[str, str] = {}
        if service is not None:
            for zone_id in service.zone_ids():
                entity_id = service.zone_entity(zone_id)
                entity = hub.registry.get(entity_id) if entity_id else None
                zonen[zone_id] = entity.name if entity else zone_id

        # Eine Zeile je Benutzer, nicht je Zone: Wer «wer ist da?» fragt,
        # meint die Leute, die hier wohnen – nicht die Einträge, die
        # jemand einmal in die config.yaml geschrieben hat. Gäste bleiben
        # draussen; für sie ist die Ortung ohnehin aus.
        leute = []
        for user in hub.users.users:
            if user.role == users_module.Role.GUEST or not user.enabled:
                continue
            zone_id = presence_module.zone_fuer(user.name, zonen)
            zusammen = service.merged(zone_id) if (service and zone_id) else {}
            entity_id = service.zone_entity(zone_id) if (service and zone_id) else None
            entity = hub.registry.get(entity_id) if entity_id else None
            leute.append(
                {
                    "zone": zone_id,
                    "name": user.name,
                    "state": zusammen.get("state", presence_module.UNKNOWN),
                    "source": zusammen.get("source", "none"),
                    "place": zusammen.get("place"),
                    "place_name": (entity.state.get("place_name") if entity else None),
                    "battery": (entity.state.get("battery") if entity else None),
                    # Ohne Zone gibt es nichts einzurichten, worauf das
                    # Telefon melden könnte. Das sagt die App dann auch.
                    "configured": zone_id is not None,
                    "since": presence_module.since(verlauf, zone_id) if zone_id else None,
                }
            )
        return {"people": leute}

    @app.get("/api/presence/diagnose")
    async def presence_diagnose(request: Request) -> dict[str, Any]:
        """Warum steht da «weg»? Je Person eine Zeile.

        Das Gegenstück zur Ablauf-Diagnose: wann die letzte Meldung kam,
        über welchen Weg, und ob das nach Funkstille aussieht. Der halbe
        Support-Fall «die Ortung spinnt» ist damit selbst zu beantworten.
        """
        current_user(request)
        service = hub.integrations.get("geofence")
        if service is None:
            raise HTTPException(
                status_code=503,
                detail="Die geofence-Integration ist nicht eingerichtet",
            )
        return {"people": service.diagnose()}

