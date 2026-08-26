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
import time
import zlib
from datetime import UTC, datetime
from typing import Any

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration, console_html_hint

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
    return datetime.fromtimestamp(int(millis) / 1000, tz=UTC).isoformat()


# Kanäle einer Protect-Kamera, von der besten zur sparsamsten Auflösung.
QUALITIES = ("high", "medium", "low")


def rtsp_alias(camera: dict[str, Any], quality: str = "medium") -> str | None:
    """Der RTSP-Name des passenden Kanals (rein, testbar).

    Protect gibt jeden Kanal (High/Medium/Low) erst frei, wenn RTSP in den
    Kameraeinstellungen eingeschaltet ist – ohne das gibt es keinen Alias
    und damit kein Live-Bild. Ist die gewünschte Qualität nicht frei-
    geschaltet, wird die nächstbeste genommen statt gar keine.
    """
    available: dict[str, str] = {}
    for channel in camera.get("channels") or []:
        alias = channel.get("rtspAlias")
        if not alias or channel.get("isRtspEnabled") is False:
            continue
        available[str(channel.get("name", "")).strip().lower()] = str(alias)
    if not available:
        return None
    wanted = str(quality).lower()
    order = [wanted] + [name for name in QUALITIES if name != wanted]
    for name in order:
        if name in available:
            return available[name]
    return next(iter(available.values()))


def rtsp_url(host: str, alias: str) -> str:
    """Die Adresse, unter der Protect den Strom ausliefert.

    Bewusst der unverschlüsselte Port 7447: Die TLS/SRTP-Variante auf 7441
    verstehen viele Abnehmer (auch mediamtx) nicht sauber, und der Strom
    bleibt ohnehin im eigenen Netz – er läuft vom Recorder zum Hub und
    verlässt den Rechner nur über die Token-geschützte Hub-API.
    """
    return f"rtsp://{host}:7447/{alias}"


# Name der Zone, die der Hub für den Privatsphäre-Modus anlegt. Über den
# Namen erkennt er sie auch wieder – selbst gezeichnete Zonen aus der
# Protect-App bleiben unangetastet.
PRIVACY_ZONE = "HomePilot Privatsphäre"


def has_privacy_zone(camera: dict[str, Any]) -> bool:
    """Ist die Privatsphäre-Zone des Hubs gesetzt? (rein, testbar)"""
    return any(
        (zone or {}).get("name") == PRIVACY_ZONE
        for zone in camera.get("privacyZones") or []
    )


def privacy_patch(
    enabled: bool, camera: dict[str, Any], restore: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Der PATCH-Körper zum Ein-/Ausschalten der Privatsphäre (rein, testbar).

    Einschalten legt eine bildfüllende schwarze Zone, stellt das Mikrofon
    stumm und die Aufnahme ab – wie der Privatsphäre-Schalter in Home
    Assistant. Ausschalten entfernt genau unsere Zone und stellt Mikrofon
    und Aufnahme auf die gemerkten vorherigen Werte zurück (ohne gemerkte:
    Mikrofon voll, Aufnahme «always»).
    """
    zones = [
        zone
        for zone in camera.get("privacyZones") or []
        if (zone or {}).get("name") != PRIVACY_ZONE
    ]
    if enabled:
        zones.append(
            {
                "name": PRIVACY_ZONE,
                "color": "#85BCEC",
                "points": [[0, 0], [1, 0], [1, 1], [0, 1]],
            }
        )
        return {
            "privacyZones": zones,
            "micVolume": 0,
            "recordingSettings": {"mode": "never"},
        }
    restore = restore or {}
    return {
        "privacyZones": zones,
        "micVolume": restore.get("micVolume", 100),
        "recordingSettings": {"mode": restore.get("mode") or "always"},
    }


# Ereignisarten, die jemanden interessieren. Alles andere (Aufnahme
# gestartet, Firmware aktualisiert) gehört ins Protect-Log, nicht in die
# Zeitleiste einer Wohnungs-App.
EVENT_LABELS = {
    "motion": "Bewegung",
    "smartDetectZone": "Erkannt",
    "smartDetectLine": "Erkannt",
    "ring": "Geklingelt",
}


# Ereignisarten, die eine Erkennung tragen - Bild wie Ton.
DETECT_EVENTS = ("smartDetectZone", "smartDetectLine", "smartAudioDetect")

# Was Protect erkennt, wie das Feld bei uns heisst und wie es in der App
# steht. Die Schlüssel sind kleingeschrieben und ohne Unterstriche: Die
# API schreibt mal «alrmBabyCry», mal «smoke_cmonx», und beides meint
# dasselbe.
DETECTIONS: dict[str, tuple[str, str]] = {
    "person": ("person", "Person"),
    "vehicle": ("vehicle", "Fahrzeug"),
    "package": ("package", "Paket"),
    "animal": ("animal", "Tier"),
    "licenseplate": ("license_plate", "Kennzeichen"),
    "face": ("face", "Gesicht"),
    "alrmbabycry": ("baby_cry", "Baby schreit"),
    "babycry": ("baby_cry", "Baby schreit"),
    "alrmsmoke": ("smoke_alarm", "Rauchmelder"),
    "smoke": ("smoke_alarm", "Rauchmelder"),
    "alrmcmonx": ("co_alarm", "CO-Melder"),
    "smokecmonx": ("co_alarm", "CO-Melder"),
    "cmonx": ("co_alarm", "CO-Melder"),
    "alrmsiren": ("siren", "Sirene"),
    "alrmspeak": ("speaking", "Sprechen"),
    "speaking": ("speaking", "Sprechen"),
    "alrmburglar": ("burglar", "Einbruchalarm"),
    "glassbreak": ("glass_break", "Glasbruch"),
    "bark": ("bark", "Hund bellt"),
    "caralarm": ("car_alarm", "Autoalarm"),
    "carhorn": ("car_horn", "Hupe"),
}


def detect_key(roh: Any) -> tuple[str, str] | None:
    """Eine Protect-Erkennung in Feldname und Beschriftung (rein, testbar)."""
    text = str(roh or "").strip().lower().replace("_", "").replace("-", "")
    return DETECTIONS.get(text)


def supported_detections(camera: dict[str, Any]) -> list[tuple[str, str]]:
    """Was diese Kamera überhaupt erkennen kann (rein, testbar).

    Damit stehen die Felder von Anfang an im Zustand - sonst liesse sich
    ein Ablauf «wenn das Baby schreit» erst bauen, nachdem das Baby zum
    ersten Mal geschrien hat. Und umgekehrt bietet eine Kamera ohne
    Mikrofon den Auslöser gar nicht erst an.
    """
    flags = camera.get("featureFlags") or {}
    roh: list[Any] = []
    for schluessel in ("smartDetectTypes", "smartDetectAudioTypes"):
        wert = flags.get(schluessel)
        if isinstance(wert, list):
            roh.extend(wert)
    gefunden: list[tuple[str, str]] = []
    for eintrag in roh:
        treffer = detect_key(eintrag)
        if treffer and treffer not in gefunden:
            gefunden.append(treffer)
    return gefunden


def detection_changes(
    typen: Any, zeit: str | None, *, beendet: bool
) -> dict[str, Any]:
    """Aus einem Erkennungs-Ereignis die Zustandsänderungen (rein, testbar).

    Der Zeitstempel je Feld ist kein Schmuck: Zweimal Person nacheinander
    trägt beide Male «on», und ohne den Stempel liesse die
    Änderungsprüfung den zweiten Ablauf still durchfallen.
    """
    changes: dict[str, Any] = {}
    namen: list[str] = []
    for eintrag in typen or []:
        treffer = detect_key(eintrag)
        if treffer is None:
            continue
        feld, label = treffer
        changes[f"detected_{feld}"] = "off" if beendet else "on"
        if not beendet:
            changes[f"last_{feld}"] = zeit
            namen.append(label)
    if namen:
        changes["detected"] = namen
        changes["last_detected"] = zeit
    return changes


def parse_events(payload: Any, camera_id: str, limit: int = 40) -> list[dict[str, Any]]:
    """Protect-Ereignisse in eine Zeitleiste übersetzen (rein, testbar).

    Jüngste zuerst. ``smartDetectTypes`` sagt, *was* erkannt wurde
    (person, vehicle) – das ist der Unterschied zwischen «da war was» und
    «da stand jemand».
    """
    rows: list[dict[str, Any]] = []
    for event in payload or []:
        if not isinstance(event, dict):
            continue
        kind = str(event.get("type") or "")
        if kind not in EVENT_LABELS:
            continue
        if event.get("camera") not in (None, camera_id):
            continue
        start = _iso(event.get("start"))
        if start is None:
            continue
        detected = [
            str(item) for item in (event.get("smartDetectTypes") or []) if item
        ]
        rows.append(
            {
                "id": str(event.get("id") or start),
                "type": kind,
                "label": EVENT_LABELS[kind],
                "start": start,
                "end": _iso(event.get("end")),
                "detected": detected,
                "score": event.get("score"),
            }
        )
    rows.sort(key=lambda row: row["start"], reverse=True)
    return rows[:limit]


def camera_state(camera: dict[str, Any], quality: str = "medium") -> dict[str, Any]:
    """Übersetzt ein Kamera-Objekt der API in Entitäts-Attribute."""
    state: dict[str, Any] = {
        "state": "online" if camera.get("state") == "CONNECTED" else "offline",
        "recording": (camera.get("recordingSettings") or {}).get("mode"),
        "motion": "on" if camera.get("isMotionDetected") else "off",
        # Sagt der App, ob sie ein Live-Bild anbieten darf.
        "stream": rtsp_alias(camera, quality) is not None,
        "privacy": "on" if has_privacy_zone(camera) else "off",
    }
    # Was die Kamera kann, steht von Anfang an im Zustand - auf «off».
    for feld, _label in supported_detections(camera):
        state[f"detected_{feld}"] = "off"
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
        self._interval = self.scan_interval()
        self._quality = str(self.config.get("stream_quality", "medium")).lower()
        self._csrf: str | None = None
        # Kamera-ID der API → Entitäts-ID im Hub
        self._cameras: dict[str, str] = {}
        # Entitäts-ID → RTSP-Name des Live-Kanals (fehlt, wenn RTSP aus ist)
        self._aliases: dict[str, str] = {}
        # Entitäts-ID → Mikrofon/Aufnahmemodus vor dem Privatsphäre-Modus,
        # damit das Ausschalten den alten Zustand wiederherstellt.
        self._privacy_restore: dict[str, dict[str, Any]] = {}

        self._session = self.console_session(
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
            # Siehe unifi.py: aiohttp verwirft das Cookie wegen
            # 'partitioned', also legen wir es selbst ab.
            self.keep_cookies(self._session, response, self._base)

    async def _bootstrap(self) -> dict[str, Any]:
        headers = {"X-CSRF-Token": self._csrf} if self._csrf else {}
        async with self._session.get(
            f"{self._base}/proxy/protect/api/bootstrap", headers=headers
        ) as response:
            if response.status == 401:
                await self._login()
                return await self._bootstrap()
            response.raise_for_status()
            # Siehe unifi.py: Eine Konsole ohne diese Anwendung antwortet
            # mit der Weboberfläche und Status 200, nicht mit 404.
            hinweis = console_html_hint(str(response.url), response.content_type)
            if hinweis:
                raise ConnectionError(hinweis)
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
                state=camera_state(camera, self._quality),
                commands=["set_privacy"],
            )
            self._cameras[camera_id] = entity.id
            entity_id = entity.id
            if rtsp_alias(camera, self._quality) is None:
                self.log.info(
                    "%s: kein Live-Bild – RTSP ist in Protect für diese Kamera "
                    "nicht eingeschaltet (Kamera → Einstellungen → Erweitert → RTSP)",
                    entity.label,
                )
        else:
            await self.hub.registry.update_state(
                entity_id, camera_state(camera, self._quality), available=True
            )
        alias = rtsp_alias(camera, self._quality)
        if alias:
            self._aliases[entity_id] = alias
        else:
            self._aliases.pop(entity_id, None)

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
        if action.get("modelKey") == "event":
            await self._handle_detection(payload)
            return
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

    async def _handle_detection(self, payload: dict[str, Any]) -> None:
        """Eine Erkennung (Person, Paket, Baby-Schreien) übernehmen.

        Bisher landeten diese Ereignisse nur in der Zeitleiste. Zum
        Nachschauen taugte das; automatisieren liess sich damit nichts -
        ein Ablauf kann nur auf einen Zustand hören.
        """
        if str(payload.get("type") or "") not in DETECT_EVENTS:
            return
        entity_id = self._cameras.get(str(payload.get("camera") or ""))
        if entity_id is None:
            return
        beendet = payload.get("end") is not None
        zeit = _iso(payload.get("end") if beendet else payload.get("start"))
        changes = detection_changes(
            payload.get("smartDetectTypes"), zeit, beendet=beendet
        )
        if changes:
            await self.hub.registry.update_state(entity_id, changes, available=True)

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh()

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        # Kameras bleiben weitgehend lesend – einzige Ausnahme ist der
        # Privatsphäre-Modus: bildfüllende schwarze Zone, Mikrofon stumm,
        # Aufnahme aus. Das ist genau der Fall «wir sind zuhause und wollen
        # gerade nicht gefilmt werden», und der gehört auf die Wandtafel.
        if command == "set_privacy":
            await self._set_privacy(entity, bool(data.get("enabled")))
            return
        raise ConfigError("Kameras lassen sich hier nicht steuern")

    async def _set_privacy(self, entity: Entity, enabled: bool) -> None:
        camera_id = next(
            (cid for cid, eid in self._cameras.items() if eid == entity.id), None
        )
        if camera_id is None:
            raise ConfigError("Diese Kamera kennt der Controller nicht")
        headers = {"X-CSRF-Token": self._csrf} if self._csrf else {}
        # Frischen Stand holen: Fremde Zonen sollen erhalten bleiben, und
        # Mikrofon/Aufnahmemodus werden fürs spätere Zurückstellen gemerkt.
        async with self._session.get(
            f"{self._base}/proxy/protect/api/cameras/{camera_id}", headers=headers
        ) as response:
            if response.status == 401:
                await self._login()
                return await self._set_privacy(entity, enabled)
            response.raise_for_status()
            camera = await response.json()
        if enabled and not has_privacy_zone(camera):
            self._privacy_restore[entity.id] = {
                "micVolume": camera.get("micVolume", 100),
                "mode": (camera.get("recordingSettings") or {}).get("mode"),
            }
        patch = privacy_patch(enabled, camera, self._privacy_restore.get(entity.id))
        async with self._session.patch(
            f"{self._base}/proxy/protect/api/cameras/{camera_id}",
            json=patch,
            headers=headers,
        ) as response:
            response.raise_for_status()
        if not enabled:
            self._privacy_restore.pop(entity.id, None)
        await self.hub.registry.update_state(
            entity.id, {"privacy": "on" if enabled else "off"}
        )

    async def stream_url(self, entity: Entity) -> str | None:
        alias = self._aliases.get(entity.id)
        return rtsp_url(self._host, alias) if alias else None

    async def events(self, entity: Entity, hours: int = 24, limit: int = 40) -> list[dict[str, Any]]:
        """Bewegungen und Klingeln der letzten Stunden.

        «Letzte Bewegung um 16:45» beantwortet nur die halbe Frage – man
        will wissen, was über den Tag los war. Protect führt diese Liste
        ohnehin; hier wird sie nur auf das Nötige eingedampft.
        """
        camera_id = next(
            (cid for cid, eid in self._cameras.items() if eid == entity.id), None
        )
        if camera_id is None:
            return []
        now = int(time.time() * 1000)
        start = now - max(1, hours) * 3600 * 1000
        headers = {"X-CSRF-Token": self._csrf} if self._csrf else {}
        try:
            async with self._session.get(
                f"{self._base}/proxy/protect/api/events",
                params={"start": str(start), "end": str(now), "cameras": camera_id},
                headers=headers,
            ) as response:
                if response.status == 401:
                    await self._login()
                    return await self.events(entity, hours, limit)
                if response.status >= 400:
                    return []
                payload = await response.json()
        except Exception as err:
            self.log.debug("Ereignisse von %s nicht abrufbar: %s", entity.label, err)
            return []
        return parse_events(payload, camera_id, limit)

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
