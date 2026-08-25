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
import hashlib
import json
import threading
import time
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


#: Modelle, die einen Bildschirm haben, obwohl Google sie als Tongerät
#: führt. Bisher leer – die Ausnahme gibt es, seit es Fernseher mit
#: eingebautem Cast gibt, und dann steht sie hier statt in einer
#: if-Kaskade irgendwo im Code.
BILDSCHIRM_MODELLE: frozenset[str] = frozenset()


#: Der Standardempfänger von Google – der, den `play_media` selbst
#: startet. Läuft er schon, gibt es nichts zu räumen.
STANDARD_EMPFAENGER = "CC1AD845"
#: Was auf einer Box läuft, die nichts tut: der Bildschirmschoner.
LEERLAUF_APPS = frozenset({"E8C28D3C", "84912283"})


def fremde_app(app_id: str | None) -> bool:
    """Hält gerade eine andere App die Box besetzt? (rein, testbar)

    «Andere» heisst: weder nichts noch der Standardempfänger, über den
    der Hub selbst abspielt, noch der Bildschirmschoner. Genau dann - und
    nur dann - lohnt es, vor dem Abspielen aufzuräumen: Ein `quit_app`
    auf eine leere Box kostet eine Sekunde für nichts.
    """
    kennung = (app_id or "").strip().upper()
    if not kennung:
        return False
    return kennung != STANDARD_EMPFAENGER and kennung not in LEERLAUF_APPS


def ist_gruppe(cast_type: str | None, port: int = DEFAULT_PORT) -> bool:
    """Ist das eine Lautsprechergruppe? (rein, testbar)

    Zwei Wege, weil beide Auskünfte unvollständig sind. Das Gerät selbst
    meldet «group», sobald es verbunden ist – vorher weiss man es nicht.
    Der Port genügt aber schon davor: Eine Gruppe läuft auf der Adresse
    einer ihrer Boxen und ist nur über ihren **eigenen** Port zu
    erreichen. Genau darum ist die Portangabe in der config.yaml keine
    Kleinigkeit – steht dort 8009, spricht der Hub die Einzelbox an, die
    die Gruppe beherbergt, und es spielt genau eine statt aller.
    """
    if (cast_type or "").strip().lower() == "group":
        return True
    return int(port or DEFAULT_PORT) != DEFAULT_PORT


def ist_bildschirm(cast_type: str | None, model_name: str | None = None) -> bool:
    """Hängt an diesem Cast-Gerät ein Bild? (rein, testbar)

    Google unterscheidet «cast» (Video), «audio» (Lautsprecher) und
    «group» (Lautsprechergruppe). Der Fernseher im Wohnzimmer meldet
    «cast» – auch dann, wenn er weder Steuerkreuz noch App-Start kennt
    und für den Hub aussieht wie eine Box.

    Genau daran hing ein Fehler: Der Musikplayer der Startseite
    unterscheidet Box und Fernseher an den Befehlen, und ein Cast-Gerät
    hat nur die eines Lautsprechers. Der Fernseher stand deshalb in der
    Boxenwahl, und lief dort ein Film, war er die gezeigte Karte.

    Eine Gruppe zählt als Lautsprecher: Google baut sie zum synchronen
    Abspielen von Ton, nicht von Bild.
    """
    if (model_name or "").strip() in BILDSCHIRM_MODELLE:
        return True
    return (cast_type or "").strip().lower() == "cast"


def cast_media_state(
    player_state: str | None,
    title: str | None,
    artist: str | None,
    app: str | None,
    volume: float | None,
    muted: bool | None = None,
    image: str | None = None,
    has_screen: bool | None = None,
    is_group: bool | None = None,
) -> dict[str, Any]:
    """Übersetzt Cast-Status in Entitäts-Attribute (rein, testbar).

    ``has_screen`` sagt der App, dass hier ein Fernseher steht und kein
    Lautsprecher. Es kommt vom Gerät selbst (siehe `ist_bildschirm`) und
    nicht aus seinem Namen: «Wohnzimmer» ist kein Beweis.
    """
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
        # Cover des laufenden Titels, sofern die sendende App eines mitgibt.
        "image": image or None,
        "app": app if app and app != "Backdrop" else None,
    }
    if volume is not None:
        result["volume"] = round(float(volume) * 100)
    if muted is not None:
        result["muted"] = bool(muted)
    if has_screen is not None:
        result["has_screen"] = bool(has_screen)
    if is_group is not None:
        result["is_group"] = bool(is_group)
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
        # entity_id → Port. Bei einer Gruppe ist er die halbe Auskunft:
        # Sie teilt sich die Adresse mit einer ihrer Boxen.
        self._ports: dict[str, int] = {}

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
                    # Eine Ton-Adresse abspielen - Grundlage der Durchsage.
                    "play_url",
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
                self._ports[entity_id] = port
                self._attach_listeners(entity_id, cast)
                await self._push_state(entity_id, cast, port)
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
                    integration._push_state(
                        entity_id, cast, integration._ports.get(entity_id, DEFAULT_PORT)
                    ),
                    integration._loop,
                )

            def new_media_status(self, _status: Any) -> None:
                asyncio.run_coroutine_threadsafe(
                    integration._push_state(
                        entity_id, cast, integration._ports.get(entity_id, DEFAULT_PORT)
                    ),
                    integration._loop,
                )

            def load_media_failed(self, _item: Any, _error_code: Any) -> None:
                pass

        listener = _Listener()
        cast.register_status_listener(listener)
        cast.media_controller.register_status_listener(listener)

    async def _push_state(
        self, entity_id: str, cast: Any, port: int = DEFAULT_PORT
    ) -> None:
        media = getattr(cast.media_controller, "status", None)
        status = getattr(cast, "status", None)
        # pychromecast liefert Cover als Liste von MediaImage(url, …).
        images = getattr(media, "images", None) or []
        image = next(
            (getattr(img, "url", None) for img in images if getattr(img, "url", None)),
            None,
        )
        await self.hub.registry.update_state(
            entity_id,
            cast_media_state(
                getattr(media, "player_state", None),
                getattr(media, "title", None),
                getattr(media, "artist", None),
                getattr(status, "display_name", None),
                getattr(status, "volume_level", None),
                getattr(status, "volume_muted", None),
                image=image,
                has_screen=ist_bildschirm(
                    getattr(cast, "cast_type", None), getattr(cast, "model_name", None)
                ),
                is_group=ist_gruppe(getattr(cast, "cast_type", None), port),
            ),
            available=True,
        )

    # ── Spotify-Wecken (für die spotify-Integration) ───────────────────────

    def device_names(self) -> list[str]:
        """Namen der verbundenen Cast-Boxen – als schlafende Connect-Ziele.

        Ohne Fernseher: Die Liste füllt die «Abspielen auf»-Zeile von
        Spotify, und dort ist ein Fernseher die falsche Antwort. Wer eine
        Box sucht, um Musik hinzuschicken, will nicht das Gerät wecken,
        das dann mit schwarzem Bild im Wohnzimmer steht.
        """
        names = []
        for entity_id in self._casts:
            entity = self.hub.registry.get(entity_id)
            if entity is not None and not entity.state.get("has_screen"):
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
        import zeroconf
        from pychromecast.const import CAST_TYPE_GROUP
        from pychromecast.discovery import CastBrowser, SimpleCastListener

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

    def cast_fuer_namen(self, name: str) -> Any | None:
        """Das Cast-Objekt zu einem Anzeigenamen – oder None.

        Über den Namen, weil das die einzige Kennung ist, die Spotify und
        der Hub gemeinsam haben: In der Boxenwahl steht «Küche + Bad»,
        nicht eine Entitäts-ID.
        """
        for entity_id, cast in self._casts.items():
            entity = self.hub.registry.get(entity_id)
            if entity is not None and entity.name == name:
                return cast
        return None

    def group_names(self) -> list[str]:
        """Namen der echten Lautsprechergruppen.

        Für die Boxenwahl der App: Ohne diese Auskunft sieht eine Gruppe
        aus wie eine Box, und wer sich wundert, warum nur eine spielt,
        hat keinen Anhaltspunkt. Steht «Ganze Wohnung» ohne Marke da,
        führt der Hub sie als Einzelbox – dann fehlt in der config.yaml
        der eigene Port der Gruppe.
        """
        namen = []
        for entity_id in self._casts:
            entity = self.hub.registry.get(entity_id)
            if entity is not None and entity.state.get("is_group"):
                namen.append(entity.name)
        return namen

    async def lautstaerke_setzen(self, name: str, prozent: float) -> bool:
        """Die Lautstärke über das Cast-Protokoll setzen; False, wenn die
        Box hier unbekannt ist.

        Warum es diesen Weg braucht: Spotify beantwortet
        `PUT /me/player/volume` für Google-Boxen und erst recht für
        Gruppen mit «VOLUME_CONTROL_DISALLOWED». Der Regler in der App
        bewegte sich, und niemand wurde lauter. Cast kann es – und bei
        einer Gruppe setzt Google die Mitglieder gleich mit.
        """
        cast = self.cast_fuer_namen(name)
        if cast is None:
            return False
        stufe = max(0.0, min(1.0, float(prozent) / 100))
        await asyncio.to_thread(cast.set_volume, stufe)
        return True

    def lautstaerke_von(self, name: str) -> int | None:
        """Wie laut diese Box gerade steht – der Stand des Geräts selbst."""
        for entity_id in self._casts:
            entity = self.hub.registry.get(entity_id)
            if entity is not None and entity.name == name:
                wert = entity.state.get("volume")
                return int(wert) if isinstance(wert, (int, float)) else None
        return None

    async def spotify_wake(self, name: str, access_token: str) -> bool:
        """Startet die Spotify-App auf der Box und meldet sie bei Spotify an.

        Danach erscheint die Box als Spotify-Connect-Gerät – die spotify-
        Integration wartet darauf und startet dann die Playlist. Gibt False
        zurück, wenn die Box unbekannt ist oder die Anmeldung scheitert
        (Grund steht im Log).
        """
        cast = self.cast_fuer_namen(name)
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
            async with aiohttp.ClientSession() as session, session.post(
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
        elif command == "play_url":
            # Eine Ton-Adresse abspielen - die Durchsage («Essen ist
            # fertig») kommt als frisch erzeugte MP3 vom Hub selbst.
            url = str(data.get("url") or "")
            if not url:
                raise ConfigError("play_url braucht eine 'url'")
            content_type = str(data.get("content_type") or "audio/mpeg")
            volume = data.get("volume")

            def start() -> None:
                if volume is not None:
                    cast.set_volume(max(0.0, min(1.0, float(volume) / 100)))
                # Erst räumen, dann spielen. Der Fall aus dem Wohnzimmer:
                # Spotify lief, wurde auf Pause gestellt, dann sollte
                # Radio kommen - und es kam nichts. Eine pausierte
                # Spotify-Sitzung hält den Empfänger der Box besetzt; ein
                # `play_media` daneben startet den Standardempfänger, und
                # welcher von beiden gewinnt, entscheidet die Box. Wer
                # vorher aufräumt, hat die Frage nicht.
                if fremde_app(getattr(cast, "app_id", None)):
                    try:
                        cast.quit_app()
                        # Der Box einen Moment lassen, sonst trifft das
                        # `play_media` auf einen Empfänger im Abbau.
                        time.sleep(1.0)
                    except Exception as err:
                        self.log.debug("App auf %s nicht beendet: %s", entity.name, err)
                controller.play_media(url, content_type)
                # Warten, bis der Player übernommen hat - sonst ginge eine
                # gleich folgende zweite Durchsage verloren.
                controller.block_until_active(timeout=10)

            await asyncio.to_thread(start)
        else:
            raise ConfigError(f"Cast kennt das Kommando '{command}' nicht")


INTEGRATION = GoogleCastIntegration
