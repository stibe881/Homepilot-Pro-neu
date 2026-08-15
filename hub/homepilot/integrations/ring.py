"""Ring – Türklingeln und Kameras über die (inoffizielle) Cloud-API.

Konfiguration:
  - integration: ring
    # token_file: /etc/homepilot/ring-token.json   # optional
    # scan_interval: 300

Voraussetzung:  pip install "homepilot[ring]"  bzw.  pip install ring-doorbell

Einrichtung (einmalig, Ring schickt einen 2FA-Code per Mail/SMS):
  1. Den Block oben in die config.yaml eintragen.
  2. Auf dem Hub-Rechner ausführen:
         python -m homepilot.integrations.ring -c config.yaml
     E-Mail, Passwort und den zugeschickten Code eingeben.
  3. Hub (neu) starten.

Das Passwort wird nirgends gespeichert – nur das dabei ausgestellte Token
(ring-token.json neben der homepilot-data.json, nur für den eigenen
Benutzer lesbar). Der Hub frischt es selbst auf und schreibt es zurück.

Klingeln und Bewegung kommen als Push über den Ereigniskanal der Ring-App
(Firebase); Gerätestatus und Akku werden zusätzlich alle scan_interval
Sekunden abgefragt. Die Kacheln benutzen dieselben Felder wie UniFi
Protect (state/motion/last_motion/last_ring) – die App kennt sie schon.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

USER_AGENT = "HomePilot/1.0"


def device_state(battery: Any, connection: str | None) -> dict[str, Any]:
    """Übersetzt Gerätedaten in Entitäts-Attribute (rein, testbar)."""
    state: dict[str, Any] = {
        "state": "offline" if connection == "offline" else "online",
        "motion": "off",
    }
    if battery is not None:
        try:
            state["battery"] = int(battery)
        except (TypeError, ValueError):
            pass
    return state


def event_fields(kind: str, now: float) -> dict[str, Any]:
    """Übersetzt ein Push-Ereignis in Zustandsfelder (rein, testbar).

    Ring meldet 'ding' (geklingelt) und 'motion' (Bewegung erkannt).
    """
    stamp = datetime.fromtimestamp(now, tz=timezone.utc).isoformat()
    if kind == "ding":
        return {"last_ring": stamp, "ring": "on"}
    if kind == "motion":
        return {"last_motion": stamp, "motion": "on"}
    return {}


class RingIntegration(Integration):
    name = "ring"

    async def setup(self) -> None:
        try:
            import ring_doorbell  # noqa: F401 – nur Verfügbarkeit prüfen
        except ImportError as err:
            raise ConfigError(
                "ring-doorbell fehlt – installieren mit: pip install ring-doorbell"
            ) from err

        self._token_file = Path(
            self.config.get("token_file")
            or Path(self.hub.config.data_file).parent / "ring-token.json"
        )
        if not self._token_file.is_file():
            raise ConfigError(
                f"{self._token_file} fehlt – einmalig anmelden mit: "
                "python -m homepilot.integrations.ring -c config.yaml"
            )
        self._stored = json.loads(self._token_file.read_text())

        from ring_doorbell import Auth, Ring

        self._auth = Auth(
            USER_AGENT,
            token=self._stored.get("token"),
            token_updater=lambda token: self._save("token", token),
            http_client_session=self.http_session(),
        )
        self._ring = Ring(self._auth)
        await self._ring.async_create_session()
        await self._ring.async_update_devices()

        # Entity-ID → Ring-Geräteobjekt; Ring-Geräte-ID → Entity-ID
        self._devices: dict[str, Any] = {}
        self._by_ring_id: dict[int, str] = {}
        self._clear_tasks: dict[str, asyncio.Task] = {}

        devices = self._ring.devices()
        for device in list(devices.doorbells) + list(devices.stickup_cams):
            entity = await self.add_entity(
                str(device.id),
                EntityKind.CAMERA,
                device.name,
                state=device_state(device.battery_life, device.connection_status),
                commands=[],
            )
            self._devices[entity.id] = device
            self._by_ring_id[int(device.id)] = entity.id
        if not self._devices:
            self.log.warning("Ring-Konto verbunden, aber keine Kameras/Klingeln gefunden")

        self.start_task(self._poll_loop())
        self.start_task(self._listen())

    async def teardown(self) -> None:
        listener = getattr(self, "_listener", None)
        if listener is not None:
            try:
                await listener.stop()
            except Exception:
                pass
        await super().teardown()

    def _save(self, key: str, value: dict[str, Any]) -> None:
        """Aufgefrischte Tokens sofort sichern, sonst sperrt Ring den Zugang aus."""
        self._stored[key] = value
        tmp = self._token_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._stored))
        os.chmod(tmp, 0o600)
        tmp.replace(self._token_file)

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        interval = int(self.config.get("scan_interval", 300))
        while True:
            await asyncio.sleep(interval)
            try:
                await self._ring.async_update_devices()
                devices = self._ring.devices()
                for entity_id, old in list(self._devices.items()):
                    device = devices.get_device(int(old.id))
                    self._devices[entity_id] = device
                    await self.hub.registry.update_state(
                        entity_id,
                        device_state(device.battery_life, device.connection_status),
                        available=True,
                    )
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.warning("Ring-Abfrage fehlgeschlagen: %s", err)

    async def _listen(self) -> None:
        """Push-Ereignisse (Klingeln, Bewegung) über den Kanal der Ring-App."""
        from ring_doorbell import RingEventListener

        loop = asyncio.get_running_loop()
        listener = RingEventListener(
            self._ring,
            credentials=self._stored.get("listener"),
            credentials_updated_callback=lambda creds: self._save("listener", creds),
        )
        self._listener = listener

        def on_event(event: Any) -> None:
            asyncio.run_coroutine_threadsafe(self._handle_event(event), loop)

        try:
            if not await listener.start():
                self.log.warning(
                    "Ring-Ereigniskanal liess sich nicht starten – "
                    "Klingeln/Bewegung kommen nur verzögert über die Abfrage"
                )
                return
            listener.add_notification_callback(on_event)
            self.log.info("Ring-Ereigniskanal verbunden")
        except Exception as err:
            self.log.warning("Ring-Ereigniskanal fehlgeschlagen: %s", err)

    async def _handle_event(self, event: Any) -> None:
        entity_id = self._by_ring_id.get(int(event.doorbot_id))
        if entity_id is None:
            return
        fields = event_fields(event.kind, event.now or time.time())
        if not fields:
            return
        await self.hub.registry.update_state(entity_id, fields, available=True)

        # 'Bewegung'/'Klingelt' nach Ablauf wieder löschen, damit die Kachel
        # nicht dauerhaft leuchtet.
        flag = "motion" if event.kind == "motion" else "ring"
        old = self._clear_tasks.pop(f"{entity_id}:{flag}", None)
        if old:
            old.cancel()
        delay = min(float(event.expires_in or 60), 300)
        self._clear_tasks[f"{entity_id}:{flag}"] = self.start_task(
            self._clear_flag(entity_id, flag, delay)
        )

    async def _clear_flag(self, entity_id: str, flag: str, delay: float) -> None:
        await asyncio.sleep(delay)
        await self.hub.registry.update_state(entity_id, {flag: "off"})

    async def snapshot(self, entity: Any) -> bytes | None:
        device = self._devices.get(entity.id)
        if device is None:
            return None
        try:
            # Stösst bei Ring einen frischen Schnappschuss an – das dauert
            # ein paar Sekunden, dafür ist das Bild aktuell.
            return await device.async_get_snapshot()
        except Exception as err:
            self.log.debug("Ring-Schnappschuss fehlgeschlagen: %s", err)
            return None


INTEGRATION = RingIntegration


# ── Anmelde-Helfer ─────────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.ring -c config.yaml
# Fragt E-Mail, Passwort und den 2FA-Code ab und legt das Token dorthin,
# wo der Hub es liest. Das Passwort wird nicht gespeichert.


async def _login_main(config_path: str) -> int:
    import getpass

    from ring_doorbell import Auth, Requires2FAError

    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "ring"]
    token_file = Path(
        (blocks[0].get("token_file") if blocks else None)
        or Path(config.data_file).parent / "ring-token.json"
    )

    username = input("Ring-E-Mail: ").strip()
    password = getpass.getpass("Ring-Passwort: ")

    auth = Auth(USER_AGENT)
    try:
        try:
            token = await auth.async_fetch_token(username, password)
        except Requires2FAError:
            code = input("2FA-Code (per Mail/SMS zugestellt): ").strip()
            token = await auth.async_fetch_token(username, password, code)
    except Exception as err:
        print(f"✗ Anmeldung fehlgeschlagen: {err}")
        return 1
    finally:
        await auth.async_close()

    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(json.dumps({"token": token}))
    os.chmod(token_file, 0o600)
    print(f"✓ Angemeldet. Token liegt in {token_file} – jetzt den Hub starten.")
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Ring-Anmeldung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    args = parser.parse_args()
    sys.exit(asyncio.run(_login_main(args.config)))
