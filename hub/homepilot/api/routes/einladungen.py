"""Einladen mit Link und Passwort – die Routen dazu.

Drei Stück: eine geschützte zum Ausstellen und zwei offene zum Einlösen.
Warum es das gibt und warum der Schlüssel nicht mehr im Chat landet,
steht im Kopf von core/einladung.py.
"""

from __future__ import annotations

import html
import logging
import time
from typing import Any
from urllib.parse import parse_qs

from fastapi import FastAPI, HTTPException, Request, Response

from ...core import einladung as einladung_module
from ...core import throttle as throttle_module
from ...core.users import Capability
from ..context import ApiContext
from ..models import EinladungRequest

log = logging.getLogger(__name__)

# Der Schlüssel in der hub.data.
LADE = "invites"


def _seite(titel: str, inhalt: str, status: int = 200) -> Response:
    """Eine schlichte Seite ohne fremde Dateien.

    Sie wird auf einem fremden Telefon geöffnet, oft im Mobilnetz und
    ohne Zugang zum Haus-WLAN – also nichts nachladen, was von aussen
    kommen müsste. Dunkel, weil der Rest der App es auch ist.
    """
    return Response(
        status_code=status,
        media_type="text/html; charset=utf-8",
        content=(
            "<!doctype html><html lang=de><meta charset=utf-8>"
            '<meta name=viewport content="width=device-width,initial-scale=1">'
            f"<title>{html.escape(titel)}</title>"
            "<style>"
            "body{margin:0;padding:28px 20px;background:#20262F;color:#EDF1F7;"
            "font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}"
            "main{max-width:26rem;margin:0 auto}"
            "h1{font-size:1.4rem;margin:0 0 .6rem}"
            "p{color:#A2ACBB;margin:.5rem 0}"
            "input{width:100%;box-sizing:border-box;padding:14px;margin:14px 0 6px;"
            "border-radius:14px;border:1px solid rgba(255,255,255,.18);"
            "background:rgba(255,255,255,.07);color:#EDF1F7;font-size:17px}"
            "button{width:100%;padding:14px;border:0;border-radius:14px;"
            "background:#6E9BFF;color:#141922;font-size:17px;font-weight:700}"
            "code{display:block;padding:14px;border-radius:14px;word-break:break-all;"
            "background:rgba(255,255,255,.07);color:#EDF1F7;font-size:13px;margin:12px 0}"
            ".warn{color:#FFC061}"
            "</style>"
            f"<main>{inhalt}</main>"
        ),
    )


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    throttle = ctx.throttle
    require = ctx.require

    def basis() -> str:
        """Die Adresse, unter der der Hub für den Gast erreichbar ist."""
        aussen = str((hub.config.push or {}).get("public_url") or "").strip()
        if aussen:
            return aussen.rstrip("/")
        from ...qr import local_ip

        host = hub.config.api.host
        adresse = local_ip() if host in ("0.0.0.0", "::", "") else host
        return f"http://{adresse}:{hub.config.api.port}"

    def laden() -> list[dict[str, Any]]:
        """Die offenen Einladungen – Abgelaufenes fliegt dabei raus."""
        offen = einladung_module.aufraeumen(hub.data.get(LADE), time.time())
        return offen

    def sichern(rows: list[dict[str, Any]]) -> None:
        hub.data.set(LADE, einladung_module.aufraeumen(rows, time.time()))

    # ── Ausstellen ─────────────────────────────────────────────────────────

    @app.post("/api/users/{name}/einladung")
    async def einladung_ausstellen(
        name: str, body: EinladungRequest, request: Request
    ) -> dict[str, Any]:
        """Link und Passwort statt Token im Chat.

        Das Passwort kommt von der einladenden Person und wird hier nur
        als Abdruck abgelegt – zurückrechnen kann es niemand, auch wir
        nicht. Wer es vergisst, stellt eine neue Einladung aus.
        """
        wer = require(request, Capability.MANAGE_USERS)
        ziel = hub.users.by_name(name)
        if ziel is None:
            raise HTTPException(status_code=404, detail=f"Unbekannter Benutzer: {name}")
        fehler = einladung_module.passwort_haltbar(body.password)
        if fehler:
            raise HTTPException(status_code=400, detail=fehler)

        jetzt = time.time()
        zeile = einladung_module.neu(
            ziel.name,
            body.password,
            jetzt,
            body.minutes or einladung_module.DEFAULT_MINUTES,
        )
        # Je Person höchstens eine offene Einladung: Zwei gleichzeitig
        # sind zwei Türen, von denen man eine vergisst.
        rows = [row for row in laden() if row.get("user") != ziel.name]
        sichern([zeile, *rows])
        log.warning("%s hat eine Einladung für %s ausgestellt", wer.name, ziel.name)
        return {
            "id": zeile["id"],
            "link": f"{basis()}/einladung/{zeile['id']}",
            "expires": zeile["expires"],
            "user": ziel.name,
        }

    @app.get("/api/users/{name}/einladung")
    async def einladung_ansehen(name: str, request: Request) -> dict[str, Any]:
        """Gibt es für diese Person eine offene Einladung?"""
        require(request, Capability.MANAGE_USERS)
        zeile = next((row for row in laden() if row.get("user") == name), None)
        if zeile is None:
            return {"open": False}
        return {
            "open": True,
            "id": zeile["id"],
            "link": f"{basis()}/einladung/{zeile['id']}",
            "expires": zeile["expires"],
            "tries": int(zeile.get("tries") or 0),
        }

    @app.delete("/api/users/{name}/einladung")
    async def einladung_zuruecknehmen(name: str, request: Request) -> dict[str, Any]:
        """Eine Einladung zurückziehen – etwa, wenn der Link falsch landete."""
        wer = require(request, Capability.MANAGE_USERS)
        rows = [row for row in laden() if row.get("user") != name]
        sichern(rows)
        log.warning("%s hat die Einladung für %s zurückgezogen", wer.name, name)
        return {"ok": True}

    # ── Einlösen (ohne Anmeldung) ──────────────────────────────────────────

    def _abgelehnt(grund: str) -> Response:
        texte = {
            "abgelaufen": "Diese Einladung ist abgelaufen. Bitte um eine neue.",
            "gebraucht": "Diese Einladung wurde schon benutzt.",
            "verbraucht": (
                "Zu viele Fehlversuche – diese Einladung gilt nicht mehr. "
                "Bitte um eine neue."
            ),
            "unbekannt": "Diesen Link gibt es nicht.",
        }
        return _seite(
            "HomePilot",
            "<h1>Geht nicht mehr</h1>"
            f"<p class=warn>{html.escape(texte.get(grund, texte['unbekannt']))}</p>",
            status=410,
        )

    @app.get("/einladung/{id_}")
    async def einladung_seite(id_: str) -> Response:
        """Das Passwortfeld. Der Link allein öffnet nichts."""
        zeile = einladung_module.finde(laden(), id_)
        zustand = einladung_module.zustand(zeile, time.time())
        if zustand != "offen":
            return _abgelehnt(zustand)
        assert zeile is not None
        return _seite(
            "HomePilot – Einladung",
            f"<h1>Zugang für {html.escape(str(zeile['user']))}</h1>"
            "<p>Gib das Passwort ein, das du bekommen hast.</p>"
            f'<form method=post action="/einladung/{html.escape(id_)}">'
            '<input type=password name=password autocomplete="one-time-code" '
            'autofocus placeholder="Passwort">'
            "<button type=submit>Weiter</button></form>",
        )

    @app.post("/einladung/{id_}")
    async def einladung_einloesen(id_: str, request: Request) -> Response:
        """Passwort prüfen und – nur dann – den Zugang herausgeben."""
        # Zwei Bremsen: eine je Absender (sonst probiert einer viele
        # Einladungen durch) und eine je Einladung (sonst probiert er
        # viele Passwörter für eine).
        adresse = throttle_module.client_address(request)
        wartet = throttle.blocked_for(adresse)
        if wartet > 0:
            return _seite(
                "HomePilot",
                "<h1>Zu viele Versuche</h1><p class=warn>Bitte später nochmal.</p>",
                status=429,
            )

        rows = laden()
        zeile = einladung_module.finde(rows, id_)
        zustand = einladung_module.zustand(zeile, time.time())
        if zustand != "offen":
            throttle.failed(adresse)
            return _abgelehnt(zustand)
        assert zeile is not None

        # Von Hand statt `request.form()`: Das bräuchte python-multipart,
        # und für ein einziges Passwortfeld eine Abhängigkeit mehr in den
        # Hub zu ziehen – die im Betrieb dann fehlt – lohnt nicht. Ein
        # schlichtes <form> schickt urlencoded, und das kann die
        # Standardbibliothek.
        roh = (await request.body()).decode("utf-8", "replace")
        passwort = (parse_qs(roh).get("password") or [""])[0]
        if not einladung_module.stimmt(zeile, passwort):
            throttle.failed(adresse)
            zeile["tries"] = int(zeile.get("tries") or 0) + 1
            sichern(einladung_module.ersetze(rows, zeile))
            uebrig = einladung_module.MAX_VERSUCHE - int(zeile["tries"])
            log.warning(
                "Einladung %s: falsches Passwort von %s (noch %s Versuche)",
                id_, adresse, max(0, uebrig),
            )
            if uebrig <= 0:
                return _abgelehnt("verbraucht")
            return _seite(
                "HomePilot – Einladung",
                "<h1>Passwort stimmt nicht</h1>"
                f"<p class=warn>Noch {uebrig} Versuche.</p>"
                f'<form method=post action="/einladung/{html.escape(id_)}">'
                '<input type=password name=password autofocus placeholder="Passwort">'
                "<button type=submit>Nochmal</button></form>",
                status=401,
            )

        ziel = hub.users.by_name(str(zeile["user"]))
        if ziel is None:
            return _abgelehnt("unbekannt")

        throttle.succeeded(adresse)
        # Verbraucht, bevor der Zugang herausgeht: Ein Link, der nach dem
        # Anzeigen weitergälte, wäre ein Zweitschlüssel.
        zeile["used_at"] = time.time()
        sichern(einladung_module.ersetze(rows, zeile))
        log.warning("Einladung für %s eingelöst (von %s)", ziel.name, adresse)

        from ...qr import setup_payload_fuer

        # Dieselbe Adresse wie im Einladungs-Link (basis): die
        # Aussenadresse aus push.public_url, wenn es eine gibt. Vorher
        # stand hier die Haus-IP aus der config - und ein Gast, der die
        # Einladung unterwegs einlöst, bekam Zugangsdaten, mit denen er
        # von aussen nie eine Verbindung aufbauen kann. Ohne public_url
        # bleibt es bei der Haus-Adresse wie bisher.
        nutzlast = setup_payload_fuer(basis(), ziel.token, ziel.name)
        return _seite(
            "HomePilot – Zugang",
            f"<h1>Willkommen, {html.escape(ziel.name)}</h1>"
            "<p>Öffne die HomePilot-App, tippe auf «Verbinden» und füge "
            "diesen Text ein:</p>"
            f"<code id=z>{html.escape(nutzlast)}</code>"
            "<button onclick=\"navigator.clipboard.writeText("
            "document.getElementById('z').textContent).then("
            "()=>this.textContent='Kopiert')\">Kopieren</button>"
            "<p>Dieser Link gilt jetzt nicht mehr.</p>",
        )
