"""Philips Hue Play HDMI Sync Box über ihre lokale API.

Konfiguration:
  - integration: hue_sync
    host: 192.168.1.25
    access_token: "${HUE_SYNC_TOKEN}"
    scan_interval: 30

Token erzeugen: den Knopf an der Box ~3 Sekunden halten, bis die LED grün
blinkt, und innert kurzer Zeit:

  curl -sk -X POST https://<box-ip>/api/v1/registrations \\
       -d '{"appName":"homepilot","instanceName":"hub"}'

Die Antwort enthält den accessToken. Einschalten heisst hier: Sync an
(die Box überträgt das Bild als Licht), ausschalten: zurück auf
Durchleitung – der Fernseher läuft weiter, nur das Lichtspiel stoppt.
"""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


def parse_state(payload: dict[str, Any]) -> dict[str, Any]:
    """Übersetzt die Antwort von GET /api/v1 in Entitäts-Attribute."""
    execution = payload.get("execution") or {}
    hdmi = payload.get("hdmi") or {}
    source = execution.get("hdmiSource") or ""
    source_name = (hdmi.get(source) or {}).get("name") if source else None
    return {
        "state": "on" if execution.get("syncActive") else "off",
        "mode": execution.get("mode"),
        "input": source_name or source or None,
        "brightness_raw": execution.get("brightness"),
    }


class HueSyncIntegration(Integration):
    name = "hue_sync"

    async def setup(self) -> None:
        host = self.config.get("host")
        token = self.config.get("access_token")
        if not host or not token:
            raise ConfigError("hue_sync braucht 'host' und 'access_token'")

        self._base = f"https://{host}/api/v1"
        self._interval = float(self.config.get("scan_interval", 30))
        # Selbstsigniertes Zertifikat, wie bei der Hue Bridge.
        self._session = self.http_session(
            connector=aiohttp.TCPConnector(ssl=False),
            headers={"Authorization": f"Bearer {token}"},
            timeout=aiohttp.ClientTimeout(total=15),
        )

        self._object_id = str(host).replace(".", "_")
        await self.add_entity(
            self._object_id,
            EntityKind.SWITCH,
            self.config.get("name", "Hue Sync Box"),
            state={"state": "off"},
            commands=["turn_on", "turn_off", "toggle"],
            available=False,
        )
        await self._refresh()
        self.start_task(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh()

    async def _refresh(self) -> None:
        entity_id = self.entity_id(self._object_id)
        try:
            async with self._session.get(self._base) as response:
                response.raise_for_status()
                payload = await response.json(content_type=None)
        except Exception as err:
            self.log.warning("Sync Box nicht erreichbar: %s", err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return
        await self.hub.registry.update_state(
            entity_id, parse_state(payload), available=True
        )

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        if command == "toggle":
            command = "turn_off" if entity.state.get("state") == "on" else "turn_on"
        body = {"syncActive": command == "turn_on"}
        async with self._session.put(f"{self._base}/execution", json=body) as response:
            response.raise_for_status()
        await self._refresh()


INTEGRATION = HueSyncIntegration
