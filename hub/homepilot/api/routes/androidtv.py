"""Den Fernseher aus der App koppeln.

Die Kopplung mit einem Android-TV-Gerät braucht einen Menschen vor dem
Bildschirm – der Fernseher zeigt eine sechsstellige Zahl, und nur wer sie
sieht, darf ihn fernbedienen. Das ist gut so und bleibt.

Was nicht bleiben konnte: dass dieser Mensch dafür ein Terminal auf dem
Hub-Rechner braucht. Bisher war der einzige Weg
``python -m homepilot.integrations.androidtv -c config.yaml`` – also
``docker exec -it`` auf dem Rechner im Keller, mit einem Fernseher zwei
Stockwerke höher. Aus dem Haus gemeldet wurde es so: «Wenn ich den Timer
für den Fernseher einschalten will, kommt diese Meldung» – und die
Meldung sagte, die Kopplung müsse am Gerät bestätigt werden, ohne zu
sagen, wie.

Zwei Aufrufe, weil dazwischen jemand aufsteht und zum Fernseher schaut:
``pair`` zeigt den Code an, ``pair/code`` nimmt ihn entgegen.

Davor braucht es überhaupt erst den Geräte-Eintrag: ``geraet_hinzu``/
``geraet_weg`` tragen ihn in die config.yaml ein (core/config_edit, wie
eine Cast-Box unter api/routes/verbindungen.py) - auch dafür soll niemand
mehr die Datei von Hand öffnen. Die Änderung braucht wie jede Änderung an
der config.yaml einen Neustart, bevor der neue Fernseher eine Kachel hat.
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
    """Name und Adresse eines neuen Fernsehers - von der Verbindungen-Seite,
    ohne dass jemand die config.yaml von Hand öffnet (dasselbe Formular wie
    bei einer Cast-Box, siehe api/routes/verbindungen.py).
    """

    name: str
    host: str


class KopplungStart(BaseModel):
    """``neu`` wirft das bestehende Zertifikat beiseite.

    Der Fall dahinter: Wer am Fernseher die Daten des «Android TV Remote
    Service» löscht, dessen Zertifikat verbindet weiter, wirkt aber
    nicht mehr. Ohne diesen Schalter käme man aus dem Zustand nie heraus.
    """

    neu: bool = False


class KopplungCode(BaseModel):
    code: str


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

    @app.post("/api/androidtv/geraete")
    async def geraet_hinzu(body: GeraetHinzu, request: Request) -> dict[str, Any]:
        """Einen neuen Fernseher eintragen - ohne config.yaml von Hand.

        Danach steht er auf der Verbindungen-Seite mit einem eigenen
        «Fernseher koppeln»-Knopf, sobald der Hub neu gestartet ist -
        genau wie eine frisch eingetragene Cast-Box.
        """
        require(request, Capability.EDIT_CONFIG)
        name = body.name.strip()
        host = body.host.strip()
        if not name or not verbindungen.gueltiger_host(host):
            raise HTTPException(400, "Ein Gerät braucht Namen und Adresse")
        content = config_edit.add_host_device(config_text(), "androidtv", name, host)
        return configio.save_config(hub, content)

    @app.delete("/api/androidtv/geraete/{host}")
    async def geraet_weg(host: str, request: Request) -> dict[str, Any]:
        """Das Gegenstück - ein Gerät wieder aus der config.yaml nehmen."""
        require(request, Capability.EDIT_CONFIG)
        content = config_edit.remove_host_device(config_text(), "androidtv", host.strip())
        return configio.save_config(hub, content)

    def fernseher(entity_id: str) -> tuple[Any, str]:
        """Die Integration und die TV-Id zu einer Kachel – oder eine Absage.

        Die Timer-Kachel darf mitfragen: Sie ist die zweite Ansicht
        desselben Fernsehers, und genau von dort kam die Meldung.
        """
        entity = hub.registry.get(entity_id)
        if entity is None:
            raise HTTPException(404, "Unbekanntes Gerät")
        service = hub.integrations.get("androidtv")
        if service is None:
            raise HTTPException(503, "Die Android-TV-Integration läuft nicht")
        tv_id = service.tv_id(entity_id)
        if tv_id is None:
            raise HTTPException(400, "Dieses Gerät ist kein Android-TV-Fernseher")
        return service, tv_id

    @app.post("/api/androidtv/{entity_id}/pair")
    async def pair_start(
        entity_id: str, request: Request, body: KopplungStart | None = None
    ) -> dict[str, Any]:
        """Kopplung beginnen – danach steht der Code auf dem Fernseher."""
        user = require(request, Capability.CONTROL)
        service, tv_id = fernseher(entity_id)
        try:
            await service.pair_start(tv_id, neu=bool(body and body.neu))
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        except ConnectionError as err:
            # 503 und nicht 500: Der Fernseher ist aus oder nicht im Netz -
            # das ist kein Fehler des Hubs, und die App sagt es so weiter.
            raise HTTPException(503, str(err)) from err
        log.info("%s beginnt die Kopplung mit %s", getattr(user, "name", "?"), tv_id)
        return {"ok": True}

    @app.post("/api/androidtv/{entity_id}/pair/code")
    async def pair_finish(
        entity_id: str, body: KopplungCode, request: Request
    ) -> dict[str, Any]:
        """Den Code vom Bildschirm nachreichen."""
        require(request, Capability.CONTROL)
        service, tv_id = fernseher(entity_id)
        try:
            await service.pair_finish(tv_id, body.code)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        except ConnectionError as err:
            raise HTTPException(503, str(err)) from err
        return {"ok": True}
