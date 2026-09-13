"""Die PlayStation aus der App koppeln (Punkt 643 der Werkbank).

Zwei Schritte, weil zwei Dinge zusammenkommen müssen: Das PSN-Konto
(Sony will einen Browser und eine Anmeldung) und die Konsole (sie zeigt
einen Code, und nur wer ihn sieht, darf sie fernbedienen). Dazwischen
steht jemand auf, geht ins Wohnzimmer und liest ab - deshalb getrennte
Aufrufe, wie beim Fernseher (routes/androidtv.py).

``GET pair`` sagt, wo die Kopplung steht, ``POST pair`` liefert die
Anmeldeseite, ``pair/account`` nimmt die Adresse nach der Anmeldung
entgegen, ``pair/pin`` den Code von der Konsole.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from ...core.users import Capability
from ..context import ApiContext

log = logging.getLogger(__name__)


class KopplungStart(BaseModel):
    """``neu`` verwirft Konto und Registrierung.

    Der Fall dahinter: Die Konsole wurde zurückgesetzt oder ein anderes
    Konto soll her - die alte Registrierung verbindet dann nicht mehr,
    und ohne diesen Schalter käme man aus dem Zustand nie heraus.
    """

    neu: bool = False


class KopplungKonto(BaseModel):
    redirect_url: str


class KopplungCode(BaseModel):
    pin: str


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    require = ctx.require

    def konsole(entity_id: str) -> tuple[Any, str]:
        """Die Integration und die Konsolen-Id zu einer Kachel – oder eine Absage."""
        entity = hub.registry.get(entity_id)
        if entity is None:
            raise HTTPException(404, "Unbekanntes Gerät")
        service: Any = hub.integrations.get("playstation")
        if service is None:
            raise HTTPException(503, "Die PlayStation-Integration läuft nicht")
        ps_id = service.playstation_id(entity_id)
        if ps_id is None:
            raise HTTPException(400, "Dieses Gerät ist keine PlayStation")
        return service, ps_id

    @app.get("/api/playstation/{entity_id}/pair")
    async def pair_stand(entity_id: str, request: Request) -> dict[str, Any]:
        """Wo die Kopplung steht: Konto da? Registriert? Bibliothek da?"""
        require(request, Capability.CONTROL)
        service, ps_id = konsole(entity_id)
        return dict(service.pair_stand(ps_id))

    @app.post("/api/playstation/{entity_id}/pair")
    async def pair_start(
        entity_id: str, request: Request, body: KopplungStart | None = None
    ) -> dict[str, Any]:
        """Schritt 1 beginnen – die App öffnet die Anmeldeseite."""
        user = require(request, Capability.CONTROL)
        service, ps_id = konsole(entity_id)
        try:
            login_url = await service.pair_start(ps_id, neu=bool(body and body.neu))
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        log.info("%s beginnt die Kopplung mit %s", getattr(user, "name", "?"), ps_id)
        return {"ok": True, "login_url": login_url}

    @app.post("/api/playstation/{entity_id}/pair/account")
    async def pair_account(
        entity_id: str, body: KopplungKonto, request: Request
    ) -> dict[str, Any]:
        """Schritt 1 abschliessen – die Adresse nach der Anmeldung einfügen."""
        require(request, Capability.CONTROL)
        service, ps_id = konsole(entity_id)
        try:
            online_id = await service.pair_account(ps_id, body.redirect_url)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        except ConnectionError as err:
            # 503 und nicht 500: Sony antwortet nicht oder die Bibliothek
            # fehlt - kein Fehler des Hubs, und die App sagt es so weiter.
            raise HTTPException(503, str(err)) from err
        return {"ok": True, "online_id": online_id}

    @app.post("/api/playstation/{entity_id}/pair/pin")
    async def pair_pin(entity_id: str, body: KopplungCode, request: Request) -> dict[str, Any]:
        """Schritt 2 – den Code von der Konsole nachreichen (sie muss an sein)."""
        require(request, Capability.CONTROL)
        service, ps_id = konsole(entity_id)
        try:
            await service.pair_pin(ps_id, body.pin)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        except ConnectionError as err:
            raise HTTPException(503, str(err)) from err
        except Exception as err:  # noqa: BLE001 - der Grund gehört auf den Bildschirm
            # Beim allerersten Koppeln im Haus kam hier ein OSError der
            # Bibliothek an, und die App sagte nur «im Hub ist etwas
            # schiefgegangen». Die Integration fängt seither selbst, und
            # falls doch etwas durchrutscht: mit Satz, nicht als 500.
            log.exception("PlayStation %s: Kopplung gescheitert", ps_id)
            raise HTTPException(503, f"Kopplung gescheitert: {err}") from err
        return {"ok": True}
