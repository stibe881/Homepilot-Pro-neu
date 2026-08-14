"""REST- und WebSocket-API für die App.

WebSocket-Protokoll (/ws):
  Server → Client:
    {"type": "snapshot", "entities": [...]}          direkt nach Verbinden
    {"type": "state_changed", "entity": {...}, ...}
    {"type": "entity_added", "entity": {...}}
    {"type": "entity_removed", "entity_id": "..."}
    {"type": "pong"}
    {"type": "result", "ok": true|false, "error"?: "..."}
  Client → Server:
    {"type": "ping"}
    {"type": "command", "entity_id": "...", "command": "...", "data": {...}}

Auth: Bearer-Token im Authorization-Header, oder ?token=... (WebSocket).
Ohne konfiguriertes Token ist die API offen – nur fürs LAN gedacht.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..core.errors import HomePilotError, UnknownEntityError, UnsupportedCommandError
from ..core.hub import Hub

log = logging.getLogger(__name__)


class CommandRequest(BaseModel):
    command: str
    data: dict[str, Any] = {}


def create_app(hub: Hub) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await hub.start()
        yield
        await hub.stop()

    app = FastAPI(title="HomePilot", lifespan=lifespan)
    token = hub.config.api.token

    def check_auth(request: Request) -> None:
        if not token:
            return
        header = request.headers.get("authorization", "")
        provided = header.removeprefix("Bearer ").strip()
        if provided != token:
            raise HTTPException(status_code=401, detail="Ungültiges Token")

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "entities": len(hub.registry.all())}

    @app.get("/api/entities")
    async def list_entities(request: Request) -> list[dict[str, Any]]:
        check_auth(request)
        return [entity.as_dict() for entity in hub.registry.all()]

    @app.get("/api/entities/{entity_id}")
    async def get_entity(entity_id: str, request: Request) -> dict[str, Any]:
        check_auth(request)
        entity = hub.registry.get(entity_id)
        if entity is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        return entity.as_dict()

    @app.post("/api/entities/{entity_id}/command")
    async def run_command(
        entity_id: str, body: CommandRequest, request: Request
    ) -> dict[str, Any]:
        check_auth(request)
        try:
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
        check_auth(request)
        if hub.registry.get(entity_id) is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        if hub.store is None:
            raise HTTPException(status_code=503, detail="Keine Datenbank konfiguriert")
        try:
            rows = await hub.store.history(entity_id, hours=hours, limit=min(limit, 2000))
        except Exception as err:
            raise HTTPException(status_code=502, detail=f"Supabase: {err}") from err
        return {"entity_id": entity_id, "history": rows}

    @app.get("/api/automations")
    async def list_automations(request: Request) -> list[dict[str, Any]]:
        check_auth(request)
        return [automation.as_dict() for automation in hub.automations.automations]

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        if token:
            header = websocket.headers.get("authorization", "")
            provided = (
                websocket.query_params.get("token")
                or header.removeprefix("Bearer ").strip()
            )
            if provided != token:
                await websocket.close(code=4401)
                return

        await websocket.accept()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        def forward(event_type: str, data: dict[str, Any]) -> None:
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
                "entities": [entity.as_dict() for entity in hub.registry.all()],
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
                    try:
                        await hub.integrations.dispatch_command(
                            message.get("entity_id", ""),
                            message.get("command", ""),
                            message.get("data") or {},
                        )
                        queue.put_nowait({"type": "result", "ok": True})
                    except HomePilotError as err:
                        queue.put_nowait(
                            {"type": "result", "ok": False, "error": str(err)}
                        )
        except WebSocketDisconnect:
            pass
        finally:
            for unsubscribe in unsubscribers:
                unsubscribe()
            sender_task.cancel()

    return app
