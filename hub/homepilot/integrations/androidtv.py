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


def cert_paths(cert_dir: str | Path, host: str) -> tuple[str, str]:
    """Zertifikat und Schlüssel für einen Fernseher – Integration und
    Pairing-Helfer müssen zwingend dieselben Pfade berechnen."""
    base = Path(cert_dir) / f"androidtv-{host.replace(':', '_')}"
    return (f"{base}.pem", f"{base}.key")


PAIR_HINT = (
    "nicht gekoppelt – auf dem Hub-Rechner ausführen: "
    "python -m homepilot.integrations.androidtv -c config.yaml"
)


class AndroidTvIntegration(Integration):
    name = "androidtv"

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

        cert_dir = self.config.get("cert_dir") or str(Path(self.hub.config.data_file).parent)
        self._remotes: dict[str, Any] = {}

        for device in devices:
            host = device.get("host")
            if not host:
                raise ConfigError("androidtv: jedes Gerät braucht einen 'host'")
            entity = await self.add_entity(
                str(host).replace(".", "_"),
                EntityKind.MEDIA_PLAYER,
                device.get("name", f"Android TV {host}"),
                state={"state": "off", "apps": app_list(self.config, device)},
                commands=[
                    "turn_on", "turn_off", "toggle",
                    "play", "pause", "next", "previous",
                    "volume_up", "volume_down", "mute",
                    "home", "back", "launch_app",
                    "dpad_up", "dpad_down", "dpad_left", "dpad_right", "ok",
                ],
                available=False,
            )
            self.start_task(self._device_loop(entity.id, str(host), cert_dir))

    async def teardown(self) -> None:
        await super().teardown()
        for remote in self._remotes.values():
            try:
                remote.disconnect()
            except Exception:
                pass
        self._remotes.clear()

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    async def _device_loop(self, entity_id: str, host: str, cert_dir: str) -> None:
        from androidtvremote2 import AndroidTVRemote, InvalidAuth

        certfile, keyfile = cert_paths(cert_dir, host)
        remote = AndroidTVRemote("homepilot", certfile, keyfile, host)
        self._remotes[entity_id] = remote
        await remote.async_generate_cert_if_missing()

        while True:
            try:
                await remote.async_connect()
                break
            except InvalidAuth:
                # Pairing braucht einen Menschen vor dem Fernseher –
                # Dauer-Wiederholung wäre sinnlos.
                self.log.warning("Android TV %s %s", host, PAIR_HINT)
                await self.hub.registry.update_state(entity_id, {"state": "off"}, available=False)
                return
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.debug("Android TV %s nicht erreichbar (%s), neuer Versuch in 30s", host, err)
                await asyncio.sleep(30)

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
        await self.hub.registry.update_state(
            entity_id,
            tv_state(bool(remote.is_on), remote.current_app, remote.volume_info),
            available=available,
        )

    # ── Hub → Gerät ────────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        remote = self._remotes.get(entity.id)
        if remote is None:
            raise ConnectionError("Android TV ist nicht verbunden")
        if command == "toggle":
            command = "turn_off" if entity.state.get("state") == "on" else "turn_on"
        if command in ("turn_on", "turn_off"):
            # Es gibt nur eine Power-Taste; nichts tun, wenn der Zustand schon stimmt.
            if (command == "turn_on") != bool(remote.is_on):
                remote.send_key_command("KEYCODE_POWER")
            return
        if command == "launch_app":
            app = data.get("app")
            if not app:
                raise ValueError("launch_app braucht data.app (Paket-ID oder Link)")
            remote.send_launch_app_command(str(app))
            return
        remote.send_key_command(KEYMAP[command])


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
    cert_dir = block.get("cert_dir") or str(Path(config.data_file).parent)
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


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Android-TV-Kopplung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    parser.add_argument("--host", help="nur diesen Fernseher koppeln")
    args = parser.parse_args()
    sys.exit(asyncio.run(_pair_main(args.config, args.host)))
