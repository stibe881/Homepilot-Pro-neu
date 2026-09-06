"""Anmeldung mit E-Mail und Passwort (Supabase) samt Einladungen.

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
    Response,
)

from ...core import (
    bereich,
    supabase_auth,
)
from ...core import throttle as throttle_module
from ...core.errors import HomePilotError
from ...core.users import Capability
from .. import invitepage
from ..context import ApiContext
from ..models import (
    EmailRequest,
    LoginRequest,
    PasswordRequest,
    PasswortWechselRequest,
    RecoverRequest,
)

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    throttle = ctx.throttle
    current_user = ctx.current_user
    require = ctx.require
    user_payload = ctx.user_payload
    token_from = ctx.token_from

    # ── Anmeldung mit E-Mail und Passwort ──────────────────────────────────
    #
    # Der Hub spricht selbst mit Supabase, nicht die App: So bleibt der
    # Anon-Key auf dem Hub, und die App kennt weiterhin genau eine Adresse.
    # Nach erfolgreicher Anmeldung stellt der Hub eine eigene Sitzung aus –
    # danach braucht der Alltag kein Internet mehr.

    def auth_service() -> supabase_auth.SupabaseAuth | None:
        config = hub.config.supabase or {}
        url = str(config.get("url") or "")
        anon = str(config.get("anon_key") or "")
        if not (url and anon):
            return None
        # Derselbe Dienstschlüssel wie für den Verlauf. Einladungen sind
        # eine Admin-Handlung; der Anon-Key darf das absichtlich nicht.
        service = str(config.get("service_key") or "")
        return supabase_auth.SupabaseAuth(url, anon, service)

    def lokal_moeglich() -> bool:
        """Gibt es Benutzer mit eigenem Passwort-Zugang beim Hub?"""
        if any(user.passwort for user in hub.users.users):
            return True
        # Punkt 234 der Werkbank: Auch die nachgeführten Supabase-Hashes
        # zählen. Sonst meldete die Maske «keine Passwort-Anmeldung»,
        # sobald Supabase aus der Konfiguration fällt, obwohl der lokale
        # Rückfall längst funktioniert.
        return any(
            isinstance(row, dict) and row.get("passwort")
            for row in hub.data.get("emails")
        )

    @app.get("/api/auth/config")
    async def auth_config() -> dict[str, Any]:
        """Was die Anmeldemaske anbieten darf – ohne Anmeldung abrufbar.

        Enthält bewusst nichts Verräterisches: nur ob es die Anmeldung mit
        Passwort überhaupt gibt. Registrieren kann sich hier ohnehin
        niemand selbst – deshalb steht das auch nicht zur Auswahl.
        """
        service = auth_service()
        return {
            # Passwort-Anmeldung gibt es auf zwei Wegen: über Supabase
            # (E-Mail) oder direkt beim Hub (Name + Initialpasswort).
            "password_login": service is not None or lokal_moeglich(),
            "self_signup": False,
            "invite": service is not None and service.can_invite,
        }

    @app.post("/api/auth/login")
    async def auth_login(body: LoginRequest, request: Request) -> dict[str, Any]:
        """Anmelden und eine Sitzung für dieses Gerät bekommen."""

        def rueckfall_lokal(address: str) -> dict[str, Any] | None:
            """Anmeldung gegen den nachgeführten Hash - None heisst: kein Weg.

            Punkt 234 der Werkbank: Antwortet Supabase nicht, prüft der
            Hub das Passwort selbst - gegen den Hash, den die letzte
            erfolgreiche Online-Anmeldung hinterlegt hat. Der Rückfall
            senkt die Sicherheit nicht: Gesperrte und abgelaufene
            Benutzer bleiben draussen, und hierher führt nur ein
            Netz-/Serverfehler, nie ein von Supabase abgelehntes
            Passwort.
            """
            eingabe = str(body.email or "").strip()
            user = hub.users.by_email(eingabe)
            if user is None:
                return None
            entry = supabase_auth.stored_hash(hub.data.get("emails"), eingabe)
            if not entry:
                return None
            if not bereich.matches(entry, body.password):
                throttle.failed(address)
                log.warning(
                    "Rückfall-Anmeldung für %s abgelehnt (%s)", user.name, address
                )
                raise HTTPException(
                    status_code=401, detail="Name oder Passwort stimmt nicht."
                )
            if not user.active():
                raise HTTPException(
                    status_code=403,
                    detail=f"Der Zugang von '{user.name}' ist gesperrt.",
                )
            throttle.succeeded(address)
            token = hub.sessions.create(
                user.name,
                body.label or "Unbenanntes Gerät",
                keep=user.shared,
                email=user.email or "",
            )
            log.warning(
                "Supabase nicht erreichbar - %s über den lokalen Hash "
                "angemeldet (%s)",
                user.name,
                address,
            )
            return {"token": token, "user": user_payload(user)}

        service = auth_service()
        if service is None and not lokal_moeglich():
            raise HTTPException(
                status_code=503,
                detail="Anmeldung mit Passwort ist nicht eingerichtet.",
            )
        # Dieselbe Bremse wie bei den Tokens: Sonst liesse sich hier in
        # Ruhe ein Passwort durchprobieren.
        address = throttle_module.client_address(request)
        waiting = throttle.blocked_for(address)
        if waiting > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Zu viele Fehlversuche. In {round(waiting)} Sekunden wieder.",
                headers={"Retry-After": str(round(waiting))},
            )

        # Erst der Hub selbst: Wer ein Initialpasswort bekommen hat,
        # meldet sich mit seinem Namen an - ganz ohne Supabase und ohne
        # E-Mail. Das Feld heisst in der App «Name oder E-Mail».
        eingabe = str(body.email or "").strip()
        lokal = hub.users.by_name(eingabe) or hub.users.by_email(eingabe)
        if lokal is not None and lokal.passwort:
            if not bereich.matches(lokal.passwort, body.password):
                throttle.failed(address)
                log.warning("Passwort-Anmeldung für %s abgelehnt (%s)", lokal.name, address)
                raise HTTPException(
                    status_code=401, detail="Name oder Passwort stimmt nicht."
                )
            if not lokal.active():
                raise HTTPException(
                    status_code=403, detail=f"Der Zugang von '{lokal.name}' ist gesperrt."
                )
            throttle.succeeded(address)
            token = hub.sessions.create(
                lokal.name,
                body.label or "Unbenanntes Gerät",
                keep=lokal.shared,
                email=lokal.email or "",
            )
            log.warning("%s hat sich mit Passwort angemeldet (%s)", lokal.name, address)
            return {
                "token": token,
                "user": user_payload(lokal),
                # Die App führt dann zuerst zum Passwort-Wechsel: Ein
                # Initialpasswort kennt auch der Verwalter.
                "must_change_password": bool(lokal.passwort_wechseln),
            }
        if service is None:
            # Punkt 234 der Werkbank: Steht Supabase nicht (mehr) in der
            # Konfiguration, gilt trotzdem der nachgeführte Hash - wer
            # sich je online angemeldet hat, kommt weiter herein.
            rueckfall = rueckfall_lokal(address)
            if rueckfall is not None:
                return rueckfall
            # Es gibt Passwort-Zugänge, nur nicht für diese Eingabe -
            # dieselbe Auskunft wie bei einem falschen Passwort, damit
            # sich Namen nicht durchprobieren lassen.
            throttle.failed(address)
            raise HTTPException(
                status_code=401, detail="Name oder Passwort stimmt nicht."
            )
        try:
            session = await service.sign_in(body.email, body.password)
        except supabase_auth.AuthError as err:
            if err.status in (400, 401, 403):
                # Supabase hat entschieden: falsches Passwort, unbestätigte
                # Adresse. Das fällt bewusst NICHT auf den lokalen Hash
                # zurück - sonst bliebe ein bei Supabase zurückgesetztes
                # Passwort hier ewig gültig.
                throttle.failed(address)
                raise HTTPException(status_code=err.status, detail=str(err)) from err
            if err.status >= 500:
                # Timeout, DNS weg, Supabase down (Punkt 234 der
                # Werkbank): Der Hub kennt seine Benutzer selbst und darf
                # das Haus nicht vom Internet abhängig machen.
                rueckfall = rueckfall_lokal(address)
                if rueckfall is not None:
                    return rueckfall
            raise HTTPException(status_code=err.status, detail=str(err)) from err

        user = hub.users.by_email(session["email"])
        if user is None:
            # Das Konto gibt es bei Supabase, aber niemand im Haus hat die
            # Adresse eingetragen. Bewusst dieselbe Auskunft wie bei einem
            # falschen Passwort – wer fremde Adressen durchprobiert, soll
            # daraus nichts lernen.
            throttle.failed(address)
            log.warning(
                "Anmeldung mit unbekannter Adresse %s abgelehnt", session["email"]
            )
            raise HTTPException(
                status_code=403,
                detail=(
                    "Diese Adresse ist im Haus nicht freigegeben. Wer schon "
                    "Zugang hat, kann sie unter Benutzer eintragen."
                ),
            )
        if not user.active():
            raise HTTPException(
                status_code=403, detail=f"Der Zugang von '{user.name}' ist gesperrt."
            )
        throttle.succeeded(address)
        # Punkt 234 der Werkbank: Den Hash lokal nachführen, damit der
        # Rückfall beim nächsten Ausfall greift - ein Supabase-Benutzer
        # hat sonst gar keinen lokalen Hash, das Passwort kennt nur
        # Supabase. Nur bei Änderung schreiben: make_entry salzt frisch,
        # und jede Anmeldung würde die Datendatei sonst neu schreiben.
        rows = hub.data.get("emails")
        if not bereich.matches(
            supabase_auth.stored_hash(rows, session["email"]), body.password
        ):
            hub.data.set(
                "emails",
                supabase_auth.remember_hash(
                    rows, session["email"], bereich.make_entry(body.password)
                ),
            )
        # Das Wandtablet meldet sich einmal an und dann nie wieder: Es
        # steht an der Wand, und niemand tippt dort nach drei Monaten
        # wieder eine Adresse samt Passwort ein.
        token = hub.sessions.create(
            user.name,
            body.label or "Unbenanntes Gerät",
            keep=user.shared,
            # Die Adresse mit in die Sitzung: Sie überlebt eine
            # Umbenennung, der Name nicht (core/sessions.py).
            email=user.email or "",
        )
        log.warning("%s hat sich mit Passwort angemeldet (%s)", user.name, address)
        return {"token": token, "user": user_payload(user)}

    @app.post("/api/auth/password")
    async def auth_set_password(body: PasswordRequest, request: Request) -> dict[str, Any]:
        """Passwort setzen – nach Einladung oder «Passwort vergessen».

        Das Ticket kommt aus der E-Mail und ist der ganze Nachweis: Wer es
        hat, hat das Postfach. Der Hub reicht es an Supabase weiter, damit
        die App nie selbst mit Supabase sprechen muss.

        Ohne Anmeldung erreichbar – deshalb dieselbe Bremse wie überall.
        """
        service = auth_service()
        if service is None:
            raise HTTPException(
                status_code=503, detail="Anmeldung mit Passwort ist nicht eingerichtet."
            )
        address = throttle_module.client_address(request)
        waiting = throttle.blocked_for(address)
        if waiting > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Zu viele Versuche. In {round(waiting)} Sekunden wieder.",
                headers={"Retry-After": str(round(waiting))},
            )
        if len(body.password) < 8:
            raise HTTPException(
                status_code=400, detail="Das Passwort braucht mindestens acht Zeichen."
            )
        try:
            result = await service.set_password(body.access_token, body.password)
        except supabase_auth.AuthError as err:
            if err.status in (400, 401, 403):
                throttle.failed(address)
            raise HTTPException(status_code=err.status, detail=str(err)) from err
        throttle.succeeded(address)
        log.warning("Passwort für %s gesetzt (%s)", result["email"], address)
        return {
            "ok": True,
            "message": "Passwort gesetzt. Du kannst dich jetzt in der App anmelden.",
        }

    @app.post("/api/auth/passwort-wechsel")
    async def auth_passwort_wechsel(
        body: PasswortWechselRequest, request: Request
    ) -> dict[str, Any]:
        """Das eigene Passwort gegen ein neues tauschen - jederzeit.

        Angemeldet, mit dem bisherigen Passwort als Nachweis: Die
        Sitzung sagt nur, dass das Gerät hereindarf - wer das Telefon
        entsperrt in der Hand hält, soll damit nicht das Passwort
        eines anderen setzen können. Danach ist eine allfällige
        Wechsel-Pflicht des Initialpassworts erledigt (Punkt 244 der
        Werkbank: derselbe Weg dient auch dem freiwilligen Wechsel).
        """
        user = current_user(request)
        if not user.passwort:
            raise HTTPException(
                status_code=400,
                detail="Für dieses Konto gibt es keinen Passwort-Zugang.",
            )
        address = throttle_module.client_address(request)
        waiting = throttle.blocked_for(address)
        if waiting > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Zu viele Versuche. In {round(waiting)} Sekunden wieder.",
                headers={"Retry-After": str(round(waiting))},
            )
        if len(body.new.strip()) < 8:
            raise HTTPException(
                status_code=400, detail="Das Passwort braucht mindestens acht Zeichen."
            )
        if not bereich.matches(user.passwort, body.old):
            throttle.failed(address)
            raise HTTPException(
                status_code=403, detail="Das bisherige Passwort stimmt nicht."
            )
        throttle.succeeded(address)
        try:
            hub.users.passwort_setzen(user.name, body.new, wechseln=False)
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        # Punkt 244 der Werkbank: Die anderen Sitzungen fallen mit. Wer
        # sein Passwort wechselt, tut das oft, weil das alte irgendwo
        # gelandet ist, wo es nicht hingehört - dann darf das fremde
        # Gerät nicht angemeldet bleiben. Nur die eigene Sitzung
        # überlebt, sonst meldet einen der Wechsel selbst ab.
        beendet = hub.sessions.revoke_others(user.name, token_from(request) or "")
        log.warning(
            "%s hat das eigene Passwort gewechselt (%s, %d andere "
            "Sitzungen beendet)",
            user.name,
            address,
            beendet,
        )
        return {"ok": True, "revoked": beendet}

    @app.post("/api/auth/recover")
    async def auth_recover(body: RecoverRequest) -> dict[str, Any]:
        """Passwort vergessen.

        Die Antwort ist immer dieselbe – ob es zu einer Adresse ein Konto
        gibt, geht niemanden etwas an, der sie nur eintippt.
        """
        service = auth_service()
        if service is not None:
            base = str((hub.config.push or {}).get("public_url") or "").rstrip("/")
            try:
                await service.recover(body.email, f"{base}/einladung" if base else "")
            except supabase_auth.AuthError as err:
                if err.status == 503:
                    raise HTTPException(status_code=503, detail=str(err)) from err
        return {
            "ok": True,
            "message": (
                "Falls es zu dieser Adresse ein Konto gibt, ist die E-Mail "
                "unterwegs."
            ),
        }

    @app.post("/api/auth/logout")
    async def auth_logout(request: Request) -> dict[str, Any]:
        """Diese Sitzung beenden – das feste Token bleibt davon unberührt."""
        current_user(request)
        return {"ok": hub.sessions.revoke(token_from(request) or "")}

    @app.get("/api/auth/sessions")
    async def auth_sessions(request: Request) -> dict[str, Any]:
        """Die eigenen angemeldeten Geräte - mit «diese hier»-Kennung.

        Punkt 244 der Werkbank: Jede Zeile trägt label, created, seen,
        eine Kennung (id) zum einzelnen Beenden und current für die
        Sitzung, mit der gerade gefragt wird - sonst räumt man in der
        «Meine Geräte»-Ansicht das Gerät in der eigenen Hand mit ab.
        """
        user = current_user(request)
        return {
            "sessions": hub.sessions.list_for(user.name, token_from(request) or "")
        }

    @app.delete("/api/auth/sessions/{sid}")
    async def auth_revoke_one(sid: str, request: Request) -> dict[str, Any]:
        """Ein einzelnes Gerät abmelden, ohne alle anderen mitzureissen.

        Punkt 244 der Werkbank: Bisher gab es nur «überall abmelden» -
        für das vergessene iPad im Ferienhaus ist das zu grob. Die
        Kennung allein genügt absichtlich nicht, sie muss zu einer
        eigenen Sitzung gehören (core/sessions.py).
        """
        user = current_user(request)
        if not hub.sessions.revoke_id(user.name, sid):
            raise HTTPException(
                status_code=404, detail="Diese Sitzung gibt es nicht (mehr)."
            )
        log.warning("%s hat die Sitzung %s beendet", user.name, sid)
        return {"ok": True}

    @app.delete("/api/auth/sessions")
    async def auth_revoke_all(request: Request) -> dict[str, Any]:
        """Überall abmelden – der Knopf für «Telefon verloren»."""
        user = current_user(request)
        count = hub.sessions.revoke_user(user.name)
        log.warning("%s hat alle Sitzungen beendet (%d)", user.name, count)
        return {"ok": True, "revoked": count}

    @app.put("/api/users/{name}/email")
    async def set_user_email(
        name: str, body: EmailRequest, request: Request
    ) -> dict[str, Any]:
        """Die Anmelde-Adresse einer Person setzen.

        Damit ist noch nichts verschickt – das macht erst die Einladung
        darunter. Und nur mit einer hier eingetragenen Adresse kommt
        jemand später durch die Anmeldung.
        """
        require(request, Capability.MANAGE_USERS)
        try:
            user = hub.users.set_email(name, body.email)
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        return {"user": user.as_dict()}

    @app.post("/api/users/{name}/invite")
    async def invite_user(name: str, request: Request) -> dict[str, Any]:
        """Eine eingetragene Person einladen – Supabase verschickt die E-Mail.

        Der einzige Weg zu einem Konto. Es gibt bewusst keine
        Selbstregistrierung: Wer im Haus mitreden darf, entscheidet der
        Besitzer und niemand sonst. Der Knopf funktioniert auch als
        Erinnerung – eine zweite Einladung ersetzt einfach die erste.
        """
        require(request, Capability.MANAGE_USERS)
        service = auth_service()
        if service is None:
            raise HTTPException(
                status_code=503, detail="Anmeldung mit Passwort ist nicht eingerichtet."
            )
        target = hub.users.by_name(name)
        if target is None:
            raise HTTPException(status_code=404, detail=f"Unbekannter Benutzer: {name}")
        if not target.email:
            raise HTTPException(
                status_code=400,
                detail=f"Für '{name}' ist keine E-Mail-Adresse eingetragen.",
            )
        # Wohin der Link in der E-Mail führt. Ohne öffentliche Adresse
        # nimmt Supabase die im Projekt hinterlegte Site-URL – dann muss
        # sie dort stimmen.
        base = str((hub.config.push or {}).get("public_url") or "").rstrip("/")
        try:
            await service.invite(target.email, f"{base}/einladung" if base else "")
        except supabase_auth.AuthError as err:
            raise HTTPException(status_code=err.status, detail=str(err)) from err
        who = current_user(request)
        log.warning("%s hat %s (%s) eingeladen", who.name, name, target.email)
        return {
            "ok": True,
            "message": (
                f"Einladung an {target.email} verschickt. Darin setzt "
                f"{name} ein Passwort und kann sich dann anmelden."
            ),
        }

    @app.get("/einladung")
    async def invite_page() -> Response:
        """Die Seite aus der Einladungs-E-Mail – ohne Anmeldung erreichbar.

        Sie enthält kein Geheimnis: Das Ticket steht im Fragment der
        Adresse und kommt hier nie an. Die Seite gibt es nur, weil der
        Link im Browser landet und nicht in der App.
        """
        return Response(
            content=invitepage.PAGE,
            media_type="text/html; charset=utf-8",
            headers={"Cache-Control": "no-store"},
        )

