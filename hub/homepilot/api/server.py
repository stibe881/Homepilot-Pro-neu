"""REST- und WebSocket-API für die App.

Jeder Zugriff läuft über ein Benutzer-Token: Es bestimmt die Rolle und
damit, was jemand sehen und tun darf. Gäste bekommen bereits im Snapshot
und in den Live-Ereignissen nur die Geräte zu sehen, die für sie
freigegeben sind – filtern erst in der App wäre keine Einschränkung.

WebSocket-Protokoll (/ws):
  Server → Client:
    {"type": "snapshot", "entities": [...], "user": {...}, "rooms": [...]}
    {"type": "state_changed", "entity": {...}, "source": {...}, ...}
    {"type": "entity_added" | "entity_removed", ...}
    {"type": "result", "ok": false, "error": "...", "entity_id": "..."}
    {"type": "pong"}
  Client → Server:
    {"type": "ping"}
    {"type": "command", "entity_id": "...", "command": "...", "data": {...}}
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ..core.config import ConfigError, load_config
from ..core.errors import HomePilotError, UnknownEntityError, UnsupportedCommandError
from ..core.hub import Hub
from ..core.source import as_source, user_source
from ..core.streams import (
    SEGMENT_NAME,
    StreamError,
    rewrite_playlist,
    strip_low_latency,
)
from ..core.users import GUEST_FEATURES, Capability, Role, User, parse_users

log = logging.getLogger(__name__)


def _exit_for_restart() -> None:
    """Prozess hart beenden – der Prozessmanager (Docker, systemd) startet
    neu. In Tests wird diese Funktion ersetzt."""
    os._exit(0)


class CommandRequest(BaseModel):
    command: str
    data: dict[str, Any] = {}


class PauseRequest(BaseModel):
    seconds: float = 7200


class PushRegistration(BaseModel):
    token: str
    label: str = ""


class AutomationRequest(BaseModel):
    alias: str
    trigger: list[dict[str, Any]] = []
    condition: list[dict[str, Any]] = []
    action: list[dict[str, Any]] = []
    enabled: bool = True


class SceneRequest(BaseModel):
    name: str
    icon: str = "sparkles-outline"
    actions: list[dict[str, Any]] = []
    room: str | None = None
    # Auf der Startseite als Schnellaktion anzeigen.
    on_start: bool = False


class UserRequest(BaseModel):
    name: str
    role: str = Role.RESIDENT
    token: str | None = None
    allow: list[str] = []
    # Freigegebene Bereiche für Gäste (Schlüssel aus GUEST_FEATURES).
    features: list[str] = []


class UserUpdateRequest(BaseModel):
    enabled: bool | None = None
    features: list[str] | None = None


class ConfigRequest(BaseModel):
    content: str


class RoomRequest(BaseModel):
    room: str | None = None


def create_app(hub: Hub) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await hub.start()
        yield
        await hub.stop()

    app = FastAPI(title="HomePilot", lifespan=lifespan)

    # Ohne das blockiert der Browser jeden REST-Aufruf der Web-Fassung der
    # App, weil sie unter einer anderen Adresse läuft als der Hub. Die App
    # authentifiziert sich per Bearer-Token und nicht über Cookies – deshalb
    # bringt eine fremde Seite hier nichts zustande, auch wenn sie darf.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=hub.config.api.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Authentifizierung ──────────────────────────────────────────────────

    def token_from(request: Request) -> str | None:
        header = request.headers.get("authorization", "")
        if header:
            return header.removeprefix("Bearer ").strip()
        return request.query_params.get("token")

    def current_user(request: Request) -> User:
        user = hub.users.by_token(token_from(request))
        if user is None:
            raise HTTPException(status_code=401, detail="Ungültiges Token")
        return user

    def require(request: Request, capability: str) -> User:
        user = current_user(request)
        if not user.can(capability):
            raise HTTPException(
                status_code=403,
                detail=f"Rolle '{user.role}' darf das nicht",
            )
        return user

    def user_payload(user: User) -> dict[str, Any]:
        """Benutzer samt Berechtigungen – die App richtet ihre Navigation danach."""
        return {
            **user.as_dict(),
            "capabilities": sorted(
                capability
                for capability in vars(Capability).values()
                if isinstance(capability, str)
                and not capability.startswith("_")
                and user.can(capability)
            ),
        }

    def visible(user: User, entities) -> list[dict[str, Any]]:
        return [
            entity.as_dict()
            for entity in entities
            if user.may_see(entity.id, entity.kind, entity.integration)
        ]

    # ── Allgemeines ────────────────────────────────────────────────────────

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "entities": len(hub.registry.all())}

    @app.get("/api/me")
    async def me(request: Request) -> dict[str, Any]:
        """Wer bin ich und was darf ich – die App richtet ihre Ansicht danach."""
        return user_payload(current_user(request))

    @app.get("/api/system/status")
    async def system_status(request: Request) -> dict[str, Any]:
        require(request, Capability.VIEW_SYSTEM)
        return hub.status()

    # ── Konfiguration aus der App bearbeiten ──────────────────────────────

    def config_path() -> str:
        path = hub.config.source_path
        if not path:
            raise HTTPException(
                status_code=503, detail="Der Hub wurde ohne Konfigurationsdatei gestartet"
            )
        return path

    @app.get("/api/config")
    async def get_config(request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        path = config_path()
        try:
            content = Path(path).read_text(encoding="utf-8")
        except OSError as err:
            raise HTTPException(status_code=500, detail=f"Konfiguration nicht lesbar: {err}") from err
        return {"path": path, "content": content}

    @app.put("/api/config")
    async def put_config(body: ConfigRequest, request: Request) -> dict[str, Any]:
        """Konfiguration validiert speichern.

        Erst in eine Temporärdatei schreiben und komplett parsen – eine
        kaputte config.yaml darf nie auf der Platte landen, sonst kommt der
        Hub nach dem nächsten Neustart nicht mehr hoch.
        """
        require(request, Capability.EDIT_CONFIG)
        path = Path(config_path())
        temp = path.with_suffix(".tmp")
        try:
            temp.write_text(body.content, encoding="utf-8")
            candidate = load_config(temp)  # wirft ConfigError bei YAML-/Strukturfehlern
            # Auch die Benutzer-Regeln prüfen: Eine Konfiguration ohne
            # Besitzer würde den Editor selbst aussperren.
            parse_users(candidate.users, candidate.api.token)
        except ConfigError as err:
            temp.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=str(err)) from err
        except OSError as err:
            raise HTTPException(status_code=500, detail=f"Schreiben fehlgeschlagen: {err}") from err
        temp.replace(path)
        log.info("Konfiguration über die App gespeichert (%s)", path)
        return {"ok": True, "restart_required": True}

    @app.post("/api/system/restart")
    async def restart(request: Request) -> dict[str, Any]:
        """Hub-Prozess beenden – Docker (restart: unless-stopped) oder
        systemd starten ihn sofort neu, mit frisch gelesener Konfiguration."""
        user = require(request, Capability.EDIT_CONFIG)
        log.warning("Neustart angefordert von %s", user.name)
        # Kurz warten, damit die Antwort das Gerät noch erreicht.
        threading.Timer(0.8, _exit_for_restart).start()
        return {"ok": True}

    # ── Entitäten ──────────────────────────────────────────────────────────

    @app.get("/api/entities")
    async def list_entities(request: Request) -> list[dict[str, Any]]:
        user = current_user(request)
        return visible(user, hub.registry.all())

    @app.get("/api/entities/{entity_id}")
    async def get_entity(entity_id: str, request: Request) -> dict[str, Any]:
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        return entity.as_dict()

    @app.post("/api/entities/{entity_id}/command")
    async def run_command(
        entity_id: str, body: CommandRequest, request: Request
    ) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        try:
            with as_source(user_source(user.name)):
                entity = await hub.integrations.dispatch_command(
                    entity_id, body.command, body.data
                )
        except UnknownEntityError as err:
            raise HTTPException(status_code=404, detail=str(err)) from err
        except UnsupportedCommandError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        except HomePilotError as err:
            raise HTTPException(status_code=500, detail=str(err)) from err
        return {"ok": True, "entity": entity.as_dict()}

    @app.put("/api/entities/{entity_id}/room")
    async def set_entity_room(
        entity_id: str, body: RoomRequest, request: Request
    ) -> dict[str, Any]:
        """Raumzuordnung einer Entität in der App setzen (oder mit null lösen).

        Bleibt in der homepilot-data.json erhalten und hat Vorrang vor der
        config.yaml – so ordnet man Geräte den Räumen zu, ohne die Datei
        anzufassen."""
        require(request, Capability.EDIT_CONFIG)
        if hub.registry.get(entity_id) is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        await hub.set_entity_room(entity_id, body.room or None)
        return {"ok": True, "entity": hub.registry.get(entity_id).as_dict()}

    @app.get("/api/entities/{entity_id}/snapshot")
    async def entity_snapshot(entity_id: str, request: Request) -> Response:
        """Aktuelles Standbild: Kamerabild (JPEG) oder Saugerkarte (PNG).

        Läuft über den Hub statt direkt zum Gerät: Die App braucht so keine
        Geräte-Zugangsdaten, und die Sichtbarkeitsregeln gelten auch hier.
        """
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        integration = hub.integrations.get(entity.integration)
        if integration is None:
            raise HTTPException(status_code=503, detail="Integration nicht geladen")
        try:
            image = await integration.snapshot(entity)
        except Exception as err:
            raise HTTPException(status_code=502, detail=f"Schnappschuss: {err}") from err
        if not image:
            raise HTTPException(
                status_code=404, detail="Diese Kamera liefert keine Schnappschüsse"
            )
        return Response(
            content=image,
            media_type="image/png" if image.startswith(b"\x89PNG") else "image/jpeg",
            headers={"Cache-Control": "no-store"},
        )

    async def camera_for(entity_id: str, request: Request):
        """Kamera-Entität samt Integration – oder ein sauberes 404."""
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        integration = hub.integrations.get(entity.integration)
        if integration is None:
            raise HTTPException(status_code=503, detail="Integration nicht geladen")
        return entity, integration

    async def deliver(target, request: Request, prefix: str) -> Response:
        """Wiedergabeliste oder Häppchen ausliefern – aus Datei oder mediamtx.

        Wiedergabelisten werden dabei umgeschrieben: Ein Videoplayer schickt
        beim Abarbeiten keine eigenen Kopfzeilen mit, das Token muss also in
        jeder Adresse stehen.
        """
        query = str(request.url.query or "")
        if target.url:
            content, media_type = await hub.streams.fetch(target, query)
        else:
            if not target.path.is_file():
                raise HTTPException(status_code=404, detail="Häppchen nicht mehr vorhanden")
            content = target.path.read_bytes()
            media_type = (
                "application/vnd.apple.mpegurl"
                if target.path.suffix == ".m3u8"
                else "video/mp2t"
            )
        if "mpegurl" in media_type or str(target.path or target.url).endswith(".m3u8"):
            text = rewrite_playlist(
                content.decode("utf-8", "replace"),
                prefix,
                request.query_params.get("token"),
            )
            # Apple-Player (AVPlayer in der App, Safari) scheitern an den
            # zitternden Part-Dauern der Protect-Kameras – sie bekommen die
            # Liste ohne Low-Latency-Teile und spielen gewöhnliches HLS.
            agent = request.headers.get("user-agent", "")
            if "AppleCoreMedia" in agent or (
                "Safari/" in agent and "Chrome" not in agent and "Android" not in agent
            ):
                text = strip_low_latency(text)
            content, media_type = text.encode(), "application/vnd.apple.mpegurl"
        return Response(
            content=content,
            media_type=media_type,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/entities/{entity_id}/stream.m3u8")
    async def entity_stream(entity_id: str, request: Request) -> Response:
        """Live-Bild als HLS-Wiedergabeliste.

        Der Hub holt RTSP von der Kamera und packt es für die App um – die
        Kamera-Adresse bleibt so auf dem Hub, und die App braucht nur ihr
        gewohntes Token.
        """
        entity, integration = await camera_for(entity_id, request)
        source = await integration.stream_url(entity)
        if not source:
            raise HTTPException(
                status_code=404,
                detail="Diese Kamera liefert kein Live-Bild (RTSP nicht eingeschaltet)",
            )
        try:
            target = await hub.streams.playlist(entity_id, source)
            # Die Häppchen liegen unter .../stream/ – von der Liste aus
            # gesehen also ein Verzeichnis tiefer.
            return await deliver(target, request, prefix="stream/")
        except StreamError as err:
            # Auch ins Log: Die App zeigt nur «nicht verfügbar», die
            # Ursache steht sonst nirgends.
            log.warning("Live-Bild %s: %s", entity_id, err)
            raise HTTPException(status_code=502, detail=str(err)) from err

    @app.get("/api/entities/{entity_id}/stream/{name}")
    async def entity_stream_segment(entity_id: str, name: str, request: Request) -> Response:
        """Ein Häppchen, ein Bruchstück oder eine Unterliste des Stroms."""
        await camera_for(entity_id, request)
        # Nur erzeugte Namen zulassen – sonst liesse sich über den Dateinamen
        # jede Datei des Hubs abholen.
        if not SEGMENT_NAME.fullmatch(name):
            raise HTTPException(status_code=404, detail="Unbekanntes Häppchen")
        try:
            target = await hub.streams.locate(entity_id, name)
            # Unterlisten liegen im selben Verzeichnis wie ihre Häppchen.
            return await deliver(target, request, prefix="")
        except StreamError as err:
            log.warning("Live-Bild %s (%s): %s", entity_id, name, err)
            raise HTTPException(status_code=404, detail=str(err)) from err

    @app.get("/api/entities/{entity_id}/history")
    async def entity_history(
        entity_id: str, request: Request, hours: float = 24, limit: int = 500
    ) -> dict[str, Any]:
        """Zustandsverlauf aus Supabase.

        Die App liest den Verlauf bewusst über den Hub statt direkt aus
        Supabase – so bleibt der Datenbank-Key ausschliesslich auf dem Hub.
        """
        require(request, Capability.VIEW_HISTORY)
        if hub.registry.get(entity_id) is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        if hub.store is None:
            raise HTTPException(status_code=503, detail="Keine Datenbank konfiguriert")
        try:
            rows = await hub.store.history(entity_id, hours=hours, limit=min(limit, 2000))
        except Exception as err:
            raise HTTPException(status_code=502, detail=f"Supabase: {err}") from err
        return {"entity_id": entity_id, "history": rows}

    # ── Szenen ─────────────────────────────────────────────────────────────

    @app.get("/api/scenes")
    async def list_scenes(request: Request) -> list[dict[str, Any]]:
        user = current_user(request)
        scenes = [scene.as_dict() for scene in hub.scenes.scenes]
        if user.role != Role.GUEST:
            return scenes
        # Ein Gast sieht nur Szenen, die ausschliesslich freigegebene Geräte
        # anfassen – sonst schaltete er über Umwege doch das ganze Haus.
        allowed = []
        for scene in scenes:
            entities = [hub.registry.get(eid) for eid in scene["entity_ids"]]
            if all(
                entity is not None and user.may_see(entity.id, entity.kind, entity.integration)
                for entity in entities
            ):
                allowed.append(scene)
        return allowed

    @app.post("/api/scenes/{scene_id}/activate")
    async def activate_scene(scene_id: str, request: Request) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        scene = hub.scenes.get(scene_id)
        if scene is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Szene: {scene_id}")
        if user.role == Role.GUEST:
            for entity_id in (action.get("entity_id") for action in scene.actions):
                entity = hub.registry.get(entity_id or "")
                if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
                    raise HTTPException(status_code=403, detail="Szene nicht freigegeben")
        return await hub.scenes.activate(scene_id)

    def stored_scenes() -> list[dict[str, Any]]:
        return hub.data.get("scenes")

    def validate_scene_actions(actions: list[dict[str, Any]]) -> None:
        if not actions:
            raise HTTPException(status_code=400, detail="Eine Szene braucht Aktionen")
        for action in actions:
            if not action.get("entity_id") or not action.get("command"):
                raise HTTPException(
                    status_code=400,
                    detail="Jede Aktion braucht 'entity_id' und 'command'",
                )

    @app.post("/api/scenes")
    async def create_scene(body: SceneRequest, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        validate_scene_actions(body.actions)
        import secrets as _secrets

        entry = {
            "id": f"app_{_secrets.token_hex(4)}",
            "name": body.name,
            "icon": body.icon,
            "actions": body.actions,
            "room": body.room,
            "on_start": body.on_start,
        }
        hub.data.set("scenes", [*stored_scenes(), entry])
        hub.reload_scenes()
        return {"scene": entry}

    @app.put("/api/scenes/{scene_id}")
    async def update_scene(
        scene_id: str, body: SceneRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        validate_scene_actions(body.actions)
        stored = stored_scenes()
        if not any(entry["id"] == scene_id for entry in stored):
            # Aus der config.yaml stammende gehören der Datei, nicht der App.
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Szenen lassen sich hier ändern",
            )
        updated = [
            {
                "id": scene_id,
                "name": body.name,
                "icon": body.icon,
                "actions": body.actions,
                "room": body.room,
                "on_start": body.on_start,
            }
            if entry["id"] == scene_id
            else entry
            for entry in stored
        ]
        hub.data.set("scenes", updated)
        hub.reload_scenes()
        return {"ok": True}

    @app.delete("/api/scenes/{scene_id}")
    async def delete_scene(scene_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        stored = stored_scenes()
        remaining = [entry for entry in stored if entry["id"] != scene_id]
        if len(remaining) == len(stored):
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Szenen lassen sich hier löschen",
            )
        hub.data.set("scenes", remaining)
        hub.reload_scenes()
        return {"ok": True}

    # ── Automationen ───────────────────────────────────────────────────────

    @app.get("/api/automations")
    async def list_automations(request: Request) -> dict[str, Any]:
        require(request, Capability.VIEW_AUTOMATIONS)
        return {
            "automations": [
                automation.as_dict() for automation in hub.automations.automations
            ],
            "paused_until": (
                hub.automations.paused_until.isoformat()
                if hub.automations.paused_until
                else None
            ),
        }

    @app.post("/api/automations/pause")
    async def pause_automations(body: PauseRequest, request: Request) -> dict[str, Any]:
        require(request, Capability.PAUSE_AUTOMATIONS)
        until = hub.automations.pause(body.seconds)
        return {"paused_until": until.isoformat() if until else None}

    def stored_automations() -> list[dict[str, Any]]:
        return hub.data.get("automations")

    @app.post("/api/automations")
    async def create_automation(
        body: AutomationRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        import secrets as _secrets

        entry = {
            "id": f"app_{_secrets.token_hex(4)}",
            "alias": body.alias,
            "trigger": body.trigger,
            "condition": body.condition,
            "action": body.action,
        }
        hub.data.set("automations", [*stored_automations(), entry])
        await hub.reload_automations()
        return {"automation": entry}

    @app.put("/api/automations/{automation_id}")
    async def update_automation(
        automation_id: str, body: AutomationRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        stored = stored_automations()
        if not any(entry["id"] == automation_id for entry in stored):
            # Aus der config.yaml stammende gehören der Datei, nicht der App.
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Abläufe lassen sich hier ändern",
            )
        updated = [
            {
                "id": automation_id,
                "alias": body.alias,
                "trigger": body.trigger,
                "condition": body.condition,
                "action": body.action,
            }
            if entry["id"] == automation_id
            else entry
            for entry in stored
        ]
        hub.data.set("automations", updated)
        await hub.reload_automations()
        return {"ok": True}

    @app.delete("/api/automations/{automation_id}")
    async def delete_automation(automation_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        stored = stored_automations()
        remaining = [entry for entry in stored if entry["id"] != automation_id]
        if len(remaining) == len(stored):
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Abläufe lassen sich hier löschen",
            )
        hub.data.set("automations", remaining)
        await hub.reload_automations()
        return {"ok": True}

    @app.post("/api/automations/{automation_id}/trigger")
    async def trigger_automation(automation_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        ok = await hub.automations.trigger_now(automation_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Ablauf nicht gefunden")
        return {"ok": True}

    # ── Push ───────────────────────────────────────────────────────────────

    @app.post("/api/push/register")
    async def register_push(body: PushRegistration, request: Request) -> dict[str, Any]:
        user = current_user(request)
        device = hub.push.register(body.token, user.name, body.label)
        return {"ok": True, "device": device.as_dict()}

    @app.post("/api/push/unregister")
    async def unregister_push(body: PushRegistration, request: Request) -> dict[str, Any]:
        current_user(request)
        return {"ok": hub.push.unregister(body.token)}

    @app.post("/api/push/test")
    async def test_push(request: Request) -> dict[str, Any]:
        user = current_user(request)
        tokens = hub.push.recipients(hub.users.users, user.name)
        count = await hub.push.send(
            tokens,
            title="HomePilot Test",
            body="Push-Benachrichtigungen funktionieren \U0001f389",
            data={"type": "test"},
        )
        return {"ok": True, "sent": count}

    # ── Benutzerverwaltung ─────────────────────────────────────────────────

    @app.get("/api/users")
    async def list_users(request: Request) -> list[dict[str, Any]]:
        require(request, Capability.MANAGE_USERS)
        return [user.as_dict() for user in hub.users.users]

    @app.post("/api/users")
    async def create_user(body: UserRequest, request: Request) -> dict[str, Any]:
        require(request, Capability.MANAGE_USERS)
        import secrets

        from ..core.users import User as HubUser

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

    # ── Familie: geteilte Listen (Aufgaben, Einkauf, Pinnwand …) ──────────
    # Alle Bewohner sehen und pflegen dieselben Daten; Gäste bleiben aussen
    # vor. Die Struktur ist bewusst generisch: eine Sammlung ist eine Liste
    # von Einträgen mit id, author und created – was sonst drinsteht,
    # bestimmt die App (Aufgabe, Pin, Rezept …).

    FAMILY_COLLECTIONS = frozenset(
        {
            "tasks", "shopping", "pins", "meals", "contacts", "routines",
            "rewards", "rewards_catalog", "packlists", "countdowns",
            "recipes", "documents",
        }
    )

    def family_user(request: Request) -> User:
        user = current_user(request)
        if user.role == Role.GUEST and "familie" not in user.features:
            raise HTTPException(status_code=403, detail="Für Gäste nicht sichtbar")
        return user

    def family_key(collection: str) -> str:
        if collection not in FAMILY_COLLECTIONS:
            raise HTTPException(status_code=404, detail=f"Unbekannte Liste: {collection}")
        return f"family_{collection}"

    @app.get("/api/family")
    async def family_all(request: Request) -> dict[str, Any]:
        family_user(request)
        return {name: hub.data.get(f"family_{name}") for name in sorted(FAMILY_COLLECTIONS)}

    @app.post("/api/family/{collection}")
    async def family_add(
        collection: str, body: dict[str, Any], request: Request
    ) -> dict[str, Any]:
        import secrets
        from datetime import datetime

        user = family_user(request)
        key = family_key(collection)
        item = {k: v for k, v in body.items() if k not in ("id", "author", "created")}
        item["id"] = secrets.token_urlsafe(8)
        item["author"] = user.name
        item["created"] = datetime.now().isoformat(timespec="seconds")
        hub.data.set(key, [*hub.data.get(key), item])
        return item

    @app.put("/api/family/{collection}/{item_id}")
    async def family_update(
        collection: str, item_id: str, body: dict[str, Any], request: Request
    ) -> dict[str, Any]:
        family_user(request)
        key = family_key(collection)
        items = hub.data.get(key)
        for item in items:
            if item.get("id") == item_id:
                item.update(
                    {k: v for k, v in body.items() if k not in ("id", "author", "created")}
                )
                hub.data.set(key, items)
                return item
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")

    @app.delete("/api/family/{collection}/{item_id}")
    async def family_delete(
        collection: str, item_id: str, request: Request
    ) -> dict[str, Any]:
        family_user(request)
        key = family_key(collection)
        items = hub.data.get(key)
        remaining = [item for item in items if item.get("id") != item_id]
        if len(remaining) == len(items):
            raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")
        hub.data.set(key, remaining)
        return {"ok": True}

    @app.put("/api/users/{name}")
    async def update_user(
        name: str, body: UserUpdateRequest, request: Request
    ) -> dict[str, Any]:
        """Gast sperren/entsperren oder Bereiche ändern – das Token bleibt."""
        user = require(request, Capability.MANAGE_USERS)
        if user.name == name and body.enabled is False:
            raise HTTPException(status_code=400, detail="Sich selbst kann man nicht sperren")
        try:
            updated = hub.users.update(name, enabled=body.enabled, features=body.features)
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        return {"user": updated.as_dict()}

    @app.get("/api/users/{name}/pairing")
    async def user_pairing(name: str, request: Request) -> dict[str, Any]:
        """Kopplungs-Daten für den QR-Code: dieselbe Form wie der
        Einrichtungs-Code beim Hub-Start – die App scannt und verbindet."""
        require(request, Capability.MANAGE_USERS)
        target = hub.users.by_name(name)
        if target is None:
            raise HTTPException(status_code=404, detail=f"Unbekannter Benutzer: {name}")
        from ..qr import setup_payload

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

    # ── WebSocket ──────────────────────────────────────────────────────────

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        header = websocket.headers.get("authorization", "")
        token = (
            websocket.query_params.get("token") or header.removeprefix("Bearer ").strip()
        )
        user = hub.users.by_token(token)
        if user is None:
            await websocket.close(code=4401)
            return

        await websocket.accept()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        def forward(event_type: str, data: dict[str, Any]) -> None:
            entity = data.get("entity")
            if entity and not user.may_see(entity["id"], entity["kind"], entity.get("integration", "")):
                return
            queue.put_nowait({"type": event_type, **data})

        unsubscribers = [
            hub.bus.subscribe("state_changed", forward),
            hub.bus.subscribe("entity_added", forward),
            hub.bus.subscribe("entity_removed", forward),
        ]

        async def sender() -> None:
            while True:
                message = await queue.get()
                await websocket.send_json(message)

        await websocket.send_json(
            {
                "type": "snapshot",
                "entities": visible(user, hub.registry.all()),
                "user": user_payload(user),
                # Raum-Reihenfolge (config.yaml zuerst, dann per App
                # zugewiesene): Die App sortiert ihre Reiter danach statt
                # alphabetisch und bietet sie zur Zuweisung an.
                "rooms": hub.known_rooms(),
            }
        )
        sender_task = asyncio.create_task(sender())
        try:
            while True:
                message = await websocket.receive_json()
                mtype = message.get("type")
                if mtype == "ping":
                    queue.put_nowait({"type": "pong"})
                elif mtype == "command":
                    entity_id = message.get("entity_id", "")
                    entity = hub.registry.get(entity_id)
                    if not user.can(Capability.CONTROL) or (
                        entity is not None and not user.may_see(entity.id, entity.kind, entity.integration)
                    ):
                        queue.put_nowait(
                            {
                                "type": "result",
                                "ok": False,
                                "entity_id": entity_id,
                                "error": "Dafür fehlt dir die Berechtigung",
                            }
                        )
                        continue
                    try:
                        with as_source(user_source(user.name)):
                            await hub.integrations.dispatch_command(
                                entity_id,
                                message.get("command", ""),
                                message.get("data") or {},
                            )
                        queue.put_nowait(
                            {"type": "result", "ok": True, "entity_id": entity_id}
                        )
                    except Exception as err:
                        queue.put_nowait(
                            {
                                "type": "result",
                                "ok": False,
                                "entity_id": entity_id,
                                "error": str(err),
                            }
                        )
        except WebSocketDisconnect:
            pass
        finally:
            for unsubscribe in unsubscribers:
                unsubscribe()
            sender_task.cancel()

    return app
