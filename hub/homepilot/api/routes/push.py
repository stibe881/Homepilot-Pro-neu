"""Push-Nachrichten: Geräte, Kategorien, Wächter-Regeln, Bild-Anhänge.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
)

from ...core import (
    notifyrules,
    push,
    snapshots,
)
from ...core.users import Capability
from ..context import ApiContext
from ..models import NotifyRuleRequest, PushPrefsRequest, PushRegistration

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require

    @app.get("/api/push/image/{token}")
    async def push_image(token: str) -> Response:
        """Das Kamerabild zu einer Alarm-Nachricht – bewusst ohne Anmeldung.

        Das Telefon zeigt die Nachricht an, lange bevor die App läuft; es
        hat zu diesem Zeitpunkt keinen Token und kann auch keinen
        mitschicken. Ein Bild in der Nachricht geht deshalb nur so.

        Was den Handel vertretbar macht: Die Kennung besteht aus 32
        zufälligen Bytes, sie gilt zehn Minuten, sie liegt nur im
        Arbeitsspeicher, und dahinter steckt ein einzelnes Standbild – kein
        Zugang zur laufenden Kamera und zu nichts sonst. Wer das nicht will,
        lässt ``push.public_url`` in der config.yaml weg; dann entsteht
        gar keine solche Adresse.
        """
        image = hub.snapshots.get(token)
        if image is None:
            # Abgelaufen und nie existiert sehen von aussen gleich aus –
            # sonst liesse sich am Unterschied ablesen, ob geraten wurde.
            raise HTTPException(status_code=404, detail="Kein Bild")
        return Response(
            content=image,
            media_type=snapshots.media_type(image),
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/push/categories")
    async def push_categories(request: Request) -> dict[str, Any]:
        """Welche Arten von Nachrichten es gibt – und was ich abbestellt habe.

        Je Benutzer, nicht global: Wen die schwache Batterie im Keller nicht
        interessiert, der soll deswegen nicht den Alarm mit abschalten.
        """
        user = current_user(request)
        muted = sorted(hub.push.muted.get(user.name, set()))
        return {
            "categories": [
                {"key": key, "label": label} for key, label in push.CATEGORIES.items()
            ],
            "muted": muted,
        }

    @app.put("/api/push/categories")
    async def set_push_categories(
        body: PushPrefsRequest, request: Request
    ) -> dict[str, Any]:
        """Abbestellungen des angemeldeten Benutzers speichern.

        Bewusst neben den Benutzern abgelegt und nicht in ihnen: Auch wer
        in der config.yaml steht, soll seine Nachrichten einstellen können,
        ohne dass der Hub die Datei anfasst.
        """
        user = current_user(request)
        stored = {
            entry["user"]: entry
            for entry in hub.data.get("push_prefs")
            if isinstance(entry, dict) and entry.get("user")
        }
        stored[user.name] = {
            "user": user.name,
            "muted": [key for key in body.muted if key in push.CATEGORIES],
        }
        hub.data.set("push_prefs", list(stored.values()))
        hub.push.muted = push.parse_muted(hub.data.get("push_prefs"))
        return {"ok": True, "muted": sorted(hub.push.muted.get(user.name, set()))}

    # ── Eingebaute Wächter-Nachrichten (Abläufe → Push) ────────────────────
    # Global, nicht je Benutzer: Diese Regeln bestimmen, ob und wann der Hub
    # überhaupt meldet. Wer sie nur für sich nicht will, bestellt die
    # Kategorie unter Benachrichtigungen ab.

    @app.get("/api/notifyrules")
    async def list_notify_rules(request: Request) -> dict[str, Any]:
        current_user(request)
        return {"rules": notifyrules.describe(hub.data.get("notify_rules"))}

    @app.put("/api/notifyrules/{key}")
    async def set_notify_rule(
        key: str, body: NotifyRuleRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        try:
            stored = notifyrules.store(
                hub.data.get("notify_rules"), key, body.enabled, body.params
            )
        except ValueError as err:
            raise HTTPException(status_code=404, detail=str(err)) from err
        hub.data.set("notify_rules", stored)
        # Sofort übernehmen, nicht erst in der nächsten Wächter-Runde:
        # Wer den Schalter umlegt, erwartet, dass er ab jetzt gilt.
        hub.watchdog.rules = notifyrules.effective(stored)
        return {"rules": notifyrules.describe(stored)}

    # ── Push ───────────────────────────────────────────────────────────────

    @app.post("/api/push/register")
    async def register_push(body: PushRegistration, request: Request) -> dict[str, Any]:
        user = current_user(request)
        device = hub.push.register(body.token, user.name, body.label)
        return {"ok": True, "device": device.as_dict()}

    @app.get("/api/push/devices")
    async def list_push_devices(request: Request) -> dict[str, Any]:
        """Die angemeldeten Telefone - zum Nachsehen und Aufräumen.

        Bisher gab es nur die Zählung, und die Fehlermeldung «alte
        Einträge entfernen» zeigte auf eine Tür, die es nicht gab. Das
        volle Token ist dabei: Es ist die Adresse fürs Entfernen, und wer
        hier hineindarf (Besitzer), darf ohnehin senden.
        """
        require(request, Capability.EDIT_CONFIG)
        return {"devices": [device.as_dict() for device in hub.push.devices]}

    @app.post("/api/push/unregister")
    async def unregister_push(body: PushRegistration, request: Request) -> dict[str, Any]:
        current_user(request)
        return {"ok": hub.push.unregister(body.token)}

    @app.post("/api/push/test")
    async def test_push(request: Request) -> dict[str, Any]:
        """Probe-Nachricht an die Geräte des angemeldeten Benutzers.

        Der Test wartet kurz auf die Zustell-Quittung: «angenommen» sagt nur,
        dass Expo die Nachricht entgegengenommen hat – ob Apple oder Google
        sie ausgeliefert haben, steht erst in der Quittung. Genau dort steht
        auch der Grund, wenn nichts ankommt.
        """
        user = current_user(request)
        # Der Test geht bewusst ohne Kategorie raus: Wer prüft, ob Push
        # überhaupt ankommt, will keine Antwort von seinen eigenen
        # Abbestellungen.
        tokens = hub.push.recipients(hub.users.users, user.name)
        result = await hub.push.send(
            tokens,
            title="HomePilot Test",
            body="Push-Benachrichtigungen funktionieren \U0001f389",
            data={"type": "test"},
        )
        problems = list(result.errors)
        if result.ticket_ids:
            # Expo braucht einen Moment, bis die Quittung bereitsteht.
            await asyncio.sleep(3)
            problems.extend(await hub.push.delivered(result.ticket_ids))
        return {
            "ok": not problems,
            "sent": result.accepted,
            "devices": len(tokens),
            "errors": problems,
        }

