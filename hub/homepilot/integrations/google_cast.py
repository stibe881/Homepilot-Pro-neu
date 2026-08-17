"""Google Cast – Chromecasts und Cast-fähige Lautsprecher/Fernseher.

Konfiguration:
  - integration: google_cast
    devices:
      - host: 192.168.1.35
        name: Wohnzimmer TV
      - host: 192.168.1.36
        name: Küche Lautsprecher

Voraussetzung:  pip install "homepilot[cast]"  bzw.  pip install pychromecast

Bewusst mit festen Adressen statt mDNS-Suche: Im eigenen Netz vergibt der
Router ohnehin feste IPs, und ein mDNS-Dienst weniger bedeutet einen
Fehlerherd weniger (Docker, VLANs). Die Bibliothek arbeitet mit Threads;
ihre Rückrufe werden hier in den Event-Loop des Hubs übersetzt – dasselbe
Muster wie beim Homematic-Callback.
"""

from __future__ import annotations

import asyncio
import time
import hashlib
import json
import threading
from typing import Any

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


# Der übliche Cast-Port. Eine Lautsprechergruppe hat einen eigenen, denn
# sie läuft auf der Adresse einer ihrer Boxen.
DEFAULT_PORT = 8009


# Ab so vielen Fehlversuchen in Folge gilt eine Box als dauerhaft weg.
GIVE_UP_AFTER = 10
# Danach wird nur noch stündlich probiert.
MAX_RETRY = 3600


def retry_delay(failures: int) -> int:
    """Wartezeit bis zum nächsten Verbindungsversuch (rein, testbar).

    Die ersten Versuche kommen schnell – eine Box startet neu, ein Netz
    hakt kurz. Danach immer seltener: Ein Gerät, das aus ist, muss nicht
    alle 30 Sekunden angesprochen und ins Log geschrieben werden.
    """
    if failures < 3:
        return 30
    if failures < GIVE_UP_AFTER:
        return 120
    return MAX_RETRY


def cast_object_id(host: str, port: int = DEFAULT_PORT) -> str:
    """Kennung der Entität aus Adresse und Port (rein, testbar).

    Der Port kommt nur dazu, wenn er vom üblichen abweicht – sonst würden
    sich die Kennungen bestehender Geräte ändern und ihre Favoriten,
    Abläufe und Szenen ins Leere zeigen. Nötig ist er bei Gruppen: Die
    teilen sich die Adresse mit einer ihrer Boxen.
    """
    base = host.replace(".", "_")
    return base if port == DEFAULT_PORT else f"{base}_{port}"


def cast_media_state(
    player_state: str | None,
    title: str | None,
    artist: str | None,
    app: str | None,
    volume: float | None,
    muted: bool | None = None,
) -> dict[str, Any]:
    """Übersetzt Cast-Status in Entitäts-Attribute (rein, testbar)."""
    if player_state == "PLAYING":
        state = "playing"
    elif player_state == "PAUSED":
        state = "paused"
    else:
        state = "idle"
    result: dict[str, Any] = {
        "state": state,
        "track": title or None,
        "artist": artist or None,
        "app": app if app and app != "Backdrop" else None,
    }
    if volume is not None:
        result["volume"] = round(float(volume) * 100)
    if muted is not None:
        result["muted"] = bool(muted)
    return result


# Spotify-Empfänger auf Cast-Geräten (dieselbe Mechanik wie «Spotcast» in
# Home Assistant): App starten, das Gerät bei Spotify anmelden – danach
# taucht es als Spotify-Connect-Ziel auf, ganz ohne offene Handy-App.
SPOTIFY_APP = "CC32E753"
SPOTIFY_NS = "urn:x-cast:com.spotify.chromecast.secure.v1"
DEVICE_AUTH = "https://spclient.wg.spotify.com/device-auth/v1/refresh"


def _spotify_controller_class():
    """Controller erst bei Gebrauch bauen – pychromecast ist optional."""
    from pychromecast.controllers import BaseController

    class SpotifyCastController(BaseController):
        """Minimaler Nachbau des Spotcast-Controllers.

        Ablauf: getInfo → (getInfoResponse mit deviceID/clientID) →
        device-auth bei Spotify → addUser mit dem Geräte-Token →
        addUserResponse. Die Ereignisse laufen im Thread der Bibliothek;
        threading.Events tragen sie zurück.
        """

        def __init__(self, remote_name: str) -> None:
            super().__init__(SPOTIFY_NS, SPOTIFY_APP)
            self.remote_name = remote_name
            self.device_id: str | None = None
            self.client_id: str | None = None
            self.result: str | None = None
            self.got_info = threading.Event()
            self.done = threading.Event()

        def receive_message(self, _message: Any, data: dict) -> bool:
            kind = data.get("type")
            if kind == "getInfoResponse":
                payload = data.get("payload") or {}
                self.device_id = payload.get("deviceID")
                self.client_id = payload.get("clientID")
                self.got_info.set()
            elif kind == "addUserResponse":
                self.result = "ok"
                self.done.set()
            elif kind == "addUserError":
                self.result = str(data.get("payload") or "addUserError")
                self.done.set()
            return True

        def ask_info(self) -> None:
            self.send_message(
                {
                    "type": "getInfo",
                    "payload": {
                        "remoteName": self.remote_name,
                        "deviceID": hashlib.md5(
                            self.remote_name.encode()
                        ).hexdigest(),
                        "deviceAPI_isGroup": False,
                    },
                }
            )

        def add_user(self, token: str) -> None:
            self.send_message(
                {
                    "type": "addUser",
                    "payload": {"blob": token, "tokenType": "accesstoken"},
                }
            )

    return SpotifyCastController


class GoogleCastIntegration(Integration):
    name = "google_cast"

    async def setup(self) -> None:
        devices = self.config.get("devices") or []
        if not devices:
            raise ConfigError("google_cast braucht mindestens ein Gerät unter 'devices'")

        try:
            import pychromecast  # noqa: F401 – nur Verfügbarkeit prüfen
        except ImportError as err:
            raise ConfigError(
                "pychromecast fehlt – installieren mit: pip install pychromecast"
            ) from err

        self._loop = asyncio.get_running_loop()
        # entity_id → Chromecast-Objekt der Bibliothek
        self._casts: dict[str, Any] = {}

        for device in devices:
            host = device.get("host")
            if not host:
                raise ConfigError("google_cast: jedes Gerät braucht einen 'host'")
            port = int(device.get("port", DEFAULT_PORT))
            entity = await self.add_entity(
                cast_object_id(str(host), port),
                EntityKind.MEDIA_PLAYER,
                device.get("name", f"Cast {host}"),
                state={"state": "idle"},
                commands=[
                    "play", "pause", "toggle", "next", "previous",
                    "volume_up", "volume_down", "set_volume", "mute",
                ],
                available=False,
            )
            self.start_task(self._connect_loop(entity.id, str(host), port))

    async def teardown(self) -> None:
        await super().teardown()
        for cast in self._casts.values():
            try:
                await asyncio.to_thread(cast.disconnect)
            except Exception:
                pass
        self._casts.clear()

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    async def _connect_loop(
        self, entity_id: str, host: str, port: int = DEFAULT_PORT
    ) -> None:
        import pychromecast

        failures = 0
        while True:
            try:
                cast = await asyncio.to_thread(
                    pychromecast.get_chromecast_from_host,
                    (host, port, None, None, None),
                    timeout=10,
                )
                await asyncio.to_thread(cast.wait, 15)
                failures = 0
                self._casts[entity_id] = cast
                self._attach_listeners(entity_id, cast)
                await self._push_state(entity_id, cast)
                self.log.info("Mit Cast-Gerät %s verbunden", host)
                # Verbunden bleiben, solange die Bibliothek den Kontakt hält.
                while cast.socket_client.is_alive():
                    await asyncio.sleep(15)
                raise ConnectionError("Verbindung beendet")
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self._casts.pop(entity_id, None)
                await self.hub.registry.update_state(entity_id, {}, available=False)
                failures += 1
                wait = retry_delay(failures)
                if failures == GIVE_UP_AFTER:
                    # Eine Box, die dauerhaft weg ist, hat das Log alle 30
                    # Sekunden geflutet. Einmal deutlich sagen, dann selten
                    # weiterprobieren – zurück kommt sie trotzdem.
                    self.log.warning(
                        "Cast-Gerät %s ist seit %d Versuchen nicht erreichbar (%s). "
                        "Weitere Versuche nur noch stündlich; ist die Box weg, "
                        "gehört sie aus der Konfiguration.",
                        host,
                        failures,
                        err,
                    )
                else:
                    self.log.debug(
                        "Cast %s nicht erreichbar (%s), neuer Versuch in %ds",
                        host,
                        err,
                        wait,
                    )
                await asyncio.sleep(wait)

    def _attach_listeners(self, entity_id: str, cast: Any) -> None:
        integration = self

        class _Listener:
            """Läuft im Thread der Bibliothek – nur den Sprung in den
            Event-Loop anstossen, sonst nichts."""

            def new_cast_status(self, _status: Any) -> None:
                asyncio.run_coroutine_threadsafe(
                    integration._push_state(entity_id, cast), integration._loop
                )

            def new_media_status(self, _status: Any) -> None:
                asyncio.run_coroutine_threadsafe(
                    integration._push_state(entity_id, cast), integration._loop
                )

            def load_media_failed(self, _item: Any, _error_code: Any) -> None:
                pass

        listener = _Listener()
        cast.register_status_listener(listener)
        cast.media_controller.register_status_listener(listener)

    async def _push_state(self, entity_id: str, cast: Any) -> None:
        media = getattr(cast.media_controller, "status", None)
        status = getattr(cast, "status", None)
        await self.hub.registry.update_state(
            entity_id,
            cast_media_state(
                getattr(media, "player_state", None),
                getattr(media, "title", None),
                getattr(media, "artist", None),
                getattr(status, "display_name", None),
                getattr(status, "volume_level", None),
                getattr(status, "volume_muted", None),
            ),
            available=True,
        )

    # ── Spotify-Wecken (für die spotify-Integration) ───────────────────────

    def device_names(self) -> list[str]:
        """Namen aller verbundenen Cast-Geräte – als schlafende Connect-Ziele."""
        names = []
        for entity_id in self._casts:
            entity = self.hub.registry.get(entity_id)
            if entity is not None:
                names.append(entity.name)
        return names

    async def discover(self, seconds: float = 5.0) -> list[dict[str, Any]]:
        """Sucht Cast-Geräte und Lautsprechergruppen im Netz.

        Damit muss niemand IP-Adressen zusammensuchen, um eine Box in die
        config.yaml einzutragen. Gruppen kommen mit derselben Suche: Google
        meldet sie als eigenständiges Cast-Gerät vom Typ «group» – genau
        deshalb spielen sie auch synchron, und genau deshalb kann der Hub
        eine solche Gruppe nur benutzen, nicht selbst herstellen.
        """
        from pychromecast.const import CAST_TYPE_GROUP
        from pychromecast.discovery import CastBrowser, SimpleCastListener
        import zeroconf

        def browse() -> list[dict[str, Any]]:
            found: dict[str, dict[str, Any]] = {}
            zc = zeroconf.Zeroconf()
            browser = CastBrowser(SimpleCastListener(), zc)
            browser.start_discovery()
            try:
                time.sleep(seconds)
                for info in list(browser.devices.values()):
                    found[str(info.uuid)] = {
                        # Eine Gruppe läuft auf der IP eines ihrer
                        # Mitglieder, nur mit eigenem Port – die Adresse
                        # allein taugt deshalb nicht als Kennung.
                        "uuid": str(info.uuid),
                        "name": info.friendly_name,
                        "host": info.host,
                        "port": info.port,
                        "model": info.model_name,
                        # Nur eine echte Google-Gruppe spielt synchron.
                        "group": info.cast_type == CAST_TYPE_GROUP,
                    }
            finally:
                browser.stop_discovery()
                zc.close()
            return sorted(found.values(), key=lambda entry: entry["name"] or "")

        return await asyncio.to_thread(browse)

    async def group_members(self, host: str, port: int = DEFAULT_PORT) -> list[str]:
        """Welche Boxen stecken in dieser Gruppe? Leer, wenn keine Gruppe.

        Der Port gehört dazu: Eine Gruppe teilt sich die Adresse mit der
        Box, die sie beherbergt, und ist nur über ihren eigenen Port zu
        erreichen.
        """
        import pychromecast
        from pychromecast.controllers.multizone import MultizoneController

        def read() -> list[str]:
            cast = pychromecast.get_chromecast_from_host(
                (host, port, None, None, None)
            )
            try:
                cast.wait(10)
                controller = MultizoneController(cast.uuid)
                cast.register_handler(controller)
                time.sleep(2)
                return [str(member) for member in controller.members]
            finally:
                cast.disconnect()

        try:
            return await asyncio.to_thread(read)
        except Exception as err:
            self.log.debug("Gruppenmitglieder von %s nicht lesbar: %s", host, err)
            return []

    async def spotify_wake(self, name: str, access_token: str) -> bool:
        """Startet die Spotify-App auf der Box und meldet sie bei Spotify an.

        Danach erscheint die Box als Spotify-Connect-Gerät – die spotify-
        Integration wartet darauf und startet dann die Playlist. Gibt False
        zurück, wenn die Box unbekannt ist oder die Anmeldung scheitert
        (Grund steht im Log).
        """
        cast = None
        for entity_id, candidate in self._casts.items():
            entity = self.hub.registry.get(entity_id)
            if entity is not None and entity.name == name:
                cast = candidate
                break
        if cast is None:
            return False

        controller_cls = _spotify_controller_class()
        controller = controller_cls(name)
        cast.register_handler(controller)
        try:
            # 1. App starten und Geräteinfo erfragen.
            def launch_and_ask() -> bool:
                launched = threading.Event()
                # pychromecast ruft den Callback mit (ok, antwort) auf –
                # die Argumente interessieren nicht, nur das Signal.
                controller.launch(callback_function=lambda *_args: launched.set())
                if not launched.wait(10):
                    return False
                controller.ask_info()
                return controller.got_info.wait(10)

            if not await asyncio.to_thread(launch_and_ask):
                self.log.warning("Spotify-App auf %s meldet keine Geräteinfo", name)
                return False

            # 2. Geräte-Token bei Spotify holen (mit dem Konto-Token).
            # Abgelehnte Anfragen kommen teils mit leerem Rumpf zurück –
            # deshalb erst Text lesen und erklärend scheitern statt an
            # ungültigem JSON zu sterben.
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    DEVICE_AUTH,
                    json={
                        "clientId": controller.client_id,
                        "deviceId": controller.device_id,
                    },
                    headers={"Authorization": f"Bearer {access_token}"},
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    status = response.status
                    text = await response.text()
            try:
                payload = json.loads(text) if text else {}
            except ValueError:
                payload = {}
            device_token = payload.get("accessToken")
            if not device_token:
                self.log.warning(
                    "Spotify device-auth für %s abgelehnt (HTTP %s): %s – "
                    "meist fehlt dem refresh_token der 'streaming'-Scope: "
                    "Anmelde-Helfer neu laufen lassen und Hub neu starten.",
                    name,
                    status,
                    text[:200] or "leere Antwort",
                )
                return False

            # 3. Box anmelden.
            def add_user() -> bool:
                controller.add_user(device_token)
                return controller.done.wait(10)

            if not await asyncio.to_thread(add_user) or controller.result != "ok":
                self.log.warning(
                    "Spotify-Anmeldung auf %s fehlgeschlagen: %s",
                    name,
                    controller.result or "Zeitüberschreitung",
                )
                return False
            self.log.info("%s bei Spotify angemeldet (geweckt)", name)
            return True
        finally:
            try:
                cast.unregister_handler(controller)
            except Exception:
                pass

    # ── Hub → Gerät ────────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        cast = self._casts.get(entity.id)
        if cast is None:
            raise ConnectionError("Cast-Gerät ist nicht verbunden")
        if command == "toggle":
            command = "pause" if entity.state.get("state") == "playing" else "play"
        controller = cast.media_controller

        if command == "play":
            if entity.state.get("state") not in ("paused", "playing"):
                # Play kann nur fortsetzen, was schon läuft/pausiert ist – auf
                # einem leeren Gerät gibt es nichts zu starten.
                raise ConfigError(
                    "Auf diesem Gerät läuft gerade nichts. Starte die Wiedergabe "
                    "aus einer App (Spotify, YouTube) heraus – dann steuert die "
                    "Kachel Play/Pause und Lautstärke."
                )
            await asyncio.to_thread(controller.play)
        elif command == "pause":
            await asyncio.to_thread(controller.pause)
        elif command == "next":
            await asyncio.to_thread(controller.queue_next)
        elif command == "previous":
            await asyncio.to_thread(controller.queue_prev)
        elif command == "volume_up":
            await asyncio.to_thread(cast.volume_up)
        elif command == "volume_down":
            await asyncio.to_thread(cast.volume_down)
        elif command == "set_volume":
            level = max(0.0, min(1.0, float(data.get("volume", 0)) / 100))
            await asyncio.to_thread(cast.set_volume, level)
        elif command == "mute":
            # Umschalten oder gezielt setzen, wenn data.muted mitkommt.
            muted = data.get("muted")
            if muted is None:
                muted = not bool(entity.state.get("muted"))
            await asyncio.to_thread(cast.set_volume_muted, bool(muted))
        else:
            raise ConfigError(f"Cast kennt das Kommando '{command}' nicht")


INTEGRATION = GoogleCastIntegration
