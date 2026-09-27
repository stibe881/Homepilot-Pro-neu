"""Die PlayStation aus der App koppeln (Punkt 643 der Werkbank).

Zwei Schritte, weil zwei Dinge zusammenkommen müssen: Das PSN-Konto
(Sony will einen Browser und eine Anmeldung) und die Konsole (sie zeigt
einen Code, und nur wer ihn sieht, darf sie fernbedienen). Dazwischen
steht jemand auf, geht ins Wohnzimmer und liest ab - deshalb getrennte
Aufrufe, wie beim Fernseher (routes/androidtv.py).

``GET pair`` sagt, wo die Kopplung steht, ``POST pair`` liefert die
Anmeldeseite, ``pair/account`` nimmt die Adresse nach der Anmeldung
entgegen, ``pair/pin`` den Code von der Konsole.

Davor braucht es überhaupt erst den Geräte-Eintrag: ``geraet_hinzu``/
``geraet_weg`` tragen ihn in die config.yaml ein (core/config_edit, wie
eine Cast-Box unter api/routes/verbindungen.py) - auch dafür soll niemand
mehr die Datei von Hand öffnen. Die Änderung braucht wie jede Änderung an
der config.yaml einen Neustart, bevor die neue Konsole eine Kachel hat.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from ...core import config_edit, verbindungen
from ...core.users import Capability
from .. import configio
from ..context import ApiContext

log = logging.getLogger(__name__)


class GeraetHinzu(BaseModel):
    """Name und Adresse einer neuen Konsole - von der Verbindungen-Seite,
    ohne dass jemand die config.yaml von Hand öffnet (dasselbe Formular wie
    bei einer Cast-Box, siehe api/routes/verbindungen.py).
    """

    name: str
    host: str


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

    def config_text() -> str:
        try:
            return Path(configio.config_path(hub)).read_text(encoding="utf-8")
        except OSError as err:
            raise HTTPException(
                status_code=500, detail=f"Konfiguration nicht lesbar: {err}"
            ) from err

    @app.post("/api/playstation/geraete")
    async def geraet_hinzu(body: GeraetHinzu, request: Request) -> dict[str, Any]:
        """Eine neue Konsole eintragen - ohne config.yaml von Hand.

        Danach steht sie auf der Verbindungen-Seite mit eigener PSN- und
        Konsolen-Kopplung, sobald der Hub neu gestartet ist.
        """
        require(request, Capability.EDIT_CONFIG)
        name = body.name.strip()
        host = body.host.strip()
        if not name or not verbindungen.gueltiger_host(host):
            raise HTTPException(400, "Ein Gerät braucht Namen und Adresse")
        content = config_edit.add_host_device(config_text(), "playstation", name, host)
        return configio.save_config(hub, content)

    @app.delete("/api/playstation/geraete/{host}")
    async def geraet_weg(host: str, request: Request) -> dict[str, Any]:
        """Das Gegenstück - eine Konsole wieder aus der config.yaml nehmen."""
        require(request, Capability.EDIT_CONFIG)
        content = config_edit.remove_host_device(config_text(), "playstation", host.strip())
        return configio.save_config(hub, content)

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
