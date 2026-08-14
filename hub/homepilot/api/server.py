"""REST- und WebSocket-API für die App.

Jeder Zugriff läuft über ein Benutzer-Token: Es bestimmt die Rolle und
damit, was jemand sehen und tun darf. Gäste bekommen bereits im Snapshot
und in den Live-Ereignissen nur die Geräte zu sehen, die für sie
freigegeben sind – filtern erst in der App wäre keine Einschränkung.

WebSocket-Protokoll (/ws):
  Server → Client:
    {"type": "snapshot", "entities": [...], "user": {...}}
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
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ..core.errors import HomePilotError, UnknownEntityError, UnsupportedCommandError
from ..core.hub import Hub
from ..core.source import as_source, user_source
from ..core.users import Capability, Role, User

log = logging.getLogger(__name__)


class CommandRequest(BaseModel):
    command: str
    data: dict[str, Any] = {}


class PauseRequest(BaseModel):
    seconds: float = 7200


class PushRegistration(BaseModel):
    token: str
    label: str = ""


class UserRequest(BaseModel):
    name: str
    role: str = Role.RESIDENT
    token: str | None = None
    allow: list[str] = []


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
            if user.may_see(entity.id, entity.kind)
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

    # ── Entitäten ──────────────────────────────────────────────────────────

    @app.get("/api/entities")
    async def list_entities(request: Request) -> list[dict[str, Any]]:
        user = current_user(request)
        return visible(user, hub.registry.all())

    @app.get("/api/entities/{entity_id}")
    async def get_entity(entity_id: str, request: Request) -> dict[str, Any]:
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        return entity.as_dict()

    @app.post("/api/entities/{entity_id}/command")
    async def run_command(
        entity_id: str, body: CommandRequest, request: Request
    ) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind):
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
                entity is not None and user.may_see(entity.id, entity.kind)
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
                if entity is None or not user.may_see(entity.id, entity.kind):
                    raise HTTPException(status_code=403, detail="Szene nicht freigegeben")
        return await hub.scenes.activate(scene_id)

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
        token = body.token or secrets.token_urlsafe(32)
        try:
            hub.users.add(
                HubUser(name=body.name, role=body.role, token=token, allow=body.allow)
            )
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        # Das Token wird genau einmal zurückgegeben – danach steht es
        # nirgends mehr im Klartext zum Abholen.
        return {
            "user": hub.users.by_name(body.name).as_dict(include_token=True),
            "hinweis": (
                "Token jetzt notieren und in die config.yaml übernehmen – "
                "sonst ist der Zugang nach einem Neustart des Hubs weg."
            ),
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
            if entity and not user.may_see(entity["id"], entity["kind"]):
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
                        entity is not None and not user.may_see(entity.id, entity.kind)
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
