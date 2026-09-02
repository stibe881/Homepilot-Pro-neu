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
    livekarten,
    notifyrules,
    presence,
    push,
    pushverlauf,
    snapshots,
    spaeter,
    waschkueche,
)
from ...core.users import Capability, Role
from ..context import ApiContext
from ..models import (
    LaundryRequest,
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
        user = require(request, Capability.EDIT_AUTOMATIONS)
        try:
            stored = notifyrules.store(
                hub.data.get("notify_rules"), key, body.enabled, body.params
            )
        except ValueError as err:
            raise HTTPException(status_code=404, detail=str(err)) from err
        hub.data.set("notify_rules", stored)
        hub.aenderungen.merken(
            user,
            "regel",
            "eingeschaltet" if body.enabled else "abgeschaltet",
            push.CATEGORIES.get(key, key),
        )
        # Sofort übernehmen, nicht erst in der nächsten Wächter-Runde:
        # Wer den Schalter umlegt, erwartet, dass er ab jetzt gilt.
        hub.watchdog.rules = notifyrules.effective(stored)
        return {
            "rules": notifyrules.describe(stored),
            "groups": push.group_order(),
        }

    # ── Die Türe der Waschküche ────────────────────────────────────────────
    #
    # Gehört zur Regel «Haushaltgerät noch voll» und steht in der App
    # deshalb in derselben Karte: An diesem Kontakt liest der Wächter ab,
    # ob jemand unten war - und hört auf zu mahnen. Warum überhaupt an
    # einer Türe gemessen wird, steht in core/waschkueche.py.
    #
    # Nicht als Parameter der Regel selbst: Die sind Zahlen mit Grenzen
    # (notifyrules.py), eine Geräte-Id ist keine.

    @app.get("/api/laundry")
    async def laundry_door(request: Request) -> dict[str, Any]:
        current_user(request)
        entities = hub.registry.all()
        gewaehlt = _gewaehlte_tuer()
        aktuell = waschkueche.tuer(entities, gewaehlt)
        return {
            # Was gewählt wurde - leer heisst «geraten».
            "door": gewaehlt,
            # Und was daraus folgt: Ohne diese Zeile sähe man in der App
            # nicht, dass ohne eigene Wahl trotzdem eine Türe gilt.
            "using": aktuell.id if aktuell is not None else None,
            "guess": waschkueche.raten(entities),
            "candidates": [
                {"id": entity.id, "name": entity.label, "room": entity.room}
                for entity in waschkueche.kandidaten(entities)
            ],
        }

    @app.put("/api/laundry")
    async def set_laundry_door(body: LaundryRequest, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        tuer = (body.door or "").strip()
        if tuer and hub.registry.get(tuer) is None:
            raise HTTPException(status_code=404, detail="Diesen Kontakt kennt der Hub nicht")
        hub.data.set("laundry", [{"door": tuer}] if tuer else [])
        hub.watchdog.tuer_gewechselt(hub.registry.all(), tuer or None)
        return await laundry_door(request)

    @app.post("/api/appliances/{entity_id}/claim")
    async def claim_appliance(entity_id: str, request: Request) -> dict[str, Any]:
        """«Ich mach's» – diesen Programmlauf übernimmt jemand.

        Die Meldung «Waschmaschine ist noch voll» geht an alle, und was
        danach passiert, ist beide Male falsch: Entweder geht niemand
        hinunter, weil jeder annimmt, ein anderer tue es - oder zwei
        stehen gleichzeitig vor der Trommel. Hier steht der Name, der
        das beendet.

        Zum Bedienen und nicht zum Verwalten: Wer die Maschine ausräumen
        darf, darf auch sagen, dass er es tut.
        """
        user = require(request, Capability.CONTROL)
        entity = hub.registry.get(entity_id)
        if entity is None or entity.kind != "appliance":
            raise HTTPException(status_code=404, detail="Kein Haushaltgerät")
        name = getattr(user, "name", "") or ""
        genommen = await hub.watchdog.uebernehmen(entity_id, name)
        # Kein Fehler, wenn es nichts zu übernehmen gibt: Der Normalfall
        # ist ein später Druck auf eine überholte Nachricht - die
        # Maschine läuft wieder, oder jemand war schon unten. Die App
        # soll das sagen können, ohne dass es nach Panne aussieht.
        return {
            "claimed": genommen,
            "by": waschkueche.uebernahmesatz(name) if genommen else None,
        }

    def _gewaehlte_tuer() -> str | None:
        for entry in hub.data.get("laundry"):
            if isinstance(entry, dict) and entry.get("door"):
                return str(entry["door"])
        return None

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

    @app.get("/api/push/log")
    async def push_log(request: Request) -> dict[str, Any]:
        """Die letzten Meldungen zum Nachlesen.

        Nur die eigenen: Was an alle ging und was an mich - dass Lina
        ans Medikament erinnert wurde, geht die anderen nichts an
        (core/pushverlauf.py).
        """
        user = current_user(request)
        return {
            "log": pushverlauf.fuer(hub.data.get(pushverlauf.STORE_KEY), user.name),
            "days": pushverlauf.TAGE,
        }

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
        """Für die App: eingerichtet, angemeldet - und warum keine Karte da ist.

        Der Satz in `reason` hat drei Runden Raten gekostet. Zwischen
        «der Schalter steht an» und «die Karte liegt da» hängen acht
        Glieder, und die meisten schweigen, wenn sie fehlen: kein
        angemeldetes Telefon, keine Zone zu diesem Namen, keine Ortung,
        kein Vermerk «war draussen». Von aussen sieht jedes davon gleich
        aus - es passiert nichts.
        """
        user = current_user(request)
        rows = hub.data.get(liveaktivitaet.DATA_KEY)
        meine = [
            row for row in rows if isinstance(row, dict) and row.get("user") == user.name
        ]

        geofence = hub.integrations.get("geofence") if hub.integrations else None
        zones = getattr(geofence, "_zones", None) or {}
        namen = {
            zone_id: getattr(hub.registry.get(entity_id), "label", zone_id)
            for zone_id, entity_id in zones.items()
        }
        zone_id = presence.zone_fuer(user.name, namen)
        entity = hub.registry.get(zones[zone_id]) if zone_id else None
        zustand_roh = (entity.state if entity else {}) or {}

        weit_rows = hub.data.get(liveaktivitaet.WEIT_KEY)
        angekommen = liveaktivitaet.heim_seit(weit_rows, user.name)
        prefs_rows = hub.data.get("user_prefs")

        return {
            "configured": liveaktivitaet.parse_apns(hub.config.apns) is not None,
            "registered": len(meine),
            "phones": [str(row.get("label") or "Telefon") for row in meine],
            "reason": liveaktivitaet.diagnose(
                eingerichtet=liveaktivitaet.parse_apns(hub.config.apns) is not None,
                telefone=len(meine),
                abgestellt=(
                    user.name in liveaktivitaet.abgeschaltet(prefs_rows)
                    or "tuer" in liveaktivitaet.abbestellte(prefs_rows).get(
                        user.name, set()
                    )
                ),
                zone=zone_id,
                zustand=str(zustand_roh.get("state") or presence.UNKNOWN),
                entfernung=zustand_roh.get("distance"),
                nah=liveaktivitaet.kartenradius(
                    liveaktivitaet.heimradius(getattr(geofence, "places", None))
                ),
                draussen_gewesen=liveaktivitaet.war_weit(weit_rows, user.name),
                laeuft=any(row.get("unterwegs") for row in meine),
                token_da=any(row.get("activity_token") for row in meine),
                heim_vor=None if angekommen is None else time.time() - angekommen,
            ),
        }

    @app.post("/api/liveactivity/register")
    async def liveactivity_register(
        body: LiveActivityTokenRequest, request: Request
    ) -> dict[str, Any]:
        user = current_user(request)
        if user.role == Role.GUEST:
            raise HTTPException(status_code=403, detail="Nicht für Gäste")
        if body.typ == "haus":
            hub.data.set(
                livekarten.START_KEY,
                livekarten.registrieren(
                    hub.data.get(livekarten.START_KEY),
                    user.name,
                    body.token,
                    body.label,
                ),
            )
        else:
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
        hub.data.set(
            livekarten.START_KEY,
            livekarten.abmelden(hub.data.get(livekarten.START_KEY), body.token),
        )
        return {"ok": True}

    @app.post("/api/liveactivity/activity")
    async def liveactivity_activity(
        body: LiveActivityTokenRequest, request: Request
    ) -> dict[str, Any]:
        """Das Token der gerade laufenden Aktivität - fürs spätere Beenden."""
        user = current_user(request)
        if body.art:
            # Eine generische Karte (Timer, Gerät, Grill, …): Das Token
            # gehört zur laufenden Zeile in live_cards.
            hub.data.set(
                livekarten.KARTEN_KEY,
                livekarten.token_merken(
                    hub.data.get(livekarten.KARTEN_KEY), user.name, body.art, body.token
                ),
            )
        else:
            hub.data.set(
                liveaktivitaet.DATA_KEY,
                liveaktivitaet.aktivitaet_merken(
                    hub.data.get(liveaktivitaet.DATA_KEY), user.name, body.token
                ),
            )
        return {"ok": True}

