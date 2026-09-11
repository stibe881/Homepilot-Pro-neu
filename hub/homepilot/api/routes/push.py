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
    batterie,
    gutscheine,
    klingelton,
    liveaktivitaet,
    livekarten,
    notifyrules,
    presence,
    push,
    pushbeispiel,
    pushgeraet,
    pushruhe,
    pushverlauf,
    pushziel,
    snapshots,
    spaeter,
    storenwaechter,
    waschkueche,
)
from ...core.users import Capability, Role
from ..context import ApiContext
from ..models import (
    BatteryPrefsRequest,
    CoverGuardRequest,
    DoorbellSoundRequest,
    DoorbellSoundTestRequest,
    LaundryRequest,
    LiveActivityTokenRequest,
    NotifyRuleRequest,
    PushPrefsRequest,
    PushQuittierenRequest,
    PushRegistration,
    PushRuhezeitRequest,
    PushSnoozeRequest,
    PushStillRequest,
    VoucherPrefsRequest,
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

    def _meine_zeile(name: str) -> dict[str, Any]:
        """Die gespeicherte Push-Zeile einer Person - leer, wenn keine da.

        Abbestellungen, Ruhezeit und Stillgestelltes liegen in derselben
        Zeile (``push_prefs``): Es ist dasselbe Thema, und drei Listen
        nebeneinander liefen früher oder später auseinander - genau wie
        es die Kategorien-Einteilung schon einmal tat.
        """
        for eintrag in hub.data.get("push_prefs") or []:
            if isinstance(eintrag, dict) and eintrag.get("user") == name:
                return eintrag
        return {}

    def _zeile_schreiben(name: str, **felder: Any) -> dict[str, Any]:
        """Felder in die eigene Push-Zeile einsetzen und übernehmen."""
        stored = {
            entry["user"]: entry
            for entry in hub.data.get("push_prefs")
            if isinstance(entry, dict) and entry.get("user")
        }
        zeile = {**stored.get(name, {"user": name, "muted": []}), **felder}
        stored[name] = zeile
        hub.data.set("push_prefs", list(stored.values()))
        # Sofort übernehmen: Sonst gölte die neue Ruhezeit erst nach dem
        # nächsten Neustart, und danach sucht man eine Stunde.
        hub.push_einstellungen_lesen()
        return zeile

    @app.get("/api/push/categories")
    async def push_categories(request: Request, token: str = "") -> dict[str, Any]:
        """Welche Arten von Nachrichten es gibt – und was ich abbestellt habe.

        Je Benutzer, nicht global: Wen die schwache Batterie im Keller nicht
        interessiert, der soll deswegen nicht den Alarm mit abschalten.

        Mit ``token`` je *Gerät* (Punkt 471 der Werkbank): Wer sich mit
        Telefon und iPad anmeldet, bekam auf beiden dasselbe - auch die
        Ruhezeit. Das iPad liegt nachts im Wohnzimmer und darf klingeln.
        Gefragt wird mit dem eigenen Token, den die App ohnehin hat;
        fehlt er, steht hier wie bisher die Sicht der Person.
        """
        user = current_user(request)
        meine = _meine_zeile(user.name)
        eigen = bool(token) and pushgeraet.weicht_ab(meine, token)
        fuer_dieses = pushgeraet.fuer_geraet(meine, token) if token else meine
        muted = sorted(
            str(key)
            for key in (fuer_dieses.get("muted") or [])
            if push.known(str(key))
        )
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
        jetzt = time.time()
        still = pushruhe.still_lesen(_meine_zeile(user.name).get("still"), jetzt)
        return {
            "categories": [
                # Die Gruppe kommt mit: Die App soll dieselbe Einteilung
                # zeigen wie die Liste unter «Abläufe → Push», und die
                # kennt nur der Hub.
                {
                    "key": key,
                    "label": label,
                    "group": push.group_of(key),
                    # Was auf dem Sperrbildschirm stehen wird. Ohne das
                    # bestellt man eine Überschrift ab und weiss nicht,
                    # was darunter läuft (core/pushbeispiel.py).
                    "beispiel": pushbeispiel.beispiel(key),
                    # Dringend heisst: kommt sofort, auch im Fokus.
                    # Sichtbar, weil es sonst nirgends steht und die
                    # Frage «warum kommt das eine sofort und das andere
                    # zwanzig Minuten später» sonst unbeantwortet bleibt.
                    "dringend": key not in push.LEISE,
                    # Was sich nie zurückhalten lässt - die App soll den
                    # Knopf «24 h still» dort gar nicht erst anbieten.
                    "immer": key in pushruhe.IMMER_DURCH,
                    # Bis wann stillgestellt (Unix-Sekunden) oder None.
                    "still_bis": still.get(key),
                    "deckel": pushruhe.deckel_fuer(key),
                }
                for key, label in push.CATEGORIES.items()
            ]
            + aus_ablaeufen,
            # Die Kategorien der Abläufe hinten an: Sie stehen erst da,
            # seit jemand sie vergeben hat, und sollen die eingebaute
            # Ordnung nicht durcheinanderbringen.
            "groups": push.group_order() + eigene_gruppen,
            "muted": muted,
            "ruhe": pushruhe.ruhe_lesen(fuer_dieses.get("ruhe")),
            # Hat dieses Gerät eine eigene Einstellung, oder folgt es der
            # Person? Die App soll den Unterschied zeigen können - sonst
            # sieht «Ruhezeit aus» am iPad gleich aus, ob sie dort
            # abgeschaltet wurde oder überall.
            "geraet_eigen": eigen,
            # Meine angemeldeten Geräte - damit sich die Einstellung
            # überhaupt auf eines beziehen lässt.
            "geraete": [
                {
                    "token": geraet.token,
                    "label": geraet.label,
                    "eigen": pushgeraet.weicht_ab(meine, geraet.token),
                    "hier": geraet.token == token,
                }
                for geraet in hub.push.devices
                if geraet.user == user.name
            ],
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
        # Auch die Schlüssel aus Abläufen (automation:<id>) - ob es den
        # Ablauf noch gibt, prüft hier bewusst niemand: Ein pausierter
        # Ablauf soll seine Abbestellung behalten.
        gewaehlt = [key for key in body.muted if push.known(key)]
        if body.token:
            # Nur für dieses eine Gerät (Punkt 471). Die Abbestellungen
            # der Person bleiben, wie sie sind - ein Gerät weicht ab, es
            # ersetzt nicht.
            meines = any(
                geraet.token == body.token and geraet.user == user.name
                for geraet in hub.push.devices
            )
            if not meines:
                raise HTTPException(status_code=404, detail="Unbekanntes Gerät")
            neu = pushgeraet.setzen(
                _meine_zeile(user.name), body.token, {"muted": gewaehlt}
            )
            _zeile_schreiben(user.name, **{pushgeraet.FELD: neu.get(pushgeraet.FELD)})
            return {"ok": True, "token": body.token, "muted": sorted(gewaehlt)}
        stored = {
            entry["user"]: entry
            for entry in hub.data.get("push_prefs")
            if isinstance(entry, dict) and entry.get("user")
        }
        stored[user.name] = {**stored.get(user.name, {}), "user": user.name, "muted": gewaehlt}
        hub.data.set("push_prefs", list(stored.values()))
        hub.push_einstellungen_lesen()
        hub.push.muted = push.parse_muted(hub.data.get("push_prefs"))
        return {"ok": True, "muted": sorted(hub.push.muted.get(user.name, set()))}

    @app.delete("/api/push/categories/{token}")
    async def clear_device_categories(token: str, request: Request) -> dict[str, Any]:
        """Die eigenen Abbestellungen eines Geräts aufheben (Punkt 471).

        Danach folgt es wieder der Person - und die Abweichung
        verschwindet aus dem Speicher, statt eine zu behaupten, die keine
        mehr ist.
        """
        user = current_user(request)
        neu = pushgeraet.setzen(_meine_zeile(user.name), token, {"muted": None})
        _zeile_schreiben(user.name, **{pushgeraet.FELD: neu.get(pushgeraet.FELD)})
        return {"ok": True, "token": token}

    # ── Ruhezeit und Stillstellen (core/pushruhe.py) ───────────────────────
    #
    # Beides gilt je Person und beides endet von selbst - das ist der
    # Unterschied zum Abbestellen darüber. Was nie zurückgehalten wird
    # (Alarm, Wasser, Klingel, ein weinendes Kind), steht im Hub und
    # nicht in der App: Eine Ruhezeit, die den Wasseralarm verschluckt,
    # wäre ein Fehler, kein Komfort.

    @app.put("/api/push/ruhe")
    async def set_push_ruhe(
        body: PushRuhezeitRequest, request: Request
    ) -> dict[str, Any]:
        """Die eigene Nachtruhe setzen - für mich oder für ein Gerät.

        Mit ``token`` gilt sie nur für dieses eine Gerät (Punkt 471 der
        Werkbank): Das iPad liegt nachts im Wohnzimmer und darf klingeln,
        das Telefon liegt neben dem Bett. Ohne Token gilt sie wie bisher
        für alle Geräte der Person - das ist der Normalfall.
        """
        user = current_user(request)
        ruhe = {
            "enabled": bool(body.enabled),
            "from": int(body.von) % 24,
            "to": int(body.bis) % 24,
            "days": pushruhe.tage_lesen(body.tage),
        }
        if body.token:
            # Nur eigene Geräte: Sonst stellte man die Nachtruhe eines
            # anderen Telefons ein, und niemand fände den Grund.
            meines = any(
                geraet.token == body.token and geraet.user == user.name
                for geraet in hub.push.devices
            )
            if not meines:
                raise HTTPException(status_code=404, detail="Unbekanntes Gerät")
            zeile = _zeile_schreiben(
                user.name,
                **{
                    pushgeraet.FELD: pushgeraet.setzen(
                        _meine_zeile(user.name), body.token, {"ruhe": ruhe}
                    ).get(pushgeraet.FELD)
                },
            )
            return {
                "ok": True,
                "token": body.token,
                "ruhe": pushruhe.ruhe_lesen(
                    pushgeraet.fuer_geraet(zeile, body.token).get("ruhe")
                ),
            }
        zeile = _zeile_schreiben(user.name, ruhe=ruhe)
        return {"ok": True, "ruhe": pushruhe.ruhe_lesen(zeile.get("ruhe"))}

    @app.delete("/api/push/ruhe/{token}")
    async def clear_push_ruhe(token: str, request: Request) -> dict[str, Any]:
        """Die eigene Ruhezeit eines Geräts wieder aufheben (Punkt 471).

        Danach folgt das Gerät wieder der Person - und die Zeile im
        Speicher verschwindet, statt eine Abweichung zu behaupten, die
        keine mehr ist.
        """
        user = current_user(request)
        neu = pushgeraet.setzen(_meine_zeile(user.name), token, {"ruhe": None})
        _zeile_schreiben(user.name, **{pushgeraet.FELD: neu.get(pushgeraet.FELD)})
        return {"ok": True, "token": token}

    @app.post("/api/push/still")
    async def set_push_still(
        body: PushStillRequest, request: Request
    ) -> dict[str, Any]:
        """Eine Kategorie auf Zeit stillstellen - «heute nicht mehr».

        Der Unterschied zum Abbestellen ist der wichtigste Teil: Das
        hier läuft von selbst ab. Wer im September den Trockner
        abbestellt, merkt es im März nicht mehr.
        """
        user = current_user(request)
        if not push.known(body.category):
            raise HTTPException(status_code=404, detail="Unbekannte Kategorie")
        if not pushruhe.darf_zurueckgehalten(body.category):
            raise HTTPException(
                status_code=400,
                detail="Diese Meldung lässt sich nicht stillstellen.",
            )
        jetzt = time.time()
        stand = pushruhe.still_setzen(
            _meine_zeile(user.name).get("still"), body.category, body.stunden, jetzt
        )
        _zeile_schreiben(user.name, still=stand)
        return {"ok": True, "still_bis": stand.get(body.category)}

    @app.get("/api/push/verpasst")
    async def push_verpasst(request: Request) -> dict[str, Any]:
        """Was das Haus für mich zurückgehalten hat.

        Nicht dasselbe wie «zuletzt gemeldet»: Hier steht nur, was
        absichtlich nicht gebrummt hat - in der Nacht, während etwas
        stillgestellt war, über dem Tagesdeckel. Das ist die Liste, die
        man am Morgen durchgeht.
        """
        user = current_user(request)
        return {
            "verpasst": pushverlauf.verpasst(
                hub.data.get(pushverlauf.STORE_KEY), user.name
            )
        }

    # ── Batterie-Erinnerung (Punkt 258 der Werkbank) ───────────────────────

    @app.get("/api/push/battery")
    async def battery_prefs(request: Request) -> dict[str, Any]:
        """Zu welcher Stunde und ab welcher Schwelle der Hub erinnert."""
        current_user(request)
        return batterie.prefs_lesen(hub.data.get(batterie.PREFS_KEY))

    @app.put("/api/push/battery")
    async def set_battery_prefs(
        body: BatteryPrefsRequest, request: Request
    ) -> dict[str, Any]:
        """Stunde und Schwelle setzen - für den ganzen Haushalt.

        Global und nicht je Benutzer, wie die Wächter-Regeln darunter:
        Die Einstellung bestimmt, ob und wann der Hub überhaupt meldet.
        Wer die Batterien nur für sich nicht will, bestellt die Kategorie
        unter Benachrichtigungen ab. Die Klemmen (0-23, 1-50) sitzen in
        prefs_lesen, damit auch von Hand geschriebene Werte sie passieren.
        """
        require(request, Capability.EDIT_CONFIG)
        bisher = batterie.prefs_lesen(hub.data.get(batterie.PREFS_KEY))
        neu = batterie.prefs_lesen(
            {
                "hour": body.hour if body.hour is not None else bisher["hour"],
                "threshold": (
                    body.threshold
                    if body.threshold is not None
                    else bisher["threshold"]
                ),
            }
        )
        # Als Ein-Eintrag-Liste: `DataStore.set` nimmt nur Listen und
        # machte aus dem Dict eine Liste seiner Schlüssel - die Einstellung
        # kam nie an (siehe batterie.prefs_lesen).
        hub.data.set(batterie.PREFS_KEY, [neu])
        return {"ok": True, **neu}

    # ── Gutschein-Erinnerung (Punkt 264 der Werkbank) ──────────────────────

    @app.get("/api/push/vouchers")
    async def voucher_prefs(request: Request) -> dict[str, Any]:
        """Wie viele Tage vor dem Verfall der Hub erinnert - zweimal."""
        current_user(request)
        return gutscheine.prefs_lesen(hub.data.get(gutscheine.PREFS_KEY))

    @app.put("/api/push/vouchers")
    async def set_voucher_prefs(
        body: VoucherPrefsRequest, request: Request
    ) -> dict[str, Any]:
        """Die beiden Stufen setzen - für den ganzen Haushalt.

        Global und nicht je Benutzer, wie die Batterie-Erinnerung
        darüber: Die Einstellung bestimmt, wann der Hub überhaupt meldet.
        Wer die Gutscheine nur für sich nicht will, bestellt die Kategorie
        unter Benachrichtigungen ab. Die Klemmen (1-365, erste vor der
        zweiten) sitzen in prefs_lesen, damit auch von Hand geschriebene
        Werte sie passieren. Der Ablauftag selbst ist keine Einstellung -
        an dem wird immer erinnert.
        """
        require(request, Capability.EDIT_CONFIG)
        bisher = gutscheine.prefs_lesen(hub.data.get(gutscheine.PREFS_KEY))
        neu = gutscheine.prefs_lesen(
            {
                "first_days": (
                    body.first_days if body.first_days is not None else bisher["first_days"]
                ),
                "second_days": (
                    body.second_days
                    if body.second_days is not None
                    else bisher["second_days"]
                ),
            }
        )
        # Als Ein-Eintrag-Liste: siehe gutscheine.PREFS_KEY.
        hub.data.set(gutscheine.PREFS_KEY, [neu])
        return {"ok": True, **neu}

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

    # ── Die Storen der Wächter ─────────────────────────────────────────────
    #
    # Gehört zu den Regeln «Sturm und Hagel» und «Sommerhitze» und steht
    # in der App in deren Karten: Hier wird gewählt, welche Storen der
    # Sturmwächter fährt bzw. von welchen die Hitze-Empfehlung spricht.
    # Aus demselben Grund wie bei der Waschküchentüre nicht als Parameter
    # der Regel: Die sind Zahlen mit Grenzen, Geräte-Ids sind keine.

    @app.get("/api/coverguard")
    async def cover_guard(request: Request) -> dict[str, Any]:
        current_user(request)
        entities = hub.registry.all()
        rows = hub.data.get("cover_guard")
        return {
            "storm": storenwaechter.guard_auswahl(rows, "storm"),
            "heat": storenwaechter.guard_auswahl(rows, "heat"),
            # Alle Storen des Hauses - die App baut daraus die Chips,
            # ohne selbst durch die Entitäten zu gehen.
            "covers": [
                {"id": entity.id, "name": entity.label, "room": entity.room}
                for entity in entities
                if entity.kind == "cover"
            ],
        }

    @app.put("/api/coverguard")
    async def set_cover_guard(
        body: CoverGuardRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        rows = hub.data.get("cover_guard")
        stand = {
            "storm": storenwaechter.guard_auswahl(rows, "storm"),
            "heat": storenwaechter.guard_auswahl(rows, "heat"),
        }
        known = {entity.id for entity in hub.registry.all() if entity.kind == "cover"}
        for art, neu in (("storm", body.storm), ("heat", body.heat)):
            if neu is None:
                continue
            fremd = [eintrag for eintrag in neu if eintrag not in known]
            if fremd:
                raise HTTPException(
                    status_code=404,
                    detail=f"Diese Storen kennt der Hub nicht: {', '.join(fremd)}",
                )
            stand[art] = [str(eintrag) for eintrag in neu]
        hub.data.set(
            "cover_guard", [stand] if (stand["storm"] or stand["heat"]) else []
        )
        return await cover_guard(request)

    # ── Der Klingelton (gehört zur Regel «Es klingelt») ─────────────────────
    #
    # Wie bei der Waschküchentüre und den Storen darüber: kein Parameter der
    # Regel selbst (core/notifyrules.py kennt nur Zahlen mit Grenzen),
    # sondern eine eigene Wahl - hier gleich zwei, Ton und Boxen, darum eine
    # eigene Route statt eines einzelnen Feldes.

    def _klingelton_kandidaten() -> list[dict[str, Any]]:
        return [
            {"id": entity.id, "name": entity.label, "room": entity.room}
            for entity in hub.registry.all()
            if "play_url" in entity.commands
        ]

    @app.get("/api/push/doorbell-sound")
    async def doorbell_sound(request: Request) -> dict[str, Any]:
        current_user(request)
        stand = klingelton.einstellung_lesen(hub.data.get(klingelton.DATA_KEY))
        return {
            "sound": stand["sound"],
            "speakers": stand["speakers"],
            "sounds": [
                {"key": klang["key"], "label": klang["label"]}
                for klang in klingelton.KLAENGE
            ],
            "candidates": _klingelton_kandidaten(),
        }

    @app.put("/api/push/doorbell-sound")
    async def set_doorbell_sound(
        body: DoorbellSoundRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        bisher = klingelton.einstellung_lesen(hub.data.get(klingelton.DATA_KEY))
        sound = body.sound if body.sound is not None else bisher["sound"]
        if sound not in klingelton.BY_KEY:
            raise HTTPException(status_code=404, detail="Diesen Klingelton kennt der Hub nicht")
        if body.speakers is None:
            speakers = bisher["speakers"]
        else:
            bekannt = {kandidat["id"] for kandidat in _klingelton_kandidaten()}
            gewuenscht = [
                eintrag if isinstance(eintrag, str) else eintrag.model_dump(by_alias=True)
                for eintrag in body.speakers
            ]
            kennungen = [
                eintrag if isinstance(eintrag, str) else str(eintrag.get("id") or "")
                for eintrag in gewuenscht
            ]
            fremd = [kennung for kennung in kennungen if kennung not in bekannt]
            if fremd:
                raise HTTPException(
                    status_code=404,
                    detail=f"Diese Lautsprecher kennt der Hub nicht: {', '.join(fremd)}",
                )
            # Durch den Leser des Kerns und nicht roh gespeichert: Er
            # setzt die Vorgaben, klemmt die Lautstärke und macht aus
            # «7:5» eine «07:05». Was hier hineinkommt, ist damit auch
            # dann brauchbar, wenn eine ältere App nur Kennungen schickt.
            speakers = klingelton.einstellung_lesen(
                [{"sound": sound, "speakers": gewuenscht}]
            )["speakers"]
        hub.data.set(klingelton.DATA_KEY, [{"sound": sound, "speakers": speakers}])
        return await doorbell_sound(request)

    @app.get("/api/push/doorbell-sound/{key}.wav")
    async def doorbell_sound_wav(key: str, request: Request) -> Response:
        """Der Ton als Datei - zum Anhören auf dem Gerät in der Hand.

        Die Probe über ``/test`` spielt auf den *Boxen*: Sie beantwortet
        «wie klingt das im Haus», aber nicht «welchen nehme ich», denn
        dafür müsste man neben der Box stehen. Wer die Klänge
        durchprobiert, sitzt aber auf dem Sofa mit dem Telefon - also
        muss der Ton auch dorthin kommen.

        Das Token darf hier in der Adresse stehen: Audio- und
        Videoplayer schicken keine eigenen Kopfzeilen mit (dasselbe
        Muster wie bei den Aufnahmen, app/src/lib/aufnahmeurl.ts).
        ``token_from`` in api/server.py liest es aus der Abfrage.

        Gerechnet statt gespeichert - ein Ton sind ein paar Zehntel
        Sekunden Sinus aus Zahlen, das ist billiger als ein
        Zwischenspeicher, der altert. Trotzdem darf der Browser ihn
        behalten: Die Bytes zu einem Schlüssel ändern sich nur mit einer
        neuen Auslieferung, und wer sechzehn Klänge durchtippt, soll
        nicht sechzehnmal warten.
        """
        current_user(request)
        if key not in klingelton.BY_KEY:
            raise HTTPException(status_code=404, detail="Diesen Klingelton kennt der Hub nicht")
        return Response(
            content=klingelton.klang_wav(key),
            media_type="audio/wav",
            headers={"Cache-Control": "private, max-age=3600"},
        )

    @app.post("/api/push/doorbell-sound/test")
    async def test_doorbell_sound(
        body: DoorbellSoundTestRequest, request: Request
    ) -> dict[str, Any]:
        """Einen Ton anhören, bevor er gespeichert wird - auf den gerade
        gewählten Boxen, auch wenn sie noch nicht gespeichert sind."""
        current_user(request)
        if body.sound is not None and body.sound not in klingelton.BY_KEY:
            raise HTTPException(status_code=404, detail="Diesen Klingelton kennt der Hub nicht")
        gespielt = await hub.ton.klingelton_abspielen(
            sound=body.sound, speakers=body.speakers
        )
        if not gespielt:
            raise HTTPException(
                status_code=400, detail="Kein Lautsprecher gewählt oder erreichbar"
            )
        return {"ok": True, "sent": gespielt}

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

    @app.post("/api/push/quittieren")
    async def quittiere_push(
        body: PushQuittierenRequest, request: Request
    ) -> dict[str, Any]:
        """«Passt so» aus der Mitteilung heraus - für die offene Türe.

        Die steht oft absichtlich offen; quittieren heisst: Ruhe für
        diese Öffnung. Der Wächter meldet ohnehin einmal je Öffnung -
        auszutragen ist nur, was diese Person selbst mit «Später»
        zurückgelegt hat. Erst zu und wieder offen beginnt von vorn.
        """
        user = current_user(request)
        hub.data.set(
            spaeter.SCHLANGE,
            spaeter.austragen(hub.data.get(spaeter.SCHLANGE), body.title, user.name),
        )
        return {"ok": True}

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

    @app.post("/api/push/test/{category}")
    async def test_push_kategorie(category: str, request: Request) -> dict[str, Any]:
        """Genau diese Art Meldung ans eigene Telefon - mit allem, was dranhängt.

        Der allgemeine Test oben beantwortet «kommt überhaupt etwas
        an?». Diese Frage ist eine andere: Kommt *diese* Art durch -
        durch die eigene Abbestellung, durch die Ruhezeit, mit ihren
        Knöpfen und ihrer Dringlichkeit? Deshalb geht sie bewusst *mit*
        Kategorie raus und wird unterwegs von denselben Regeln behandelt
        wie im Ernstfall.

        Erkennbar bleibt sie trotzdem: «Probe:» steht vorn im Titel
        (core/pushbeispiel.py). Ohne das läuft jemand los, weil «Wasser
        gemeldet» auf dem Telefon steht.
        """
        user = current_user(request)
        if not push.known(category):
            raise HTTPException(status_code=404, detail="Unbekannte Kategorie")
        titel, text = pushbeispiel.als_meldung(category)
        tokens = hub.push.recipients(hub.users.users, user.name, category)
        result = await hub.push.send(
            tokens,
            title=titel,
            body=text,
            data={"ziel": pushziel.ziel_fuer(category)} if pushziel.ziel_fuer(category) else None,
            category=category,
        )
        # Der ehrlichste Teil der Antwort: Warum nichts kam. «0
        # zugestellt» allein sähe aus wie ein kaputter Push-Dienst,
        # während in Wahrheit die eigene Ruhezeit läuft.
        warum = result.zurueckgehalten
        if not tokens and warum is None:
            warum = (
                "abbestellt"
                if category in hub.push.muted.get(user.name, set())
                else "kein Gerät angemeldet"
            )
        return {
            "ok": not result.errors and warum is None,
            "sent": result.accepted,
            "errors": list(result.errors),
            "warum": warum,
            "titel": titel,
            "text": text,
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
            # Eine generische Karte (Timer, Gerät, Fernseher, …): Das
            # Token gehört zur laufenden Zeile in live_cards.
            rows = hub.data.get(livekarten.KARTEN_KEY)
            if livekarten.hat_karte(rows, user.name, body.art):
                hub.data.set(
                    livekarten.KARTEN_KEY,
                    livekarten.token_merken(rows, user.name, body.art, body.token),
                )
            else:
                # Laut Hub läuft zu dieser Art keine Karte mehr - dann
                # gehört die, deren Token hier ankommt, beendet: Sie ist
                # die liegen gebliebene vom letzten Mal (der Fernseher
                # ging aus, bevor die App ihr Token melden konnte, und
                # ohne Token ging ihr Ende ins Leere). Der Takt räumt
                # sie im nächsten Umlauf ab - dasselbe Muster wie bei
                # der Türkarte darunter.
                hub.data.set(
                    livekarten.VERWAIST_KEY,
                    livekarten.verwaist_merken(
                        hub.data.get(livekarten.VERWAIST_KEY), user.name, body.token
                    ),
                )
        else:
            rows = hub.data.get(liveaktivitaet.DATA_KEY)
            if liveaktivitaet.karte_laeuft(rows, user.name):
                hub.data.set(
                    liveaktivitaet.DATA_KEY,
                    liveaktivitaet.aktivitaet_merken(rows, user.name, body.token),
                )
            else:
                # Laut Hub liegt gerade keine Karte - dann gehört die,
                # deren Token hier ankommt, beendet. Das ist die liegen
                # gebliebene vom letzten Mal: Ihr Ende wurde übersprungen,
                # weil das Token damals fehlte, und die nächste Fahrt
                # legte eine zweite Karte darüber (core/liveaktivitaet.py,
                # VERWAIST_KEY). Der Takt räumt sie im nächsten Umlauf ab.
                hub.data.set(
                    liveaktivitaet.VERWAIST_KEY,
                    liveaktivitaet.verwaist_merken(
                        hub.data.get(liveaktivitaet.VERWAIST_KEY),
                        user.name,
                        body.token,
                    ),
                )
        return {"ok": True}

