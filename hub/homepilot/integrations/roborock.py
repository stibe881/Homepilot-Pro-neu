"""Roborock-Staubsauger über die python-roborock-Bibliothek.

Konfiguration:
  - integration: roborock
    username: "${ROBOROCK_EMAIL}"
    password: "${ROBOROCK_PASSWORD}"
    scan_interval: 60

Voraussetzung (bewusst nicht in den Grundabhängigkeiten, die Bibliothek
ist gross):  pip install "homepilot[roborock]"  bzw.  pip install python-roborock

Die Anmeldung läuft über das Roborock-Konto; die Bibliothek verbindet sich
danach bevorzugt lokal mit dem Sauger. Kommandos: start, pause, stop, dock
und clean_rooms (gezielt einzelne oder mehrere Räume saugen).

Die Räume des Saugers stehen als state.rooms auf der Entität; die Karte
liefert der Schnappschuss-Endpunkt (GET /api/entities/{id}/snapshot) als
fertig gerendertes PNG – dieselbe Leitung, über die auch Kamerabilder
laufen.
"""

from __future__ import annotations

import asyncio
import inspect
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


def vacuum_state(status: Any) -> dict[str, Any]:
    """Übersetzt den Status der Bibliothek in Entitäts-Attribute.

    Nimmt jedes Objekt mit den passenden Attributen – so bleibt die
    Übersetzung ohne Konto und Gerät testbar.
    """
    state_name = getattr(status, "state_name", None)
    result: dict[str, Any] = {
        "state": state_name or "unknown",
        "battery": getattr(status, "battery", None),
    }
    error = getattr(status, "error_code_name", None)
    if error and error not in ("none", "None"):
        result["error"] = error
    clean_area = getattr(status, "clean_area", None)
    if clean_area:
        # Die Bibliothek liefert mm² – die App soll m² zeigen.
        result["clean_area_m2"] = round(float(clean_area) / 1_000_000, 1)
    clean_time = getattr(status, "clean_time", None)
    if clean_time:
        result["clean_minutes"] = round(float(clean_time) / 60)
    return result


def parse_rooms(mappings: Any) -> list[dict[str, Any]]:
    """Übersetzt die Raumliste der Bibliothek in App-taugliche Einträge.

    Erwartet Objekte mit segment_id und name (NamedRoomMapping) – als reine
    Funktion auch ohne Konto und Gerät testbar.
    """
    rooms = []
    for mapping in mappings or []:
        segment_id = getattr(mapping, "segment_id", None)
        if segment_id is None:
            continue
        rooms.append({"id": int(segment_id), "name": str(getattr(mapping, "name", segment_id))})
    return sorted(rooms, key=lambda room: room["name"])


def segment_clean_params(room_ids: list[Any]) -> list[dict[str, Any]]:
    """Parameter für APP_SEGMENT_CLEAN (rein, testbar).

    Wirft bei leerer oder unbrauchbarer Auswahl, damit der Fehler beim
    Benutzer ankommt statt still nichts zu passieren.
    """
    segments = [int(room_id) for room_id in room_ids or []]
    if not segments:
        raise ValueError("clean_rooms braucht data.rooms mit mindestens einer Raum-ID")
    return [{"segments": segments, "repeat": 1}]


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


class RoborockIntegration(Integration):
    name = "roborock"

    async def setup(self) -> None:
        username = self.config.get("username")
        password = self.config.get("password")
        if not username or not password:
            raise ConfigError("roborock braucht 'username' und 'password'")

        # Erst hier importieren: Die Bibliothek ist gross und soll den Hub
        # ohne Roborock-Konfiguration nicht belasten.
        try:
            from roborock import RoborockCommand
            from roborock.devices.device_manager import (
                UserParams,
                create_device_manager,
            )
            from roborock.web_api import RoborockApiClient
        except ImportError as err:
            raise ConfigError(
                "python-roborock fehlt – installieren mit: pip install python-roborock"
            ) from err

        self._commands = {
            "start": RoborockCommand.APP_START,
            "pause": RoborockCommand.APP_PAUSE,
            "stop": RoborockCommand.APP_STOP,
            "dock": RoborockCommand.APP_CHARGE,
        }
        self._segment_clean = RoborockCommand.APP_SEGMENT_CLEAN
        self._interval = float(self.config.get("scan_interval", 60))

        api = RoborockApiClient(username)
        user_data = await api.pass_login(password)
        self._manager = await create_device_manager(
            UserParams(username=username, user_data=user_data)
        )

        # entity_id → Gerät der Bibliothek
        self._devices: dict[str, Any] = {}
        devices = await _maybe_await(self._manager.get_devices())
        for device in devices:
            # Nur Sauger mit v1-Protokoll – Waschtürme u.ä. haben andere APIs.
            if getattr(device, "v1_properties", None) is None:
                continue
            if not getattr(device, "is_connected", False):
                await _maybe_await(device.connect())
            entity = await self.add_entity(
                str(device.duid),
                EntityKind.VACUUM,
                device.name or "Roborock",
                state={"state": "unknown"},
                commands=[*self._commands, "clean_rooms"],
                available=False,
            )
            self._devices[entity.id] = device
            await self._load_rooms(entity.id, device)

        if not self._devices:
            raise ConfigError("Im Roborock-Konto wurde kein passender Sauger gefunden")

        await self._refresh_all()
        self.start_task(self._poll_loop())

    async def teardown(self) -> None:
        await super().teardown()
        if hasattr(self, "_manager"):
            await _maybe_await(self._manager.close())

    async def _load_rooms(self, entity_id: str, device: Any) -> None:
        """Raumliste des Saugers holen und auf die Entität schreiben.

        Kein harter Fehler, wenn das Modell keine Räume kennt – dann fehlt
        in der App einfach die Raumauswahl.
        """
        try:
            rooms_trait = getattr(device.v1_properties, "rooms", None)
            if rooms_trait is None:
                return
            await _maybe_await(rooms_trait.refresh())
            rooms = parse_rooms(rooms_trait.rooms)
            if rooms:
                await self.hub.registry.update_state(entity_id, {"rooms": rooms})
        except Exception as err:
            self.log.warning("Raumliste von %s nicht abrufbar: %s", device.name, err)

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh_all()

    async def _refresh_all(self) -> None:
        for entity_id, device in self._devices.items():
            try:
                status = device.v1_properties.status
                await _maybe_await(status.refresh())
                await self.hub.registry.update_state(
                    entity_id, vacuum_state(status), available=True
                )
            except Exception as err:
                self.log.warning("Roborock %s nicht erreichbar: %s", device.name, err)
                await self.hub.registry.update_state(entity_id, {}, available=False)

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        device = self._devices[entity.id]
        properties = device.v1_properties
        sender = getattr(properties, "command", None) or getattr(
            properties.status, "command", None
        )
        if sender is None:
            raise ConfigError("Dieses Gerät nimmt keine Kommandos entgegen")
        if command == "clean_rooms":
            await _maybe_await(
                sender.send(self._segment_clean, params=segment_clean_params(data.get("rooms")))
            )
        else:
            await _maybe_await(sender.send(self._commands[command]))
        await self._refresh_all()

    async def snapshot(self, entity: Entity) -> bytes | None:
        """Die Karte des Saugers als fertig gerendertes PNG."""
        device = self._devices.get(entity.id)
        if device is None:
            return None
        try:
            map_trait = getattr(device.v1_properties, "map_content", None)
            if map_trait is None:
                return None
            await _maybe_await(map_trait.refresh())
            return map_trait.image_content
        except Exception as err:
            self.log.debug("Karte von %s nicht abrufbar: %s", device.name, err)
            return None


INTEGRATION = RoborockIntegration
