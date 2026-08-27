"""Benutzerverwaltung: anlegen, ändern, Kopplung, Token, löschen.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
)

from ...core import bereich as bereich_module
from ...core import throttle as throttle_module
from ...core import users as users_module
from ...core.errors import HomePilotError
from ...core.users import GUEST_FEATURES, Capability, Role
from ..context import ApiContext
from ..models import AreaUnlockRequest, SelfNameRequest, UserRequest, UserUpdateRequest

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    require = ctx.require
    current_user = ctx.current_user
    throttle = ctx.throttle

    # ── Benutzerverwaltung ─────────────────────────────────────────────────

    @app.get("/api/users")
    async def list_users(request: Request) -> list[dict[str, Any]]:
        """Die Menschen im Haushalt.

        Ohne den Hub-Token: Der ist ein Zugang für Skripte und das
        Wandpanel, kein Mensch. In der Benutzerverwaltung stand er
        zwischen den anderen, liess sich aber weder anlegen noch ändern
        noch löschen - eine Zeile, die nur Fragen aufwarf.
        """
        require(request, Capability.MANAGE_USERS)
        return [user.as_dict() for user in hub.users.users if not user.system]

    @app.post("/api/users")
    async def create_user(body: UserRequest, request: Request) -> dict[str, Any]:
        require(request, Capability.MANAGE_USERS)
        import secrets

        from ...core.users import User as HubUser

        if body.role not in Role.ALL:
            raise HTTPException(status_code=400, detail=f"Unbekannte Rolle: {body.role}")
        unknown = [f for f in body.features if f not in GUEST_FEATURES]
        if unknown:
            raise HTTPException(
                status_code=400, detail=f"Unbekannte Bereiche: {', '.join(unknown)}"
            )
        token = body.token or secrets.token_urlsafe(32)
        try:
            hub.users.add(
                HubUser(
                    name=body.name,
                    role=body.role,
                    token=token,
                    allow=body.allow,
                    features=body.features,
                    expires=body.expires or None,
                    hours=users_module.parse_hours(body.hours),
                    simple_rooms=[str(r) for r in body.simple_rooms],
                    shared=body.shared,
                    # In der App angelegt: wird gespeichert und ist dort
                    # auch wieder löschbar.
                    editable=True,
                )
            )
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        # Das Token wird genau einmal zurückgegeben – danach steht es
        # nirgends mehr im Klartext zum Abholen.
        return {
            "user": hub.users.by_name(body.name).as_dict(include_token=True),
            "hinweis": "Token jetzt notieren – er wird nur dieses eine Mal gezeigt.",
        }

    @app.put("/api/users/self")
    async def rename_self(body: SelfNameRequest, request: Request) -> dict[str, Any]:
        """Den eigenen Namen ändern - im Profil, und damit überall.

        Das Feld im Profil hiess «Dein Name (für die Begrüssung)» und
        lebte nur im Gerät: Die Benutzerverwaltung zeigte weiter den
        alten Namen, und niemand wusste, welcher nun gilt. Jetzt ist es
        derselbe Name - wer sich hier umbenennt, heisst auch in der
        Benutzerverwaltung, in der Anwesenheit und als Push-Empfänger so.

        Kein MANAGE_USERS nötig: Es geht nur um den eigenen Namen, und
        der gehört einem selbst. Gäste bleiben draussen - ihre Namen
        vergibt, wer sie eingeladen hat, sonst steht plötzlich ein
        zweiter «Stefan» in der Liste, den niemand angelegt hat.
        """
        user = current_user(request)
        if user.role == Role.GUEST:
            raise HTTPException(
                status_code=403, detail="Gäste können sich nicht umbenennen"
            )
        alt = user.name
        try:
            umbenannt = hub.users.rename(alt, body.name)
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        if umbenannt.name == alt:
            return {"user": umbenannt.as_dict()}
        # Alles nachziehen, was nach Namen abgelegt ist - sonst gehen
        # Push-Nachrichten an einen Namen, den es nicht mehr gibt.
        #
        # Die Sitzungen zuerst: An ihnen hing der Zugang. Sie merken sich,
        # zu wem ein Token gehört, und das war der Name. Nach einer
        # Umbenennung zeigte jede Sitzung ins Leere - «Ungültiges Token»
        # auf allen Geräten gleichzeitig, auch auf dem, an dem gerade
        # jemand den neuen Namen eingetippt hatte.
        hub.sessions.rename(alt, umbenannt.name)
        hub.push.umbenennen(alt, umbenannt.name)
        prefs = [
            {**entry, "user": umbenannt.name}
            if isinstance(entry, dict) and entry.get("user") == alt
            else entry
            for entry in hub.data.get("push_prefs")
        ]
        hub.data.set("push_prefs", prefs)
        from ...core import erinnerungen

        hub.data.set(
            "family_reminders",
            erinnerungen.benutzer_umbenennen(
                hub.data.get("family_reminders"), alt, umbenannt.name
            ),
        )
        log.info("Benutzer '%s' heisst jetzt '%s'", alt, umbenannt.name)
        return {"user": umbenannt.as_dict()}

    @app.put("/api/users/{name}")
    async def update_user(
        name: str, body: UserUpdateRequest, request: Request
    ) -> dict[str, Any]:
        """Gast sperren/entsperren oder Bereiche ändern – das Token bleibt."""
        user = require(request, Capability.MANAGE_USERS)
        if user.name == name and body.enabled is False:
            raise HTTPException(status_code=400, detail="Sich selbst kann man nicht sperren")
        try:
            updated = hub.users.update(
                name,
                enabled=body.enabled,
                features=body.features,
                expires=body.expires,
                hours=body.hours,
                simple_rooms=body.simple_rooms,
                shared=body.shared,
                area_password=body.area_password,
            )
        except ValueError as err:
            # Zu kurzes Passwort - der Text steht in core/bereich.py.
            raise HTTPException(status_code=400, detail=str(err)) from err
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        return {"user": updated.as_dict()}

    @app.post("/api/areas/unlock")
    async def unlock_areas(body: AreaUnlockRequest, request: Request) -> dict[str, Any]:
        """Das Passwort vor den persönlichen Bereichen prüfen.

        Für das Wandtablet im Flur: Licht und Storen bedient jeder, der
        vorbeigeht, die Einkaufsliste und der Kalender der Familie sollen
        aber nicht offen im Flur stehen. Der Riegel wird in der
        Benutzerverwaltung gesetzt (area_password).

        Der Hub sagt hier nur Ja oder Nein - was danach sichtbar wird,
        entscheidet die App. Das ist Absicht: Es ist ein Sichtschutz vor
        Mitlesenden im eigenen Haus, keine zweite Anmeldung. Wer das Token
        hat, ist ohnehin drin; die Rechte hängen weiter an der Rolle.

        Mit derselben Bremse wie die Anmeldung - vier Zeichen wären sonst
        an einem Nachmittag durchprobiert.
        """
        user = current_user(request)
        address = throttle_module.client_address(request)
        waiting = throttle.blocked_for(address)
        if waiting > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Zu viele Versuche - gesperrt für {round(waiting)} Sekunden.",
            )
        if not user.area_lock:
            # Kein Riegel gesetzt: dann ist auch nichts zu öffnen.
            return {"ok": True, "seconds": bereich_module.OPEN_SECONDS}
        if not bereich_module.matches(user.area_lock, body.password or ""):
            throttle.failed(address)
            raise HTTPException(status_code=403, detail="Falsches Passwort.")
        throttle.succeeded(address)
        return {"ok": True, "seconds": bereich_module.OPEN_SECONDS}

    @app.post("/api/users/{name}/token")
    async def rotate_user_token(name: str, request: Request) -> dict[str, Any]:
        """Ein frisches Token ausstellen, das alte sofort ungültig machen.

        Für den Ernstfall gedacht: Ein Token ist irgendwo gelandet, wo es
        nicht hingehört. Wer sein eigenes wechselt, fliegt damit selbst
        raus - das ist beabsichtigt und steht in der Antwort.
        """
        actor = require(request, Capability.MANAGE_USERS)
        try:
            token = hub.users.rotate_token(name)
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        log.warning("Token von '%s' wurde durch '%s' ersetzt", name, actor.name)
        from ...qr import setup_payload

        return {
            "ok": True,
            "name": name,
            "token": token,
            "self": actor.name == name,
            "payload": setup_payload(
                hub.config.api.host, hub.config.api.port, token, name
            ),
        }

    @app.get("/api/users/{name}/pairing")
    async def user_pairing(name: str, request: Request) -> dict[str, Any]:
        """Kopplungs-Daten für den QR-Code: dieselbe Form wie der
        Einrichtungs-Code beim Hub-Start – die App scannt und verbindet."""
        require(request, Capability.MANAGE_USERS)
        target = hub.users.by_name(name)
        if target is None:
            raise HTTPException(status_code=404, detail=f"Unbekannter Benutzer: {name}")
        from ...qr import setup_payload

        return {
            "payload": setup_payload(
                hub.config.api.host, hub.config.api.port, target.token, target.name
            ),
            "enabled": target.enabled,
        }

    @app.delete("/api/users/{name}")
    async def delete_user(name: str, request: Request) -> dict[str, Any]:
        user = require(request, Capability.MANAGE_USERS)
        if user.name == name:
            raise HTTPException(status_code=400, detail="Sich selbst kann man nicht löschen")
        try:
            removed = hub.users.remove(name)
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        if not removed:
            raise HTTPException(status_code=404, detail=f"Unbekannter Benutzer: {name}")
        return {"ok": True}

