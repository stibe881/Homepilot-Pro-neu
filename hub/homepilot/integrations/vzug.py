"""V-ZUG-Geräte über die lokale Home-API.

Konfiguration:
  - integration: vzug
    scan_interval: 60
    devices:
      - host: 192.168.1.40
        name: Geschirrspüler
        username: "${VZUG_USER}"      # optional, nur bei aktivierter Anmeldung
        password: "${VZUG_PASSWORD}"

Die Geräte liefern unter /ai?command=getDeviceStatus ihren Zustand. Die API
ist lesend – Programme lassen sich damit nicht starten, was für Geschirr-
spüler und Backofen auch gut so ist.
"""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from ..core.entity import EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


def parse_device_status(payload: dict[str, Any]) -> dict[str, Any]:
    """Übersetzt die Antwort von getDeviceStatus in Entitäts-Attribute.

    'Inactive' kommt als String "true"/"false" – daraus wird der Hauptwert
    idle/running.
    """
    inactive = str(payload.get("Inactive", "true")).strip().lower() == "true"
    program_end = payload.get("ProgramEnd") or {}
    return {
        "state": "idle" if inactive else "running",
        "program": payload.get("Program") or None,
        "status": payload.get("Status") or None,
        "program_end": (program_end.get("End") or None)
        if isinstance(program_end, dict)
        else None,
        "serial": payload.get("Serial") or None,
    }


class VZugIntegration(Integration):
    name = "vzug"

    async def setup(self) -> None:
        devices = self.config.get("devices") or []
        if not devices:
            raise ConfigError("vzug braucht mindestens ein Gerät unter 'devices'")
        self._interval = float(self.config.get("scan_interval", 60))
        self._session = self.http_session()

        # entity_id → (host, auth)
        self._devices: dict[str, tuple[str, aiohttp.BasicAuth | None]] = {}
        for device in devices:
            host = device.get("host")
            if not host:
                raise ConfigError("vzug: jedes Gerät braucht einen 'host'")
            username, password = device.get("username"), device.get("password")
            auth = (
                aiohttp.BasicAuth(username, password) if username and password else None
            )
            entity = await self.add_entity(
                str(host).replace(".", "_"),
                EntityKind.APPLIANCE,
                device.get("name", f"V-ZUG {host}"),
                state={"state": "unknown"},
                available=False,
            )
            self._devices[entity.id] = (host, auth)

        await self._refresh_all()
        self.start_task(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh_all()

    async def _refresh_all(self) -> None:
        for entity_id, (host, auth) in self._devices.items():
            await self._refresh(entity_id, host, auth)

    async def _refresh(
        self, entity_id: str, host: str, auth: aiohttp.BasicAuth | None
    ) -> None:
        try:
            async with self._session.get(
                f"http://{host}/ai",
                params={"command": "getDeviceStatus"},
                auth=auth,
            ) as response:
                response.raise_for_status()
                # Die Geräte senden JSON teils als text/plain.
                payload = await response.json(content_type=None)
        except Exception as err:
            self.log.warning("V-ZUG %s nicht erreichbar: %s", host, err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return

        await self.hub.registry.update_state(
            entity_id, parse_device_status(payload), available=True
        )


INTEGRATION = VZugIntegration
