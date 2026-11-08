"""Konsolenzeit der Kinder (Punkt 748 der Werkbank).

Die Regeln stehen in ``core/konsolenzeit.py``, die Uhr in
``core/konsolenwache.py``; hier ist nur die Tür dazu.

Wer was darf:

- **Erwachsene** (Besitzerin, Bewohner) richten die Pläne ein und dürfen
  Zeit geben, einen Tag freigeben und sperren - ``EDIT_DEVICES``, dieselbe
  Fähigkeit wie beim Anpassen von Geräten.
- **Ein Kind** sieht nur sich selbst und meldet sich selbst an
  («Ich spiele jetzt»). Zeit geben oder an einem Plan drehen kann es
  nicht: Ein Plan, den das Kind ändert, ist keiner.
- Ein Kind **ohne eigenen Zugang** meldet ein Erwachsener an, auf dem
  Telefon oder dem Wandtablet.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from ...core.errors import HomePilotError
from ...core.users import Capability, Role
from ..context import ApiContext


class Spielen(BaseModel):
    konsole: str


class Geben(BaseModel):
    minuten: float


class Schalter(BaseModel):
    an: bool


class Einstellungen(BaseModel):
    unbekannt: str


class ElternSpielen(BaseModel):
    konsole: str


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    wache = hub.konsolenwache

    def erwachsen(request: Request) -> Any:
        return ctx.require(request, Capability.EDIT_DEVICES)

    def darf_fuer(request: Request, kind: str) -> Any:
        """Ein Erwachsener für jedes Kind, ein Kind nur für sich."""
        user = ctx.current_user(request)
        if user.can(Capability.EDIT_DEVICES):
            return user
        if user.role == Role.KID and user.name.strip().casefold() == kind.strip().casefold():
            return user
        raise HTTPException(status_code=403, detail="Das darfst du hier nicht")

    def antwort(aufruf: Any) -> Any:
        try:
            return aufruf()
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.get("/api/konsolenzeit")
    async def konsolenzeit(request: Request) -> dict[str, Any]:
        """Die Lage: für Erwachsene alle Kinder, für ein Kind nur es selbst."""
        user = ctx.current_user(request)
        alles = wache.uebersicht()
        if user.can(Capability.EDIT_DEVICES):
            return alles
        if user.role != Role.KID:
            raise HTTPException(status_code=403, detail="Das darfst du hier nicht")
        eigene = user.name.strip().casefold()
        return {
            "kinder": [k for k in alles["kinder"] if k["kind"].strip().casefold() == eigene],
            "konsolen": alles["konsolen"],
        }

    @app.put("/api/konsolenzeit/einstellungen")
    async def einstellungen(body: Einstellungen, request: Request) -> dict[str, Any]:
        erwachsen(request)
        return antwort(lambda: wache.einstellungen_setzen(body.unbekannt))

    @app.post("/api/konsolenzeit/eltern")
    async def eltern_spielen(body: ElternSpielen, request: Request) -> dict[str, Any]:
        """Die Erwachsenen spielen: nicht zählen, nicht nachfragen."""
        erwachsen(request)
        antwort(lambda: wache.eltern_spielen(body.konsole))
        return {"ok": True}

    @app.get("/api/konsolenzeit/{kind}")
    async def kind_lage(kind: str, request: Request) -> dict[str, Any]:
        darf_fuer(request, kind)
        return wache.lage(kind)

    @app.put("/api/konsolenzeit/{kind}/plan")
    async def plan_setzen(kind: str, body: dict[str, Any], request: Request) -> dict[str, Any]:
        erwachsen(request)
        antwort(lambda: wache.plan_setzen(kind, body))
        return wache.lage(kind)

    @app.post("/api/konsolenzeit/{kind}/spielen")
    async def spielen(kind: str, body: Spielen, request: Request) -> dict[str, Any]:
        darf_fuer(request, kind)
        antwort(lambda: wache.spielen(kind, body.konsole))
        return wache.lage(kind)

    @app.post("/api/konsolenzeit/{kind}/stopp")
    async def stopp(kind: str, request: Request) -> dict[str, Any]:
        darf_fuer(request, kind)
        wache.stoppen(kind)
        return wache.lage(kind)

    @app.post("/api/konsolenzeit/{kind}/geben")
    async def geben(kind: str, body: Geben, request: Request) -> dict[str, Any]:
        erwachsen(request)
        antwort(lambda: wache.geben(kind, body.minuten))
        return wache.lage(kind)

    @app.post("/api/konsolenzeit/{kind}/frei")
    async def frei(kind: str, body: Schalter, request: Request) -> dict[str, Any]:
        erwachsen(request)
        wache.frei_setzen(kind, body.an)
        return wache.lage(kind)

    @app.post("/api/konsolenzeit/{kind}/sperre")
    async def sperre(kind: str, body: Schalter, request: Request) -> dict[str, Any]:
        erwachsen(request)
        wache.sperre_setzen(kind, body.an)
        return wache.lage(kind)
