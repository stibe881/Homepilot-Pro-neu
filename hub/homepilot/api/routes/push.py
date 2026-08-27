"""Push-Nachrichten: Geräte, Kategorien, Wächter-Regeln, Bild-Anhänge.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
)

from ...core import (
    liveaktivitaet,
    notifyrules,
    push,
    snapshots,
    spaeter,
)
from ...core.users import Capability, Role
from ..context import ApiContext
from ..models import (
    LiveActivityTokenRequest,
    NotifyRuleRequest,
    PushPrefsRequest,
    PushRegistration,
    PushSnoozeRequest,
)

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
        # ``warten`` statt ``get``: Bei einer Kamera mit Personenerkennung
        # ist die Adresse schon vergeben, das Bild aber noch unterwegs -
        # der Hub wartet gerade darauf, dass wirklich jemand im Bild
        # steht. Diese Anfrage hält so lange still, statt einen leeren
        # Kasten zu liefern. Liegt das Bild bereits da, kostet es nichts.
        # Warum das der richtige Handel ist: core/personenbild.py.
        image = await hub.snapshots.warten(token)
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
        # Jeder selbst gebaute Ablauf, der meldet, bringt seinen eigenen
        # Schalter mit - einsortiert unter seiner Kategorie. Wer seine
        # Push-Abläufe «Push» nennt, findet sie hier unter «Push». Früher
        # lief alles unter der einen Zeile «Nachricht aus einem Ablauf»,
        # und wer die Gefriertruhe abbestellte, schaltete «Jemand weint
        # im Kinderzimmer» mit ab.
        aus_ablaeufen = push.automation_categories(hub.automations.automations)
        eigene_gruppen = [
            gruppe
            for gruppe in dict.fromkeys(zeile["group"] for zeile in aus_ablaeufen)
            if gruppe not in push.group_order()
        ]
        return {
            "categories": [
                # Die Gruppe kommt mit: Die App soll dieselbe Einteilung
                # zeigen wie die Liste unter «Abläufe → Push», und die
                # kennt nur der Hub.
                {"key": key, "label": label, "group": push.group_of(key)}
                for key, label in push.CATEGORIES.items()
            ]
            + aus_ablaeufen,
            # Die Kategorien der Abläufe hinten an: Sie stehen erst da,
            # seit jemand sie vergeben hat, und sollen die eingebaute
            # Ordnung nicht durcheinanderbringen.
            "groups": push.group_order() + eigene_gruppen,
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
            # Auch die Schlüssel aus Abläufen (automation:<id>) - ob es
            # den Ablauf noch gibt, prüft hier bewusst niemand: Ein
            # pausierter Ablauf soll seine Abbestellung behalten.
            "muted": [key for key in body.muted if push.known(key)],
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
        # Die Reihenfolge der Unterkategorien kommt mit: Dieselbe
        # Einteilung zeigt die Liste im Profil.
        return {
            "rules": notifyrules.describe(hub.data.get("notify_rules")),
            "groups": push.group_order(),
        }

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
        return {
            "rules": notifyrules.describe(stored),
            "groups": push.group_order(),
        }

    # ── Push ───────────────────────────────────────────────────────────────

    @app.get("/api/push/targets")
    async def push_targets(request: Request) -> dict[str, Any]:
        """Wer als Empfänger einer Ablauf-Nachricht in Frage kommt (158).

        Nur Namen und Rollen, keine Tokens: Der Ablauf-Editor braucht
        eine Auswahl, keine Benutzerverwaltung. Seit die Erinnerungen
        ihre Push-Empfänger wählen lassen, brauchen die Liste auch
        Mitbewohner - wer hier wohnt, kennt die Namen ohnehin (sie
        stehen in der Anwesenheitsliste). Nur Gäste bleiben draussen.
        """
        user = current_user(request)
        from ...core.users import Role

        if user.role == Role.GUEST:
            raise HTTPException(status_code=403, detail="Für Gäste nicht sichtbar")
        return {
            "names": [
                user.name
                for user in hub.users.users
                if not user.system and user.role != Role.GUEST
            ],
            "roles": sorted(Role.ALL),
        }

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

    @app.post("/api/push/snooze")
    async def snooze_push(body: PushSnoozeRequest, request: Request) -> dict[str, Any]:
        """«Später erinnern» aus der Mitteilung heraus.

        Der Knopf sitzt auf dem Sperrbildschirm; die App reicht ihn hierher
        weiter, sobald sie davon erfährt. Zurückgelegt wird die Meldung
        selbst - wer «in 30 Minuten» wählt, will genau diesen Satz wieder
        lesen und keine Zusammenfassung dessen, was inzwischen gilt.

        Nur an die Person, die geschoben hat: Dass Stefan die Meldung
        wegschiebt, geht die anderen Telefone nichts an.
        """
        user = current_user(request)
        hub.data.set(
            spaeter.SCHLANGE,
            spaeter.einreihen(
                hub.data.get(spaeter.SCHLANGE),
                {
                    "title": body.title,
                    "body": body.body,
                    "category": body.category,
                    "to": user.name,
                },
                time.time(),
                body.minutes,
            ),
        )
        return {"ok": True, "minutes": spaeter.minuten_pruefen(body.minutes)}

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

    # ── Haustür-Live-Aktivität (core/liveaktivitaet.py) ────────────────────
    #
    # Das iPhone meldet hier seine ActivityKit-Tokens an; wann eine Karte
    # startet oder endet, entscheidet der Takt im Hub. Kein Gast-Zugang:
    # Die Karte führt zur Haustüre.

    @app.get("/api/liveactivity")
    async def liveactivity_status(request: Request) -> dict[str, Any]:
        """Für die App: Ist der Hub dafür eingerichtet, und bin ich dabei?"""
        user = current_user(request)
        rows = hub.data.get(liveaktivitaet.DATA_KEY)
        return {
            "configured": liveaktivitaet.parse_apns(hub.config.apns) is not None,
            "registered": sum(
                1
                for row in rows
                if isinstance(row, dict) and row.get("user") == user.name
            ),
        }

    @app.post("/api/liveactivity/register")
    async def liveactivity_register(
        body: LiveActivityTokenRequest, request: Request
    ) -> dict[str, Any]:
        user = current_user(request)
        if user.role == Role.GUEST:
            raise HTTPException(status_code=403, detail="Nicht für Gäste")
        hub.data.set(
            liveaktivitaet.DATA_KEY,
            liveaktivitaet.registrieren(
                hub.data.get(liveaktivitaet.DATA_KEY),
                user.name,
                body.token,
                body.label,
            ),
        )
        return {"ok": True}

    @app.post("/api/liveactivity/unregister")
    async def liveactivity_unregister(
        body: LiveActivityTokenRequest, request: Request
    ) -> dict[str, Any]:
        current_user(request)
        hub.data.set(
            liveaktivitaet.DATA_KEY,
            liveaktivitaet.abmelden(hub.data.get(liveaktivitaet.DATA_KEY), body.token),
        )
        return {"ok": True}

    @app.post("/api/liveactivity/activity")
    async def liveactivity_activity(
        body: LiveActivityTokenRequest, request: Request
    ) -> dict[str, Any]:
        """Das Token der gerade laufenden Aktivität - fürs spätere Beenden."""
        user = current_user(request)
        hub.data.set(
            liveaktivitaet.DATA_KEY,
            liveaktivitaet.aktivitaet_merken(
                hub.data.get(liveaktivitaet.DATA_KEY), user.name, body.token
            ),
        )
        return {"ok": True}

