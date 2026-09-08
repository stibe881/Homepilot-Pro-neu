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
