"""Oberflächen-Einstellungen: persönliche und haushaltsweite.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
)

from ...core.einstellungen import verschmelzen
from ...core.users import Capability
from ..context import ApiContext
from ..models import HOUSE_PREFS_BYTES, PREFS_BYTES, PrefsRequest

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require

    # ── Persönliche Oberflächen-Einstellungen ──────────────────────────────
    # Kachel-Reihenfolgen und Ähnliches: je Benutzer gespeichert, damit jedes
    # Gerät derselben Person dieselbe Ansicht zeigt. Der Inhalt gehört der
    # App – der Hub prüft nur, dass es ein Objekt in vernünftiger Grösse ist.

    @app.get("/api/prefs")
    async def get_prefs(request: Request) -> dict[str, Any]:
        user = current_user(request)
        for entry in hub.data.get("user_prefs"):
            if isinstance(entry, dict) and entry.get("user") == user.name:
                stored = entry.get("prefs")
                return {"prefs": stored if isinstance(stored, dict) else {}}
        return {"prefs": {}}

    @app.put("/api/prefs")
    async def put_prefs(body: PrefsRequest, request: Request) -> dict[str, Any]:
        """Die genannten Einstellungen ändern - der Rest bleibt stehen.

        Nicht mehr «was hier steht, ist ab jetzt der Bestand»: Der Anblick
        wird im Profil gesetzt, die Playlist-Reihenfolge an der Musikkarte,
        die Vorlese-Box im Kochbuch. Keine dieser Stellen kennt die
        Einstellungen der anderen, und wer den ganzen Bestand mitschicken
        müsste, löschte bei jedem Zug alles, was er nicht kennt (siehe
        core/einstellungen.py).
        """
        user = current_user(request)
        entries = []
        bestand: dict[str, Any] = {}
        for entry in hub.data.get("user_prefs"):
            if not isinstance(entry, dict):
                continue
            if entry.get("user") == user.name:
                gespeichert = entry.get("prefs")
                bestand = gespeichert if isinstance(gespeichert, dict) else {}
            else:
                entries.append(entry)
        zusammen = verschmelzen(bestand, body.prefs)
        # Gemessen wird, was liegen bleibt, nicht was ankommt: Ein kleiner
        # Zug auf einen schon zu grossen Bestand soll nicht durchrutschen.
        if len(json.dumps(zusammen, ensure_ascii=False)) > PREFS_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Die persönlichen Einstellungen sind zu gross geworden.",
            )
        entries.append({"user": user.name, "prefs": zusammen})
        hub.data.set("user_prefs", entries)
        return {"ok": True, "prefs": zusammen}

    # ── Haushaltsweite Oberflächen-Einstellungen ───────────────────────────
    # Was ausgeblendet ist, was gesperrt, in welcher Reihenfolge die Kacheln
    # stehen, was im Widget liegt: Das prägt die Ansicht des Hauses und soll
    # überall gleich aussehen - auf dem Wandpanel wie auf dem Telefon, bei
    # Stefan wie bei Livia. Früher lag das im Speicher der App und war nach
    # einer Neuinstallation weg.

    @app.get("/api/houseprefs")
    async def get_house_prefs(request: Request) -> dict[str, Any]:
        # Kein require: Wer angemeldet ist, sieht das Haus - und damit die
        # Ansicht, in der es eingerichtet ist. Etwas anderes zu zeigen als
        # das, was da ist, hülfe niemandem.
        current_user(request)
        for entry in hub.data.get("house_prefs"):
            if isinstance(entry, dict):
                stored = entry.get("prefs")
                return {"prefs": stored if isinstance(stored, dict) else {}}
        return {"prefs": {}}

    @app.put("/api/houseprefs")
    async def put_house_prefs(body: PrefsRequest, request: Request) -> dict[str, Any]:
        """Die Ansicht des Hauses ändern.

        CONTROL und nicht EDIT_CONFIG: Hier stehen Oberflächen-Einstellungen,
        keine Rechte. Auch die Sperre ist eine Rückfrage in der App, kein
        Zugangsschutz - sie schützt vor Versehen, nicht vor Absicht. Wer ein
        Gerät schalten darf, darf auch einstellen, wie es dasteht. Die App
        zeigt «Anpassen» trotzdem nur der Besitzerrolle.
        """
        require(request, Capability.CONTROL)
        bestand: dict[str, Any] = {}
        for entry in hub.data.get("house_prefs"):
            if isinstance(entry, dict) and isinstance(entry.get("prefs"), dict):
                bestand = entry["prefs"]
                break
        # Auch hier nur die genannten Schlüssel - aus demselben Grund wie
        # bei den persönlichen: Die Widget-Knöpfe werden woanders gesetzt
        # als die Kachel-Reihenfolge.
        zusammen = verschmelzen(bestand, body.prefs)
        if len(json.dumps(zusammen, ensure_ascii=False)) > HOUSE_PREFS_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Die Einstellungen des Hauses sind zu gross geworden.",
            )
        hub.data.set("house_prefs", [{"prefs": zusammen}])
        return {"ok": True, "prefs": zusammen}

