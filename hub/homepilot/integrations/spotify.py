"""Spotify – was gerade läuft, plus Wiedergabesteuerung.

Konfiguration:
  - integration: spotify
    client_id: "${SPOTIFY_CLIENT_ID}"
    client_secret: "${SPOTIFY_CLIENT_SECRET}"
    refresh_token: "${SPOTIFY_REFRESH_TOKEN}"
    scan_interval: 30

Einmalige Einrichtung (dauert fünf Minuten):
  1. Auf developer.spotify.com eine App anlegen; als Redirect-URI
     http://127.0.0.1:8888/callback eintragen.
  2. Im Browser aufrufen (client_id einsetzen):
       https://accounts.spotify.com/authorize?client_id=...&response_type=code
       &redirect_uri=http://127.0.0.1:8888/callback
       &scope=user-read-playback-state%20user-modify-playback-state
  3. Den 'code' aus der Adresszeile gegen Tokens tauschen:
       curl -s https://accounts.spotify.com/api/token \\
            -u "CLIENT_ID:CLIENT_SECRET" \\
            -d grant_type=authorization_code -d code=DER_CODE \\
            -d redirect_uri=http://127.0.0.1:8888/callback
     Der refresh_token aus der Antwort kommt in die .env – er läuft nicht ab.

Der Hub tauscht ihn selbstständig gegen kurzlebige Zugriffstokens; in der
Konfiguration liegt nie ein ablaufendes Geheimnis.
"""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

ACCOUNTS = "https://accounts.spotify.com/api/token"
API = "https://api.spotify.com/v1"


def parse_devices(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Übersetzt /me/player/devices in eine Geräteliste (rein, testbar).

    Google-Home-Lautsprecher, Fernseher usw. tauchen hier als
    Spotify-Connect-Ziele auf; 'play_on' zieht die Wiedergabe dorthin um.
    """
    devices = []
    for device in (payload or {}).get("devices") or []:
        if not device.get("name") or not device.get("id"):
            continue
        devices.append(
            {
                "id": device["id"],
                "name": device["name"],
                "active": bool(device.get("is_active")),
            }
        )
    return devices


def parse_playback(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Übersetzt /me/player in Entitäts-Attribute.

    Kein Payload heisst: nirgends läuft etwas – das ist ein normaler
    Zustand, keine Störung.
    """
    if not payload:
        return {"state": "idle", "track": None, "artist": None, "device": None}
    item = payload.get("item") or {}
    artists = ", ".join(
        artist.get("name", "") for artist in item.get("artists") or [] if artist.get("name")
    )
    return {
        "state": "playing" if payload.get("is_playing") else "paused",
        "track": item.get("name"),
        "artist": artists or None,
        "device": (payload.get("device") or {}).get("name"),
    }


class SpotifyIntegration(Integration):
    name = "spotify"

    async def setup(self) -> None:
        self._client_id = self.config.get("client_id")
        self._client_secret = self.config.get("client_secret")
        self._refresh_token = self.config.get("refresh_token")
        if not (self._client_id and self._client_secret and self._refresh_token):
            raise ConfigError(
                "spotify braucht 'client_id', 'client_secret' und 'refresh_token' "
                "– die Einrichtung steht oben in integrations/spotify.py"
            )

        self._interval = float(self.config.get("scan_interval", 30))
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=15))
        self._access_token: str | None = None
        self._token_expires_at = 0.0

        await self.add_entity(
            "player",
            EntityKind.MEDIA_PLAYER,
            self.config.get("name", "Spotify"),
            state={"state": "idle"},
            commands=["play", "pause", "toggle", "next", "previous", "play_on"],
            available=False,
        )
        # Gerätename → Spotify-Connect-ID, für play_on.
        self._device_ids: dict[str, str] = {}
        await self._refresh()
        self.start_task(self._poll_loop())

    # ── Anmeldung ──────────────────────────────────────────────────────────

    async def _ensure_token(self) -> str:
        loop = asyncio.get_running_loop()
        if self._access_token and loop.time() < self._token_expires_at:
            return self._access_token
        async with self._session.post(
            ACCOUNTS,
            data={"grant_type": "refresh_token", "refresh_token": self._refresh_token},
            auth=aiohttp.BasicAuth(self._client_id, self._client_secret),
        ) as response:
            if response.status >= 400:
                raise ConnectionError(
                    f"Spotify-Token-Erneuerung fehlgeschlagen ({response.status})"
                )
            payload = await response.json()
        self._access_token = payload["access_token"]
        # Etwas vor Ablauf erneuern, damit kein Aufruf ins Leere läuft.
        self._token_expires_at = loop.time() + float(payload.get("expires_in", 3600)) * 0.9
        return self._access_token

    async def _call(
        self, method: str, path: str, json: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        token = await self._ensure_token()
        async with self._session.request(
            method, f"{API}{path}", headers={"Authorization": f"Bearer {token}"}, json=json
        ) as response:
            # 204: nichts läuft. 404: kein aktives Gerät – beim Steuern
            # möglich, wenn überall Stille ist.
            if response.status in (204, 404):
                return None
            response.raise_for_status()
            if response.content_type == "application/json":
                return await response.json()
            return None

    # ── Spotify → Hub ──────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh()

    async def _refresh(self) -> None:
        entity_id = self.entity_id("player")
        try:
            payload = await self._call("GET", "/me/player")
            devices = parse_devices(await self._call("GET", "/me/player/devices"))
        except Exception as err:
            self.log.warning("Spotify nicht erreichbar: %s", err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return
        self._device_ids = {device["name"]: device["id"] for device in devices}
        state = parse_playback(payload)
        state["devices"] = [device["name"] for device in devices]
        await self.hub.registry.update_state(entity_id, state, available=True)

    # ── Hub → Spotify ──────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        if command == "play_on":
            device_id = self._device_ids.get(str(data.get("device")))
            if device_id is None:
                raise ValueError(
                    f"Unbekanntes Wiedergabegerät '{data.get('device')}' – "
                    f"verfügbar: {', '.join(self._device_ids) or 'keine'}"
                )
            # Spotify Connect: Wiedergabe auf das Gerät umziehen und weiterspielen.
            await self._call("PUT", "/me/player", json={"device_ids": [device_id], "play": True})
            await self._refresh()
            return
        if command == "toggle":
            command = "pause" if entity.state.get("state") == "playing" else "play"
        routes = {
            "play": ("PUT", "/me/player/play"),
            "pause": ("PUT", "/me/player/pause"),
            "next": ("POST", "/me/player/next"),
            "previous": ("POST", "/me/player/previous"),
        }
        method, path = routes[command]
        await self._call(method, path)
        await self._refresh()


INTEGRATION = SpotifyIntegration
