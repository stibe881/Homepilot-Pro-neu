"""Rund ums Haus: Gute Nacht, Durchsagen, Küchen-Timer, Gäste-WLAN, Lautsprecher.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import logging
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
    say,
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
    VoucherRequest,
)

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    require = ctx.require

    def config_path() -> str:
        return configio.config_path(hub)

    def save_config(content: str) -> dict[str, Any]:
        return configio.save_config(hub, content)

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

        turned_off: list[str] = []
        with as_source(user_source(user.name)):
            for entity in goodnight_module.lights_to_off(
                entities, settings["night_lights"]
            ):
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
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )

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
            entity.name: entity.id
            for entity in hub.registry.all()
            if entity.kind == "media_player"
        }
        for entry in found:
            entry["entity_id"] = configured.get(entry["name"])
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

