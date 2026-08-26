"""Einmal-Türöffnung: Links erstellen, einlösen, zurückziehen.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
)

from ...core import throttle as throttle_module
from ...core.errors import HomePilotError
from ...core.source import as_source, user_source
from ...core.users import Capability
from ..context import ApiContext
from ..models import PassRequest, moment

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    throttle = ctx.throttle
    require = ctx.require

    # ── Einmal-Türöffnung ──────────────────────────────────────────────────

    def pass_base_url() -> str | None:
        return str((hub.config.push or {}).get("public_url") or "") or None

    @app.get("/api/passes")
    async def list_passes(request: Request) -> dict[str, Any]:
        require(request, Capability.MANAGE_USERS)
        base = pass_base_url()
        return {"passes": [entry.as_dict(base) for entry in hub.passes.all()]}

    @app.post("/api/passes")
    async def create_pass(body: PassRequest, request: Request) -> dict[str, Any]:
        """Einen Einmal-Link ausstellen.

        Nur für Geräte, die der Ausstellende auch selbst bedienen dürfte -
        sonst wäre der Link ein Weg, die eigenen Grenzen zu umgehen.
        """
        user = require(request, Capability.MANAGE_USERS)
        wanted = body.wanted()
        if not wanted:
            raise HTTPException(
                status_code=400, detail="Ein Einmal-Link ohne Tür öffnet nichts"
            )
        # Erst alles prüfen, dann ausstellen: Ein Link, bei dem die zweite
        # Türe nicht aufgeht, ist schlimmer als gar keiner - der Bote steht
        # dann im Haus und kommt nicht weiter.
        targets: list[tuple[str, str]] = []
        names: list[str] = []
        for item in wanted:
            entity = hub.registry.get(item.entity_id)
            if entity is None or not user.may_see(
                entity.id, entity.kind, entity.integration
            ):
                raise HTTPException(status_code=404, detail="Unbekanntes Gerät")
            if item.command not in entity.commands:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{entity.label}' kennt den Befehl '{item.command}' nicht",
                )
            targets.append((item.entity_id, item.command))
            names.append(entity.label)
        try:
            starts = moment(body.starts)
            until = moment(body.ends) or None
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        try:
            entry = hub.passes.create(
                targets=targets,
                created_by=user.name,
                minutes=body.minutes,
                label=body.label,
                starts=starts,
                until=until,
            )
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        log.warning(
            "Einmal-Link für %s ausgestellt von %s, gültig %s bis %s",
            " + ".join(names),
            user.name,
            datetime.fromtimestamp(entry.starts).isoformat(timespec="minutes")
            if entry.starts
            else "sofort",
            datetime.fromtimestamp(entry.expires).isoformat(timespec="minutes"),
        )
        base = pass_base_url()
        if base is None:
            log.warning(
                "Ohne 'push.public_url' in der config.yaml kennt der Hub seine "
                "Adresse von aussen nicht - der Link muss von Hand gebaut werden."
            )
        return {"ok": True, "pass": entry.as_dict(base)}

    @app.delete("/api/passes/{token}")
    async def revoke_pass(token: str, request: Request) -> dict[str, Any]:
        require(request, Capability.MANAGE_USERS)
        return {"ok": hub.passes.revoke(token)}

    @app.post("/einmal/{token}")
    @app.get("/einmal/{token}")
    async def redeem_pass(token: str, request: Request) -> Response:
        """Den Link einlösen - ohne Anmeldung, dafür genau einmal.

        Bewusst auch per GET: Der Empfänger tippt die Adresse an, sonst
        bräuchte er ein Formular. Die Adresse selbst ist das Geheimnis.
        """
        # Auch hier die Bremse: Sonst liesse sich der Token-Raum in Ruhe
        # durchprobieren, wenn jemand die Adresse kennt.
        address = throttle_module.client_address(request)
        waiting = throttle.blocked_for(address)
        if waiting > 0:
            return Response(
                content="Zu viele Versuche. Später nochmal.",
                status_code=429,
                media_type="text/plain; charset=utf-8",
            )
        try:
            entry = hub.passes.redeem(token)
        except KeyError:
            throttle.failed(address)
            return Response(
                content="Dieser Link gilt nicht mehr.",
                status_code=410,
                media_type="text/plain; charset=utf-8",
            )
        throttle.succeeded(address)

        # Alle Türen des Links, in der gespeicherten Reihenfolge. Der Link
        # ist mit dem Einlösen verbraucht - auch wenn eine Türe klemmt.
        # Ein Link, der nach halbem Erfolg weitergilt, liesse sich sonst
        # beliebig oft wiederholen.
        opened: list[str] = []
        failed: list[str] = []
        for entity_id, command in entry.targets:
            entity = hub.registry.get(entity_id)
            if entity is None:
                failed.append(f"{entity_id} (gibt es nicht mehr)")
                continue
            hub.audit.record(f"Einmal-Link von {entry.created_by}", entity, command, address)
            log.warning(
                "Einmal-Link eingelöst: %s → %s (von %s)", entity.label, command, address
            )
            try:
                with as_source(user_source(f"Einmal-Link ({entry.created_by})")):
                    await hub.integrations.dispatch_command(entity_id, command, {})
            except HomePilotError as err:
                log.error("Einmal-Link: %s liess sich nicht öffnen: %s", entity.label, err)
                failed.append(f"{entity.label} ({err})")
            else:
                opened.append(entity.label)

        if not opened:
            return Response(
                content="Hat nicht geklappt: " + ", ".join(failed) + "\n",
                status_code=502,
                media_type="text/plain; charset=utf-8",
            )
        text = " und ".join(opened) + ": erledigt."
        if failed:
            # Halber Erfolg gehört gesagt, sonst steht der Bote im
            # Treppenhaus und rüttelt an der falschen Türe.
            text += " Nicht geklappt hat: " + ", ".join(failed) + "."
        return Response(
            content=text + " Dieser Link gilt jetzt nicht mehr.\n",
            media_type="text/plain; charset=utf-8",
        )

