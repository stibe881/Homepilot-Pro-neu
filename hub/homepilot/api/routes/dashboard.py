"""Startseiten-Zulieferer: Glance, Szenen-Vorschlag, Unterhalts-Liste.

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
)
from pydantic import BaseModel

from ...core import (
    laufzeit,
    maintenance,
    suggest,
    watchdog,
    widgetkarten,
)
from ...core.users import Capability
from ..context import ApiContext

log = logging.getLogger(__name__)


class MaintenanceRequest(BaseModel):
    """Eine Wartung: was, wie oft, ab wann.

    Auf Modulhöhe und nicht in register(): Mit ``from __future__ import
    annotations`` steht in der Signatur nur der *Name* des Modells, und
    FastAPI schlägt ihn im Namensraum des Moduls nach. Eine Klasse
    innerhalb der Funktion findet es dort nicht - es hielt den Rumpf
    dann für einen Abfrageparameter und wies jedes Anlegen mit «Field
    required: query.body» ab. «Wartung eintragen» in der App tat also
    seit der Aufteilung von server.py gar nichts.
    """

    text: str
    interval_days: int = 90
    due: str | None = None


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require

    @app.get("/api/glance")
    async def glance(request: Request, ids: str = "") -> dict[str, Any]:
        """Der Blick aufs Haus in drei Zeilen - fürs Widget.

        Bewusst eine eigene, winzige Antwort statt der ganzen
        Geräteliste: Das Widget fragt alle Viertelstunde an und läuft auf
        einem Telefon, das gerade nichts anderes tut. Was es nicht
        braucht, soll es nicht übertragen.

        ``ids`` ist die Ausnahme davon, und aus demselben Grund: Wer sich
        ein Widget für das Küchenlicht hinlegt, braucht dessen Namen und
        Zustand - aber eben nur dessen. Die Kennungen stehen in der
        Adresse, damit das Widget mit einer einzigen Anfrage auskommt.
        """
        current_user(request)
        entities = hub.registry.all()
        gefragt = widgetkarten.gefragte_ids(ids)

        # Dieselbe Zählung wie in der App (open_contacts): Kontakte samt
        # Türsensor im Schloss. Vorher zählte das Widget nur Schlösser –
        # und behauptete «Alles zu», während das Küchenfenster offen
        # stand. Eine Anzeige, die man im Vorbeigehen liest und nicht
        # nachprüft, muss stimmen oder schweigen.
        offen = watchdog.open_contacts(entities)
        lichter = [
            entity
            for entity in entities
            if entity.kind == "light" and str(entity.state.get("state")) == "on"
        ]
        kalender = next((e for e in entities if e.kind == "calendar"), None)
        termin = None
        if kalender is not None:
            events = kalender.state.get("events") or []
            if events:
                erster = events[0]
                termin = {
                    "summary": str(erster.get("summary") or "Termin"),
                    "start": erster.get("start"),
                    "all_day": bool(erster.get("all_day")),
                }

        alarm = next((e for e in entities if e.kind == "alarm"), None)
        antwort = {
            "doors_open": [entity.label for entity in offen],
            "lights_on": len(lichter),
            "next_event": termin,
            "alarm": str(alarm.state.get("state")) if alarm is not None else None,
            "at": datetime.now().isoformat(timespec="seconds"),
        }
        # Laufende Maschinen nur, wenn welche laufen. Der Normalfall ist
        # ein leerer Waschkeller, und dafür soll die Antwort nicht um ein
        # Feld wachsen, das immer «[]» heisst (core/laufzeit.py).
        laeuft = laufzeit.laufende(entities, hub.data.get("appliance_cycles"))
        if laeuft:
            antwort["running"] = laeuft
        # Nur wenn gefragt: Die alte Knopfleiste soll keine Zeile mehr
        # übertragen als bisher.
        if gefragt:
            antwort["entities"] = widgetkarten.zeilen(entities, gefragt)
        return antwort

    @app.get("/api/suggestions/scene")
    async def scene_suggestion(request: Request) -> dict[str, Any]:
        """Eine erkannte Gewohnheit - oder nichts.

        Nichts ist der Normalfall und keine Fehlermeldung: Die meisten
        Haushalte haben keine so klare Gewohnheit, und dann soll auch
        nichts vorgeschlagen werden.
        """
        require(request, Capability.EDIT_CONFIG)
        muster = suggest.find_pattern(hub.eventlog.all())
        if muster is None:
            return {"suggestion": None}
        namen = {
            entity.id: entity.label
            for entity in hub.registry.all()
            if entity.id in muster["entity_ids"]
        }
        # Geräte, die es nicht mehr gibt, fallen raus - ein Vorschlag mit
        # einer toten Kennung liesse sich nicht speichern.
        muster["entity_ids"] = [
            gerät for gerät in muster["entity_ids"] if gerät in namen
        ]
        if len(muster["entity_ids"]) < suggest.MIN_ENTITIES:
            return {"suggestion": None}
        return {
            "suggestion": {
                **muster,
                "text": suggest.describe(muster, namen),
                "names": [namen[gerät] for gerät in muster["entity_ids"]],
            }
        }

    @app.get("/api/maintenance")
    async def list_maintenance(request: Request) -> dict[str, Any]:
        current_user(request)
        rows = hub.data.get("maintenance")
        return {
            "items": rows,
            "due": maintenance.due_items(rows),
        }

    @app.post("/api/maintenance")
    async def add_maintenance(
        body: MaintenanceRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        import secrets

        name = body.text.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Die Wartung braucht einen Namen")
        intervall = maintenance.clean_interval(body.interval_days)
        item = {
            "id": secrets.token_urlsafe(6),
            "text": name,
            "interval_days": intervall,
            # Ohne Angabe beginnt die Frist heute - wer eine Wartung
            # einträgt, hat sie meistens gerade gemacht.
            "due": body.due or maintenance.next_after(None, intervall),
            "last_done": None,
        }
        hub.data.set("maintenance", [*hub.data.get("maintenance"), item])
        return item

    @app.post("/api/maintenance/{item_id}/done")
    async def maintenance_done(item_id: str, request: Request) -> dict[str, Any]:
        """Quittieren: die nächste Frist zählt ab heute."""
        user = require(request, Capability.EDIT_CONFIG)
        rows = hub.data.get("maintenance")
        for index, row in enumerate(rows):
            if row.get("id") == item_id:
                # Mit Namen: «erledigt» ohne ihn ist in einem Haushalt mit
                # drei Leuten eine Behauptung (core/maintenance.py).
                neu_row = maintenance.quittieren(row, user.name, datetime.now().date())
                rows[index] = neu_row
                hub.data.set("maintenance", rows)
                log.info("%s hat '%s' quittiert", user.name, row.get("text"))
                return neu_row
        raise HTTPException(status_code=404, detail="Wartung nicht gefunden")

    @app.delete("/api/maintenance/{item_id}")
    async def delete_maintenance(item_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        rows = hub.data.get("maintenance")
        rest = [row for row in rows if row.get("id") != item_id]
        if len(rest) == len(rows):
            raise HTTPException(status_code=404, detail="Wartung nicht gefunden")
        hub.data.set("maintenance", rest)
        return {"ok": True}

