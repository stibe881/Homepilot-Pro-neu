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
import json
import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

import aiohttp
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..core.config import ConfigError, load_config
from ..core import energy as energy_module
from ..core import push
from ..core import snapshots
from ..core import throttle as throttle_module
from ..core import watchdog
from ..core import users as users_module
from ..core import automation as automation_module
from ..core import config_edit
from ..core import confighistory
from ..core import guestpass
from ..core import trash as trash_module
from ..core.config_edit import add_cast_device
from ..integrations import alarm as alarm_module
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
    # Was stattdessen läuft, wenn die Bedingungen nicht passen.
    otherwise: list[dict[str, Any]] = []
    enabled: bool = True
    # «all» = alle Bedingungen müssen stimmen, «any» = eine genügt.
    match: str = "all"
    # Frei gewählter Name zum Gruppieren in der App.
    category: str | None = None


class SceneRequest(BaseModel):
    name: str
    icon: str = "sparkles-outline"
    actions: list[dict[str, Any]] = []
    room: str | None = None
    # Auf der Startseite als Schnellaktion anzeigen.
    on_start: bool = False
    # Frei gewählter Name zum Gruppieren in der App.
    category: str | None = None
    # Übergangszeit in Sekunden: Helligkeiten werden angefahren statt
    # gesetzt – Lichtwecker, Einschlaflicht.
    transition: int = 0


class PushPrefsRequest(BaseModel):
    """Abbestellte Nachrichtenarten eines Benutzers."""

    muted: list[str] = []


class SpeakerRequest(BaseModel):
    """Eine gefundene Box, die in die Konfiguration soll."""

    name: str
    host: str
    # Gruppen laufen auf der Adresse einer ihrer Boxen, mit eigenem Port.
    port: int = 8009


class UserRequest(BaseModel):
    name: str
    role: str = Role.RESIDENT
    token: str | None = None
    allow: list[str] = []
    # Freigegebene Bereiche für Gäste (Schlüssel aus GUEST_FEATURES).
    features: list[str] = []
    expires: str | None = None
    hours: dict[str, str] = {}


class UserUpdateRequest(BaseModel):
    enabled: bool | None = None
    features: list[str] | None = None
    # Ablaufdatum als "JJJJ-MM-TT"; leerer Text hebt es auf.
    expires: str | None = None
    # Zeitfenster {"from": "07:00", "to": "20:00"}; leer hebt es auf.
    hours: dict[str, str] | None = None


class GeofenceRequest(BaseModel):
    """Ortswechsel eines Telefons: enter/leave (oder home/away)."""

    event: str
    # Ohne Zone gilt der Name des angemeldeten Benutzers.
    zone: str | None = None


class PassRequest(BaseModel):
    """Ein Einmal-Link: ein Gerät, ein Befehl, wenige Minuten."""

    entity_id: str
    command: str = "unlatch"
    minutes: int = guestpass.DEFAULT_MINUTES
    label: str = ""


class PrefsRequest(BaseModel):
    prefs: dict[str, Any]


# Obergrenze der persönlichen Einstellungen je Benutzer - genug für viele
# Reihenfolgen, zu wenig, um die Datendatei zu fluten.
PREFS_BYTES = 32_768


class ConfigRequest(BaseModel):
    content: str


class RoomRequest(BaseModel):
    room: str | None = None


class AlarmArmRequest(BaseModel):
    mode: str
    # Trotz offener Fenster scharf schalten – bewusste Entscheidung des
    # Benutzers, nachdem ihm gesagt wurde, was offen ist.
    force: bool = False


class MetaRequest(BaseModel):
    """Anzeigename, Favorit oder Gruppe – nur gesetzte Felder ändern sich."""

    name: str | None = None
    favorite: bool | None = None
    group: str | None = None


# Wie ein Kommando im Namen eines Kurzbefehls heisst – «Licht turn_on» wäre
# als Siri-Satz unbrauchbar.
COMMAND_WORDS = {
    "turn_on": "an",
    "turn_off": "aus",
    "open": "auf",
    "close": "zu",
}


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
        user = hub.users.by_token(token_from(request))
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

    def _user_name(request: Request) -> str:
        """Wer gerade handelt – für Papierkorb und Protokoll."""
        try:
            return current_user(request).name
        except HTTPException:
            return "?"

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
        return save_config(body.content)

    def save_config(content: str) -> dict[str, Any]:
        path = Path(config_path())
        temp = path.with_suffix(".tmp")
        try:
            temp.write_text(content, encoding="utf-8")
            candidate = load_config(temp)  # wirft ConfigError bei YAML-/Strukturfehlern
            # Auch die Benutzer-Regeln prüfen: Eine Konfiguration ohne
            # Besitzer würde den Editor selbst aussperren.
            parse_users(candidate.users, candidate.api.token)
        except ConfigError as err:
            temp.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=str(err)) from err
        except OSError as err:
            raise HTTPException(status_code=500, detail=f"Schreiben fehlgeschlagen: {err}") from err
        # Vorherige Fassung wegsichern, bevor sie überschrieben wird -
        # gültig heisst nicht richtig, und der alte Wortlaut ist dann weg.
        confighistory.snapshot(path)
        temp.replace(path)
        log.info("Konfiguration über die App gespeichert (%s)", path)
        # Diese Prüfungen liefen bisher nur beim Start ins Log – wer in der
        # App speicherte, sah eine doppelte Geräteadresse also erst nach dem
        # Neustart, wenn überhaupt. Sie brechen nichts ab: Eine Warnung ist
        # eine Warnung, kein Fehler.
        known = {entity.id for entity in hub.registry.all()}
        warnings = [
            *config_edit.duplicate_devices(candidate.integrations),
            *config_edit.unused_rooms(candidate.rooms, known),
        ]
        return {"ok": True, "restart_required": True, "warnings": warnings}

    @app.post("/api/config/check")
    async def check_config(body: ConfigRequest, request: Request) -> dict[str, Any]:
        """Prüfen, ohne zu speichern.

        Damit man den Fehler sieht, bevor man ihn auf die Platte schreibt –
        und die Warnungen, bevor sie im Log versauern.
        """
        require(request, Capability.EDIT_CONFIG)
        temp = Path(config_path()).with_suffix(".check")
        try:
            temp.write_text(body.content, encoding="utf-8")
            candidate = load_config(temp)
            parse_users(candidate.users, candidate.api.token)
        except ConfigError as err:
            return {"ok": False, "error": str(err), "warnings": []}
        except OSError as err:
            raise HTTPException(
                status_code=500, detail=f"Prüfen fehlgeschlagen: {err}"
            ) from err
        finally:
            temp.unlink(missing_ok=True)

        known = {entity.id for entity in hub.registry.all()}
        return {
            "ok": True,
            "error": None,
            "warnings": [
                *config_edit.duplicate_devices(candidate.integrations),
                *config_edit.unused_rooms(candidate.rooms, known),
            ],
        }

    @app.post("/api/system/restart")
    async def restart(request: Request) -> dict[str, Any]:
        """Hub-Prozess beenden – Docker (restart: unless-stopped) oder
        systemd starten ihn sofort neu, mit frisch gelesener Konfiguration."""
        user = require(request, Capability.EDIT_CONFIG)
        log.warning("Neustart angefordert von %s", user.name)
        # Kurz warten, damit die Antwort das Gerät noch erreicht.
        threading.Timer(0.8, _exit_for_restart).start()
        return {"ok": True}

    @app.get("/api/shortcuts")
    async def shortcuts(request: Request) -> dict[str, Any]:
        """Fertige Bausteine für Apple Kurzbefehle.

        Die Anleitung in docs/siri-und-widgets.md erklärt, wie man einen
        Kurzbefehl von Hand zusammensetzt – und genau das ist die Hürde:
        URL, Methode, zwei Header und ein JSON-Rumpf, für jede Szene aufs
        Neue. Hier kommt alles fertig heraus, samt Token des Anfragenden.

        Bewusst mit *seinem* Token: Wer den Kurzbefehl baut, soll ihn mit
        den eigenen Rechten bauen. Ein Gast bekommt so auch nur die Geräte,
        die er ohnehin sehen darf.
        """
        user = current_user(request)
        token = token_from(request) or ""
        base = str(request.base_url).rstrip("/")

        items: list[dict[str, Any]] = [
            {
                "kind": "scene",
                "name": scene.name,
                "url": f"{base}/api/scenes/{scene.id}/activate",
                "method": "POST",
                "headers": {"Authorization": f"Bearer {token}"},
                "body": None,
            }
            for scene in hub.scenes.scenes
        ]
        for entity in hub.registry.all():
            if not user.may_see(entity.id, entity.kind, entity.integration):
                continue
            for command in ("turn_on", "turn_off", "open", "close"):
                if command not in entity.commands:
                    continue
                items.append(
                    {
                        "kind": "device",
                        "name": f"{entity.name} {COMMAND_WORDS.get(command, command)}",
                        "url": f"{base}/api/entities/{entity.id}/command",
                        "method": "POST",
                        "headers": {
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "application/json",
                        },
                        "body": {"command": command},
                    }
                )
        return {"shortcuts": items}

    @app.post("/api/system/update")
    async def trigger_update(request: Request) -> dict[str, Any]:
        """Stösst die eingerichtete Update-Adresse an.

        Was der Hub *nicht* kann: sich selbst neu bauen. Er läuft in einem
        Container und hat weder das Repository noch Docker zur Hand – das
        wäre auch kein Zugriff, den ein Hausautomations-Dienst haben sollte.

        Was er kann: eine Adresse aufrufen, die das auf dem Host anstösst –
        den Stack-Webhook von Portainer oder einen eigenen kleinen Dienst,
        der rebuild-hub.sh startet. Die Adresse steht in der config.yaml
        unter ``update.webhook_url``; ohne sie passiert hier nichts.
        """
        user = require(request, Capability.EDIT_CONFIG)
        url = str((hub.config.update or {}).get("webhook_url") or "")
        if not url.startswith(("http://", "https://")):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Keine Update-Adresse eingerichtet. In der config.yaml "
                    "unter 'update.webhook_url' eintragen – siehe "
                    "deploy/portainer.md."
                ),
            )
        log.warning("Update angefordert von %s", user.name)
        # Ein Dienst, der auf dem Host baut, darf nicht ohne Nachweis
        # anspringen. Der Portainer-Webhook braucht dagegen keinen – seine
        # Adresse ist selbst das Geheimnis.
        secret = str((hub.config.update or {}).get("token") or "")
        headers = {"Authorization": f"Bearer {secret}"} if secret else {}
        try:
            timeout = aiohttp.ClientTimeout(total=30)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, headers=headers) as response:
                    text = (await response.text())[:200]
                    if response.status >= 400:
                        raise HTTPException(
                            status_code=502,
                            detail=f"Die Update-Adresse antwortet mit {response.status}: {text}",
                        )
        except HTTPException:
            raise
        except Exception as err:
            raise HTTPException(
                status_code=502, detail=f"Update-Adresse nicht erreichbar: {err}"
            ) from err
        return {"ok": True}

    @app.get("/api/system/update/status")
    async def update_status(request: Request) -> dict[str, Any]:
        """Live-Fortschritt des Host-Baus, für einen Fortschrittsbalken in der App.

        Nur der beiliegende ``deploy/update-listener.py`` kennt einen
        Fortschritt (er beobachtet die Ausgabe von rebuild-hub.sh live) –
        ein reiner Portainer-Stack-Webhook hat kein Gegenstück dazu. Ohne
        passende Adresse kommt hier schlicht ``available: false`` zurück,
        kein Fehler: Die App blendet den Balken dann einfach aus.
        """
        require(request, Capability.EDIT_CONFIG)
        url = str((hub.config.update or {}).get("webhook_url") or "")
        if not url.endswith("/update"):
            return {"available": False}
        status_url = url[: -len("/update")] + "/status"
        secret = str((hub.config.update or {}).get("token") or "")
        headers = {"Authorization": f"Bearer {secret}"} if secret else {}
        try:
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(status_url, headers=headers) as response:
                    if response.status != 200:
                        return {"available": False}
                    data = await response.json()
        except Exception:
            return {"available": False}
        if not isinstance(data, dict):
            return {"available": False}
        data["available"] = True
        return data

    @app.get("/api/system/log")
    async def system_log(request: Request, limit: int = 100, level: str | None = None) -> dict[str, Any]:
        """Die letzten Warnungen und Fehler des Hubs.

        Damit beantwortet die App die Frage «warum ist nichts passiert»,
        ohne dass jemand per SSH ins Container-Log steigen muss.
        """
        require(request, Capability.EDIT_CONFIG)
        return {
            "entries": hub.log_buffer.entries(limit=min(500, max(1, limit)), level=level)
        }

    @app.get("/api/automations/conflicts")
    async def automation_conflicts(request: Request) -> dict[str, Any]:
        """Abläufe, die dasselbe Gerät gegensätzlich schalten.

        Kein Fehler – manchmal ist genau das gewollt. Aber wenn nachts das
        Licht von selbst angeht, sucht man diese Liste.
        """
        require(request, Capability.EDIT_AUTOMATIONS)
        return {"conflicts": automation_module.find_conflicts(hub.automations.automations)}

    @app.get("/api/automations/{automation_id}/runs")
    async def automation_runs(automation_id: str, request: Request) -> dict[str, Any]:
        """Der Verlauf genau dieses Ablaufs – was er tat und was nicht."""
        require(request, Capability.EDIT_AUTOMATIONS)
        return {
            "runs": [
                run
                for run in hub.automations.runs
                if run.get("automation_id") == automation_id
            ][:50]
        }

    # ── Papierkorb ─────────────────────────────────────────────────────────

    @app.get("/api/trash")
    async def list_trash(request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        rows = trash_module.purge(hub.data.get("trash"))
        hub.data.set("trash", rows)
        return {
            "trash": [
                {k: v for k, v in row.items() if k != "item"} | {"id": (row.get("item") or {}).get("id")}
                for row in rows
            ],
            "keep_days": trash_module.KEEP_DAYS,
        }

    @app.post("/api/trash/{kind}/{item_id}/restore")
    async def restore_from_trash(kind: str, item_id: str, request: Request) -> dict[str, Any]:
        """Gelöschtes zurückholen – es landet wieder dort, wo es herkam."""
        require(request, Capability.EDIT_AUTOMATIONS)
        if kind not in ("scene", "automation"):
            raise HTTPException(status_code=400, detail="Unbekannte Art")
        row, rest = trash_module.take(hub.data.get("trash"), kind, item_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Nicht (mehr) im Papierkorb")
        key = "scenes" if kind == "scene" else "automations"
        existing = hub.data.get(key)
        if any(entry.get("id") == item_id for entry in existing):
            raise HTTPException(status_code=409, detail="Gibt es schon wieder")
        hub.data.set(key, [*existing, row["item"]])
        hub.data.set("trash", rest)
        if kind == "scene":
            hub.reload_scenes()
        else:
            await hub.reload_automations()
        return {"ok": True, "restored": row["name"]}

    @app.delete("/api/trash")
    async def empty_trash(request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        hub.data.set("trash", [])
        return {"ok": True}

    @app.get("/api/entities/{entity_id}/events")
    async def camera_events(
        entity_id: str, request: Request, hours: int = 24
    ) -> dict[str, Any]:
        """Zeitleiste einer Kamera: Bewegungen und Klingeln der letzten Stunden.

        «Letzte Bewegung um 16:45» beantwortet nur die halbe Frage – man
        will wissen, was über den Tag los war. Kann die Integration das
        nicht, kommt eine leere Liste statt eines Fehlers.
        """
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        service = hub.integrations.get(entity.integration)
        getter = getattr(service, "events", None)
        if not callable(getter):
            return {"events": [], "supported": False}
        try:
            events = await getter(entity, hours=max(1, min(72, hours)))
        except Exception as err:
            log.debug("Ereignisse von %s nicht abrufbar: %s", entity_id, err)
            return {"events": [], "supported": True}
        return {"events": events, "supported": True}

    @app.get("/api/system/audit")
    async def system_audit(
        request: Request, limit: int = 200, entity_id: str | None = None
    ) -> dict[str, Any]:
        """Zugriffsprotokoll: wer hat wann was geschaltet."""
        require(request, Capability.EDIT_CONFIG)
        return {"entries": hub.audit.entries(limit=min(500, max(1, limit)), entity_id=entity_id)}

    @app.get("/api/config/history")
    async def config_history(request: Request) -> dict[str, Any]:
        """Frühere Fassungen der config.yaml (jüngste zuerst)."""
        require(request, Capability.EDIT_CONFIG)
        return {"versions": confighistory.versions(config_path())}

    @app.get("/api/config/history/{name}")
    async def config_history_read(name: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        try:
            return {"name": name, "content": confighistory.read(config_path(), name)}
        except (ValueError, FileNotFoundError) as err:
            raise HTTPException(status_code=404, detail=f"Fassung nicht gefunden: {err}") from err

    @app.post("/api/config/history/{name}/restore")
    async def config_history_restore(name: str, request: Request) -> dict[str, Any]:
        """Eine frühere Fassung zurückholen.

        Sie läuft durch dieselbe Prüfung wie jede Änderung - und der
        aktuelle Stand wird vorher seinerseits gesichert, damit auch das
        Zurückholen umkehrbar bleibt.
        """
        require(request, Capability.EDIT_CONFIG)
        try:
            content = confighistory.read(config_path(), name)
        except (ValueError, FileNotFoundError) as err:
            raise HTTPException(status_code=404, detail=f"Fassung nicht gefunden: {err}") from err
        return {**save_config(content), "restored": name}

    @app.get("/api/system/backups")
    async def list_backups(request: Request) -> dict[str, Any]:
        """Vorhandene Sicherungen der App-Daten (jüngste zuerst)."""
        require(request, Capability.EDIT_CONFIG)
        return {"backups": hub.data.backups()}

    @app.post("/api/system/backup")
    async def make_backup(request: Request) -> dict[str, Any]:
        """Jetzt eine Sicherung anlegen – ergänzt die tägliche Automatik."""
        require(request, Capability.EDIT_CONFIG)
        result = hub.data.backup()
        if result is None:
            raise HTTPException(
                status_code=400,
                detail="Ohne Datei-Speicher (z.B. reiner Demo-Hub) gibt es nichts zu sichern",
            )
        return {"ok": True, "backup": result, "backups": hub.data.backups()}

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
        hub.audit.record(
            user.name, entity, body.command, throttle_module.client_address(request)
        )
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

    @app.put("/api/entities/{entity_id}/meta")
    async def set_entity_meta(
        entity_id: str, body: MetaRequest, request: Request
    ) -> dict[str, Any]:
        """Anzeigename, Favorit oder Gruppe einer Entität setzen.

        Für «Gerät umbenennen», die Favoriten-Reihe auf der Startseite und
        das Gruppieren mehrerer Geräte. Bleibt in der homepilot-data.json."""
        require(request, Capability.EDIT_CONFIG)
        if hub.registry.get(entity_id) is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        await hub.set_entity_meta(
            entity_id,
            name=body.name,
            favorite=body.favorite,
            group=body.group,
        )
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
            "transition": body.transition,
            "category": body.category,
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
                "transition": body.transition,
                "category": body.category,
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
        gone = next(entry for entry in stored if entry["id"] == scene_id)
        hub.data.set("scenes", remaining)
        hub.data.set(
            "trash",
            trash_module.put(hub.data.get("trash"), "scene", gone, _user_name(request)),
        )
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
            "otherwise": body.otherwise,
            "enabled": body.enabled,
            "match": body.match,
            "category": body.category,
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
                "otherwise": body.otherwise,
                "enabled": body.enabled,
                "match": body.match,
                "category": body.category,
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
        gone = next(entry for entry in stored if entry["id"] == automation_id)
        hub.data.set("automations", remaining)
        hub.data.set(
            "trash",
            trash_module.put(
                hub.data.get("trash"), "automation", gone, _user_name(request)
            ),
        )
        await hub.reload_automations()
        return {"ok": True}

    @app.get("/api/automations/runs")
    async def automation_runs(request: Request) -> dict[str, Any]:
        """Was die Abläufe zuletzt getan haben – und was nicht, mit Grund.

        Der häufigste Support-Fall lautet «der Ablauf geht nicht». Ohne
        diese Liste bleibt nur Raten, ob der Auslöser ausblieb oder eine
        Bedingung im Weg war.
        """
        require(request, Capability.VIEW_AUTOMATIONS)
        return {"runs": hub.automations.runs}

    @app.post("/api/automations/{automation_id}/duplicate")
    async def duplicate_automation(automation_id: str, request: Request) -> dict[str, Any]:
        """Kopie anlegen – sechs fast gleiche Taster-Abläufe tippt niemand."""
        require(request, Capability.EDIT_AUTOMATIONS)
        import secrets as _secrets

        source = next(
            (entry for entry in stored_automations() if entry["id"] == automation_id),
            None,
        )
        if source is None:
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Abläufe lassen sich kopieren",
            )
        copy = {
            **source,
            "id": f"app_{_secrets.token_hex(4)}",
            "alias": f"{source.get('alias', 'Ablauf')} (Kopie)",
        }
        hub.data.set("automations", [*stored_automations(), copy])
        await hub.reload_automations()
        return {"automation": copy}

    @app.post("/api/automations/{automation_id}/trigger")
    async def trigger_automation(automation_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        ok = await hub.automations.trigger_now(automation_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Ablauf nicht gefunden")
        return {"ok": True}

    @app.get("/api/automations/{automation_id}/dryrun")
    async def dry_run_automation(automation_id: str, request: Request) -> dict[str, Any]:
        """Zeigt, was der Ablauf jetzt täte – ohne es zu tun.

        Der Testlauf über /trigger führt wirklich aus. Das schreckt bei
        allem ab, was die Storen bewegt oder die Familie anpiepst, und
        gerade dort will man vorher wissen, ob die Bedingungen passen.
        """
        require(request, Capability.VIEW_AUTOMATIONS)
        found = next(
            (item for item in hub.automations.automations if item.id == automation_id),
            None,
        )
        if found is None:
            raise HTTPException(status_code=404, detail="Ablauf nicht gefunden")
        return hub.automations.dry_run(found)

    @app.get("/api/hue/scenes")
    async def hue_scenes(request: Request) -> dict[str, Any]:
        """Die auf der Hue-Bridge gespeicherten Szenen.

        Sie gehören der Bridge: Farben und Helligkeiten stecken dort, und
        nur sie kann eine Szene in einem Zug setzen. Der Hub ruft sie auf,
        baut sie aber nicht nach.
        """
        require(request, Capability.VIEW_AUTOMATIONS)
        hue = hub.integrations.get("hue")
        if hue is None or not hasattr(hue, "scenes"):
            return {"scenes": [], "reason": "keine Hue-Bridge verbunden"}
        return {"scenes": hue.scenes()}

    @app.get("/api/appliances/cycles")
    async def appliance_cycles(request: Request) -> dict[str, Any]:
        """Wie oft und wie lange die Haushaltgeräte laufen.

        Neben Anzahl und Durchschnitt steht der letzte Lauf – erst der
        Vergleich sagt, ob ein Gerät schleichend länger braucht.
        """
        require(request, Capability.VIEW_SYSTEM)
        cycles = hub.data.get("appliance_cycles")
        return {
            "stats": watchdog.cycle_stats(cycles),
            "cycles": cycles[:30],
        }

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

    @app.get("/api/energy/months")
    async def energy_months(request: Request) -> dict[str, Any]:
        """Diesen Monat mit dem letzten vergleichen.

        Der Vergleich mit demselben Zeitraum steht bewusst daneben: Am 3.
        des Monats sieht der bisherige Verbrauch neben einem vollen
        Vormonat nach einer Ersparnis aus, die es nicht gibt.
        """
        require(request, Capability.VIEW_SYSTEM)
        today = datetime.now().strftime("%Y-%m-%d")
        days = hub.data.get("energy_days")
        totals = energy_module.month_totals(days, today)
        # Hochrechnung und Vorjahr gehören daneben: «312 statt 280 wie
        # letztes Jahr» sagt mehr als eine nackte Zwischensumme.
        totals["forecast"] = energy_module.forecast(totals, today)
        totals["year_ago_kwh"] = energy_module.year_ago(days, totals["month"])
        return totals

    @app.get("/api/energy/devices")
    async def energy_devices(request: Request) -> dict[str, Any]:
        """Wohin die Kilowattstunden gehen - und was dauernd zieht.

        Zwei Fragen, eine Antwort: Die Rangliste zeigt den heutigen
        Verbrauch, die Standby-Liste alles, was rund um die Uhr Strom
        zieht, mit den Kosten aufs Jahr gerechnet.
        """
        user = require(request, Capability.VIEW_SYSTEM)
        visible = [
            entity
            for entity in hub.registry.all()
            if user.may_see(entity.id, entity.kind, entity.integration)
        ]
        price = float((hub.config.energy or {}).get("price_per_kwh") or 0)
        return {
            "top": energy_module.top_consumers(visible),
            "standby": energy_module.standby_costs(visible, price),
            "price_per_kwh": price or None,
            "currency": (hub.config.energy or {}).get("currency") or "CHF",
        }

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

    # ── Persönliche Oberflächen-Einstellungen ──────────────────────────────
    # Kachel-Reihenfolgen und Ähnliches: je Benutzer gespeichert, damit jedes
    # Gerät derselben Person dieselbe Ansicht zeigt. Der Inhalt gehört der
    # App – der Hub prüft nur, dass es ein Objekt in vernünftiger Grösse ist.

    @app.get("/api/prefs")
    async def get_prefs(request: Request) -> dict[str, Any]:
        user = current_user(request)
        for entry in hub.data.get("user_prefs"):
            if isinstance(entry, dict) and entry.get("user") == user.name:
                stored = entry.get("prefs")
                return {"prefs": stored if isinstance(stored, dict) else {}}
        return {"prefs": {}}

    @app.put("/api/prefs")
    async def put_prefs(body: PrefsRequest, request: Request) -> dict[str, Any]:
        user = current_user(request)
        if len(json.dumps(body.prefs, ensure_ascii=False)) > PREFS_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Die persönlichen Einstellungen sind zu gross geworden.",
            )
        entries = [
            entry
            for entry in hub.data.get("user_prefs")
            if isinstance(entry, dict) and entry.get("user") != user.name
        ]
        entries.append({"user": user.name, "prefs": body.prefs})
        hub.data.set("user_prefs", entries)
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

    # ── Alarmanlage ────────────────────────────────────────────────────────

    def alarm_service():
        service = hub.integrations.get("alarm")
        if service is None:
            raise HTTPException(status_code=503, detail="Alarmanlage nicht geladen")
        return service

    @app.get("/api/alarm")
    async def alarm_overview(request: Request) -> dict[str, Any]:
        """Zustand, Zuordnung und alle Sensoren, die in Frage kommen.

        Die Kandidatenliste kommt vom Hub statt aus der App: Nur er weiss,
        welche Entität wirklich einen Öffnungs- oder Bewegungszustand
        meldet – die App müsste es raten.
        """
        require(request, Capability.EDIT_CONFIG)
        service = alarm_service()
        return {
            "state": service._entity.as_dict()["state"],
            **service.config_dict(),
            "history": service.history,
            "candidates": [
                {
                    "entity_id": entity.id,
                    "name": entity.name,
                    "room": entity.room,
                    "kind": entity.kind,
                    "device_class": entity.state.get("device_class"),
                    "open": alarm_module.sensor_open(entity),
                    "available": entity.available,
                }
                for entity in service.candidates()
            ],
        }

    @app.put("/api/alarm")
    async def alarm_configure(body: dict[str, Any], request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        service = alarm_service()
        await service.update_config(body)
        return {"ok": True, **service.config_dict()}

    @app.post("/api/alarm/arm")
    async def alarm_arm(body: AlarmArmRequest, request: Request) -> dict[str, Any]:
        """Scharf schalten. Offene Fenster melden statt blind loszulaufen –
        sonst schlägt die Anlage los, sobald die Verzögerung endet."""
        user = require(request, Capability.CONTROL)
        service = alarm_service()
        try:
            return await service.arm(body.mode, force=body.force, by=user.name)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.post("/api/alarm/disarm")
    async def alarm_disarm(request: Request) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        return await alarm_service().disarm(by=user.name)

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
                    expires=body.expires or None,
                    hours=users_module.parse_hours(body.hours),
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
            updated = hub.users.update(
                name,
                enabled=body.enabled,
                features=body.features,
                expires=body.expires,
                hours=body.hours,
            )
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        return {"user": updated.as_dict()}

    @app.post("/api/users/{name}/token")
    async def rotate_user_token(name: str, request: Request) -> dict[str, Any]:
        """Ein frisches Token ausstellen, das alte sofort ungültig machen.

        Für den Ernstfall gedacht: Ein Token ist irgendwo gelandet, wo es
        nicht hingehört. Wer sein eigenes wechselt, fliegt damit selbst
        raus - das ist beabsichtigt und steht in der Antwort.
        """
        actor = require(request, Capability.MANAGE_USERS)
        try:
            token = hub.users.rotate_token(name)
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        log.warning("Token von '%s' wurde durch '%s' ersetzt", name, actor.name)
        from ..qr import setup_payload

        return {
            "ok": True,
            "name": name,
            "token": token,
            "self": actor.name == name,
            "payload": setup_payload(
                hub.config.api.host, hub.config.api.port, token, name
            ),
        }

    # ── Geofence ───────────────────────────────────────────────────────────

    @app.post("/api/presence/geofence")
    async def report_geofence(body: GeofenceRequest, request: Request) -> dict[str, Any]:
        """Das Telefon meldet Ankommen oder Weggehen.

        Aufgerufen von den iOS-Kurzbefehlen («Wenn ich ankomme» → Inhalte
        von URL abrufen) oder von Tasker. Bewusst ein eigener Endpunkt und
        kein Kommando: Eine Zone ist nichts, was sich schalten lässt.
        """
        user = current_user(request)
        service = hub.integrations.get("geofence")
        if service is None:
            raise HTTPException(
                status_code=503,
                detail="Die geofence-Integration ist nicht eingerichtet",
            )
        # Ohne Angabe gilt der eigene Name - so genügt im Kurzbefehl die
        # Adresse plus das Ereignis.
        zone = body.zone or user.name.lower()
        try:
            state = await service.report(zone, body.event)
        except KeyError:
            raise HTTPException(
                status_code=404, detail=f"Unbekannte Zone: {zone}"
            ) from None
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        return {"ok": True, "zone": zone, "state": state}

    # ── Einmal-Türöffnung ──────────────────────────────────────────────────

    def pass_base_url() -> str | None:
        return str((hub.config.push or {}).get("public_url") or "") or None

    @app.get("/api/passes")
    async def list_passes(request: Request) -> dict[str, Any]:
        require(request, Capability.MANAGE_USERS)
        base = pass_base_url()
        return {"passes": [entry.as_dict(base) for entry in hub.passes.all()]}

    @app.post("/api/passes")
    async def create_pass(body: PassRequest, request: Request) -> dict[str, Any]:
        """Einen Einmal-Link ausstellen.

        Nur für Geräte, die der Ausstellende auch selbst bedienen dürfte -
        sonst wäre der Link ein Weg, die eigenen Grenzen zu umgehen.
        """
        user = require(request, Capability.MANAGE_USERS)
        entity = hub.registry.get(body.entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail="Unbekanntes Gerät")
        if body.command not in entity.commands:
            raise HTTPException(
                status_code=400,
                detail=f"'{entity.name}' kennt den Befehl '{body.command}' nicht",
            )
        entry = hub.passes.create(
            entity_id=body.entity_id,
            command=body.command,
            created_by=user.name,
            minutes=body.minutes,
            label=body.label,
        )
        log.warning(
            "Einmal-Link für %s (%s) ausgestellt von %s, gültig %d Minuten",
            entity.name,
            body.command,
            user.name,
            max(1, min(guestpass.MAX_MINUTES, body.minutes)),
        )
        base = pass_base_url()
        if base is None:
            log.warning(
                "Ohne 'push.public_url' in der config.yaml kennt der Hub seine "
                "Adresse von aussen nicht - der Link muss von Hand gebaut werden."
            )
        return {"ok": True, "pass": entry.as_dict(base)}

    @app.delete("/api/passes/{token}")
    async def revoke_pass(token: str, request: Request) -> dict[str, Any]:
        require(request, Capability.MANAGE_USERS)
        return {"ok": hub.passes.revoke(token)}

    @app.post("/einmal/{token}")
    @app.get("/einmal/{token}")
    async def redeem_pass(token: str, request: Request) -> Response:
        """Den Link einlösen - ohne Anmeldung, dafür genau einmal.

        Bewusst auch per GET: Der Empfänger tippt die Adresse an, sonst
        bräuchte er ein Formular. Die Adresse selbst ist das Geheimnis.
        """
        # Auch hier die Bremse: Sonst liesse sich der Token-Raum in Ruhe
        # durchprobieren, wenn jemand die Adresse kennt.
        address = throttle_module.client_address(request)
        waiting = throttle.blocked_for(address)
        if waiting > 0:
            return Response(
                content="Zu viele Versuche. Später nochmal.",
                status_code=429,
                media_type="text/plain; charset=utf-8",
            )
        try:
            entry = hub.passes.redeem(token)
        except KeyError:
            throttle.failed(address)
            return Response(
                content="Dieser Link gilt nicht mehr.",
                status_code=410,
                media_type="text/plain; charset=utf-8",
            )
        throttle.succeeded(address)
        entity = hub.registry.get(entry.entity_id)
        if entity is None:
            return Response(
                content="Das Gerät gibt es nicht mehr.",
                status_code=404,
                media_type="text/plain; charset=utf-8",
            )
        hub.audit.record(f"Einmal-Link von {entry.created_by}", entity, entry.command, address)
        log.warning(
            "Einmal-Link eingelöst: %s → %s (von %s)", entity.name, entry.command, address
        )
        try:
            with as_source(user_source(f"Einmal-Link ({entry.created_by})")):
                await hub.integrations.dispatch_command(entry.entity_id, entry.command, {})
        except HomePilotError as err:
            return Response(
                content=f"Hat nicht geklappt: {err}",
                status_code=502,
                media_type="text/plain; charset=utf-8",
            )
        return Response(
            content=f"{entity.name}: erledigt. Dieser Link gilt jetzt nicht mehr.",
            media_type="text/plain; charset=utf-8",
        )

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
    app.mount("/", StaticFiles(directory=str(folder), html=True), name="web")
    log.info("Web-Fassung der App wird aus %s ausgeliefert", folder)
