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
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


def cast_media_state(
    player_state: str | None,
    title: str | None,
    artist: str | None,
    app: str | None,
    volume: float | None,
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
    return result


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
            entity = await self.add_entity(
                str(host).replace(".", "_"),
                EntityKind.MEDIA_PLAYER,
                device.get("name", f"Cast {host}"),
                state={"state": "idle"},
                commands=["play", "pause", "toggle"],
                available=False,
            )
            self.start_task(self._connect_loop(entity.id, str(host)))

    async def teardown(self) -> None:
        await super().teardown()
        for cast in self._casts.values():
            try:
                await asyncio.to_thread(cast.disconnect)
            except Exception:
                pass
        self._casts.clear()

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    async def _connect_loop(self, entity_id: str, host: str) -> None:
        import pychromecast

        while True:
            try:
                cast = await asyncio.to_thread(
                    pychromecast.get_chromecast_from_host,
                    (host, 8009, None, None, None),
                    timeout=10,
                )
                await asyncio.to_thread(cast.wait, 15)
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
                self.log.debug("Cast %s nicht erreichbar (%s), neuer Versuch in 30s", host, err)
                await asyncio.sleep(30)

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
            ),
            available=True,
        )

    # ── Hub → Gerät ────────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        cast = self._casts.get(entity.id)
        if cast is None:
            raise ConnectionError("Cast-Gerät ist nicht verbunden")
        if command == "toggle":
            command = "pause" if entity.state.get("state") == "playing" else "play"
        controller = cast.media_controller
        await asyncio.to_thread(controller.play if command == "play" else controller.pause)


INTEGRATION = GoogleCastIntegration
