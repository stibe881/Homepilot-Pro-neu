"""Radio: Sender suchen und die Liste im Haus pflegen.

Das Abspielen läuft über das Kommando `play_radio` der Radio-Entität –
dafür braucht es keine eigene Route, die Gerätesteuerung gibt es schon.
Hier steht nur, was sich mit Geräten nicht ausdrücken lässt: bei TuneIn
suchen und einen Fund merken.

Gemerkte Sender liegen in `hub.data` (Schlüssel `radio_stations`), nicht
in der config.yaml – wer abends einen Sender findet, soll ihn behalten
können, ohne eine Datei auf dem Hub zu bearbeiten. Was in der
config.yaml steht, gewinnt trotzdem (siehe `merge_stations`).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from ...core.users import Capability, Role
from ..context import ApiContext

log = logging.getLogger(__name__)


class StationRequest(BaseModel):
    name: str
    id: str = ""
    url: str = ""
    subtext: str = ""
    image: str = ""


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require

    def radio() -> Any:
        """Die Radio-Integration – oder ein Fehler, den man lesen kann."""
        integration = hub.integrations.get("tunein")
        if integration is None or not hasattr(integration, "stations"):
            raise HTTPException(
                status_code=404,
                detail="Kein Radio eingerichtet – 'integration: tunein' fehlt in der config.yaml",
            )
        return integration

    def darf_pflegen(request: Request) -> None:
        """Die Senderliste gehört dem Haus, nicht dem Besuch.

        Ein Gast darf Radio hören – die Liste ändern hiesse, sie für alle
        zu ändern, und das ist etwas anderes als eine Lautstärke.
        """
        user = require(request, Capability.CONTROL)
        if user.role == Role.GUEST:
            raise HTTPException(
                status_code=403, detail="Gäste können die Senderliste nicht ändern"
            )

    @app.get("/api/radio/stations")
    async def list_stations(request: Request) -> dict[str, Any]:
        """Die wählbaren Sender und die Boxen, auf denen sie laufen können."""
        current_user(request)
        # Kein Radio eingerichtet ist hier kein Fehler: Die App fragt beim
        # Öffnen der Musikkarte, und ein 404 sähe dort nach Ausfall aus.
        integration: Any = hub.integrations.get("tunein")
        if integration is None or not hasattr(integration, "stations"):
            return {"stations": [], "speakers": [], "reason": "kein Radio eingerichtet"}
        return {
            "stations": [station.as_dict() for station in integration.stations()],
            "speakers": [name for _, name in integration.speakers()],
        }

    @app.get("/api/radio/search")
    async def search_stations(request: Request, q: str = "") -> dict[str, Any]:
        """Bei TuneIn suchen.

        Die Suche geht über den Hub und nicht aus der App heraus: Sie ist
        der einzige Weg nach draussen, den die App kennt, und so bleibt
        es dabei – die App spricht mit dem Hub, sonst mit niemandem.
        """
        require(request, Capability.CONTROL)
        begriff = q.strip()
        if len(begriff) < 2:
            return {"stations": []}
        try:
            treffer = await radio().search(begriff)
        except HTTPException:
            raise
        except Exception as err:
            log.warning("TuneIn-Suche nach '%s' fehlgeschlagen: %s", begriff, err)
            raise HTTPException(
                status_code=502, detail=f"TuneIn antwortet nicht: {err}"
            ) from err
        return {"stations": [station.as_dict() for station in treffer]}

    @app.post("/api/radio/stations")
    async def add_station(body: StationRequest, request: Request) -> dict[str, Any]:
        """Einen gefundenen Sender in die Liste des Hauses aufnehmen."""
        darf_pflegen(request)
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Der Sender braucht einen Namen")
        integration = radio()
        gespeichert: list[dict[str, Any]] = [
            entry
            for entry in hub.data.get(integration.STORE_KEY)
            if isinstance(entry, dict)
            and str(entry.get("name", "")).casefold() != name.casefold()
        ]
        gespeichert.append(
            {
                "name": name,
                "id": body.id.strip(),
                "url": body.url.strip(),
                "subtext": body.subtext,
                "image": body.image,
            }
        )
        hub.data.set(integration.STORE_KEY, gespeichert)
        await integration.refresh_now()
        return {"stations": [station.as_dict() for station in integration.stations()]}

    @app.delete("/api/radio/stations/{name}")
    async def remove_station(name: str, request: Request) -> dict[str, Any]:
        """Einen gemerkten Sender wieder vergessen.

        Was in der config.yaml steht, lässt sich hier nicht löschen – die
        Datei gehört dem Hub, und ein Knopf, der sie stillschweigend nicht
        ändert, wäre eine Attrappe.
        """
        darf_pflegen(request)
        integration = radio()
        vorher = hub.data.get(integration.STORE_KEY)
        nachher = [
            entry
            for entry in vorher
            if isinstance(entry, dict)
            and str(entry.get("name", "")).casefold() != name.casefold()
        ]
        if len(nachher) == len(vorher):
            raise HTTPException(
                status_code=404,
                detail=f"'{name}' ist nicht gemerkt – Sender aus der config.yaml "
                "lassen sich nur dort entfernen",
            )
        hub.data.set(integration.STORE_KEY, nachher)
        await integration.refresh_now()
        return {"stations": [station.as_dict() for station in integration.stations()]}
