"""Einmal-Türöffnung: Links erstellen, einlösen, zurückziehen.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
)

from ...core import guestpass
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

    def _html(inhalt: str, status: int = 200) -> Response:
        return Response(
            content=inhalt, status_code=status, media_type="text/html; charset=utf-8"
        )

    def _abgelaufen() -> Response:
        return _html(
            guestpass.seite(
                "Dieser Link gilt nicht mehr.",
                "Er war für genau eine Öffnung gedacht und ist verbraucht, "
                "abgelaufen oder zurückgezogen.",
            ),
            status=410,
        )

    def _bremse(request: Request) -> tuple[str, Response | None]:
        """Die Bremse gegen das Durchprobieren von Adressen."""
        address = throttle_module.client_address(request)
        if throttle.blocked_for(address) > 0:
            return address, _html(
                guestpass.seite(
                    "Zu viele Versuche.", "Bitte später nochmal probieren."
                ),
                status=429,
            )
        return address, None

    @app.get("/einmal/{token}")
    async def show_pass(token: str, request: Request) -> Response:
        """Den Link *zeigen* - und ausdrücklich nichts öffnen.

        Das war der gemeldete Fehler: Der Link öffnete früher schon beim
        Abrufen. Wer ihn verschickte, löste ihn damit selbst ein - jeder
        Messenger, jeder Mailserver und jeder Virenscanner baut eine
        Vorschau, indem er die Adresse abruft. Die Türen gingen also auf,
        sobald man auf «Teilen» tippte, und beim Boten stand nur noch
        «Dieser Link gilt nicht mehr».

        Ein GET darf nichts verändern. Geöffnet wird per POST, und den
        löst nur ein Mensch aus, der auf den Knopf drückt.
        """
        address, gebremst = _bremse(request)
        if gebremst is not None:
            return gebremst
        entry = hub.passes.get(token)
        now = time.time()
        # Vier Fälle, eine Antwort: Es gibt ihn nicht, er ist verbraucht,
        # abgelaufen - oder er gilt noch nicht. Das Letzte sieht wie ein
        # Fehler aus und ist Absicht: Wer Adressen durchprobiert, soll aus
        # der Antwort nicht lernen, dass es sich lohnt, in zwei Stunden
        # wiederzukommen (siehe PassStore.redeem).
        if (
            entry is None
            or entry.used_at is not None
            or entry.expires < now
            or entry.pending(now)
        ):
            throttle.failed(address)
            return _abgelaufen()
        namen = {e.id: e.label for e in hub.registry.all()}
        tueren = guestpass.tuerennamen(entry, namen)
        return _html(
            guestpass.seite(
                " und ".join(tueren) or "Türe öffnen",
                "Der Knopf öffnet genau einmal. Danach gilt der Link nicht mehr.",
                knopf="Jetzt öffnen",
            )
        )

    @app.post("/einmal/{token}")
    async def redeem_pass(token: str, request: Request) -> Response:
        """Den Link einlösen - ohne Anmeldung, dafür genau einmal.

        Nur per POST: siehe ``show_pass``. Die Adresse selbst ist das
        Geheimnis; wer sie hat, darf öffnen - aber erst, wenn ein Mensch
        auf den Knopf gedrückt hat.
        """
        address, gebremst = _bremse(request)
        if gebremst is not None:
            return gebremst
        try:
            entry = hub.passes.redeem(token)
        except KeyError:
            throttle.failed(address)
            return _abgelaufen()
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
            return _html(
                guestpass.seite(
                    "Hat nicht geklappt.",
                    "Keine Türe liess sich öffnen: " + ", ".join(failed) + ".",
                ),
                status=502,
            )
        satz = "Dieser Link gilt jetzt nicht mehr."
        if failed:
            # Halber Erfolg gehört gesagt, sonst steht der Bote im
            # Treppenhaus und rüttelt an der falschen Türe.
            satz = "Nicht geklappt hat: " + ", ".join(failed) + ". " + satz
        return _html(guestpass.seite(" und ".join(opened) + ": offen.", satz))

