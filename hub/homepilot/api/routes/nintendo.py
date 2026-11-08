"""Die Switch aus der App anmelden (Punkt 748, Teil C).

Nintendo verlangt eine Anmeldung im Browser; am Ende steht eine Adresse
(«npf…://auth#…»), die der Browser nicht öffnen kann und die man darum
kopiert. Zwei Schritte wie bei der PlayStation (routes/playstation.py):
``POST anmeldung`` liefert die Adresse für den Browser, ``POST
anmeldung/abschluss`` nimmt die kopierte Adresse entgegen.

Der Schlüssel, der danach neben der Datendatei liegt, ist ein
Generalschlüssel für das Nintendo-Konto der Eltern - deshalb nur mit der
Fähigkeit, die Konfiguration zu ändern.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from ...core.errors import HomePilotError
from ...core.users import Capability
from ..context import ApiContext


class Abschluss(BaseModel):
    adresse: str


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    require = ctx.require

    def integration() -> Any:
        gefunden = hub.integrations.get("nintendo")
        if gefunden is None:
            raise HTTPException(
                404,
                "Die Nintendo-Anbindung ist nicht eingerichtet: In der config.yaml fehlt "
                "der Eintrag «- integration: nintendo».",
            )
        return gefunden

    @app.get("/api/nintendo")
    async def stand(request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        gefunden: Any = hub.integrations.get("nintendo")
        if gefunden is None:
            return {"eingerichtet": False, "angemeldet": False, "konsolen": []}
        return {
            "eingerichtet": True,
            "angemeldet": gefunden.angemeldet(),
            "konsolen": [
                {"id": e.id, "name": e.name, "modell": e.state.get("model")}
                for e in hub.registry.all()
                if e.integration == "nintendo"
            ],
        }

    @app.post("/api/nintendo/anmeldung")
    async def anmeldung(request: Request) -> dict[str, str]:
        require(request, Capability.EDIT_CONFIG)
        try:
            return {"url": integration().anmeldung_starten()}
        except HomePilotError as err:
            raise HTTPException(400, str(err)) from err

    @app.post("/api/nintendo/anmeldung/abschluss")
    async def abschluss(body: Abschluss, request: Request) -> dict[str, bool]:
        require(request, Capability.EDIT_CONFIG)
        try:
            await integration().anmeldung_abschliessen(body.adresse)
        except HomePilotError as err:
            raise HTTPException(400, str(err)) from err
        return {"angemeldet": True}
