"""Familie und Freunde – die Routen dazu.

Eine Liste aller Menschen, die der Hub kennt, samt Aufenthaltsort und den
Schaltern für das, was über sie gemeldet wird. Warum das eine eigene
Liste ist und nicht drei, steht im Kopf von core/personen.py.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Request

from ...core import personen as personen_module
from ...core import presence as presence_module
from ...core import users as users_module
from ...core.users import Capability
from ..context import ApiContext
from ..models import MeldungRequest

log = logging.getLogger(__name__)


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require

    def zonen_namen() -> dict[str, str]:
        """Je Zone ihr Anzeigename – daran werden die Benutzer erkannt."""
        service = hub.integrations.get("geofence")
        if service is None:
            return {}
        namen: dict[str, str] = {}
        for zone_id in service.zone_ids():
            entity_id = service.zone_entity(zone_id)
            entity = hub.registry.get(entity_id) if entity_id else None
            namen[zone_id] = entity.name if entity else zone_id
        return namen

    def zonen_zeilen() -> list[dict[str, Any]]:
        """Je Ortungszone eine Zeile: wer, wo, seit wann, wie zuverlässig."""
        service = hub.integrations.get("geofence")
        if service is None:
            return []
        jetzt = time.time()
        verlauf = hub.data.get("presence_history")
        prefs = hub.data.get(personen_module.LADE)
        zeilen: list[dict[str, Any]] = []
        for zone_id, name in zonen_namen().items():
            zusammen = service.merged(zone_id)
            entity_id = service.zone_entity(zone_id)
            entity = hub.registry.get(entity_id) if entity_id else None
            zeilen.append(
                {
                    "zone": zone_id,
                    "name": name,
                    "state": zusammen.get("state", presence_module.UNKNOWN),
                    "place": zusammen.get("place"),
                    "place_name": zusammen.get("place_name"),
                    # Der fertige Satzteil kommt vom Hub, nicht aus der
                    # App: «bei Tanners Home» hängt daran, welche Orte
                    # Life360 mitgeschickt hat, und das weiss nur er.
                    "where": personen_module.aufenthalt(zusammen),
                    "source": zusammen.get("source", "none"),
                    "battery": (entity.state.get("battery") if entity else None),
                    "since": presence_module.since(verlauf, zone_id),
                    # Warum die Ortung gerade so aussieht. Ein langer
                    # Satz, den man selten braucht - in der App steckt
                    # er hinter einem Tipp. Aber er gehört hierher und
                    # nicht in eine zweite Anfrage: Wer die Liste hat,
                    # soll die Rückfrage nicht noch einmal stellen
                    # müssen.
                    "hint": presence_module.diagnose(
                        name, dict(entity.state) if entity else {}, jetzt
                    )["hint"],
                    "meldungen": personen_module.fuer(prefs, zone_id),
                }
            )
        return zeilen

    @app.get("/api/personen")
    async def personen_liste(request: Request) -> dict[str, Any]:
        """Alle Menschen, die der Hub kennt – Haushalt und Geortete.

        Bisher war das über drei Listen verteilt, die einander nicht
        kannten. Wer wissen wollte, wo Maja ist, fand sie in keiner
        davon: Sie hat keinen Zugang zum Hub, nur ein Telefon in
        Life360.
        """
        current_user(request)
        namen = zonen_namen()
        benutzer = [
            {
                "name": user.name,
                "role": user.role,
                "zone": presence_module.zone_fuer(user.name, namen),
            }
            for user in hub.users.users
            # Gäste bleiben draussen: Für sie ist die Ortung ohnehin aus,
            # und ein Wochenendbesuch gehört nicht in die Familienliste.
            if user.role != users_module.Role.GUEST and user.enabled
        ]
        leute = personen_module.zusammenfuehren(benutzer, zonen_zeilen())
        return {
            "people": leute,
            # Die Beschriftungen kommen mit: Sonst stünden dieselben
            # deutschen Wörter noch einmal in der App und liefen
            # auseinander, sobald hier eine Meldung dazukommt.
            "meldungen": personen_module.MELDUNGEN,
        }

    @app.post("/api/personen/{zone}/meldungen")
    async def personen_meldung(
        zone: str, body: MeldungRequest, request: Request
    ) -> dict[str, Any]:
        """Einen Schalter umlegen: Was soll über diese Person gemeldet werden?"""
        require(request, Capability.CONTROL)
        service = hub.integrations.get("geofence")
        bekannt = set(service.zone_ids()) if service is not None else set()
        if zone not in bekannt:
            raise HTTPException(status_code=404, detail=f"Keine Ortung für {zone}")
        if not personen_module.bekannt(body.key):
            raise HTTPException(
                status_code=400, detail=f"Unbekannte Meldung: {body.key}"
            )
        rows = personen_module.setzen(
            hub.data.get(personen_module.LADE), zone, body.key, body.enabled
        )
        hub.data.set(
            personen_module.LADE, personen_module.aufraeumen(rows, sorted(bekannt))
        )
        return {"zone": zone, "meldungen": personen_module.fuer(
            hub.data.get(personen_module.LADE), zone
        )}
