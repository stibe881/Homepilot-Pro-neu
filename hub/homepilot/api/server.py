"""REST- und WebSocket-API für die App - hier nur noch das Gerüst.

Die Routen selbst liegen ein Modul je Sachgebiet unter routes/ (Punkt 16
der Werkbank); hier bleiben Authentifizierung, WebSocket und die
Auslieferung der Web-Fassung, weil alles drei an denselben Closures hängt.

Jeder Zugriff läuft über ein Benutzer-Token: Es bestimmt die Rolle und
damit, was jemand sehen und tun darf. Gäste bekommen bereits im Snapshot
und in den Live-Ereignissen nur die Geräte zu sehen, die für sie
freigegeben sind – filtern erst in der App wäre keine Einschränkung.

WebSocket-Protokoll (/ws):
  Server → Client:
    {"type": "snapshot", "entities": [...], "user": {...}, "rooms": [...]}
    {"type": "state_changed", "entity": {...}, "source": {...}, ...}
    {"type": "entity_added" | "entity_removed", ...}
    {"type": "family_changed", "collection": "shopping"}   # nur der Fingerzeig
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
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from ..core import throttle as throttle_module
from ..core.hub import Hub
from ..core.source import as_source, user_source
from ..core.users import Capability, Role, User
from . import invitepage  # noqa: F401 - Weiterleitung für bestehende Importe
from .context import ApiContext
from .routes import (
    alarm as routes_alarm,
)
from .routes import (
    auth as routes_auth,
)
from .routes import (
    automations as routes_automations,
)
from .routes import (
    dashboard as routes_dashboard,
)
from .routes import (
    einladungen as routes_einladungen,
)
from .routes import (
    entities as routes_entities,
)
from .routes import (
    family as routes_family,
)
from .routes import (
    haus as routes_haus,
)
from .routes import (
    lightgroups as routes_lightgroups,
)
from .routes import (
    passes as routes_passes,
)
from .routes import (
    medien as routes_medien,
)
from .routes import (
    personen as routes_personen,
)
from .routes import (
    prefs as routes_prefs,
)
from .routes import (
    push as routes_push,
)
from .routes import (
    radio as routes_radio,
)
from .routes import (
    system as routes_system,
)
from .routes import (
    users as routes_users,
)

log = logging.getLogger(__name__)


def _exit_for_restart() -> None:
    """Prozess hart beenden – der Prozessmanager (Docker, systemd) startet
    neu. In Tests wird diese Funktion ersetzt."""
    os._exit(0)



def create_app(hub: Hub) -> FastAPI:
    # Eine Bremse je Hub-Instanz, nicht global: Tests sollen sich nicht
    # gegenseitig aussperren.
    throttle = throttle_module.Throttle()

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
        # Nur was die App wirklich schickt. Vorher stand hier zweimal «*» -
        # im eigenen Netz belanglos, aber sobald der Hub von aussen
        # erreichbar ist, ist das unnötig weit offen. Die Herkunft war
        # schon einstellbar, der Rest nicht.
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # ── Authentifizierung ──────────────────────────────────────────────────

    def token_from(request: Request) -> str | None:
        header = request.headers.get("authorization", "")
        if header:
            return header.removeprefix("Bearer ").strip()
        return request.query_params.get("token")

    def user_for_token(token: str | None) -> User | None:
        """Wer gehört zu diesem Token? – für HTTP und WebSocket dieselbe Antwort.

        Zwei Arten von Token führen zum selben Benutzer: das feste aus der
        Konfiguration (QR-Code, Kurzbefehle, NFC) und die Sitzung aus der
        Anmeldung mit E-Mail und Passwort. Bewusst an einer Stelle: Stünde
        die Auflösung zweimal im Code, hinge irgendwann eine der beiden
        zurück – und dann kommt man zwar durch die Anmeldung, aber der
        Zustandskanal bleibt zu.
        """
        user = hub.users.by_token(token)
        if user is not None:
            return user
        name = hub.sessions.user_for(token or "")
        if not name:
            return None
        user = hub.users.by_name(name)
        return user if user is not None and user.active() else None

    def current_user(request: Request) -> User:
        # Sobald der Hub von aussen erreichbar ist, klopfen Scanner an.
        # Die Bremse zählt nur Fehlversuche – wer ein gültiges Token hat,
        # darf so oft, wie er will.
        address = throttle_module.client_address(request)
        waiting = throttle.blocked_for(address)
        if waiting > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Zu viele Fehlversuche. In {round(waiting)} Sekunden wieder.",
                headers={"Retry-After": str(round(waiting))},
            )
        user = user_for_token(token_from(request))
        if user is None:
            if throttle.failed(address):
                log.warning(
                    "%s gesperrt: zu viele ungültige Tokens", address
                )
            raise HTTPException(status_code=401, detail="Ungültiges Token")
        throttle.succeeded(address)
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

    def _user_name(request: Request) -> str:
        """Wer gerade handelt – für Papierkorb und Protokoll."""
        try:
            return current_user(request).name
        except HTTPException:
            return "?"

    # Die Sachgebiete hängen ihre Routen selbst an (Punkt 16 der
    # Werkbank): eine Datei je Gebiet statt 3800 Zeilen am Stück. Der
    # Kontext reicht die Closures weiter, die alle teilen.
    ctx = ApiContext(
        hub=hub,
        throttle=throttle,
        current_user=current_user,
        require=require,
        user_payload=user_payload,
        visible=visible,
        user_name=_user_name,
        token_from=token_from,
    )
    for register in (
        routes_system.register,
        routes_entities.register,
        routes_automations.register,
        routes_haus.register,
        routes_push.register,
        routes_prefs.register,
        routes_alarm.register,
        routes_users.register,
        routes_family.register,
        routes_auth.register,
        routes_lightgroups.register,
        routes_passes.register,
        routes_dashboard.register,
        routes_radio.register,
        routes_einladungen.register,
        routes_personen.register,
        routes_medien.register,
    ):
        register(app, ctx)

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

    # ── WebSocket ──────────────────────────────────────────────────────────

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        header = websocket.headers.get("authorization", "")
        token = (
            websocket.query_params.get("token") or header.removeprefix("Bearer ").strip()
        )
        user = user_for_token(token)
        if user is None:
            await websocket.close(code=4401)
            return

        await websocket.accept()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        def forward(event_type: str, data: dict[str, Any]) -> None:
            # Familien-Ereignisse gelten nur für Rollen, die die Listen
            # auch abrufen dürfen - dieselbe Regel wie in family_user().
            if event_type == "family_changed" and (
                user.role == Role.GUEST and "familie" not in user.features
            ):
                return
            entity = data.get("entity")
            if entity and not user.may_see(entity["id"], entity["kind"], entity.get("integration", "")):
                return
            queue.put_nowait({"type": event_type, **data})

        unsubscribers = [
            hub.bus.subscribe("state_changed", forward),
            hub.bus.subscribe("entity_added", forward),
            hub.bus.subscribe("entity_removed", forward),
            # Nur der Fingerzeig «Liste X hat sich geändert» - die App holt
            # die Daten selbst, statt im Minutentakt zu fragen.
            hub.bus.subscribe("family_changed", forward),
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
                        # Die Entität ist oben schon geholt - nur festhalten,
                        # wer hier was ausgelöst hat.
                        if entity is not None:
                            hub.audit.record(
                                user.name, entity, message.get("command", "")
                            )
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

    _serve_web(app, hub)
    return app


def _serve_web(app: FastAPI, hub: Hub) -> None:
    """Die gebaute Web-Fassung der App unter «/» ausliefern.

    Ganz am Ende eingehängt und deshalb hinter allen Routen: Ein Mount auf
    «/» würde sonst die Schnittstelle überdecken.

    Ohne Ordner passiert nichts – der Hub bleibt dann reine Schnittstelle,
    so wie bisher.
    """
    root = hub.config.web_root
    if not root:
        return
    folder = Path(root)
    if not (folder / "index.html").exists():
        log.warning(
            "web_root %s enthält keine index.html – die Web-Fassung wird "
            "nicht ausgeliefert. Gebaut wird sie mit «npx expo export "
            "--platform web» im Ordner app/.",
            folder,
        )
        return
    # html=True liefert index.html für «/» aus.
    app.mount("/", WebStatics(directory=str(folder), html=True), name="web")
    log.info("Web-Fassung der App wird aus %s ausgeliefert", folder)


class WebStatics(StaticFiles):
    """StaticFiles mit passenden Cache-Regeln für eine Expo-Web-App.

    Ohne sie hält der Browser - besonders die Homescreen-Fassung auf dem
    iPhone - die index.html fest und zeigt wochenlang das alte Bundle:
    Neue Funktionen «fehlen» dann im Web, obwohl der Hub sie längst
    ausliefert. Die HTML-Datei muss deshalb bei jedem Öffnen nachgefragt
    werden (no-cache heisst: nachfragen, 304 genügt). Die Bundles unter
    _expo/ tragen einen Hash im Namen - die dürfen ewig im Cache bleiben,
    ein neues Bundle hat einen neuen Namen.
    """

    def file_response(self, *args: Any, **kwargs: Any):
        response = super().file_response(*args, **kwargs)
        path = str(getattr(response, "path", "")).replace("\\", "/")
        if path.endswith((".html", "version.json")):
            response.headers["Cache-Control"] = "no-cache"
        elif "/_expo/" in path:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response
