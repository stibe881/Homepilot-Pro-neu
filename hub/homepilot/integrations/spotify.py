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
       &scope=user-read-playback-state%20user-modify-playback-state%20playlist-read-private%20playlist-read-collaborative
  3. Den 'code' aus der Adresszeile gegen Tokens tauschen:
       curl -s https://accounts.spotify.com/api/token \\
            -u "CLIENT_ID:CLIENT_SECRET" \\
            -d grant_type=authorization_code -d code=DER_CODE \\
            -d redirect_uri=http://127.0.0.1:8888/callback
     Der refresh_token aus der Antwort kommt in die .env – er läuft nicht ab.

Wichtig: Die Playlisten brauchen die beiden playlist-read-Scopes. Ein
refresh_token, der ohne sie erzeugt wurde, liefert eine leere Liste –
dann Schritt 2 und 3 einmal mit der obigen (vollständigen) URL wiederholen
und den neuen refresh_token eintragen.

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


def parse_playlists(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Übersetzt /me/playlists in [{name, uri}] (rein, testbar)."""
    result = []
    for item in (payload or {}).get("items") or []:
        uri = item.get("uri")
        name = item.get("name")
        if uri and name:
            result.append({"name": str(name), "uri": str(uri)})
    return result


def pick_device(
    requested: str, active: str | None, device_ids: dict[str, str]
) -> str | None:
    """Ziel-Lautsprecher für den Start einer Playlist (rein, testbar).

    Reihenfolge: ausdrücklich gewünscht → gerade aktiv → der erste
    sichtbare. So startet eine Playlist auch aus völliger Stille, ohne dass
    Spotify mit «kein aktives Gerät» abwinkt.
    """
    if requested and requested in device_ids:
        return device_ids[requested]
    if active and active in device_ids:
        return device_ids[active]
    return next(iter(device_ids.values()), None)


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
    device = payload.get("device") or {}
    result = {
        "state": "playing" if payload.get("is_playing") else "paused",
        "track": item.get("name"),
        "artist": artists or None,
        "device": device.get("name"),
    }
    volume = device.get("volume_percent")
    if volume is not None:
        result["volume"] = int(volume)
    return result


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
            commands=[
                "play", "pause", "toggle", "next", "previous", "play_on",
                "set_volume", "volume_up", "volume_down", "mute", "play_playlist",
            ],
            available=False,
        )
        # Gerätename → Spotify-Connect-ID, für play_on.
        self._device_ids: dict[str, str] = {}
        # Name → Playlist-URI, für play_playlist.
        self._playlists: list[dict[str, Any]] = []
        await self._load_playlists()
        await self._refresh()
        self.start_task(self._poll_loop())

    async def _load_playlists(self) -> None:
        """Alle Playlisten des Kontos holen (mehrere Seiten à 50)."""
        try:
            playlists: list[dict[str, Any]] = []
            offset = 0
            while offset < 200:
                payload = await self._call(
                    "GET", f"/me/playlists?limit=50&offset={offset}"
                )
                page = parse_playlists(payload)
                playlists.extend(page)
                if len(page) < 50:
                    break
                offset += 50
            self._playlists = playlists
            if not playlists:
                self.log.warning(
                    "Spotify meldet keine Playlisten – fehlen dem refresh_token "
                    "die playlist-read-Scopes? (Einrichtung im Kopf von spotify.py)"
                )
        except Exception as err:
            self.log.warning("Spotify-Playlisten nicht abrufbar: %s", err)

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
        rounds = 0
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh()
            rounds += 1
            # Neue Playlisten tauchen ohne Neustart auf (~halbstündlich).
            if rounds % max(1, int(1800 / self._interval)) == 0:
                await self._load_playlists()

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
        state["playlists"] = [p["name"] for p in self._playlists]
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
        if command == "play_playlist":
            name = str(data.get("name", ""))
            uri = data.get("uri") or next(
                (p["uri"] for p in self._playlists if p["name"] == name), None
            )
            if not uri:
                raise ValueError(f"Unbekannte Playlist '{name}'")
            body: dict[str, Any] = {"context_uri": uri}
            # Ziel: gewünschte Box → gerade aktive → erste sichtbare. Ohne
            # Ziel würde Spotify aus der Stille heraus mit 404 abwinken.
            device_id = pick_device(
                str(data.get("device", "")),
                entity.state.get("device"),
                self._device_ids,
            )
            if device_id is None:
                raise ValueError(
                    "Keine Spotify-Lautsprecher sichtbar. Google-Lautsprecher "
                    "erscheinen, wenn in der Google-Home-App Spotify verknüpft "
                    "ist; sonst einmal die Spotify-App im selben Netz öffnen."
                )
            await self._call("PUT", f"/me/player/play?device_id={device_id}", json=body)
            await self._refresh()
            return

        if command == "toggle":
            command = "pause" if entity.state.get("state") == "playing" else "play"

        if command in ("set_volume", "volume_up", "volume_down", "mute"):
            current = int(entity.state.get("volume", 50) or 0)
            if command == "set_volume":
                target = int(data.get("volume", current))
            elif command == "volume_up":
                target = current + int(data.get("step", 10))
            elif command == "volume_down":
                target = current - int(data.get("step", 10))
            else:  # mute: auf 0 bzw. zurück auf die gemerkte Lautstärke
                if current > 0:
                    self._volume_before_mute = current
                    target = 0
                else:
                    target = getattr(self, "_volume_before_mute", 30)
            target = max(0, min(100, target))
            await self._call("PUT", f"/me/player/volume?volume_percent={target}")
            await self._refresh()
            return

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
