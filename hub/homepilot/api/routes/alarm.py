"""Die Alarmanlage: Überblick, scharf/unscharf, Probealarm, PIN.

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

from ...core import throttle as throttle_module
from ...core.errors import HomePilotError
from ...core.users import Capability
from ...integrations import alarm as alarm_module
from ..context import ApiContext
from ..models import AlarmArmRequest, AlarmDisarmRequest, AlarmPinRequest

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    require = ctx.require

    # ── Alarmanlage ────────────────────────────────────────────────────────

    def alarm_service():
        service = hub.integrations.get("alarm")
        if service is None:
            raise HTTPException(status_code=503, detail="Alarmanlage nicht geladen")
        return service

    @app.get("/api/alarm")
    async def alarm_overview(request: Request) -> dict[str, Any]:
        """Zustand, Zuordnung und alle Sensoren, die in Frage kommen.

        Die Kandidatenliste kommt vom Hub statt aus der App: Nur er weiss,
        welche Entität wirklich einen Öffnungs- oder Bewegungszustand
        meldet – die App müsste es raten.
        """
        require(request, Capability.EDIT_CONFIG)
        service = alarm_service()
        return {
            "state": service._entity.as_dict()["state"],
            **service.config_dict(),
            "history": service.history,
            # Ob überhaupt ein Bild in einer Nachricht landen kann: Ohne
            # `push.public_url` gibt es keine Adresse, die das Telefon ohne
            # Anmeldung erreicht (siehe core/snapshots.py). Die App sagt es
            # dann dort, wo man das Bild erwartet - statt dass es einfach
            # ausbleibt.
            "images": bool((hub.config.push or {}).get("public_url")),
            "candidates": [
                {
                    "entity_id": entity.id,
                    "name": entity.name,
                    "room": entity.room,
                    "kind": entity.kind,
                    "device_class": entity.state.get("device_class"),
                    "open": alarm_module.sensor_open(entity),
                    "available": entity.available,
                }
                for entity in service.candidates()
            ],
        }

    @app.put("/api/alarm")
    async def alarm_configure(body: dict[str, Any], request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        service = alarm_service()
        await service.update_config(body)
        return {"ok": True, **service.config_dict()}

    @app.post("/api/alarm/arm")
    async def alarm_arm(body: AlarmArmRequest, request: Request) -> dict[str, Any]:
        """Scharf schalten. Offene Fenster melden statt blind loszulaufen –
        sonst schlägt die Anlage los, sobald die Verzögerung endet."""
        user = require(request, Capability.CONTROL)
        service = alarm_service()
        try:
            return await service.arm(body.mode, force=body.force, by=user.name)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.post("/api/alarm/disarm")
    async def alarm_disarm(
        request: Request,
        # Ohne Body gültig - ältere App-Fassungen schicken keinen, und ohne
        # gesetzte PIN braucht es auch keinen.
        body: AlarmDisarmRequest | None = None,
    ) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        try:
            return await alarm_service().disarm(
                by=user.name,
                pin=(body.pin if body else "") or None,
                address=throttle_module.client_address(request),
                # Am Wandtablet ist die PIN Pflicht - siehe check_pin().
                require_pin=user.shared,
            )
        except HomePilotError as err:
            # Falsche oder fehlende PIN - lesbar zurück, kein Stacktrace.
            raise HTTPException(status_code=403, detail=str(err)) from err

    @app.post("/api/alarm/test")
    async def alarm_test(request: Request) -> dict[str, Any]:
        """Probealarm: Sirene, Lichter und Nachricht einmal durchspielen.

        Die einzige Möglichkeit nachzusehen, ob die Anlage überhaupt
        etwas tut, bevor es darauf ankommt. Nur wer die Konfiguration
        ändern darf, darf testen – ein Gast soll keine Sirene starten.
        """
        user = require(request, Capability.EDIT_CONFIG)
        try:
            return await alarm_service().test_run(by=user.name)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.put("/api/alarm/pin")
    async def alarm_set_pin(body: AlarmPinRequest, request: Request) -> dict[str, Any]:
        """PIN fürs Entschärfen setzen oder (leer) entfernen.

        Nur Besitzer: Wer die PIN ändern darf, kann sie auch aushebeln -
        das gehört in dieselben Hände wie die Benutzerverwaltung.
        """
        require(request, Capability.MANAGE_USERS)
        try:
            alarm_service().set_pin(body.pin or None)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        return {"ok": True, "pin_required": alarm_service().pin_required()}

