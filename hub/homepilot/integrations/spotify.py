"""Spotify – was gerade läuft, plus Wiedergabesteuerung.

Konfiguration:
  - integration: spotify
    client_id: "${SPOTIFY_CLIENT_ID}"
    client_secret: "${SPOTIFY_CLIENT_SECRET}"
    refresh_token: "${SPOTIFY_REFRESH_TOKEN}"
    scan_interval: 30

Einmalige Einrichtung (~5 Minuten):
  1. developer.spotify.com → Dashboard → Create App; als Redirect-URI exakt
     http://127.0.0.1:8888/callback eintragen. Client-ID und Client-Secret
     als SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in die Umgebung
     (Portainer-Stack), dann den Stack neu deployen.
  2. Anmelden:  docker exec -it homepilot-hub \
                  python -m homepilot.integrations.spotify -c /config/config.yaml
     Der Helfer zeigt eine Spotify-Adresse; dort zustimmen und die komplette
     Adresse aus der Adresszeile (die «Seite nicht erreichbar»-Seite) zurück
     in den Helfer kopieren. Der refresh_token landet in spotify-token.json
     neben der homepilot-data.json – 'refresh_token' in der Konfiguration
     ist damit optional (und hat Vorrang, falls gesetzt).

Der Hub tauscht den refresh_token selbstständig gegen kurzlebige
Zugriffstokens; er läuft nicht ab.

Google-/Cast-Boxen: Schlafende Lautsprecher stehen trotzdem in der
Geräteliste (aus der google_cast-Integration). Beim Playlist-Start weckt
der Hub die Box übers Cast-Protokoll und meldet sie bei Spotify an –
dieselbe Mechanik wie «Spotcast» in Home Assistant. Dafür braucht der
refresh_token die Scopes streaming/user-read-email/user-read-private
(im Anmelde-Helfer enthalten) und Spotify Premium.
"""

from __future__ import annotations

import asyncio
import json as jsonlib
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit, parse_qs

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

ACCOUNTS = "https://accounts.spotify.com/api/token"
AUTHORIZE = "https://accounts.spotify.com/authorize"
API = "https://api.spotify.com/v1"
REDIRECT = "http://127.0.0.1:8888/callback"
SCOPES = (
    "user-read-playback-state user-modify-playback-state "
    "playlist-read-private playlist-read-collaborative"
)


def merge_device_names(connect: list[str], cast: list[str]) -> list[str]:
    """Connect-Geräte plus (schlafende) Cast-Boxen, ohne Duplikate (rein).

    Die Cast-Namen hängen hinten an: So bleibt eine Box wählbar, auch wenn
    sie bei Spotify gerade nicht registriert ist – beim Playlist-Start wird
    sie geweckt.
    """
    result = list(connect)
    for name in cast:
        if name not in result:
            result.append(name)
    return result


def extract_code(text: str) -> str:
    """Holt den OAuth-Code aus einer ganzen Redirect-Adresse oder gibt die
    Eingabe unverändert zurück, wenn sie schon der Code ist (rein, testbar)."""
    text = text.strip()
    if "code=" in text:
        query = urlsplit(text).query or text.split("?", 1)[-1]
        values = parse_qs(query).get("code")
        if values:
            return values[0]
    return text


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
        return {
            "state": "idle",
            "track": None,
            "artist": None,
            "device": None,
            "context_uri": None,
            "shuffle": False,
            "repeat": "off",
        }
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
        # Woraus gerade gespielt wird. Spotify nennt hier nur die URI –
        # den Namen kennt erst, wer die Playlists des Kontos hat.
        "context_uri": (payload.get("context") or {}).get("uri"),
        "shuffle": bool(payload.get("shuffle_state")),
        # «off», «track» (ein Titel) oder «context» (Playlist/Album).
        "repeat": str(payload.get("repeat_state") or "off"),
    }
    volume = device.get("volume_percent")
    if volume is not None:
        result["volume"] = int(volume)
    return result


# Reihenfolge beim Durchtippen: aus → alles → ein Titel → aus. Das sind
# genau die Werte, die Spotify für /me/player/repeat annimmt.
REPEAT_MODES = ("off", "context", "track")


def next_repeat(current: str) -> str:
    """Der nächste Wiederholmodus beim Antippen (rein, testbar)."""
    try:
        return REPEAT_MODES[(REPEAT_MODES.index(current) + 1) % len(REPEAT_MODES)]
    except ValueError:
        return REPEAT_MODES[1]


def playlist_name(
    context_uri: str | None, playlists: list[dict[str, Any]]
) -> str | None:
    """Die laufende Playlist benennen (rein, testbar).

    Spotify meldet beim Abspielen nur eine Kontext-URI. Ein Album oder die
    Songradio hat keinen Playlist-Namen – dann bleibt es bei None, statt
    irgendetwas zu behaupten.
    """
    if not context_uri:
        return None
    for entry in playlists:
        if entry.get("uri") == context_uri:
            return str(entry.get("name"))
    return None


class SpotifyIntegration(Integration):
    name = "spotify"

    async def setup(self) -> None:
        self._client_id = self.config.get("client_id")
        self._client_secret = self.config.get("client_secret")
        self._refresh_token = self.config.get("refresh_token")
        if not self._refresh_token:
            # Vom Anmelde-Helfer abgelegt (siehe Kopf dieser Datei).
            token_file = Path(self.hub.config.data_file).parent / "spotify-token.json"
            if token_file.exists():
                self._refresh_token = jsonlib.loads(token_file.read_text()).get(
                    "refresh_token"
                )
        if not (self._client_id and self._client_secret and self._refresh_token):
            raise ConfigError(
                "spotify braucht 'client_id' und 'client_secret'; den refresh_token "
                "erzeugt der Anmelde-Helfer: "
                "python -m homepilot.integrations.spotify -c config.yaml"
            )

        # sp_dc-Cookie (optional): nur fürs Wecken schlafender Cast-Boxen.
        self._sp_dc = self.config.get("sp_dc")
        if not self._sp_dc:
            token_file = Path(self.hub.config.data_file).parent / "spotify-token.json"
            if token_file.exists():
                self._sp_dc = jsonlib.loads(token_file.read_text()).get("sp_dc")
        self._webplayer = None
        if self._sp_dc:
            from .spotify_webplayer import WebPlayerAuth

            self._webplayer = WebPlayerAuth(self._sp_dc)

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
                "shuffle", "repeat",
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
        state["devices"] = merge_device_names(
            [device["name"] for device in devices], self._cast_names()
        )
        state["playlists"] = [p["name"] for p in self._playlists]
        state["playlist"] = playlist_name(state.get("context_uri"), self._playlists)
        await self.hub.registry.update_state(entity_id, state, available=True)

    def _cast_names(self) -> list[str]:
        cast = self.hub.integrations.get("google_cast")
        if cast is None or not hasattr(cast, "device_names"):
            return []
        try:
            return cast.device_names()
        except Exception:
            return []

    async def _wake_and_find(self, name: str) -> str | None:
        """Weckt eine schlafende Cast-Box und wartet, bis Spotify sie kennt."""
        cast = self.hub.integrations.get("google_cast")
        if cast is None or not hasattr(cast, "spotify_wake"):
            return None
        if self._webplayer is None:
            self.log.warning(
                "Box '%s' schläft, aber ohne sp_dc-Cookie lässt sie sich nicht "
                "wecken. Cookie eintragen: docs/spotify-boxen-wecken.md",
                name,
            )
            return None
        try:
            token = await self._webplayer.token(self._session)
        except Exception as err:
            self.log.warning("Web-Player-Token fürs Wecken nicht erhältlich: %s", err)
            return None
        try:
            woken = await cast.spotify_wake(name, token)
        except Exception as err:
            # Ein Fehler beim Wecken darf nie als roher Traceback in der App
            # landen – der Grund steht im Log der Cast-Integration.
            self.log.warning("Wecken von %s fehlgeschlagen: %s", name, err)
            return None
        if not woken:
            return None
        for _ in range(12):
            await asyncio.sleep(1)
            try:
                devices = parse_devices(await self._call("GET", "/me/player/devices"))
            except Exception:
                continue
            self._device_ids = {device["name"]: device["id"] for device in devices}
            if name in self._device_ids:
                return self._device_ids[name]
        return None

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
            requested = str(data.get("device", ""))
            device_id = pick_device(
                requested, entity.state.get("device"), self._device_ids
            )
            # Gewünschte Box schläft (kennt Spotify gerade nicht)? Dann über
            # das Cast-Protokoll wecken und anmelden – wie Spotcast.
            if requested and requested not in self._device_ids:
                woken = await self._wake_and_find(requested)
                if woken:
                    device_id = woken
                elif device_id is None:
                    raise ValueError(
                        f"'{requested}' liess sich nicht wecken – Details im "
                        "Hub-Log (docker logs homepilot-hub | grep -i spotify)"
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

        if command == "shuffle":
            # Ohne Angabe umschalten – so genügt ein Tipp in der App.
            target = data.get("on")
            on = (not bool(entity.state.get("shuffle"))) if target is None else bool(target)
            await self._call("PUT", f"/me/player/shuffle?state={'true' if on else 'false'}")
            await self._refresh()
            return

        if command == "repeat":
            mode = str(data.get("mode") or next_repeat(str(entity.state.get("repeat") or "off")))
            if mode not in REPEAT_MODES:
                raise ValueError(f"Unbekannter Wiederholmodus '{mode}'")
            await self._call("PUT", f"/me/player/repeat?state={mode}")
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


# ── Anmelde-Helfer ─────────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.spotify -c config.yaml
# Fragt nach dem Zustimmen im Browser nach der Redirect-Adresse und legt den
# refresh_token in spotify-token.json neben der homepilot-data.json ab.


async def _login_main(config_path: str) -> int:
    import aiohttp

    from ..core.config import load_config
    from ..core.errors import ConfigError as _ConfigError

    blocks: list[dict[str, Any]] = []
    data_dir = Path(config_path).parent
    try:
        config = load_config(config_path)
        data_dir = Path(config.data_file).parent
        blocks = [
            b for b in config.integrations if b.get("integration") == "spotify"
        ]
    except _ConfigError as err:
        # Z.B. weil ${SPOTIFY_CLIENT_ID} noch nicht gesetzt ist – dann eben
        # von Hand eintippen statt abzubrechen.
        print(f"(Konfiguration nicht lesbar: {err} – Werte bitte eingeben)")

    client_id = (blocks[0].get("client_id") if blocks else None) or input(
        "Spotify Client-ID: "
    ).strip()
    client_secret = (blocks[0].get("client_secret") if blocks else None) or input(
        "Spotify Client-Secret: "
    ).strip()
    if not client_id or not client_secret:
        print("✗ Client-ID und Client-Secret sind nötig (developer.spotify.com).")
        return 1

    auth_url = (
        f"{AUTHORIZE}?client_id={quote(client_id)}&response_type=code"
        f"&redirect_uri={quote(REDIRECT)}&scope={quote(SCOPES)}"
    )
    print("\n1. Diese Adresse im Browser öffnen und zustimmen:\n")
    print(f"   {auth_url}\n")
    print(
        "2. Danach erscheint «Seite nicht erreichbar» – das ist richtig so.\n"
        "   Die KOMPLETTE Adresse aus der Adresszeile kopieren und hier einfügen\n"
        "   (der Code darin gilt nur wenige Minuten):"
    )
    code = extract_code(input("\nAdresse oder Code: "))

    async with aiohttp.ClientSession() as session:
        async with session.post(
            ACCOUNTS,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT,
            },
            auth=aiohttp.BasicAuth(client_id, client_secret),
        ) as response:
            payload = await response.json(content_type=None)

    error = payload.get("error")
    if error == "invalid_client":
        print(
            "✗ Spotify lehnt Client-ID/Secret ab (invalid_client).\n"
            "  Im Dashboard (developer.spotify.com) unter Settings das Secret\n"
            "  mit «View client secret» frisch kopieren – oder rotieren, wenn\n"
            "  es irgendwo geteilt wurde – und den Helfer erneut starten."
        )
        return 1
    if error == "invalid_grant":
        print("✗ Der Code war abgelaufen oder schon benutzt – bitte nochmals "
              "bei Schritt 1 beginnen und zügig einfügen.")
        return 1
    refresh_token = payload.get("refresh_token")
    if not refresh_token:
        print(f"✗ Kein refresh_token erhalten: {payload}")
        return 1

    stored: dict[str, str] = {"refresh_token": refresh_token}

    # Optionaler dritter Schritt: das sp_dc-Cookie fürs Wecken schlafender
    # Google-/Cast-Boxen (ohne offene Spotify-App).
    print(
        "\n3. (Optional) Google-/Cast-Boxen aus dem Ruhezustand starten:\n"
        "   Dafür braucht der Hub das Cookie 'sp_dc' aus einer Browser-\n"
        "   Sitzung. In Chrome: open.spotify.com öffnen und einloggen → F12\n"
        "   → «Application» → «Cookies» → open.spotify.com → Zeile 'sp_dc' →\n"
        "   den Wert kopieren. Leer lassen und Enter, wenn nicht gewünscht."
    )
    sp_dc = input("\nsp_dc (optional): ").strip()
    if sp_dc:
        stored["sp_dc"] = sp_dc

    token_file = data_dir / "spotify-token.json"
    token_file.write_text(jsonlib.dumps(stored))
    token_file.chmod(0o600)
    print(f"\n✓ Angemeldet. Token gespeichert in {token_file}.")
    if sp_dc:
        print("  Mit sp_dc: schlafende Boxen werden beim Playlist-Start geweckt.")
    print("  Jetzt den Hub neu starten – die Spotify-Kachel erscheint mit "
          "Playlists und Lautsprechern.")
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Spotify-Anmeldung für HomePilot")
    parser.add_argument(
        "-c", "--config", default="config.yaml", help="Pfad zur config.yaml des Hubs"
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(_login_main(args.config)))
