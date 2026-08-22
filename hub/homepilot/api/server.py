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
from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import qr as qr_module
from ..core import automation as automation_module
from ..core import (
    config_edit,
    confighistory,
    guestpass,
    maintenance,
    notifyrules,
    push,
    say,
    snapshots,
    suggest,
    supabase_auth,
    watchdog,
)
from ..core import energy as energy_module
from ..core import goodnight as goodnight_module
from ..core import hausblatt as hausblatt_module
from ..core import replace as replace_module
from ..core import shopping as shopping_module
from ..core import throttle as throttle_module
from ..core import trash as trash_module
from ..core import users as users_module
from ..core.config import ConfigError, load_config
from ..core.config_edit import add_cast_device
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
from ..integrations import alarm as alarm_module
from ..integrations import group as group_module
from . import invitepage

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
    # Was geschieht, wenn er noch läuft und erneut ausgelöst wird:
    # «single» verwirft den zweiten Auslöser, «restart» beginnt von vorn
    # (Nachlauf, siehe core/automation.py).
    mode: str = "single"
    # «all» = alle Bedingungen müssen stimmen, «any» = eine genügt.
    match: str = "all"
    # Frei gewählter Name zum Gruppieren in der App.
    category: str | None = None
    # Bis wann der Ablauf ruht: Unix-Sekunden oder ein ISO-Zeitstempel.
    # Anders als «enabled: false» meldet er sich von selbst zurück.
    quiet_until: float | str | None = None


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


class NotifyRuleRequest(BaseModel):
    """Änderung an einer eingebauten Wächter-Nachricht (Abläufe → Push)."""

    enabled: bool = True
    params: dict[str, float] = {}


class GoodNightRequest(BaseModel):
    """Einstellungen des Gute-Nacht-Knopfs."""

    night_lights: list[str] = []
    arm_alarm: bool = False


class VoucherRequest(BaseModel):
    """Ein WLAN-Gutschein fürs Captive Portal."""

    hours: float = 24
    note: str = ""


class TimerRequest(BaseModel):
    """Ein Küchen-Timer: Minuten und was danach gesagt wird."""

    minutes: float
    text: str = ""


class BroadcastRequest(BaseModel):
    """Eine Durchsage an die Lautsprecher im Haus."""

    text: str
    # Leer = alle Cast-Boxen; sonst nur die genannten.
    speakers: list[str] = []
    # Lautstärke in Prozent für die Durchsage (None = so lassen).
    volume: int | None = None


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
    # Kinder-Ansicht: nur diese Räume, als grosse Knöpfe.
    simple_rooms: list[str] = []


class UserUpdateRequest(BaseModel):
    enabled: bool | None = None
    features: list[str] | None = None
    # Ablaufdatum als "JJJJ-MM-TT"; leerer Text hebt es auf.
    expires: str | None = None
    # Zeitfenster {"from": "07:00", "to": "20:00"}; leer hebt es auf.
    hours: dict[str, str] | None = None
    # Kinder-Ansicht an/aus bzw. Räume ändern; leere Liste hebt sie auf.
    simple_rooms: list[str] | None = None


class LoginRequest(BaseModel):
    """Anmeldung mit E-Mail und Passwort."""

    email: str
    password: str
    # Name des Geräts – damit man in der Sitzungsliste sieht, welches
    # Telefon das war.
    label: str = ""


class PasswordRequest(BaseModel):
    """Passwort setzen mit dem Ticket aus der Einladungs-E-Mail."""

    access_token: str
    password: str


class RecoverRequest(BaseModel):
    email: str


class UpdateTriggerRequest(BaseModel):
    """Was der Update-Knopf mitschickt. Auf Modulebene, wie alle Modelle
    hier - lokal definiert hielte FastAPI den Body für Query-Parameter."""

    # Zusätzlich einen iOS-Build auf den EAS-Servern anstossen. Kostet
    # Bauminuten im Kontingent und erzeugt eine TestFlight-Fassung -
    # deshalb eine bewusste Wahl in der App, nie die Vorgabe.
    ios: bool = False


class EmailRequest(BaseModel):
    """Anmelde-Adresse eines Benutzers setzen (leer = löschen)."""

    email: str | None = None


class GeofenceRequest(BaseModel):
    """Ortswechsel eines Telefons: enter/leave (oder home/away)."""

    event: str
    # Ohne Zone gilt der Name des angemeldeten Benutzers.
    zone: str | None = None


class PassTarget(BaseModel):
    entity_id: str
    command: str = "unlatch"


class PassRequest(BaseModel):
    """Ein Einmal-Link: ein bis mehrere Türen, wenige Minuten.

    Mehrere, weil im Mehrfamilienhaus ein Paket beides braucht – Haustüre
    und Wohnungstüre. Die alte Form mit einem einzelnen Gerät bleibt
    gültig, damit bestehende Kurzbefehle weiterlaufen.
    """

    targets: list[PassTarget] | None = None
    entity_id: str | None = None
    command: str = "unlatch"
    minutes: int = guestpass.DEFAULT_MINUTES
    # Festes Fenster statt «ab jetzt für N Minuten» – ISO-Zeitpunkte mit
    # Zone, so wie sie das Telefon kennt. Ohne beides zählen die Minuten.
    starts: str | None = None
    ends: str | None = None
    label: str = ""

    def wanted(self) -> list[PassTarget]:
        if self.targets:
            return self.targets
        if self.entity_id:
            return [PassTarget(entity_id=self.entity_id, command=self.command)]
        return []


def moment(text: str | None) -> float:
    """ISO-Zeitpunkt aus der App in Unix-Zeit (rein, testbar).

    Die App schickt die Zone mit ("2026-08-21T09:00:00+02:00"). Fehlt sie
    trotzdem, gilt die Zeit des Hubs – der steht im selben Haus wie die
    Türe, das ist die vernünftigere Annahme als UTC.
    """
    if not text:
        return 0.0
    try:
        stamp = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as err:
        raise ValueError(f"Unlesbarer Zeitpunkt: {text}") from err
    if stamp.tzinfo is None:
        stamp = stamp.astimezone()
    return stamp.timestamp()


class LightGroupRequest(BaseModel):
    """Mehrere Lampen zu einer Leuchte zusammenfassen."""

    name: str
    members: list[str]
    # light (Standard) oder switch.
    kind: str = "light"
    # Sollen die Einzelnen aus Räumen, Suche und Zählung verschwinden?
    # Standard ja - das ist der Fall, für den es die Zusammenfassung gibt.
    hide_members: bool = True


class PrefsRequest(BaseModel):
    prefs: dict[str, Any]


# Obergrenze der persönlichen Einstellungen je Benutzer - genug für viele
# Reihenfolgen, zu wenig, um die Datendatei zu fluten.
PREFS_BYTES = 32_768

# Dasselbe für die haushaltsweiten Einstellungen. Grosszügiger, weil dort
# die Reihenfolgen aller Ansichten zusammenkommen - aber immer noch eine
# Grenze: Was hier landet, ist eine Handvoll Listen von Kennungen, keine
# Ablage für Beliebiges.
HOUSE_PREFS_BYTES = 131_072


class ConfigRequest(BaseModel):
    content: str


class RoomRequest(BaseModel):
    room: str | None = None


class AlarmArmRequest(BaseModel):
    mode: str
    # Trotz offener Fenster scharf schalten – bewusste Entscheidung des
    # Benutzers, nachdem ihm gesagt wurde, was offen ist.
    force: bool = False


class AlarmDisarmRequest(BaseModel):
    """Entschärfen – mit PIN, falls eine gesetzt ist."""

    pin: str = ""


class AlarmPinRequest(BaseModel):
    """PIN fürs Entschärfen setzen; leer = entfernen."""

    pin: str = ""


class MetaRequest(BaseModel):
    """Anzeigename, Favorit oder Gruppe – nur gesetzte Felder ändern sich."""

    name: str | None = None
    favorite: bool | None = None
    group: str | None = None


# Was in der App steht, wenn der Update-Dienst auf dem Server den
# iOS-Schalter nicht kennt. Ein nacktes «404 Nicht gefunden» schickte die
# Suche in die falsche Richtung; und weil der übliche Rat (einmal neu
# starten) nicht immer greift, steht hier auch, wie man nachsieht, was
# wirklich auf dem Port horcht - ein von Hand gestarteter Prozess von
# früher belegt ihn sonst weiter, und der Neustart des Dienstes ändert
# nichts.
STALE_LISTENER_HINT = (
    "Der Update-Dienst auf dem Server ist noch eine ältere Fassung, die den "
    "iOS-Schalter nicht kennt. «Nur Hub» funktioniert davon unberührt.\n"
    "1. Auf dem Server: sudo systemctl restart homepilot-update\n"
    "2. Ändert das nichts, horcht dort vermutlich noch ein alter Prozess "
    "von Hand. Nachsehen mit: sudo ss -lptn 'sport = :9126' - läuft dort "
    "etwas ausserhalb von homepilot-update, dieses beenden und den Dienst "
    "erneut starten.\n"
    "3. Was der Dienst kann, sagt er selbst: curl -s http://127.0.0.1:9126/"
)

# Der zweite stille Weg, auf dem ein iOS-Build ausbleibt: Gebaut wird auf
# den EAS-Servern, und dafür braucht der Docker-Host einen Zugangs-Token.
# Fehlt er, baut das Skript den Hub fertig und überspringt den iOS-Teil -
# das Update meldet «fertig», und in TestFlight kommt nie etwas an.
MISSING_EXPO_TOKEN_HINT = (
    "Auf dem Server fehlt der Zugang zu EAS - ohne ihn lässt sich kein "
    "iOS-Build anstossen. Der Hub selbst liesse sich mit «Nur Hub» "
    "aktualisieren.\n"
    "1. Token erzeugen auf expo.dev → Account settings → Access tokens.\n"
    "2. Auf dem Server eintragen: echo 'EXPO_TOKEN=…' | sudo tee -a "
    "/opt/homepilot/github-credentials.env\n"
    "3. Danach: sudo systemctl restart homepilot-update"
)


async def listener_status(
    status_url: str, headers: dict[str, str]
) -> dict[str, Any] | None:
    """Was der Update-Dienst auf dem Host über sich sagt – oder None.

    None heisst ausdrücklich «unbekannt», nicht «kann nichts»: Ältere
    Fassungen kennen die Auskunft noch nicht, und ein Portainer-Webhook
    hat gar kein /status. In beiden Fällen wird wie bisher losgeschickt
    und erst die Antwort ausgewertet – hier etwas zu blockieren, würde
    ein funktionierendes Update verhindern, um einen Hinweis zu geben.
    """
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(status_url, headers=headers) as response:
                if response.status != 200:
                    return None
                data = await response.json(content_type=None)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


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
    async def trigger_update(
        request: Request, body: UpdateTriggerRequest | None = None
    ) -> dict[str, Any]:
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
        wants_ios = bool(body and body.ios)
        # Nur update-listener.py versteht den iOS-Parameter - und auch der
        # erst in seiner heutigen Fassung. Seine Antwort verrät, ob er ihn
        # verstanden hat («Bau gestartet (mit iOS-Build)») - daran erkennt
        # der Hub eine veraltete Fassung und kann es sagen, statt dass der
        # iOS-Build kommentarlos ausbleibt.
        is_listener = url.rstrip("/").endswith("/update")
        status_url = url.rstrip("/")[: -len("/update")] + "/status"
        # Ein Dienst, der auf dem Host baut, darf nicht ohne Nachweis
        # anspringen. Der Portainer-Webhook braucht dagegen keinen – seine
        # Adresse ist selbst das Geheimnis.
        secret = str((hub.config.update or {}).get("token") or "")
        headers = {"Authorization": f"Bearer {secret}"} if secret else {}

        if wants_ios and is_listener:
            # Vorher fragen statt hinterher rätseln: Neuere Fassungen des
            # Dienstes sagen unter /status, was sie können und ob der
            # Zugang zu EAS bereitliegt. Stimmt eines nicht, wird gar
            # nicht erst gebaut - sonst liefe ein Update durch, das den
            # iOS-Build stillschweigend weglässt, und in TestFlight käme
            # nichts an, ohne dass irgendwo stünde warum.
            status = await listener_status(status_url, headers)
            features = (status or {}).get("features")
            if isinstance(features, list) and "ios" not in [str(f) for f in features]:
                raise HTTPException(status_code=502, detail=STALE_LISTENER_HINT)
            if (status or {}).get("expo_token") is False:
                raise HTTPException(status_code=502, detail=MISSING_EXPO_TOKEN_HINT)

        if wants_ios:
            # Nur der Listener versteht den Parameter; einem
            # Portainer-Webhook schadet er nicht, er ignoriert ihn.
            url += ("&" if "?" in url else "?") + "ios=1"
        log.warning(
            "Update angefordert von %s%s",
            user.name,
            " (mit iOS-Build)" if wants_ios else "",
        )
        try:
            timeout = aiohttp.ClientTimeout(total=30)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, headers=headers) as response:
                    text = (await response.text())[:200]
                    if response.status == 403:
                        # Der Listener kennt nur einen Grund für 403: Das
                        # Geheimnis passt nicht. Das steht an zwei Orten,
                        # und wer eines davon dreht, sucht sonst lange.
                        raise HTTPException(
                            status_code=502,
                            detail=(
                                "Das Update-Geheimnis stimmt nicht überein. Es muss "
                                "an zwei Stellen gleich sein: 'update.token' des "
                                "Hubs (Umgebungsvariable UPDATE_SECRET) und "
                                "UPDATE_SECRET in /opt/homepilot/"
                                "github-credentials.env auf dem Host. Nach dem "
                                "Ändern dort: systemctl restart homepilot-update."
                            ),
                        )
                    if response.status == 409:
                        # Der Dienst baut schon. Früher hat er trotzdem
                        # «Bau gestartet» geantwortet - wer während der
                        # Wartezeit auf Portainer nochmals drückte, bekam
                        # eine Bestätigung und nichts weiter.
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                "Es läuft bereits ein Update. Dieser Wunsch "
                                "wurde nicht übernommen - warte, bis der "
                                "laufende Bau fertig ist, und drücke dann "
                                "erneut. Der Fortschritt steht oben."
                            ),
                        )
                    if response.status == 404 and wants_ios and is_listener:
                        # Die ältesten Fassungen des Listeners vergleichen
                        # den Pfad mitsamt Anhang - «/update?ios=1» passt
                        # dann nicht auf «/update», und es kommt 404. Ohne
                        # Übersetzung stünde hier nur «Nicht gefunden», und
                        # die Suche ginge in die falsche Richtung.
                        raise HTTPException(
                            status_code=502, detail=STALE_LISTENER_HINT
                        )
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
        if wants_ios and is_listener and "ios" not in text.lower():
            return {"ok": True, "ios_ignored": True}
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

    @app.get("/api/automations/{automation_id}/diagnose")
    async def automation_diagnose(automation_id: str, request: Request) -> dict[str, Any]:
        """Warum schweigt dieser Ablauf?

        Der Lauf-Verlauf sagt, was gelaufen ist – nicht, ob der Auslöser
        überhaupt ankam. Genau das ist aber der häufigere Fall: ein Melder
        mit leerer Batterie, ein falscher Kanal, ein Zustand, den das Gerät
        nie meldet. Hier steht je Auslöser, wann er zuletzt gefeuert hat
        und wann sich sein Gerät zuletzt überhaupt gemeldet hat.
        """
        require(request, Capability.VIEW_AUTOMATIONS)
        bericht = hub.automations.diagnose(automation_id)
        if bericht is None:
            raise HTTPException(status_code=404, detail="Ablauf nicht gefunden")
        return bericht

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
                    turned_off.append(entity.name)
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
                entity.name
                for entity in entities
                if entity.id in set(settings["night_lights"])
                and str(entity.state.get("state")) == "on"
            ],
            "open": [e.name for e in goodnight_module.open_windows(entities)],
            "unlocked": [e.name for e in goodnight_module.unlocked_locks(entities)],
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

    @app.get("/api/system/changes")
    async def system_changes(request: Request) -> dict[str, Any]:
        """Was dieses Update mitbrachte - für die «Was ist neu»-Karte.

        Die Liste (Commit-Betreffzeilen seit dem vorherigen Stand) legt
        das Bau-Skript als changes.txt neben den Code. Ohne Datei oder
        leer: einfach nichts anzeigen - besser keine Karte als eine
        erfundene.
        """
        current_user(request)
        commit = os.environ.get("HOMEPILOT_COMMIT", "unbekannt")
        path = Path(__file__).resolve().parent.parent / "changes.txt"
        try:
            lines = [
                line.strip()
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
        except OSError:
            lines = []
        return {"commit": commit, "changes": lines[:12]}

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
        return {"backups": hub.data.backups(), "offsite": hub.offsite}

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

    @app.get("/api/system/backups/{name}")
    async def download_backup(name: str, request: Request) -> Response:
        """Eine Sicherung herunterladen - für die Kopie ausserhalb des Hubs.

        Die täglichen Sicherungen liegen auf derselben Platte wie das
        Original; gegen einen Plattenschaden hilft nur eine Kopie woanders.
        """
        require(request, Capability.EDIT_CONFIG)
        try:
            payload = hub.data.backup_bytes(name)
        except ValueError as err:
            raise HTTPException(status_code=404, detail=str(err)) from err
        return Response(
            content=payload,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    @app.get("/api/system/hausblatt")
    async def hausblatt_text(request: Request) -> Response:
        """Das Haus auf einem Blatt – für die Ferienvertretung.

        Wer zwei Wochen giesst, bekommt sonst die App in die Hand
        gedrückt. Was er wirklich braucht, passt auf eine Seite – vor
        allem das, was von selbst passiert: Ein Licht, das um 22 Uhr von
        allein ausgeht, erschreckt jemanden, der es nicht weiss.

        Nur, was die anfragende Person auch sehen darf: Ein Gast, dem
        drei Räume freigegeben sind, bekommt kein Blatt über das ganze
        Haus.
        """
        user = current_user(request)
        sichtbar = [
            entity
            for entity in hub.registry.all()
            if user.may_see(entity.id, entity.kind, entity.integration)
        ]
        raeume: dict[str, list[dict[str, Any]]] = {}
        for name in hub.known_rooms():
            raeume[name] = [
                entity.as_dict() for entity in sichtbar if entity.room == name
            ]
        ohne_raum = [entity.as_dict() for entity in sichtbar if not entity.room]
        if ohne_raum:
            raeume["Ohne Raum"] = ohne_raum

        hinweise = [
            "Bedient wird alles über die App – dieselbe Adresse wie im Browser.",
            "Was hier von selbst passiert, lässt sich unter «Abläufe» kurz "
            "abschalten, ohne es zu löschen.",
        ]
        # Die Alarmanlage gehört zum Haus und ist immer geladen – aber
        # ein Gast sieht sie nie, und dann gehört der Hinweis auch nicht
        # aufs Blatt.
        if any(entity.get("kind") == "alarm" for entity in
               (e.as_dict() for e in sichtbar)):
            hinweise.append(
                "Die Alarmanlage ist eingerichtet. Vor dem Weggehen unter "
                "«Alarmanlage» scharf schalten, beim Kommen entschärfen."
            )

        text = hausblatt_module.hausblatt(
            haus="HomePilot – das Haus auf einem Blatt",
            raeume=raeume,
            szenen=[scene.as_dict() for scene in hub.scenes.scenes],
            ablaeufe=[a.as_dict() for a in hub.automations.automations],
            hinweise=hinweise,
        )
        return Response(content=text, media_type="text/plain; charset=utf-8")

    @app.get("/api/system/export")
    async def export_data(request: Request) -> Response:
        """Alles Eigene als eine Datei – Abläufe, Szenen, Listen, Räume.

        Der Unterschied zur Sicherung ist nicht die Technik, sondern wohin
        es geht: Eine Sicherung bleibt im Haus, ein Export landet auf einem
        Telefon oder in einer Mail. Deshalb fehlen hier Token, Sitzungen,
        Push-Geräte und das Zugriffsprotokoll (siehe `SECRETS` in
        persistence.py) – und deshalb darf ihn auch nur auslösen, wer
        ohnehin alles ändern könnte.
        """
        require(request, Capability.EDIT_CONFIG)
        daten = hub.data.export()
        # Ohne Datum im Namen liegen nach dem dritten Mal drei Dateien
        # namens «homepilot-export.json» im Ordner.
        tag = datetime.now().strftime("%Y-%m-%d")
        payload = json.dumps(daten, ensure_ascii=False, indent=2).encode("utf-8")
        return Response(
            content=payload,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="homepilot-{tag}.json"'
            },
        )

    @app.post("/api/system/backups/{name}/restore")
    async def restore_backup(name: str, request: Request) -> dict[str, Any]:
        """Eine Sicherung zurückspielen - für den Tag, an dem jemand
        versehentlich zehn Abläufe gelöscht hat.

        Der aktuelle Stand wird vorher gesichert, danach startet der Hub
        neu: Benutzer, Abläufe und Szenen entstehen beim Start aus der
        Datei, ein halb ausgetauschter Zustand im laufenden Betrieb wäre
        keiner von beiden.
        """
        require(request, Capability.EDIT_CONFIG)
        try:
            hub.data.restore_backup(name)
        except (ValueError, OSError, json.JSONDecodeError) as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        threading.Timer(0.8, _exit_for_restart).start()
        return {
            "ok": True,
            "hinweis": "Zurückgespielt - der Hub startet jetzt neu. Der "
            "vorherige Stand liegt als frische Sicherung daneben.",
        }

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
        # Nur die tatsächlich mitgeschickten Felder weitergeben: group=null
        # heisst «Keine Gruppe» (entfernen) und ist etwas anderes als ein
        # gar nicht mitgeschicktes group.
        await hub.set_entity_meta(entity_id, **body.model_dump(exclude_unset=True))
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

    # Bewusst /log und nicht /events: Unter /events liegt schon die
    # Kamera-Zeitleiste (Bewegungen aus der Integration) - eine zweite
    # Route mit demselben Pfad würde still verschattet.
    @app.get("/api/entities/{entity_id}/log")
    async def entity_log(entity_id: str, request: Request) -> dict[str, Any]:
        """Die letzten Schaltvorgänge dieses Geräts, mit Quelle.

        Beantwortet «warum ging das Licht um drei Uhr an?» ohne Scrollen
        durch den Gesamtverlauf. Das Protokoll lebt im Speicher des Hubs
        und beginnt nach einem Neustart leer - das sagt die App dazu.
        """
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        # Die Spanne kommt mit: Ohne sie kann die App nicht sagen, ob
        # «drei Einträge» wenig Betrieb heisst oder ein junger Hub.
        return {
            "events": hub.eventlog.for_entity(entity_id),
            "log": hub.eventlog.span(),
        }

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
            "mode": body.mode,
            "match": body.match,
            "category": body.category,
            "quiet_until": body.quiet_until,
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
                "mode": body.mode,
                "match": body.match,
                "category": body.category,
                "quiet_until": body.quiet_until,
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
    async def automation_runs_all(request: Request) -> dict[str, Any]:
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
            # Aus der config.yaml. Der lief bisher ins Leere («nur in der
            # App angelegte lassen sich kopieren») – und damit gab es
            # keinen Weg von der Datei zur Bedienbarkeit. Eine Kopie ist
            # genau dieser Weg: Das Original in der Datei bleibt, wie es
            # ist, die Kopie liegt in der App und ist änderbar.
            laufend = hub.automations.get(automation_id)
            if laufend is None:
                raise HTTPException(status_code=404, detail="Ablauf nicht gefunden")
            source = laufend.as_config()
            # Aus der Datei kopiert und dann in der App bearbeitet: Wer
            # den ursprünglichen nicht abschaltet, hat ihn zweimal. Die
            # Kopie kommt deshalb ausgeschaltet – ein Ablauf, der beim
            # Kopieren losgeht, ist eine Überraschung.
            source = {**source, "enabled": False}
        copy = {
            **source,
            "id": f"app_{_secrets.token_hex(4)}",
            "alias": f"{source.get('alias', 'Ablauf')} (Kopie)",
        }
        copy.pop("editable", None)
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

    # ── Eingebaute Wächter-Nachrichten (Abläufe → Push) ────────────────────
    # Global, nicht je Benutzer: Diese Regeln bestimmen, ob und wann der Hub
    # überhaupt meldet. Wer sie nur für sich nicht will, bestellt die
    # Kategorie unter Benachrichtigungen ab.

    @app.get("/api/notifyrules")
    async def list_notify_rules(request: Request) -> dict[str, Any]:
        current_user(request)
        return {"rules": notifyrules.describe(hub.data.get("notify_rules"))}

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
        return {"rules": notifyrules.describe(stored)}

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

    # ── Haushaltsweite Oberflächen-Einstellungen ───────────────────────────
    # Was ausgeblendet ist, was gesperrt, in welcher Reihenfolge die Kacheln
    # stehen, was im Widget liegt: Das prägt die Ansicht des Hauses und soll
    # überall gleich aussehen - auf dem Wandpanel wie auf dem Telefon, bei
    # Stefan wie bei Livia. Früher lag das im Speicher der App und war nach
    # einer Neuinstallation weg.

    @app.get("/api/houseprefs")
    async def get_house_prefs(request: Request) -> dict[str, Any]:
        # Kein require: Wer angemeldet ist, sieht das Haus - und damit die
        # Ansicht, in der es eingerichtet ist. Etwas anderes zu zeigen als
        # das, was da ist, hülfe niemandem.
        current_user(request)
        for entry in hub.data.get("house_prefs"):
            if isinstance(entry, dict):
                stored = entry.get("prefs")
                return {"prefs": stored if isinstance(stored, dict) else {}}
        return {"prefs": {}}

    @app.put("/api/houseprefs")
    async def put_house_prefs(body: PrefsRequest, request: Request) -> dict[str, Any]:
        """Die Ansicht des Hauses ändern.

        CONTROL und nicht EDIT_CONFIG: Hier stehen Oberflächen-Einstellungen,
        keine Rechte. Auch die Sperre ist eine Rückfrage in der App, kein
        Zugangsschutz - sie schützt vor Versehen, nicht vor Absicht. Wer ein
        Gerät schalten darf, darf auch einstellen, wie es dasteht. Die App
        zeigt «Anpassen» trotzdem nur der Besitzerrolle.
        """
        require(request, Capability.CONTROL)
        if len(json.dumps(body.prefs, ensure_ascii=False)) > HOUSE_PREFS_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Die Einstellungen des Hauses sind zu gross geworden.",
            )
        hub.data.set("house_prefs", [{"prefs": body.prefs}])
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
    async def alarm_disarm(
        request: Request,
        # Ohne Body gültig - ältere App-Fassungen schicken keinen, und ohne
        # gesetzte PIN braucht es auch keinen.
        body: AlarmDisarmRequest | None = None,
    ) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        try:
            return await alarm_service().disarm(
                by=user.name,
                pin=(body.pin if body else "") or None,
                address=throttle_module.client_address(request),
            )
        except HomePilotError as err:
            # Falsche oder fehlende PIN - lesbar zurück, kein Stacktrace.
            raise HTTPException(status_code=403, detail=str(err)) from err

    @app.put("/api/alarm/pin")
    async def alarm_set_pin(body: AlarmPinRequest, request: Request) -> dict[str, Any]:
        """PIN fürs Entschärfen setzen oder (leer) entfernen.

        Nur Besitzer: Wer die PIN ändern darf, kann sie auch aushebeln -
        das gehört in dieselben Hände wie die Benutzerverwaltung.
        """
        require(request, Capability.MANAGE_USERS)
        try:
            alarm_service().set_pin(body.pin or None)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        return {"ok": True, "pin_required": alarm_service().pin_required()}

    # ── Push ───────────────────────────────────────────────────────────────

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
        """Die Menschen im Haushalt.

        Ohne den Hub-Token: Der ist ein Zugang für Skripte und das
        Wandpanel, kein Mensch. In der Benutzerverwaltung stand er
        zwischen den anderen, liess sich aber weder anlegen noch ändern
        noch löschen - eine Zeile, die nur Fragen aufwarf.
        """
        require(request, Capability.MANAGE_USERS)
        return [user.as_dict() for user in hub.users.users if not user.system]

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
                    simple_rooms=[str(r) for r in body.simple_rooms],
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
            "recipes", "documents", "staples", "chores", "medications",
            "emergency", "polls", "shops",
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

    async def tell_the_assignee(
        collection: str, item: dict[str, Any], by: str, vorher: str | None = None
    ) -> None:
        """Der zugewiesenen Person Bescheid geben.

        Eine Liste ohne Namen erledigt niemand - und ein Name, den die
        betroffene Person nie sieht, auch nicht. Deshalb geht eine
        Nachricht raus, sobald jemandem etwas zugeteilt wird.

        Nicht an sich selbst: Wer sich eine Aufgabe notiert, weiss davon.
        Und nur bei einer Änderung - sonst käme bei jedem Abhaken eine
        neue Nachricht für dieselbe Zuteilung.
        """
        if collection not in ("tasks", "chores"):
            return
        wer = str(item.get("member") or "").strip()
        if not wer or wer == by or wer == str(vorher or "").strip():
            return
        was = str(item.get("text") or "").strip() or "Ein Eintrag"
        frist = str(item.get("due") or "").strip()
        tokens = hub.push.recipients(hub.users.users, to=wer, category="tasks")
        if not tokens:
            return
        try:
            await hub.push.send(
                tokens,
                "Aufgaben" if collection == "tasks" else "Ämtli",
                f"{was} ist jetzt bei dir" + (f" - bis {frist}" if frist else "."),
                data={"kind": "family", "collection": collection},
            )
        except Exception as err:  # eine Nachricht ist kein Grund zu scheitern
            log.warning("Zuweisungs-Nachricht an %s fehlgeschlagen: %s", wer, err)

    @app.get("/api/family/{collection}")
    async def family_one(collection: str, request: Request) -> list[dict[str, Any]]:
        """Eine einzelne Liste.

        Ohne diesen Weg blieb nur /api/family - und das liefert alles auf
        einmal, Rezepte und Dokumente eingeschlossen. Für die Kopfzeile,
        die jede Minute nach der Einkaufsliste fragt, ist das die falsche
        Grössenordnung; und wer es trotzdem einzeln versuchte, bekam vom
        Server ein «Methode nicht erlaubt» und in der App eine leere
        Liste, die aussah, als wäre nichts einzukaufen.
        """
        family_user(request)
        return list(hub.data.get(family_key(collection)))

    @app.get("/api/shopping/known")
    async def shopping_known(request: Request, q: str = "") -> list[str]:
        """Schon einmal eingekaufte Artikel – für die Vervollständigung.

        Bewusst im Hub und nicht auf dem Telefon: Was Livia einträgt, soll
        Stefan vorgeschlagen bekommen. Ein Gedächtnis je Gerät wäre nach
        einer Neuinstallation ausserdem leer.

        Eigener Weg statt /api/family/{collection}: Das ist keine
        Familienliste, die man ansieht und abhakt, sondern eine Zutat der
        Eingabe.
        """
        family_user(request)
        return shopping_module.suggestions(hub.data.get("shopping_known"), q)

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
        # Einkaufsartikel gehen ins Gedächtnis für die Vervollständigung.
        # Nicht die Liste selbst dafür nehmen: Erledigtes wird irgendwann
        # entfernt, und dann wäre «Milch» wieder unbekannt.
        if collection == "shopping":
            hub.data.set(
                "shopping_known",
                shopping_module.remember(
                    hub.data.get("shopping_known"), str(item.get("text") or "")
                ),
            )
        await tell_the_assignee(collection, item, user.name)
        return item

    @app.put("/api/family/{collection}/{item_id}")
    async def family_update(
        collection: str, item_id: str, body: dict[str, Any], request: Request
    ) -> dict[str, Any]:
        user = family_user(request)
        key = family_key(collection)
        items = hub.data.get(key)
        for item in items:
            if item.get("id") == item_id:
                vorher = str(item.get("member") or "")
                item.update(
                    {k: v for k, v in body.items() if k not in ("id", "author", "created")}
                )
                hub.data.set(key, items)
                await tell_the_assignee(collection, item, user.name, vorher)
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
                simple_rooms=body.simple_rooms,
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

    # ── Anmeldung mit E-Mail und Passwort ──────────────────────────────────
    #
    # Der Hub spricht selbst mit Supabase, nicht die App: So bleibt der
    # Anon-Key auf dem Hub, und die App kennt weiterhin genau eine Adresse.
    # Nach erfolgreicher Anmeldung stellt der Hub eine eigene Sitzung aus –
    # danach braucht der Alltag kein Internet mehr.

    def auth_service() -> supabase_auth.SupabaseAuth | None:
        config = hub.config.supabase or {}
        url = str(config.get("url") or "")
        anon = str(config.get("anon_key") or "")
        if not (url and anon):
            return None
        # Derselbe Dienstschlüssel wie für den Verlauf. Einladungen sind
        # eine Admin-Handlung; der Anon-Key darf das absichtlich nicht.
        service = str(config.get("service_key") or "")
        return supabase_auth.SupabaseAuth(url, anon, service)

    @app.get("/api/auth/config")
    async def auth_config() -> dict[str, Any]:
        """Was die Anmeldemaske anbieten darf – ohne Anmeldung abrufbar.

        Enthält bewusst nichts Verräterisches: nur ob es die Anmeldung mit
        Passwort überhaupt gibt. Registrieren kann sich hier ohnehin
        niemand selbst – deshalb steht das auch nicht zur Auswahl.
        """
        service = auth_service()
        return {
            "password_login": service is not None,
            "self_signup": False,
            "invite": service is not None and service.can_invite,
        }

    @app.post("/api/auth/login")
    async def auth_login(body: LoginRequest, request: Request) -> dict[str, Any]:
        """Anmelden und eine Sitzung für dieses Gerät bekommen."""
        service = auth_service()
        if service is None:
            raise HTTPException(
                status_code=503,
                detail="Anmeldung mit Passwort ist nicht eingerichtet.",
            )
        # Dieselbe Bremse wie bei den Tokens: Sonst liesse sich hier in
        # Ruhe ein Passwort durchprobieren.
        address = throttle_module.client_address(request)
        waiting = throttle.blocked_for(address)
        if waiting > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Zu viele Fehlversuche. In {round(waiting)} Sekunden wieder.",
                headers={"Retry-After": str(round(waiting))},
            )
        try:
            session = await service.sign_in(body.email, body.password)
        except supabase_auth.AuthError as err:
            if err.status in (400, 401, 403):
                throttle.failed(address)
            raise HTTPException(status_code=err.status, detail=str(err)) from err

        user = hub.users.by_email(session["email"])
        if user is None:
            # Das Konto gibt es bei Supabase, aber niemand im Haus hat die
            # Adresse eingetragen. Bewusst dieselbe Auskunft wie bei einem
            # falschen Passwort – wer fremde Adressen durchprobiert, soll
            # daraus nichts lernen.
            throttle.failed(address)
            log.warning(
                "Anmeldung mit unbekannter Adresse %s abgelehnt", session["email"]
            )
            raise HTTPException(
                status_code=403,
                detail=(
                    "Diese Adresse ist im Haus nicht freigegeben. Wer schon "
                    "Zugang hat, kann sie unter Benutzer eintragen."
                ),
            )
        if not user.active():
            raise HTTPException(
                status_code=403, detail=f"Der Zugang von '{user.name}' ist gesperrt."
            )
        throttle.succeeded(address)
        token = hub.sessions.create(user.name, body.label or "Unbenanntes Gerät")
        log.warning("%s hat sich mit Passwort angemeldet (%s)", user.name, address)
        return {"token": token, "user": user_payload(user)}

    @app.post("/api/auth/password")
    async def auth_set_password(body: PasswordRequest, request: Request) -> dict[str, Any]:
        """Passwort setzen – nach Einladung oder «Passwort vergessen».

        Das Ticket kommt aus der E-Mail und ist der ganze Nachweis: Wer es
        hat, hat das Postfach. Der Hub reicht es an Supabase weiter, damit
        die App nie selbst mit Supabase sprechen muss.

        Ohne Anmeldung erreichbar – deshalb dieselbe Bremse wie überall.
        """
        service = auth_service()
        if service is None:
            raise HTTPException(
                status_code=503, detail="Anmeldung mit Passwort ist nicht eingerichtet."
            )
        address = throttle_module.client_address(request)
        waiting = throttle.blocked_for(address)
        if waiting > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Zu viele Versuche. In {round(waiting)} Sekunden wieder.",
                headers={"Retry-After": str(round(waiting))},
            )
        if len(body.password) < 8:
            raise HTTPException(
                status_code=400, detail="Das Passwort braucht mindestens acht Zeichen."
            )
        try:
            result = await service.set_password(body.access_token, body.password)
        except supabase_auth.AuthError as err:
            if err.status in (400, 401, 403):
                throttle.failed(address)
            raise HTTPException(status_code=err.status, detail=str(err)) from err
        throttle.succeeded(address)
        log.warning("Passwort für %s gesetzt (%s)", result["email"], address)
        return {
            "ok": True,
            "message": "Passwort gesetzt. Du kannst dich jetzt in der App anmelden.",
        }

    @app.post("/api/auth/recover")
    async def auth_recover(body: RecoverRequest) -> dict[str, Any]:
        """Passwort vergessen.

        Die Antwort ist immer dieselbe – ob es zu einer Adresse ein Konto
        gibt, geht niemanden etwas an, der sie nur eintippt.
        """
        service = auth_service()
        if service is not None:
            base = str((hub.config.push or {}).get("public_url") or "").rstrip("/")
            try:
                await service.recover(body.email, f"{base}/einladung" if base else "")
            except supabase_auth.AuthError as err:
                if err.status == 503:
                    raise HTTPException(status_code=503, detail=str(err)) from err
        return {
            "ok": True,
            "message": (
                "Falls es zu dieser Adresse ein Konto gibt, ist die E-Mail "
                "unterwegs."
            ),
        }

    @app.post("/api/auth/logout")
    async def auth_logout(request: Request) -> dict[str, Any]:
        """Diese Sitzung beenden – das feste Token bleibt davon unberührt."""
        current_user(request)
        return {"ok": hub.sessions.revoke(token_from(request) or "")}

    @app.get("/api/auth/sessions")
    async def auth_sessions(request: Request) -> dict[str, Any]:
        """Die eigenen angemeldeten Geräte."""
        user = current_user(request)
        return {"sessions": hub.sessions.list_for(user.name)}

    @app.delete("/api/auth/sessions")
    async def auth_revoke_all(request: Request) -> dict[str, Any]:
        """Überall abmelden – der Knopf für «Telefon verloren»."""
        user = current_user(request)
        count = hub.sessions.revoke_user(user.name)
        log.warning("%s hat alle Sitzungen beendet (%d)", user.name, count)
        return {"ok": True, "revoked": count}

    @app.put("/api/users/{name}/email")
    async def set_user_email(
        name: str, body: EmailRequest, request: Request
    ) -> dict[str, Any]:
        """Die Anmelde-Adresse einer Person setzen.

        Damit ist noch nichts verschickt – das macht erst die Einladung
        darunter. Und nur mit einer hier eingetragenen Adresse kommt
        jemand später durch die Anmeldung.
        """
        require(request, Capability.MANAGE_USERS)
        try:
            user = hub.users.set_email(name, body.email)
        except HomePilotError as err:
            raise HTTPException(status_code=409, detail=str(err)) from err
        return {"user": user.as_dict()}

    @app.post("/api/users/{name}/invite")
    async def invite_user(name: str, request: Request) -> dict[str, Any]:
        """Eine eingetragene Person einladen – Supabase verschickt die E-Mail.

        Der einzige Weg zu einem Konto. Es gibt bewusst keine
        Selbstregistrierung: Wer im Haus mitreden darf, entscheidet der
        Besitzer und niemand sonst. Der Knopf funktioniert auch als
        Erinnerung – eine zweite Einladung ersetzt einfach die erste.
        """
        require(request, Capability.MANAGE_USERS)
        service = auth_service()
        if service is None:
            raise HTTPException(
                status_code=503, detail="Anmeldung mit Passwort ist nicht eingerichtet."
            )
        target = hub.users.by_name(name)
        if target is None:
            raise HTTPException(status_code=404, detail=f"Unbekannter Benutzer: {name}")
        if not target.email:
            raise HTTPException(
                status_code=400,
                detail=f"Für '{name}' ist keine E-Mail-Adresse eingetragen.",
            )
        # Wohin der Link in der E-Mail führt. Ohne öffentliche Adresse
        # nimmt Supabase die im Projekt hinterlegte Site-URL – dann muss
        # sie dort stimmen.
        base = str((hub.config.push or {}).get("public_url") or "").rstrip("/")
        try:
            await service.invite(target.email, f"{base}/einladung" if base else "")
        except supabase_auth.AuthError as err:
            raise HTTPException(status_code=err.status, detail=str(err)) from err
        who = current_user(request)
        log.warning("%s hat %s (%s) eingeladen", who.name, name, target.email)
        return {
            "ok": True,
            "message": (
                f"Einladung an {target.email} verschickt. Darin setzt "
                f"{name} ein Passwort und kann sich dann anmelden."
            ),
        }

    @app.get("/einladung")
    async def invite_page() -> Response:
        """Die Seite aus der Einladungs-E-Mail – ohne Anmeldung erreichbar.

        Sie enthält kein Geheimnis: Das Ticket steht im Fragment der
        Adresse und kommt hier nie an. Die Seite gibt es nur, weil der
        Link im Browser landet und nicht in der App.
        """
        return Response(
            content=invitepage.PAGE,
            media_type="text/html; charset=utf-8",
            headers={"Cache-Control": "no-store"},
        )

    # ── Zusammengefasste Leuchten ──────────────────────────────────────────
    #
    # Eine Deckenlampe mit fünf Spots ist ein Licht, nicht fünf. Was hier
    # entsteht, schaltet alle Mitglieder gemeinsam; die Mitglieder
    # verschwinden aus Räumen, Suche und Zählung und bleiben nur unter
    # Geräte einzeln bedienbar.

    def group_service() -> Any:
        service = hub.integrations.get("group")
        if service is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Die group-Integration ist nicht eingerichtet. In der "
                    "config.yaml genügt die Zeile '- integration: group'."
                ),
            )
        return service

    @app.get("/api/lightgroups")
    async def list_light_groups(request: Request) -> dict[str, Any]:
        current_user(request)
        return {"groups": hub.data.get("light_groups")}

    @app.post("/api/lightgroups")
    async def create_light_group(
        body: LightGroupRequest, request: Request
    ) -> dict[str, Any]:
        user = require(request, Capability.EDIT_CONFIG)
        service = group_service()
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Die Leuchte braucht einen Namen")
        if len(body.members) < 2:
            raise HTTPException(
                status_code=400,
                detail="Eine Leuchte fasst mindestens zwei Lampen zusammen",
            )
        taken: set[str] = set()
        for existing in hub.data.get("light_groups"):
            taken.update(str(m) for m in existing.get("members", []))
        for entity_id in body.members:
            entity = hub.registry.get(entity_id)
            if entity is None:
                raise HTTPException(
                    status_code=404, detail=f"Unbekanntes Gerät: {entity_id}"
                )
            if entity.integration == "group":
                raise HTTPException(
                    status_code=400,
                    detail="Eine Leuchte lässt sich nicht in eine andere stecken",
                )
            if entity_id in taken:
                # Sonst wäre unklar, welche Leuchte den Spot schaltet, und
                # er verschwände aus beiden Ansichten halb.
                raise HTTPException(
                    status_code=409,
                    detail=f"'{entity.name}' gehört schon zu einer Leuchte",
                )
        object_id = group_module.slug(name)
        rows = hub.data.get("light_groups")
        if any(row.get("id") == object_id for row in rows):
            raise HTTPException(
                status_code=409, detail=f"Eine Leuchte '{name}' gibt es schon"
            )
        rows.append(
            {
                "id": object_id,
                "name": name,
                "members": list(body.members),
                "kind": "switch" if body.kind == "switch" else "light",
                "hide_members": bool(body.hide_members),
            }
        )
        hub.data.set("light_groups", rows)
        await service.rebuild()
        log.warning("%s hat die Leuchte '%s' angelegt", user.name, name)
        return {"ok": True, "id": f"group.{object_id}"}

    @app.put("/api/lightgroups/{group_id}")
    async def update_light_group(
        group_id: str, body: LightGroupRequest, request: Request
    ) -> dict[str, Any]:
        """Eine bestehende Leuchte ändern: Name, Mitglieder, Sichtbarkeit.

        Ohne das blieb nur auflösen und neu anlegen - und dabei geht die
        Kennung verloren, an der Szenen, Abläufe und die Raumzuordnung
        hängen. Genau deshalb bleibt sie hier unangetastet, auch wenn der
        Name sich ändert: Aus «Decke» wird «Deckenlampe», und alles, was
        auf sie zeigt, zeigt weiter auf sie.
        """
        user = require(request, Capability.EDIT_CONFIG)
        service = group_service()
        wanted = group_id.split(".", 1)[-1]
        rows = hub.data.get("light_groups")
        treffer = next((row for row in rows if row.get("id") == wanted), None)
        if treffer is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Diese Leuchte kennt der Hub nicht - steht sie in der "
                    "config.yaml, gehört sie auch dort geändert."
                ),
            )

        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Die Leuchte braucht einen Namen")
        if len(body.members) < 2:
            raise HTTPException(
                status_code=400,
                detail="Eine Leuchte fasst mindestens zwei Lampen zusammen",
            )

        # Mitglieder anderer Leuchten bleiben tabu - die eigenen sind es
        # naturgemäss nicht, sonst liesse sich nie eine Lampe behalten.
        fremd: set[str] = set()
        for row in rows:
            if row.get("id") != wanted:
                fremd.update(str(m) for m in row.get("members", []))
        for entity_id in body.members:
            entity = hub.registry.get(entity_id)
            if entity is None:
                raise HTTPException(
                    status_code=404, detail=f"Unbekanntes Gerät: {entity_id}"
                )
            if entity.integration == "group":
                raise HTTPException(
                    status_code=400,
                    detail="Eine Leuchte lässt sich nicht in eine andere stecken",
                )
            if entity_id in fremd:
                raise HTTPException(
                    status_code=409,
                    detail=f"'{entity.name}' gehört schon zu einer Leuchte",
                )

        treffer["name"] = name
        treffer["members"] = list(body.members)
        treffer["kind"] = "switch" if body.kind == "switch" else "light"
        treffer["hide_members"] = bool(body.hide_members)
        hub.data.set("light_groups", rows)
        # Die Raumzuordnung hängt an der Entität, nicht an dieser Zeile:
        # Der Neuaufbau legt sie neu an, also vorher merken und danach
        # zurückgeben - sonst stünde die Leuchte plötzlich raumlos da.
        entity = hub.registry.get(f"group.{wanted}")
        raum = entity.room if entity is not None else None
        await service.rebuild()
        if raum:
            try:
                await hub.registry.set_room(f"group.{wanted}", raum)
            except UnknownEntityError:
                pass
        log.warning("%s hat die Leuchte '%s' geändert", user.name, name)
        return {"ok": True, "id": f"group.{wanted}"}

    @app.delete("/api/lightgroups/{group_id}")
    async def delete_light_group(group_id: str, request: Request) -> dict[str, Any]:
        user = require(request, Capability.EDIT_CONFIG)
        service = group_service()
        # Auch "group.decke" akzeptieren - so lässt sich die Kennung aus
        # der Geräteliste direkt weiterreichen.
        wanted = group_id.split(".", 1)[-1]
        rows = [row for row in hub.data.get("light_groups") if row.get("id") != wanted]
        if len(rows) == len(hub.data.get("light_groups")):
            raise HTTPException(
                status_code=404,
                detail=(
                    "Diese Leuchte kennt der Hub nicht - steht sie in der "
                    "config.yaml, gehört sie auch dort geändert."
                ),
            )
        hub.data.set("light_groups", rows)
        await service.rebuild()
        log.warning("%s hat die Leuchte '%s' aufgelöst", user.name, wanted)
        return {"ok": True}

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
        wanted = body.wanted()
        if not wanted:
            raise HTTPException(
                status_code=400, detail="Ein Einmal-Link ohne Tür öffnet nichts"
            )
        # Erst alles prüfen, dann ausstellen: Ein Link, bei dem die zweite
        # Türe nicht aufgeht, ist schlimmer als gar keiner - der Bote steht
        # dann im Haus und kommt nicht weiter.
        targets: list[tuple[str, str]] = []
        names: list[str] = []
        for item in wanted:
            entity = hub.registry.get(item.entity_id)
            if entity is None or not user.may_see(
                entity.id, entity.kind, entity.integration
            ):
                raise HTTPException(status_code=404, detail="Unbekanntes Gerät")
            if item.command not in entity.commands:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{entity.name}' kennt den Befehl '{item.command}' nicht",
                )
            targets.append((item.entity_id, item.command))
            names.append(entity.name)
        try:
            starts = moment(body.starts)
            until = moment(body.ends) or None
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        try:
            entry = hub.passes.create(
                targets=targets,
                created_by=user.name,
                minutes=body.minutes,
                label=body.label,
                starts=starts,
                until=until,
            )
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        log.warning(
            "Einmal-Link für %s ausgestellt von %s, gültig %s bis %s",
            " + ".join(names),
            user.name,
            datetime.fromtimestamp(entry.starts).isoformat(timespec="minutes")
            if entry.starts
            else "sofort",
            datetime.fromtimestamp(entry.expires).isoformat(timespec="minutes"),
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

        # Alle Türen des Links, in der gespeicherten Reihenfolge. Der Link
        # ist mit dem Einlösen verbraucht - auch wenn eine Türe klemmt.
        # Ein Link, der nach halbem Erfolg weitergilt, liesse sich sonst
        # beliebig oft wiederholen.
        opened: list[str] = []
        failed: list[str] = []
        for entity_id, command in entry.targets:
            entity = hub.registry.get(entity_id)
            if entity is None:
                failed.append(f"{entity_id} (gibt es nicht mehr)")
                continue
            hub.audit.record(f"Einmal-Link von {entry.created_by}", entity, command, address)
            log.warning(
                "Einmal-Link eingelöst: %s → %s (von %s)", entity.name, command, address
            )
            try:
                with as_source(user_source(f"Einmal-Link ({entry.created_by})")):
                    await hub.integrations.dispatch_command(entity_id, command, {})
            except HomePilotError as err:
                log.error("Einmal-Link: %s liess sich nicht öffnen: %s", entity.name, err)
                failed.append(f"{entity.name} ({err})")
            else:
                opened.append(entity.name)

        if not opened:
            return Response(
                content="Hat nicht geklappt: " + ", ".join(failed) + "\n",
                status_code=502,
                media_type="text/plain; charset=utf-8",
            )
        text = " und ".join(opened) + ": erledigt."
        if failed:
            # Halber Erfolg gehört gesagt, sonst steht der Bote im
            # Treppenhaus und rüttelt an der falschen Türe.
            text += " Nicht geklappt hat: " + ", ".join(failed) + "."
        return Response(
            content=text + " Dieser Link gilt jetzt nicht mehr.\n",
            media_type="text/plain; charset=utf-8",
        )

    @app.get("/api/glance")
    async def glance(request: Request) -> dict[str, Any]:
        """Der Blick aufs Haus in drei Zeilen - fürs Widget.

        Bewusst eine eigene, winzige Antwort statt der ganzen
        Geräteliste: Das Widget fragt alle Viertelstunde an und läuft auf
        einem Telefon, das gerade nichts anderes tut. Was es nicht
        braucht, soll es nicht übertragen.
        """
        current_user(request)
        entities = hub.registry.all()

        # Dieselbe Zählung wie in der App (open_contacts): Kontakte samt
        # Türsensor im Schloss. Vorher zählte das Widget nur Schlösser –
        # und behauptete «Alles zu», während das Küchenfenster offen
        # stand. Eine Anzeige, die man im Vorbeigehen liest und nicht
        # nachprüft, muss stimmen oder schweigen.
        offen = watchdog.open_contacts(entities)
        lichter = [
            entity
            for entity in entities
            if entity.kind == "light" and str(entity.state.get("state")) == "on"
        ]
        kalender = next((e for e in entities if e.kind == "calendar"), None)
        termin = None
        if kalender is not None:
            events = kalender.state.get("events") or []
            if events:
                erster = events[0]
                termin = {
                    "summary": str(erster.get("summary") or "Termin"),
                    "start": erster.get("start"),
                    "all_day": bool(erster.get("all_day")),
                }

        alarm = next((e for e in entities if e.kind == "alarm"), None)
        return {
            "doors_open": [entity.name for entity in offen],
            "lights_on": len(lichter),
            "next_event": termin,
            "alarm": str(alarm.state.get("state")) if alarm is not None else None,
            "at": datetime.now().isoformat(timespec="seconds"),
        }

    @app.get("/api/suggestions/scene")
    async def scene_suggestion(request: Request) -> dict[str, Any]:
        """Eine erkannte Gewohnheit - oder nichts.

        Nichts ist der Normalfall und keine Fehlermeldung: Die meisten
        Haushalte haben keine so klare Gewohnheit, und dann soll auch
        nichts vorgeschlagen werden.
        """
        require(request, Capability.EDIT_CONFIG)
        muster = suggest.find_pattern(hub.eventlog.all())
        if muster is None:
            return {"suggestion": None}
        namen = {
            entity.id: entity.name
            for entity in hub.registry.all()
            if entity.id in muster["entity_ids"]
        }
        # Geräte, die es nicht mehr gibt, fallen raus - ein Vorschlag mit
        # einer toten Kennung liesse sich nicht speichern.
        muster["entity_ids"] = [
            gerät for gerät in muster["entity_ids"] if gerät in namen
        ]
        if len(muster["entity_ids"]) < suggest.MIN_ENTITIES:
            return {"suggestion": None}
        return {
            "suggestion": {
                **muster,
                "text": suggest.describe(muster, namen),
                "names": [namen[gerät] for gerät in muster["entity_ids"]],
            }
        }

    class MaintenanceRequest(BaseModel):
        """Eine Wartung: was, wie oft, ab wann."""

        text: str
        interval_days: int = 90
        due: str | None = None

    @app.get("/api/maintenance")
    async def list_maintenance(request: Request) -> dict[str, Any]:
        current_user(request)
        rows = hub.data.get("maintenance")
        return {
            "items": rows,
            "due": maintenance.due_items(rows),
        }

    @app.post("/api/maintenance")
    async def add_maintenance(
        body: MaintenanceRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        import secrets

        name = body.text.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Die Wartung braucht einen Namen")
        intervall = maintenance.clean_interval(body.interval_days)
        item = {
            "id": secrets.token_urlsafe(6),
            "text": name,
            "interval_days": intervall,
            # Ohne Angabe beginnt die Frist heute - wer eine Wartung
            # einträgt, hat sie meistens gerade gemacht.
            "due": body.due or maintenance.next_after(None, intervall),
            "last_done": None,
        }
        hub.data.set("maintenance", [*hub.data.get("maintenance"), item])
        return item

    @app.post("/api/maintenance/{item_id}/done")
    async def maintenance_done(item_id: str, request: Request) -> dict[str, Any]:
        """Quittieren: die nächste Frist zählt ab heute."""
        user = require(request, Capability.EDIT_CONFIG)
        rows = hub.data.get("maintenance")
        for row in rows:
            if row.get("id") == item_id:
                heute = datetime.now().date().isoformat()
                row["last_done"] = heute
                row["due"] = maintenance.next_after(heute, row.get("interval_days"))
                hub.data.set("maintenance", rows)
                log.info("%s hat '%s' quittiert", user.name, row.get("text"))
                return row
        raise HTTPException(status_code=404, detail="Wartung nicht gefunden")

    @app.delete("/api/maintenance/{item_id}")
    async def delete_maintenance(item_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        rows = hub.data.get("maintenance")
        rest = [row for row in rows if row.get("id") != item_id]
        if len(rest) == len(rows):
            raise HTTPException(status_code=404, detail="Wartung nicht gefunden")
        hub.data.set("maintenance", rest)
        return {"ok": True}

    @app.post("/api/entities/{old_id}/replace/{new_id}")
    async def replace_entity(
        old_id: str, new_id: str, request: Request
    ) -> dict[str, Any]:
        """Alle Verweise vom alten auf das neue Gerät umhängen.

        Eine Lampe geht kaputt, die neue meldet sich unter einer anderen
        Kennung - und damit zeigen Szenen, Abläufe, Favoriten, die
        Raumzuordnung und die zusammengefassten Leuchten ins Leere. Nichts
        davon wirft einen Fehler: Der Hub überspringt stillschweigend, was
        er nicht kennt. Man merkt es Wochen später, wenn abends ein Licht
        nicht mehr angeht.

        Von Hand ist das eine halbe Stunde Suchen an sechs Stellen.
        """
        user = require(request, Capability.EDIT_CONFIG)
        if old_id == new_id:
            raise HTTPException(
                status_code=400, detail="Altes und neues Gerät sind dasselbe"
            )
        neu = hub.registry.get(new_id)
        if neu is None:
            raise HTTPException(status_code=404, detail=f"Unbekanntes Gerät: {new_id}")

        betroffen: dict[str, int] = {}

        szenen = hub.data.get("scenes")
        treffer = sum(
            replace_module.swap_in_actions(szene.get("actions") or [], old_id, new_id)
            for szene in szenen
        )
        if treffer:
            hub.data.set("scenes", szenen)
            betroffen["Szenen"] = treffer

        ablaeufe = hub.data.get("automations")
        treffer = sum(
            replace_module.swap_in_automation(ablauf, old_id, new_id)
            for ablauf in ablaeufe
        )
        if treffer:
            hub.data.set("automations", ablaeufe)
            betroffen["Abläufe"] = treffer

        for key, label in (
            ("entity_rooms", "Raumzuordnung"),
            ("entity_meta", "Name/Favorit/Gruppe"),
        ):
            rows = hub.data.get(key)
            treffer = replace_module.swap_in_rows(rows, old_id, new_id)
            if treffer:
                hub.data.set(key, rows)
                betroffen[label] = treffer

        leuchten = hub.data.get("light_groups")
        treffer = replace_module.swap_in_light_groups(leuchten, old_id, new_id)
        if treffer:
            hub.data.set("light_groups", leuchten)
            betroffen["Zusammengefasste Leuchten"] = treffer

        # Die Szenen und Abläufe im Speicher neu einlesen, sonst gilt die
        # Änderung erst nach einem Neustart - und bis dahin schaltet der
        # Hub weiter das alte, nicht mehr vorhandene Gerät.
        hub.reload_scenes()
        await hub.reload_automations()

        # Raum und Name sitzen zusätzlich an der Entität selbst - die
        # umgeschriebene Zeile allein wirkt erst nach einem Neustart.
        for row in hub.data.get("entity_rooms"):
            if row.get("entity_id") == new_id:
                try:
                    await hub.registry.set_room(new_id, row.get("room"))
                except UnknownEntityError:
                    pass
        for row in hub.data.get("entity_meta"):
            if row.get("entity_id") == new_id:
                try:
                    await hub.registry.set_meta(new_id, row)
                except UnknownEntityError:
                    pass

        # Zusammengefasste Leuchten neu aufbauen, damit die neue Lampe
        # sofort mitschaltet.
        gruppe = hub.integrations.get("group")
        if gruppe is not None and "Zusammengefasste Leuchten" in betroffen:
            await gruppe.rebuild()

        log.warning(
            "%s hat %s durch %s ersetzt (%s)",
            user.name,
            old_id,
            new_id,
            betroffen or "keine Verweise",
        )
        return {"ok": True, "changed": betroffen}

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
        user = user_for_token(token)
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
