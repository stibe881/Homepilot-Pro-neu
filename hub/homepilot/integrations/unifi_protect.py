"""UniFi Protect – Kameras über die lokale API des Controllers.

Konfiguration:
  - integration: unifi_protect
    host: 192.168.1.1
    username: "${UNIFI_USER}"
    password: "${UNIFI_PASSWORD}"
    scan_interval: 120

Je Kamera entsteht eine Entität mit Online-Zustand, Aufnahmemodus und dem
Zeitpunkt der letzten Bewegung; Türklingeln melden zusätzlich das letzte
Klingeln. Bewegungen kommen über den WebSocket des Controllers praktisch
sofort – gepollt wird nur als Sicherheitsnetz.

Die Ereignisse schickt Protect als Binärnachricht: zwei Rahmen (Aktion und
Daten) mit je 8 Byte Kopf, der Inhalt zlib-gepackt. Das Format stammt aus
der uiprotect-Bibliothek und ist hier in decode_ws_message nachgebaut –
und als reine Funktion auch ohne Controller testbar.
"""

from __future__ import annotations

import asyncio
import json
import struct
import zlib
from datetime import datetime, timezone
from typing import Any

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Rahmenkopf: Typ (1=Aktion, 2=Daten), Format (1=JSON), gepackt, frei, Länge
_HEADER = struct.Struct(">BBBBI")


def _decode_frame(buffer: bytes) -> tuple[Any, bytes]:
    if len(buffer) < _HEADER.size:
        raise ValueError("Rahmen kürzer als der Kopf")
    _ptype, fmt, deflated, _unused, size = _HEADER.unpack_from(buffer, 0)
    body = buffer[_HEADER.size : _HEADER.size + size]
    if len(body) < size:
        raise ValueError("Rahmen kürzer als angekündigt")
    if deflated:
        body = zlib.decompress(body)
    payload = json.loads(body) if fmt == 1 else body
    return payload, buffer[_HEADER.size + size :]


def decode_ws_message(data: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
    """Zerlegt eine Protect-Nachricht in (Aktion, Nutzdaten)."""
    action, rest = _decode_frame(data)
    payload, _ = _decode_frame(rest)
    if not isinstance(action, dict) or not isinstance(payload, dict):
        raise ValueError("Unerwartetes Nachrichtenformat")
    return action, payload


def login_error(status: int) -> str:
    """Sagt, was der Statuscode der Anmeldung bedeutet (rein, testbar).

    UniFi meldet mit 499 nicht «falsches Passwort», sondern «hier fehlt der
    zweite Faktor» – der Unterschied entscheidet, ob man das Passwort neu
    tippt oder einen lokalen Benutzer ohne 2FA anlegt.
    """
    if status == 499:
        return (
            "Protect verlangt Zwei-Faktor-Authentifizierung (499). Der Hub kann "
            "keinen Code eingeben: In UniFi OS unter Settings → Admins & Users "
            "einen Benutzer mit 'Local Access Only' und ohne 2FA anlegen "
            "(ein Ubiquiti-Cloud-Konto erzwingt 2FA immer)."
        )
    if status in (401, 403):
        return (
            f"Protect-Anmeldung abgelehnt ({status}) – Benutzername oder Passwort "
            "stimmen nicht, oder der Benutzer hat keine Protect-Berechtigung."
        )
    return f"Protect-Anmeldung fehlgeschlagen ({status})"


def _iso(millis: Any) -> str | None:
    if not millis:
        return None
    return datetime.fromtimestamp(int(millis) / 1000, tz=timezone.utc).isoformat()


def camera_state(camera: dict[str, Any]) -> dict[str, Any]:
    """Übersetzt ein Kamera-Objekt der API in Entitäts-Attribute."""
    state: dict[str, Any] = {
        "state": "online" if camera.get("state") == "CONNECTED" else "offline",
        "recording": (camera.get("recordingSettings") or {}).get("mode"),
        "motion": "on" if camera.get("isMotionDetected") else "off",
    }
    if camera.get("lastMotion"):
        state["last_motion"] = _iso(camera.get("lastMotion"))
    # Nur Türklingeln haben lastRing – dann gehört es auch angezeigt.
    if camera.get("featureFlags", {}).get("hasChime") or camera.get("lastRing"):
        state["last_ring"] = _iso(camera.get("lastRing"))
    return state


class UnifiProtectIntegration(Integration):
    name = "unifi_protect"

    async def setup(self) -> None:
        self._host = self.config.get("host")
        self._username = self.config.get("username")
        self._password = self.config.get("password")
        if not (self._host and self._username and self._password):
            raise ConfigError("unifi_protect braucht 'host', 'username' und 'password'")

        self._base = f"https://{self._host}"
        self._interval = float(self.config.get("scan_interval", 120))
        self._csrf: str | None = None
        # Kamera-ID der API → Entitäts-ID im Hub
        self._cameras: dict[str, str] = {}

        # Der Controller nutzt ein selbstsigniertes Zertifikat; die Anmeldung
        # läuft über Cookies, deshalb bekommt die Session einen Cookie-Speicher.
        self._session = self.http_session(
            connector=aiohttp.TCPConnector(ssl=False),
            cookie_jar=aiohttp.CookieJar(unsafe=True),
            timeout=aiohttp.ClientTimeout(total=20),
        )

        await self._login()
        await self._refresh()
        self.start_task(self._event_loop())
        self.start_task(self._poll_loop())

    # ── Verbindung ─────────────────────────────────────────────────────────

    async def _login(self) -> None:
        async with self._session.post(
            f"{self._base}/api/auth/login",
            json={
                "username": self._username,
                "password": self._password,
                "rememberMe": True,
            },
        ) as response:
            if response.status >= 400:
                raise ConnectionError(login_error(response.status))
            self._csrf = response.headers.get("X-CSRF-Token") or self._csrf

    async def _bootstrap(self) -> dict[str, Any]:
        headers = {"X-CSRF-Token": self._csrf} if self._csrf else {}
        async with self._session.get(
            f"{self._base}/proxy/protect/api/bootstrap", headers=headers
        ) as response:
            if response.status == 401:
                await self._login()
                return await self._bootstrap()
            response.raise_for_status()
            return await response.json()

    # ── Controller → Hub ───────────────────────────────────────────────────

    async def _refresh(self) -> None:
        try:
            bootstrap = await self._bootstrap()
        except Exception as err:
            self.log.warning("Protect nicht erreichbar: %s", err)
            for entity_id in self._cameras.values():
                await self.hub.registry.update_state(entity_id, {}, available=False)
            return

        self._last_update_id = bootstrap.get("lastUpdateId")
        for camera in bootstrap.get("cameras", []):
            await self._apply_camera(camera)

    async def _apply_camera(self, camera: dict[str, Any]) -> None:
        camera_id = camera.get("id")
        if not camera_id:
            return
        entity_id = self._cameras.get(camera_id)
        if entity_id is None:
            entity = await self.add_entity(
                camera_id,
                EntityKind.CAMERA,
                camera.get("name") or "Kamera",
                state=camera_state(camera),
            )
            self._cameras[camera_id] = entity.id
        else:
            await self.hub.registry.update_state(
                entity_id, camera_state(camera), available=True
            )

    async def _event_loop(self) -> None:
        """Live-Ereignisse: Bewegung und Klingeln ohne Warten auf den Poll."""
        while True:
            try:
                url = f"{self._base}/proxy/protect/ws/updates"
                if getattr(self, "_last_update_id", None):
                    url += f"?lastUpdateId={self._last_update_id}"
                headers = {"X-CSRF-Token": self._csrf} if self._csrf else {}
                async with self._session.ws_connect(url, headers=headers) as ws:
                    self.log.info("Mit dem Protect-Ereignisstrom verbunden")
                    async for message in ws:
                        if message.type != aiohttp.WSMsgType.BINARY:
                            continue
                        try:
                            action, payload = decode_ws_message(message.data)
                        except Exception:
                            continue  # unbekannter Rahmen – der Poll fängt es auf
                        await self._handle_event(action, payload)
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.debug("Protect-Ereignisstrom unterbrochen (%s), neuer Versuch in 15s", err)
                await asyncio.sleep(15)

    async def _handle_event(self, action: dict[str, Any], payload: dict[str, Any]) -> None:
        if action.get("action") != "update" or action.get("modelKey") != "camera":
            return
        entity_id = self._cameras.get(action.get("id", ""))
        if entity_id is None:
            return
        changes: dict[str, Any] = {}
        if "isMotionDetected" in payload:
            changes["motion"] = "on" if payload["isMotionDetected"] else "off"
        if "lastMotion" in payload:
            changes["last_motion"] = _iso(payload["lastMotion"])
        if "lastRing" in payload:
            changes["last_ring"] = _iso(payload["lastRing"])
        if "state" in payload:
            changes["state"] = "online" if payload["state"] == "CONNECTED" else "offline"
        if changes:
            await self.hub.registry.update_state(entity_id, changes, available=True)

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh()

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        # Kameras sind bewusst nur lesend – Aufnahmemodi umzustellen gehört
        # in die Protect-App, nicht auf eine Wandtafel.
        raise ConfigError("Kameras lassen sich hier nicht steuern")

    async def snapshot(self, entity: Entity) -> bytes | None:
        camera_id = next(
            (cid for cid, eid in self._cameras.items() if eid == entity.id), None
        )
        if camera_id is None:
            return None
        headers = {"X-CSRF-Token": self._csrf} if self._csrf else {}
        async with self._session.get(
            f"{self._base}/proxy/protect/api/cameras/{camera_id}/snapshot",
            headers=headers,
        ) as response:
            if response.status == 401:
                await self._login()
                return await self.snapshot(entity)
            if response.status >= 400:
                return None
            return await response.read()


INTEGRATION = UnifiProtectIntegration
