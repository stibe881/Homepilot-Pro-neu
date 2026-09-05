"""Rund ums Haus: Gute Nacht, Durchsagen, Küchen-Timer, Gäste-WLAN, Lautsprecher.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import logging
import secrets
import time
from pathlib import Path
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
)

from ... import qr as qr_module
from ...core import goodnight as goodnight_module
from ...core import (
    rueckgriff,
    say,
    sprachnotiz,
    wlanschein,
)
from ...core import (
    throttle as throttle_module,
)
from ...core.config_edit import add_cast_device
from ...core.errors import HomePilotError
from ...core.source import as_source, user_source
from ...core.users import Capability
from .. import configio
from ..context import ApiContext
from ..models import (
    BroadcastRequest,
    GoodNightRequest,
    SpeakerRequest,
    TimerRequest,
    UndoRecordRequest,
    VoucherRequest,
)

log = logging.getLogger(__name__)


def _lautstaerke(roh: str | None) -> int | None:
    """Die Lautstärke aus der Adresse - oder nichts (rein, testbar).

    Unsinn wird zu ``None`` statt zu einem Fehler: Dann gilt die feste
    Durchsage-Lautstärke, und das ist eine bessere Antwort als eine
    abgewiesene Sprachnotiz.
    """
    try:
        return max(0, min(100, int(str(roh))))
    except (TypeError, ValueError):
        return None

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    require = ctx.require
    throttle = ctx.throttle

    def config_path() -> str:
        return configio.config_path(hub)

    def save_config(content: str) -> dict[str, Any]:
        return configio.save_config(hub, content)

    # ── Grosse Griffe zurücknehmen ─────────────────────────────────────────

    # Der Rückweg wohnt jetzt in core/rueckgriff.py: Seit der
    # Babysitter-Modus das Empfangslicht übernommen hat, braucht ihn auch
    # eine Route in einer anderen Datei.
    def rueckweg_ablegen(
        titel: str, entity_ids: list[str], command: str, wer: str
    ) -> dict[str, Any] | None:
        return rueckgriff.ablegen(hub, titel, entity_ids, command, wer)

    @app.post("/api/undo")
    async def record_undo(body: UndoRecordRequest, request: Request) -> dict[str, Any]:
        """«Alles aus» meldet an, was es gleich tun wird.

        Warum der Hub aufnimmt, aber nicht schaltet: Die Befehle selbst
        gehen weiter denselben Weg wie jeder Tastendruck in der App -
        über die Verbindung, durch die Sperre, mit der Rückfrage beim
        Wandpaneel. Eine eigene «alles aus»-Route würde all das umgehen,
        nur damit der Rückweg an einer Stelle entsteht.
        """
        user = require(request, Capability.CONTROL)
        return {
            "undo": rueckweg_ablegen(
                body.title, body.entity_ids, body.command, user.name
            )
        }

    @app.post("/api/undo/{bundle_id}/run")
    async def run_undo(bundle_id: str, request: Request) -> dict[str, Any]:
        """Den aufgenommenen Rückweg gehen.

        Er wird dabei verbraucht: Ein zweites «Rückgängig» stellte den
        Stand von vor dem Griff ein zweites Mal her - über allem, was
        seither von Hand geschaltet wurde.
        """
        user = require(request, Capability.CONTROL)
        rows = hub.data.get(rueckgriff.SCHLANGE)
        eintrag = rueckgriff.holen(rows, bundle_id, time.time())
        if eintrag is None:
            raise HTTPException(
                status_code=404,
                detail="Das lässt sich nicht mehr zurücknehmen.",
            )
        hub.data.set(rueckgriff.SCHLANGE, rueckgriff.entfernen(rows, bundle_id))
        namen = {entity.id: entity.label for entity in hub.registry.all()}
        zurueck: list[str] = []
        fehler: list[str] = []
        with as_source(user_source(user.name)):
            for befehl in eintrag.get("commands") or []:
                entity_id = str(befehl.get("entity_id") or "")
                try:
                    await hub.integrations.dispatch_command(
                        entity_id,
                        str(befehl.get("command") or ""),
                        befehl.get("data") or {},
                    )
                    zurueck.append(namen.get(entity_id, entity_id))
                except Exception:
                    # Ein Gerät, das inzwischen offline ist, soll die
                    # anderen neunzehn nicht aufhalten.
                    log.debug("Rückweg: %s nicht schaltbar", entity_id, exc_info=True)
                    fehler.append(namen.get(entity_id, entity_id))
        return {"ok": not fehler, "restored": zurueck, "failed": fehler}


    # ── Gute Nacht ─────────────────────────────────────────────────────────

    def goodnight_settings() -> dict[str, Any]:
        for entry in hub.data.get("goodnight"):
            if isinstance(entry, dict):
                return {
                    "night_lights": [str(x) for x in entry.get("night_lights") or []],
                    "arm_alarm": bool(entry.get("arm_alarm")),
                }
        return {"night_lights": [], "arm_alarm": False}

    @app.get("/api/goodnight")
    async def get_goodnight(request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        return goodnight_settings()

    @app.put("/api/goodnight")
    async def set_goodnight(body: GoodNightRequest, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        known = {entity.id for entity in hub.registry.all()}
        hub.data.set(
            "goodnight",
            [
                {
                    "night_lights": [x for x in body.night_lights if x in known],
                    "arm_alarm": body.arm_alarm,
                }
            ],
        )
        return goodnight_settings()

    @app.post("/api/goodnight/run")
    async def run_goodnight(request: Request) -> dict[str, Any]:
        """Der letzte Gang durchs Haus: Lichter aus, Bericht, ggf. Alarm.

        Türen werden gemeldet, nie abgeschlossen - eine Tür, die sich von
        selbst verriegelt, sperrt irgendwann jemanden aus.
        """
        user = require(request, Capability.CONTROL)
        settings = goodnight_settings()
        entities = hub.registry.all()

        aus = list(
            goodnight_module.lights_to_off(entities, settings["night_lights"])
        )
        # Vor dem Schalten: Danach ist nicht mehr abzulesen, welches Licht
        # wie hell brannte. Die Alarmanlage bleibt aussen vor - sie steht
        # in szenenrueckweg.OHNE_RUECKWEG, und das aus gutem Grund.
        rueckweg = rueckweg_ablegen(
            "Gute Nacht", [entity.id for entity in aus], "turn_off", user.name
        )

        turned_off: list[str] = []
        with as_source(user_source(user.name)):
            for entity in aus:
                try:
                    await hub.integrations.dispatch_command(entity.id, "turn_off")
                    turned_off.append(entity.label)
                except Exception:
                    log.debug("Gute Nacht: %s nicht schaltbar", entity.id, exc_info=True)

        alarm_result: str | None = None
        alarm_error: str | None = None
        if settings["arm_alarm"]:
            anlage = next((e for e in entities if e.kind == "alarm"), None)
            if anlage is None:
                alarm_error = "Keine Alarmanlage eingerichtet."
            else:
                try:
                    with as_source(user_source(user.name)):
                        await hub.integrations.dispatch_command(anlage.id, "arm_night")
                    alarm_result = "nacht"
                except HomePilotError as err:
                    # Meist: ein bewachtes Fenster steht offen. Der Text
                    # der Anlage sagt, welches.
                    alarm_error = str(err)

        return {
            "lights_off": turned_off,
            "kept_on": [
                entity.label
                for entity in entities
                if entity.id in set(settings["night_lights"])
                and str(entity.state.get("state")) == "on"
            ],
            "open": [e.label for e in goodnight_module.open_windows(entities)],
            "unlocked": [e.label for e in goodnight_module.unlocked_locks(entities)],
            "alarm": alarm_result,
            "alarm_error": alarm_error,
            # Damit der Bericht einen Weg zurück anbieten kann: Wer beim
            # Lesen merkt, dass im Büro noch jemand sitzt, soll nicht
            # zwanzig Kacheln wiederfinden müssen.
            "undo": rueckweg,
        }

    # ── Durchsage ──────────────────────────────────────────────────────────

    @app.post("/api/broadcast")
    async def broadcast(body: BroadcastRequest, request: Request) -> dict[str, Any]:
        """«Essen ist fertig» auf die Cast-Boxen im Haus.

        Der Hub macht aus dem Text eine MP3 (gTTS) und lässt sie die
        Boxen abspielen. Die Ton-Adresse wird aus der Anfrage abgeleitet:
        Dieselbe Adresse, unter der die App den Hub erreicht, erreichen
        im Normalfall auch die Lautsprecher.
        """
        user = require(request, Capability.CONTROL)
        # Die Adresse merken - Abläufe brauchen sie für ihre Durchsagen.
        say.remember_base(hub, str(request.base_url))
        try:
            return await say.speak(
                hub,
                body.text,
                speakers=body.speakers or None,
                volume=body.volume,
                base=str(request.base_url),
                source=user_source(user.name),
            )
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.get("/api/broadcast/{token}.mp3")
    async def broadcast_audio(token: str) -> Response:
        """Die Durchsage-MP3 - bewusst ohne Anmeldung, wie das Push-Bild.

        Die Boxen können keinen Token mitschicken. Vertretbar aus denselben
        Gründen: 32 zufällige Bytes als Kennung, wenige Minuten gültig,
        nur im Arbeitsspeicher, dahinter eine einzelne Tondatei.
        """
        audio = hub.snapshots.get(token)
        if audio is None:
            raise HTTPException(status_code=404, detail="Keine Durchsage")
        return Response(
            content=audio,
            # Piper liefert WAV, gTTS MP3, eine Sprachnotiz WebM oder was
            # der Browser sonst aufnimmt - die Boxen wollen den ehrlichen
            # Typ, sonst raten sie (core/sprachnotiz.py).
            media_type=sprachnotiz.medientyp(audio),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/broadcast/voice")
    async def broadcast_voice(request: Request) -> dict[str, Any]:
        """Eine selbst gesprochene Notiz auf die Boxen.

        Der Rumpf ist die Aufnahme selbst, roh - kein JSON, kein Base64:
        Eine Minute Ton wird als Base64 um ein Drittel grösser, und der
        Umweg brächte nichts, was ein Content-Type nicht auch sagt.
        Empfänger und Lautstärke stehen darum in der Adresse.

        Warum es die Aufnahme nur im Browser gibt und nicht in der
        nativen App: core/sprachnotiz.py.
        """
        user = require(request, Capability.CONTROL)
        say.remember_base(hub, str(request.base_url))
        audio = await request.body()
        try:
            sprachnotiz.pruefen(audio)
            return await say.play_audio(
                hub,
                audio,
                str(request.base_url).rstrip("/"),
                speakers=[
                    teil
                    for teil in request.query_params.get("speakers", "").split(",")
                    if teil
                ]
                or None,
                volume=_lautstaerke(request.query_params.get("volume")),
                source=user_source(user.name),
            )
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    # ── Küchen-Timer ───────────────────────────────────────────────────────

    @app.get("/api/timers")
    async def list_timers(request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        return {"timers": hub.timers.list()}

    @app.post("/api/timers")
    async def start_timer(body: TimerRequest, request: Request) -> dict[str, Any]:
        """Der Eierwecker, den man nie suchen muss: Nach Ablauf kommt eine
        Push an alle und - wo Boxen stehen - eine Durchsage."""
        user = require(request, Capability.CONTROL)
        say.remember_base(hub, str(request.base_url))
        try:
            entry = hub.timers.start(body.minutes, body.text, by=user.name)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        return {"ok": True, "timer": entry, "timers": hub.timers.list()}

    @app.delete("/api/timers/{timer_id}")
    async def cancel_timer(timer_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        if not hub.timers.cancel(timer_id):
            raise HTTPException(status_code=404, detail="Diesen Timer gibt es nicht (mehr).")
        return {"ok": True, "timers": hub.timers.list()}

    # ── Gäste-WLAN ─────────────────────────────────────────────────────────

    @app.get("/api/wifi")
    async def guest_wifi(request: Request) -> dict[str, Any]:
        """Der Gäste-WLAN-Zugang als QR-Inhalt - für die Benutzerverwaltung.

        Kommt aus der config.yaml (guest_wifi) und ist bewusst für alle
        Angemeldeten sichtbar: Wer das WLAN zeigt, zeigt es einem Gast.
        """
        require(request, Capability.CONTROL)
        wifi = hub.config.guest_wifi or {}
        ssid = str(wifi.get("ssid") or "")
        password = str(wifi.get("password") or "")
        # Captive Portal (z.B. UniFi-Hotspot): Das Netz ist offen, der QR
        # verbindet nur - das Portal-Passwort steht als Text daneben.
        portal = str(wifi.get("portal_password") or "")
        open_network = str(wifi.get("auth") or "").lower() in ("open", "nopass") or (
            not password and bool(portal)
        )
        if not ssid or (not password and not open_network):
            raise HTTPException(
                status_code=404,
                detail="Kein Gäste-WLAN hinterlegt (guest_wifi in der config.yaml).",
            )
        return {
            "ssid": ssid,
            "password": password,
            "portal_password": portal,
            "open": open_network,
            "payload": qr_module.wifi_payload(
                ssid,
                password,
                bool(wifi.get("hidden")),
                open_network=open_network,
            ),
        }

    def unifi_service():
        """Die UniFi-Anbindung - oder ein lesbares 404."""
        service = hub.integrations.get("unifi")
        if service is None or not hasattr(service, "list_vouchers"):
            raise HTTPException(
                status_code=404,
                detail="Voucher brauchen die UniFi-Anbindung (integration: unifi).",
            )
        return service

    @app.get("/api/wifi/vouchers")
    async def list_wifi_vouchers(request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        try:
            return {"vouchers": await unifi_service().list_vouchers()}
        except HTTPException:
            raise
        except Exception as err:
            raise HTTPException(
                status_code=502, detail=f"UniFi-Controller: {err}"
            ) from err

    @app.post("/api/wifi/vouchers")
    async def create_wifi_voucher(body: VoucherRequest, request: Request) -> dict[str, Any]:
        """Einen Einmal-Gutschein fürs Captive Portal ausstellen.

        Aus der App statt aus dem Controller: Besuch bekommt Tür, WLAN und
        Gutschein aus derselben Karte. Einmal-Codes, damit ein
        weitergereichter Zettel nicht zur Dauerkarte wird.
        """
        user = require(request, Capability.CONTROL)
        hours = max(0.5, min(24 * 30, float(body.hours)))
        try:
            voucher = await unifi_service().create_voucher(
                round(hours * 60), note=body.note.strip() or f"Gast ({user.name})"
            )
        except HTTPException:
            raise
        except Exception as err:
            raise HTTPException(
                status_code=502, detail=f"UniFi-Controller: {err}"
            ) from err
        return {"ok": True, "voucher": voucher}

    # ── Der Aufkleber: Gutschein ziehen ohne Konto ─────────────────────────
    #
    # Bis hierher konnte einen Gutschein nur ziehen, wer selbst ein Konto
    # hat - der Gast stand daneben und wartete, bis ihm jemand einen Code
    # vorlas. Jetzt hängt im Flur ein QR-Code; wer ihn scannt, bekommt
    # seinen eigenen. Warum der Aufkleber nur die Adresse trägt und nicht
    # den Code, steht in core/wlanschein.py.

    def sticker_token() -> str:
        """Das Geheimnis im Aufkleber - beim ersten Blick angelegt.

        Nicht in der config.yaml: Es wird gewechselt, wenn ein Aufkleber
        aus dem Verkehr soll, und dafür soll niemand eine Datei
        bearbeiten müssen.
        """
        for entry in hub.data.get("wifi_sticker"):
            if isinstance(entry, dict) and entry.get("token"):
                return str(entry["token"])
        token = wlanschein.token_neu()
        hub.data.set("wifi_sticker", [{"token": token, "created": time.time()}])
        return token

    def sticker_basis() -> str:
        """Wohin der Aufkleber zeigt.

        Die öffentliche Adresse und nicht die im Haus: Der Gast scannt,
        bevor er im WLAN ist - er hängt am Mobilfunk und käme an eine
        192.168er-Adresse gar nicht heran. Fehlt sie, bleibt die
        Hausadresse als Notnagel; sie taugt für das Wandpanel und für
        einen Gast, der schon im Netz ist.
        """
        aussen = str((hub.config.push or {}).get("public_url") or "").strip()
        if aussen:
            return aussen
        return f"http://{qr_module.local_ip()}:{hub.config.api.port}"

    @app.get("/api/wifi/sticker")
    async def wifi_sticker(request: Request) -> dict[str, Any]:
        """Was auf den Aufkleber gehört - und ob er funktionieren kann."""
        require(request, Capability.CONTROL)
        token = sticker_token()
        aussen = bool(str((hub.config.push or {}).get("public_url") or "").strip())
        unifi = hub.integrations.get("unifi")
        jetzt = time.time()
        gueltig, _ = wlanschein.aufteilen(hub.data.get("wifi_vouchers"), jetzt)
        return {
            "url": wlanschein.sticker_url(sticker_basis(), token),
            # Ohne öffentliche Adresse zeigt der Aufkleber ins Hausnetz -
            # das muss dranstehen, sonst hängt er im Flur und tut nichts.
            "public": aussen,
            "unifi": unifi is not None and hasattr(unifi, "create_voucher"),
            "hours": wlanschein.GUELTIG_STUNDEN,
            "open": [
                {**eintrag, "left": wlanschein.restsatz(eintrag, jetzt)}
                for eintrag in gueltig
            ],
        }

    @app.post("/api/wifi/sticker/rotate")
    async def rotate_wifi_sticker(request: Request) -> dict[str, Any]:
        """Einen neuen Aufkleber - der alte gilt ab sofort nicht mehr.

        EDIT_CONFIG und nicht CONTROL: Wer das drückt, macht jeden
        ausgedruckten Aufkleber im Haus ungültig.
        """
        require(request, Capability.EDIT_CONFIG)
        hub.data.set(
            "wifi_sticker", [{"token": wlanschein.token_neu(), "created": time.time()}]
        )
        return await wifi_sticker(request)

    def _gastseite(inhalt: str, status: int = 200) -> Response:
        return Response(
            content=inhalt, status_code=status, media_type="text/html; charset=utf-8"
        )

    def _wlan_daten() -> tuple[str, str | None]:
        """SSID und der QR zum Verbinden - beides darf fehlen."""
        wifi = hub.config.guest_wifi or {}
        ssid = str(wifi.get("ssid") or "")
        if not ssid:
            return "", None
        password = str(wifi.get("password") or "")
        offen = str(wifi.get("auth") or "").lower() in ("open", "nopass") or (
            not password and bool(wifi.get("portal_password"))
        )
        return ssid, wlanschein.wlanbild(
            qr_module.wifi_payload(
                ssid, password, bool(wifi.get("hidden")), open_network=offen
            )
        )

    def _sticker_pruefen(token: str, request: Request) -> Response | None:
        """Bremse und Token - oder eine Seite, die sagt, was los ist."""
        adresse = throttle_module.client_address(request)
        if throttle.blocked_for(adresse) > 0:
            return _gastseite(
                wlanschein.fehlerseite(
                    "Zu viele Versuche.", "Bitte in ein paar Minuten nochmal."
                ),
                status=429,
            )
        if not secrets.compare_digest(token, sticker_token()):
            # Derselbe Satz wie bei einem abgelaufenen Aufkleber: Wer
            # Adressen durchprobiert, soll aus der Antwort nichts lernen.
            throttle.failed(adresse)
            return _gastseite(
                wlanschein.fehlerseite(
                    "Dieser Code gilt nicht mehr.",
                    "Frag im Haus nach dem aktuellen Aufkleber.",
                ),
                status=410,
            )
        return None

    @app.get("/gast/wlan/{token}")
    async def wlan_frage(token: str, request: Request) -> Response:
        """Die Seite *zeigen* - und ausdrücklich noch nichts ziehen.

        Dieselbe Falle wie beim Einmal-Link zur Türe (routes/passes.py):
        Wer eine Adresse teilt oder scannt, dessen Vorschau bauen
        Messenger, Mailserver und Virenscanner mit einem ganz normalen
        GET. Ein GET, der zieht, verbrennt Gutscheine, bevor ein Mensch
        die Seite gesehen hat.
        """
        fehler = _sticker_pruefen(token, request)
        if fehler is not None:
            return fehler
        ssid, _ = _wlan_daten()
        return _gastseite(wlanschein.frageseite(ssid))

    @app.post("/gast/wlan/{token}")
    async def wlan_ziehen(token: str, request: Request) -> Response:
        """Einen frischen Gutschein ziehen - ohne Anmeldung, einmal gültig."""
        fehler = _sticker_pruefen(token, request)
        if fehler is not None:
            return fehler
        adresse = throttle_module.client_address(request)

        unifi = hub.integrations.get("unifi")
        if unifi is None or not hasattr(unifi, "create_voucher"):
            return _gastseite(
                wlanschein.fehlerseite(
                    "Gerade nicht möglich.",
                    "Der Hub kann im Moment keine Gutscheine ausstellen. "
                    "Frag kurz im Haus nach.",
                ),
                status=503,
            )

        jetzt = time.time()
        buch = hub.data.get("wifi_vouchers")
        if wlanschein.zu_viele(buch, jetzt):
            # Nicht dem Gast anlasten: Er hat nichts falsch gemacht, und
            # der Satz soll ihn zu jemandem schicken, der helfen kann.
            log.warning(
                "Gäste-WLAN: %s offene Gutscheine - weiterer Versuch von %s abgewiesen",
                wlanschein.HOECHSTENS_OFFEN,
                adresse,
            )
            return _gastseite(
                wlanschein.fehlerseite(
                    "Gerade nicht möglich.",
                    "Es sind schon sehr viele Codes offen. Frag kurz im Haus nach.",
                ),
                status=429,
            )

        try:
            voucher = await unifi.create_voucher(
                wlanschein.GUELTIG_STUNDEN * 60, note="Gast (Aufkleber)"
            )
        except Exception as err:
            log.warning("Gäste-WLAN: Gutschein nicht ausgestellt: %s", err)
            return _gastseite(
                wlanschein.fehlerseite(
                    "Gerade nicht möglich.",
                    "Der WLAN-Controller antwortet nicht. Frag kurz im Haus nach.",
                ),
                status=502,
            )

        eintrag = wlanschein.eintragen(buch, voucher, jetzt, adresse)
        hub.data.set("wifi_vouchers", eintrag)
        throttle.succeeded(adresse)
        log.warning("Gäste-WLAN: Gutschein gezogen von %s", adresse)
        ssid, bild = _wlan_daten()
        return _gastseite(
            wlanschein.codeseite(
                str(voucher.get("code") or ""),
                wlanschein.restsatz(eintrag[0], jetzt),
                ssid,
                bild,
            )
        )

    @app.delete("/api/wifi/vouchers/{voucher_id}")
    async def delete_wifi_voucher(voucher_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.CONTROL)
        try:
            await unifi_service().delete_voucher(voucher_id)
        except HTTPException:
            raise
        except Exception as err:
            raise HTTPException(
                status_code=502, detail=f"UniFi-Controller: {err}"
            ) from err
        return {"ok": True}

    # ── Lautsprecher ───────────────────────────────────────────────────────

    @app.get("/api/speakers")
    async def list_speakers(request: Request) -> dict[str, Any]:
        """Boxen und Gruppen im Netz, plus was der Hub schon eingebunden hat.

        Wichtig zur Einordnung: Synchron spielen mehrere Boxen nur als echte
        Google-Lautsprechergruppe. Die entsteht einmalig in der Google-Home-App
        und meldet sich danach im Netz als ein einzelnes Cast-Gerät – der Hub
        kann sie benutzen, aber nicht selbst herstellen. Selbst an mehrere
        Boxen zu senden ergäbe hörbaren Versatz.
        """
        require(request, Capability.EDIT_CONFIG)
        cast = hub.integrations.get("google_cast")
        found: list[dict[str, Any]] = []
        if cast is not None and hasattr(cast, "discover"):
            try:
                found = await cast.discover()
            except Exception as err:
                log.warning("Cast-Suche fehlgeschlagen: %s", err)

        configured = {
            entity.name: entity
            for entity in hub.registry.all()
            if entity.kind == "media_player"
        }
        for entry in found:
            entity = configured.get(entry["name"])
            entry["entity_id"] = entity.id if entity is not None else None
            # Der in der App vergebene Name, falls er vom Netz-Namen
            # abweicht - die Lautsprecher-Seite zeigt ihn daneben und
            # bietet dort das Umbenennen an.
            entry["app_name"] = (
                entity.label
                if entity is not None and entity.label != entry["name"]
                else None
            )
        return {
            "speakers": found,
            # Boxen, die der Hub kennt, aber die Suche nicht gefunden hat –
            # etwa in einem anderen Netzsegment.
            "configured": sorted(configured),
        }

    @app.post("/api/speakers/adopt")
    async def adopt_speaker(body: SpeakerRequest, request: Request) -> dict[str, Any]:
        """Eine gefundene Box oder Gruppe in die config.yaml eintragen.

        Ergänzt genau zwei Zeilen im google_cast-Block; Kommentare und
        Reihenfolge der Datei bleiben, wie sie waren. Geprüft wird das
        Ergebnis wie jede Änderung über den Editor – eine kaputte
        config.yaml darf nie auf der Platte landen.
        """
        require(request, Capability.EDIT_CONFIG)
        path = Path(config_path())
        try:
            content = path.read_text(encoding="utf-8")
        except OSError as err:
            raise HTTPException(
                status_code=500, detail=f"Konfiguration nicht lesbar: {err}"
            ) from err
        updated = add_cast_device(content, body.name, body.host, body.port)
        if updated == content:
            # Schon eingetragen: kein Fehler, aber auch kein Neustart nötig.
            return {"ok": True, "restart_required": False, "already": True}
        result = save_config(updated)
        return {**result, "already": False}

    @app.get("/api/speakers/members")
    async def speaker_members(
        host: str, request: Request, port: int = 8009
    ) -> dict[str, Any]:
        """Mitglieder einer Google-Lautsprechergruppe."""
        require(request, Capability.EDIT_CONFIG)
        cast = hub.integrations.get("google_cast")
        if cast is None or not hasattr(cast, "group_members"):
            raise HTTPException(status_code=503, detail="Cast-Integration nicht geladen")
        return {"members": await cast.group_members(host, port)}

