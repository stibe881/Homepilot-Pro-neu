"""Android TV – Fernbedienung über das Google-TV-Remote-Protokoll.

Konfiguration:
  - integration: androidtv
    devices:
      - host: 192.168.1.50
        name: Wohnzimmer TV

Voraussetzung:  pip install "homepilot[androidtv]"  bzw.  pip install androidtvremote2

Einrichtung (einmalig pro Fernseher, der Fernseher muss dabei an sein):
  1. Den Geräteblock wie oben in die config.yaml eintragen.
  2. Auf dem Hub-Rechner ausführen:
         python -m homepilot.integrations.androidtv -c config.yaml
     Auf dem Fernseher erscheint ein sechsstelliger Code – hier eintippen.
  3. Hub (neu) starten. Die Kopplung liegt danach als Zertifikat neben der
     homepilot-data.json und hält dauerhaft.

Das Protokoll authentifiziert über ein selbstsigniertes Client-Zertifikat,
das der Fernseher bei der PIN-Eingabe einmalig freischaltet – deshalb
braucht die Einrichtung einen Menschen vor dem Gerät, der Betrieb danach
nicht mehr. Die Bibliothek ist asyncio-nativ; ihre Rückrufe kommen direkt
im Event-Loop an.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Bekannte Apps: Paketname → Anzeigename. Unbekanntes zeigt den letzten
# Namensteil, damit die Kachel nie eine rohe Paket-ID anzeigt.
APP_NAMES = {
    "com.netflix.ninja": "Netflix",
    "com.google.android.youtube.tv": "YouTube",
    "com.google.android.youtube.tvmusic": "YouTube Music",
    "com.spotify.tv.android": "Spotify",
    "com.disney.disneyplus": "Disney+",
    "com.amazon.amazonvideo.livingroom": "Prime Video",
    "com.plexapp.android": "Plex",
    "com.zattoo.player": "Zattoo",
    "com.google.android.apps.tv.launcherx": None,  # Startbildschirm
    "com.android.systemui": None,
    "com.google.android.tvlauncher": None,
}

# Was die Kachel zum Starten anbietet. Bewusst eine kurze Liste statt
# aller installierten Apps: Das Protokoll kennt keine Abfrage dafür - es
# kann Apps starten, aber nicht aufzählen. Wer eine andere App will,
# trägt sie in der config.yaml ein; den Paketnamen zeigt der Play-Store
# in der Adresszeile («?id=…»).
DEFAULT_APPS: list[dict[str, str]] = [
    {"name": "Plex", "app": "com.plexapp.android"},
    {"name": "Zattoo", "app": "com.zattoo.player"},
    {"name": "YouTube", "app": "com.google.android.youtube.tv"},
    {"name": "Netflix", "app": "com.netflix.ninja"},
    {"name": "Disney+", "app": "com.disney.disneyplus"},
    {"name": "Prime Video", "app": "com.amazon.amazonvideo.livingroom"},
]


def app_list(block: dict[str, Any], device: dict[str, Any]) -> list[dict[str, str]]:
    """Welche Apps dieses Gerät anbietet (rein, testbar).

    Drei Ebenen, von unten nach oben: die Vorgabe, eine Liste für alle
    Geräte, eine Liste für dieses eine. Das Spezifischere gewinnt ganz -
    wer für den Schlafzimmer-Fernseher nur Plex will, soll nicht die
    ganze Vorgabe daneben stehen haben.

    Ein Eintrag darf auch nur ein Paketname sein; dann steht der bekannte
    Anzeigename dort, sonst der letzte Namensteil - eine rohe Paket-ID
    soll auf keinem Knopf stehen.
    """
    roh = device.get("apps")
    if roh is None:
        roh = block.get("apps")
    if roh is None:
        return list(DEFAULT_APPS)

    apps: list[dict[str, str]] = []
    for eintrag in roh:
        if isinstance(eintrag, str):
            paket = eintrag.strip()
            name = APP_NAMES.get(paket) or paket.rsplit(".", 1)[-1].title()
        elif isinstance(eintrag, dict):
            paket = str(eintrag.get("app") or "").strip()
            name = str(
                eintrag.get("name")
                or APP_NAMES.get(paket)
                or (paket.rsplit(".", 1)[-1].title() if paket else "")
            )
        else:
            continue
        if paket:
            apps.append({"name": name, "app": paket})
    return apps


# Kommando der App → Taste der Fernbedienung.
KEYMAP = {
    "play": "KEYCODE_MEDIA_PLAY_PAUSE",
    "pause": "KEYCODE_MEDIA_PLAY_PAUSE",
    "next": "KEYCODE_MEDIA_NEXT",
    "previous": "KEYCODE_MEDIA_PREVIOUS",
    "volume_up": "KEYCODE_VOLUME_UP",
    "volume_down": "KEYCODE_VOLUME_DOWN",
    "mute": "KEYCODE_VOLUME_MUTE",
    "home": "KEYCODE_HOME",
    "back": "KEYCODE_BACK",
    "dpad_up": "KEYCODE_DPAD_UP",
    "dpad_down": "KEYCODE_DPAD_DOWN",
    "dpad_left": "KEYCODE_DPAD_LEFT",
    "dpad_right": "KEYCODE_DPAD_RIGHT",
    "ok": "KEYCODE_DPAD_CENTER",
}


def app_name(app_id: str | None) -> str | None:
    """Übersetzt eine Android-Paket-ID in einen lesbaren Namen (rein, testbar)."""
    if not app_id:
        return None
    if app_id in APP_NAMES:
        return APP_NAMES[app_id]
    tail = app_id.rsplit(".", 1)[-1]
    return tail.capitalize() if tail else None


def tv_state(is_on: bool, current_app: str | None, volume_info: Any) -> dict[str, Any]:
    """Übersetzt den Bibliothekszustand in Entitäts-Attribute (rein, testbar)."""
    name = app_name(current_app) if is_on else None
    result: dict[str, Any] = {
        "state": "on" if is_on else "off",
        "app": name,
        # Die Media-Player-Kachel der App zeigt 'track' als Hauptzeile.
        "track": name,
    }
    level = getattr(volume_info, "level", None)
    maximum = getattr(volume_info, "max", None)
    if level is not None and maximum:
        result["volume"] = round(level / maximum * 100)
        result["muted"] = bool(getattr(volume_info, "muted", False))
    return result


# Was der Einschlaf-Timer anbietet. Halbe Stunden bis zweieinhalb - wer
# länger wach bleibt, schaltet ohnehin selbst aus.
SLEEP_MINUTES = [30, 60, 90, 120, 150]


def sleep_left(until: float | None, now: float) -> int | None:
    """Wie viele Minuten der Timer noch läuft (rein, testbar).

    Aufgerundet: In der letzten halben Minute steht «1 min» statt «0» -
    solange noch etwas läuft, soll auch etwas dastehen. `None` heisst:
    kein Timer.
    """
    if until is None:
        return None
    rest = until - now
    if rest <= 0:
        return None
    return max(1, int(rest // 60) + (1 if rest % 60 else 0))


def cert_paths(cert_dir: str | Path, host: str) -> tuple[str, str]:
    """Zertifikat und Schlüssel für einen Fernseher – Integration und
    Pairing-Helfer müssen zwingend dieselben Pfade berechnen."""
    base = Path(cert_dir) / f"androidtv-{host.replace(':', '_')}"
    return (f"{base}.pem", f"{base}.key")


PAIR_HINT = (
    "nicht gekoppelt – auf dem Hub-Rechner ausführen: "
    "python -m homepilot.integrations.androidtv -c config.yaml"
)

# Was der Benutzer liest, wenn eine Taste ins Leere geht. Der Grund gehört
# dazu: «Der Befehl ist fehlgeschlagen» beantwortet keine einzige Frage,
# und die englische Meldung der Bibliothek («Called send_key_command after
# disconnect») erst recht nicht.
NICHT_ERREICHBAR = (
    "Fernseher nicht erreichbar – ist er am Strom und im selben Netz?"
)
NICHT_GEKOPPELT = (
    "Fernseher nicht gekoppelt – die Kopplung muss einmal am Gerät "
    "bestätigt werden (siehe Hub-Protokoll)."
)


def leitung_offen(remote: Any) -> bool | None:
    """Steht die Leitung zum Fernseher gerade wirklich? (rein, testbar)

    ``None`` heisst «weiss nicht» – dann wird gesendet wie bisher.

    **Warum das nötig ist**, steht in der Bibliothek: ``send_key_command``
    wirft ``ConnectionClosed`` nur, wenn das Protokollobjekt ganz fehlt.
    Ist bloss die *Verbindung* darunter im Zumachen, landet die Taste in
    ``_send_message`` – und das tut dann genau dies::

        if not self.transport or self.transport.is_closing():
            LOGGER.debug("Connection is closed!")
            return

    Sie verschwindet also lautlos: kein Fehler, keine Wirkung. Der Hub
    meldet «erledigt», die App schreibt «ging an den Hub», und der
    Fernseher tut nichts. Genau das Bild, das aus dem Haus gemeldet
    wurde.

    Deshalb hier ein Blick auf dieselben zwei Felder, bevor wir senden.
    Sie sind privat, und das ist der Haken: Benennt die Bibliothek sie
    um, weiss diese Funktion nichts mehr – dann gibt sie ``None`` zurück
    und alles läuft wie zuvor. Lieber gelegentlich blind als plötzlich
    stumm.
    """
    # «Feld fehlt» und «Feld ist None» sind zweierlei: Das erste heisst,
    # dass diese Funktion die Bibliothek nicht mehr versteht (Umbenennung,
    # anderer Aufbau) - dann gilt «weiss nicht» und es wird gesendet wie
    # zuvor. Das zweite heisst wirklich: keine Verbindung.
    if not hasattr(remote, "_remote_message_protocol"):
        return None
    protokoll = remote._remote_message_protocol
    if protokoll is None:
        return False
    if not hasattr(protokoll, "transport"):
        return None
    transport = protokoll.transport
    if transport is None:
        return False
    schliesst = getattr(transport, "is_closing", None)
    if not callable(schliesst):
        return None
    try:
        return not schliesst()
    except Exception:
        return None


def absage(gekoppelt: bool) -> str:
    """Warum eine Taste nicht ankam (rein, testbar).

    Zwei Fälle, zwei ganz verschiedene nächste Schritte: Ein nicht
    gekoppelter Fernseher braucht einen Menschen davor, ein nicht
    erreichbarer nur Strom und Netz. Sie zu vermengen hiesse, jemanden
    zum falschen Gerät zu schicken.
    """
    return NICHT_ERREICHBAR if gekoppelt else NICHT_GEKOPPELT


class AndroidTvIntegration(Integration):
    name = "androidtv"

    def __init__(self, hub: Any, config: dict[str, Any]) -> None:
        """Die Zustandstabellen entstehen hier und nicht in ``setup``.

        Ein Befehl kann eintreffen, bevor ``setup`` durch ist oder
        nachdem es fehlschlug – die Entitäten stehen dann längst in der
        Registry, und der Hub versucht das Setup erst in fünf Minuten
        wieder. Lagen die Tabellen im ``setup``, wurde aus der klaren
        Absage «Fernseher nicht erreichbar» ein ``AttributeError``.
        """
        super().__init__(hub, config)
        self._remotes: dict[str, Any] = {}
        # Ob die Kopplung je zustande kam. Entscheidet nur darüber, welche
        # Absage der Benutzer liest – die beiden Fälle haben verschiedene
        # nächste Schritte (siehe ``absage``).
        self._gekoppelt: dict[str, bool] = {}
        # Laufende Einschlaf-Timer je Gerät.
        self._sleep: dict[str, asyncio.Task] = {}
        # Der Einschlaf-Timer als eigene Kachel: je Fernseher eine
        # Timer-Entität, die denselben Timer zeigt und stellt. Bisher gab
        # es ihn nur in der Fernsehkachel – wer ihn als Favorit griffbereit
        # wollte, musste den ganzen Fernseher favorisieren.
        self._timer_of: dict[str, str] = {}  # TV-Id → Timer-Id
        self._tv_of: dict[str, str] = {}  # Timer-Id → TV-Id

    async def setup(self) -> None:
        devices = self.config.get("devices") or []
        if not devices:
            raise ConfigError("androidtv braucht mindestens ein Gerät unter 'devices'")

        try:
            import androidtvremote2  # noqa: F401 – nur Verfügbarkeit prüfen
        except ImportError as err:
            raise ConfigError(
                "androidtvremote2 fehlt – installieren mit: pip install androidtvremote2"
            ) from err

        cert_dir = self.config.get("cert_dir") or str(Path(str(self.hub.config.data_file)).parent)

        for device in devices:
            host = device.get("host")
            if not host:
                raise ConfigError("androidtv: jedes Gerät braucht einen 'host'")
            entity = await self.add_entity(
                str(host).replace(".", "_"),
                EntityKind.MEDIA_PLAYER,
                device.get("name", f"Android TV {host}"),
                state={
                    "state": "off",
                    # Damit die App ihn nicht in die Boxenwahl des
                    # Musikplayers nimmt. Bisher erkannte sie ihn an
                    # Steuerkreuz und App-Start; das stimmt hier, ist
                    # aber ein Umweg – ein Fernseher darf es einfach
                    # sagen.
                    "has_screen": True,
                    "apps": app_list(self.config, device),
                    # Zeitpunkt, zu dem der Fernseher von selbst ausgeht -
                    # als Zeitstempel und nicht als Restminuten, damit die
                    # App mitzählen kann, ohne dass der Hub im Minutentakt
                    # etwas schickt.
                    "sleep_until": None,
                    "sleep_minutes": SLEEP_MINUTES,
                },
                commands=[
                    "turn_on", "turn_off", "toggle",
                    "play", "pause", "next", "previous",
                    "volume_up", "volume_down", "mute",
                    "home", "back", "launch_app", "sleep_timer",
                    "dpad_up", "dpad_down", "dpad_left", "dpad_right", "ok",
                ],
                available=False,
            )
            timer = await self.add_entity(
                f"{str(host).replace('.', '_')}_timer",
                EntityKind.TIMER,
                f"{device.get('name', f'Android TV {host}')} Timer",
                state={
                    "state": "off",
                    "sleep_until": None,
                    "sleep_minutes": SLEEP_MINUTES,
                },
                commands=["sleep_timer"],
            )
            self._timer_of[entity.id] = timer.id
            self._tv_of[timer.id] = entity.id
            self.start_task(self._device_loop(entity.id, str(host), cert_dir))

    async def teardown(self) -> None:
        await super().teardown()
        for task in self._sleep.values():
            task.cancel()
        self._sleep.clear()
        for remote in self._remotes.values():
            try:
                remote.disconnect()
            except Exception:
                pass
        self._remotes.clear()
        self._gekoppelt.clear()

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    async def _device_loop(self, entity_id: str, host: str, cert_dir: str) -> None:
        from androidtvremote2 import AndroidTVRemote, InvalidAuth

        certfile, keyfile = cert_paths(cert_dir, host)
        remote = AndroidTVRemote("homepilot", certfile, keyfile, host)
        await remote.async_generate_cert_if_missing()

        while True:
            try:
                await remote.async_connect()
                break
            except InvalidAuth:
                # Pairing braucht einen Menschen vor dem Fernseher –
                # Dauer-Wiederholung wäre sinnlos.
                self.log.warning("Android TV %s %s", host, PAIR_HINT)
                self._gekoppelt[entity_id] = False
                await self.hub.registry.update_state(entity_id, {"state": "off"}, available=False)
                return
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.debug("Android TV %s nicht erreichbar (%s), neuer Versuch in 30s", host, err)
                await asyncio.sleep(30)

        # Erst jetzt eintragen. Vorher stand die Fernbedienung schon in
        # `_remotes`, während sie noch gar nicht verbunden war – die Prüfung
        # in `handle_command` lief damit ins Leere, und jeder Tastendruck
        # endete in der englischen Meldung der Bibliothek statt in einem
        # Satz, der sagt, was zu tun ist.
        self._remotes[entity_id] = remote
        self._gekoppelt[entity_id] = True

        def push(*_args: Any) -> None:
            asyncio.get_running_loop().create_task(self._push_state(entity_id, remote))

        def availability(available: bool) -> None:
            asyncio.get_running_loop().create_task(
                self._push_state(entity_id, remote, available=available)
            )

        remote.add_is_on_updated_callback(push)
        remote.add_current_app_updated_callback(push)
        remote.add_volume_info_updated_callback(push)
        remote.add_is_available_updated_callback(availability)
        remote.keep_reconnecting(
            invalid_auth_callback=lambda: self.log.warning("Android TV %s %s", host, PAIR_HINT)
        )
        await self._push_state(entity_id, remote)
        self.log.info("Mit Android TV %s verbunden", host)

    async def _push_state(self, entity_id: str, remote: Any, available: bool = True) -> None:
        zustand = tv_state(bool(remote.is_on), remote.current_app, remote.volume_info)
        # Wer den Fernseher selbst ausschaltet, meint es auch - dann läuft
        # kein Timer mehr, und in der Kachel steht auch keiner. Sonst
        # zählte dort eine Zahl herunter, die nichts mehr bewirkt.
        if zustand["state"] == "off" and entity_id in self._sleep:
            await self._set_sleep(entity_id, None)
        await self.hub.registry.update_state(entity_id, zustand, available=available)

    # ── Einschlaf-Timer ────────────────────────────────────────────────────

    async def _push_sleep(self, tv_id: str, bis: float | None) -> None:
        """Den Timer-Stand auf beide Kacheln schreiben.

        Der Fernseher und seine Timer-Entität zeigen denselben Timer –
        egal, von welcher der beiden er gestellt wurde. Eine Kachel, die
        weiterzählt, während die andere «aus» sagt, wäre schlimmer als
        keine zweite Kachel.
        """
        await self.hub.registry.update_state(tv_id, {"sleep_until": bis})
        timer_id = self._timer_of.get(tv_id)
        if timer_id is not None:
            await self.hub.registry.update_state(
                timer_id,
                {"sleep_until": bis, "state": "on" if bis is not None else "off"},
            )

    async def _set_sleep(self, entity_id: str, minutes: Any) -> None:
        """Timer setzen, verlängern oder abbrechen.

        Er lebt im Hub und nicht in der App: Wer einschläft, sperrt sein
        Telefon - ein Timer, der davon abhinge, wäre keiner.
        """
        laufend = self._sleep.pop(entity_id, None)
        if laufend is not None:
            laufend.cancel()

        try:
            zahl = int(minutes) if minutes is not None else 0
        except (TypeError, ValueError) as err:
            raise ValueError(
                "sleep_timer braucht data.minutes als Zahl (0 = aus)"
            ) from err

        if zahl <= 0:
            await self._push_sleep(entity_id, None)
            return

        bis = time.time() + zahl * 60
        await self._push_sleep(entity_id, bis)
        self._sleep[entity_id] = self.start_task(self._sleep_loop(entity_id, zahl * 60))

    async def _sleep_loop(self, entity_id: str, seconds: float) -> None:
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
            raise
        self._sleep.pop(entity_id, None)
        await self._push_sleep(entity_id, None)
        remote = self._remotes.get(entity_id)
        if remote is not None and remote.is_on:
            self.log.info("Einschlaf-Timer abgelaufen: %s geht aus", entity_id)
            try:
                self._taste(entity_id, remote, "KEYCODE_POWER")
            except ConnectionError as err:
                # Niemand steht davor, den man fragen könnte – der Timer ist
                # ohnehin schon abgeräumt. Also nur notieren.
                self.log.warning("Einschlaf-Timer konnte %s nicht ausschalten: %s",
                                 entity_id, err)

    # ── Hub → Gerät ────────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        # Die Timer-Kachel kann genau eines: den Einschlaf-Timer ihres
        # Fernsehers stellen. Der Timer selbst läuft unter der TV-Id –
        # es gibt nur einen, egal von welcher Kachel gestellt.
        tv_id = self._tv_of.get(entity.id)
        if tv_id is not None:
            if command != "sleep_timer":
                raise ValueError("Die Timer-Kachel kennt nur sleep_timer")
            if self._remotes.get(tv_id) is None:
                raise ConnectionError(absage(self._gekoppelt.get(tv_id, True)))
            await self._set_sleep(tv_id, data.get("minutes"))
            return
        remote = self._remotes.get(entity.id)
        if remote is None:
            gekoppelt = self._gekoppelt.get(entity.id, True)
            if gekoppelt and command in ("turn_off", "pause"):
                # Ein gekoppelter Fernseher, den der Hub nicht erreicht,
                # ist vom Netz - und damit aus. «Mach ihn aus» ist dann
                # ein erfüllter Wunsch, kein Fehler.
                #
                # Das zu melden hielt einen ganzen Ablauf an: «Niemand
                # mehr zuhause» schaltet zwei Fernseher und ein Dutzend
                # Boxen ab und schliesst zuletzt die Türe. Ein Gerät, das
                # ohnehin schon aus war, brachte den Rest zum Stehen.
                #
                # Nur bei gekoppelten Geräten: Eine fehlende Kopplung ist
                # ein Einrichtungsfehler, den man sehen muss - da hilft
                # kein Schweigen.
                self.log.info(
                    "%s ist nicht erreichbar - «%s» gilt als erledigt",
                    entity.label,
                    command,
                )
                return
            raise ConnectionError(absage(gekoppelt))
        if command == "toggle":
            command = "turn_off" if entity.state.get("state") == "on" else "turn_on"
        if command in ("turn_on", "turn_off"):
            # Es gibt nur eine Power-Taste; nichts tun, wenn der Zustand schon stimmt.
            if (command == "turn_on") != bool(remote.is_on):
                self._taste(entity.id, remote, "KEYCODE_POWER")
            return
        if command == "launch_app":
            app = data.get("app")
            if not app:
                raise ValueError("launch_app braucht data.app (Paket-ID oder Link)")
            self._senden(entity.id, lambda: remote.send_launch_app_command(str(app)))
            return
        if command == "sleep_timer":
            await self._set_sleep(entity.id, data.get("minutes"))
            return
        self._taste(entity.id, remote, KEYMAP[command])

    def _taste(self, entity_id: str, remote: Any, key: str) -> None:
        # Erst nachsehen, ob die Leitung steht: Eine Taste in eine
        # zumachende Verbindung verschwindet lautlos (siehe
        # `leitung_offen`). Eine Absage ist besser als ein «erledigt»,
        # das nichts bewirkt hat.
        if leitung_offen(remote) is False:
            self.log.info(
                "Taste %s an %s nicht gesendet – die Leitung ist zu", key, entity_id
            )
            raise ConnectionError(absage(self._gekoppelt.get(entity_id, True)))
        self._senden(entity_id, lambda: remote.send_key_command(key))

    def _senden(self, entity_id: str, tun: Any) -> None:
        """Etwas an den Fernseher schicken – und Fehlschläge übersetzen.

        ``send_key_command`` ist nicht blockierend: Es legt die Taste in
        den Puffer und kommt sofort zurück. Ist die Verbindung inzwischen
        weg – der Fernseher wurde vom Netz genommen, das WLAN hakt, die
        Wiederverbindung läuft gerade –, wirft es ``ConnectionClosed``.
        Ungefiltert stand das dann als «Called send_key_command after
        disconnect» in der App: richtig, aber unbrauchbar.
        """
        try:
            tun()
        except Exception as err:
            # Am Namen und nicht am Typ: `androidtvremote2` wird bewusst
            # erst in `_device_loop` importiert, damit der Hub auch ohne
            # die Bibliothek startet (und die Tests ohne sie laufen). Ein
            # `except ConnectionClosed` hier oben bräuchte sie zur
            # Ladezeit des Moduls.
            if type(err).__name__ != "ConnectionClosed":
                raise
            # Die Verbindung ist weg; `keep_reconnecting` versucht es von
            # sich aus weiter. Hier zählt nur, dass die Taste nicht ankam.
            self.log.info("Taste an %s ging ins Leere: %s", entity_id, err)
            raise ConnectionError(
                absage(self._gekoppelt.get(entity_id, True))
            ) from err


INTEGRATION = AndroidTvIntegration


# ── Pairing-Helfer ─────────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.androidtv -c config.yaml
# Liest die androidtv-Geräte aus der Konfiguration, prüft jede Kopplung und
# holt fehlende PINs interaktiv nach – mit exakt denselben Zertifikatspfaden,
# die der Hub später benutzt.


async def _pair_one(host: str, name: str, certfile: str, keyfile: str) -> bool:
    from androidtvremote2 import AndroidTVRemote, CannotConnect, InvalidAuth

    remote = AndroidTVRemote("homepilot", certfile, keyfile, host)
    await remote.async_generate_cert_if_missing()
    try:
        await remote.async_connect()
        remote.disconnect()
        print(f"✓ {name} ({host}) ist bereits gekoppelt.")
        return True
    except CannotConnect as err:
        print(f"✗ {name} ({host}) nicht erreichbar: {err}")
        print("  Ist der Fernseher an und im selben Netz?")
        return False
    except InvalidAuth:
        pass

    print(f"→ Kopple {name} ({host}) – auf dem Fernseher erscheint gleich ein Code.")
    try:
        await remote.async_start_pairing()
        code = input("  Code vom Fernseher: ").strip()
        await remote.async_finish_pairing(code)
    except Exception as err:
        print(f"✗ Kopplung fehlgeschlagen: {err}")
        return False
    finally:
        remote.disconnect()
    print(f"✓ {name} ({host}) gekoppelt.")
    return True


async def _pair_main(config_path: str, only_host: str | None) -> int:
    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "androidtv"]
    if not blocks:
        print("Kein androidtv-Block in der Konfiguration gefunden.")
        return 1
    block = blocks[0]
    cert_dir = block.get("cert_dir") or str(Path(str(config.data_file)).parent)
    Path(cert_dir).mkdir(parents=True, exist_ok=True)

    ok = True
    for device in block.get("devices") or []:
        host = str(device.get("host"))
        if only_host and host != only_host:
            continue
        certfile, keyfile = cert_paths(cert_dir, host)
        if not await _pair_one(host, device.get("name", host), certfile, keyfile):
            ok = False
    return 0 if ok else 1


async def _tasten_main(config_path: str, taste: str | None) -> int:
    """Was zwischen Hub und Fernseher wirklich passiert – roh.

    Der Anlass: «Die Fernbedienung funktioniert immer noch nicht.» Die
    App schickt nachweislich, der Hub nimmt an – und der Fernseher tut
    nichts. Dazwischen liegen drei Dinge, die man von aussen nicht
    unterscheiden kann: keine Kopplung, keine Verbindung, oder eine
    Taste, die in einer zumachenden Leitung verschwindet (siehe
    ``leitung_offen``).

    Hier sieht man alle drei auf einmal – und kann eine Taste von Hand
    schicken, ohne App dazwischen.
    """
    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "androidtv"]
    if not blocks:
        print(f"In {config_path} steht kein androidtv-Block.")
        return 1

    # Erst nach der Konfiguration: Ein Werkzeug zur Fehlersuche, das
    # selbst mit einem Traceback abbricht, ist keins.
    try:
        from androidtvremote2 import AndroidTVRemote, CannotConnect, InvalidAuth
    except ImportError:
        print("androidtvremote2 fehlt – installieren mit: pip install androidtvremote2")
        return 1
    block = blocks[0]
    cert_dir = block.get("cert_dir") or str(Path(str(config.data_file)).parent)

    for device in block.get("devices") or []:
        host = str(device.get("host"))
        name = device.get("name", host)
        certfile, keyfile = cert_paths(cert_dir, host)
        print(f"\n{name} ({host})")
        remote = AndroidTVRemote("homepilot", certfile, keyfile, host)
        await remote.async_generate_cert_if_missing()
        try:
            await remote.async_connect()
        except InvalidAuth:
            print(f"  ✗ {PAIR_HINT}")
            continue
        except CannotConnect as err:
            print(f"  ✗ nicht erreichbar: {err}")
            print("    Ist der Fernseher an und im selben Netz?")
            continue
        print("  ✓ verbunden")
        print(f"    eingeschaltet: {remote.is_on}")
        print(f"    Vordergrund:   {remote.current_app}")
        print(f"    Leitung offen: {leitung_offen(remote)}")
        if taste:
            # Ohne KEYCODE_ davor geht auch: Die Bibliothek setzt es
            # selbst davor, und die Home-Assistant-Liste schreibt sie so.
            print(f"    sende {taste} …")
            try:
                remote.send_key_command(taste)
            except Exception as err:
                print(f"    ✗ abgewiesen: {type(err).__name__}: {err}")
            else:
                # Kurz warten: `send_key_command` puffert nur.
                await asyncio.sleep(0.5)
                print(f"    ✓ rausgeschickt, Leitung danach: {leitung_offen(remote)}")
                print("      Tut der Fernseher nichts, liegt es an ihm oder")
                print("      an der App im Vordergrund - nicht am Hub.")
        remote.disconnect()
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Android-TV-Kopplung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    parser.add_argument("--host", help="nur diesen Fernseher koppeln")
    parser.add_argument(
        "--tasten",
        action="store_true",
        help="nicht koppeln, sondern nachsehen: Verbindung, Zustand, Leitung",
    )
    parser.add_argument(
        "--taste",
        help="mit --tasten: diese Taste schicken, z.B. DPAD_DOWN oder KEYCODE_HOME",
    )
    args = parser.parse_args()
    if args.tasten or args.taste:
        sys.exit(asyncio.run(_tasten_main(args.config, args.taste)))
    sys.exit(asyncio.run(_pair_main(args.config, args.host)))
