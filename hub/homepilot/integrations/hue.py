"""Philips Hue Bridge über die lokale CLIP-v2-API.

Konfiguration:
  - integration: hue
    host: 192.168.1.20
    app_key: "..."   # siehe config.example.yaml zum Erzeugen

Liest alle Lichter, lauscht auf den SSE-Eventstream der Bridge für
Live-Updates und pollt zusätzlich als Fallback.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


class HueIntegration(Integration):
    name = "hue"

    async def setup(self) -> None:
        host = self.config.get("host")
        app_key = self.config.get("app_key")
        if not host or not app_key:
            raise ConfigError("hue braucht 'host' und 'app_key' in der Konfiguration")

        self._base = f"https://{host}"
        # Die Bridge nutzt ein selbstsigniertes Zertifikat – Verifikation
        # ist für das lokale Gerät deshalb deaktiviert.
        self._session = self.http_session(
            connector=aiohttp.TCPConnector(ssl=False),
            headers={"hue-application-key": app_key},
            timeout=aiohttp.ClientTimeout(total=None),
        )
        await self._refresh()
        self.start_task(self._event_loop())
        self.start_task(self._poll_loop())

    # ── Bridge → Hub ───────────────────────────────────────────────────────

    async def _refresh(self) -> None:
        try:
            async with self._session.get(
                f"{self._base}/clip/v2/resource/light",
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                response.raise_for_status()
                payload = await response.json()
        except Exception as err:
            self.log.warning("Hue Bridge nicht erreichbar: %s", err)
            for entity in self.hub.registry.all():
                if entity.integration == self.name:
                    await self.hub.registry.update_state(entity.id, {}, available=False)
            return

        for light in payload.get("data", []):
            await self._apply_light(light)

    async def _apply_light(self, light: dict[str, Any]) -> None:
        resource_id = light.get("id")
        if not resource_id:
            return
        entity_id = self.entity_id(resource_id)
        changes: dict[str, Any] = {}
        if "on" in light:
            changes["state"] = "on" if light["on"].get("on") else "off"
        if "dimming" in light:
            changes["brightness"] = round(float(light["dimming"].get("brightness", 100)))

        if self.hub.registry.get(entity_id) is None:
            name = (light.get("metadata") or {}).get("name") or "Hue Licht"
            commands = ["turn_on", "turn_off", "toggle"]
            if "dimming" in light:
                commands.append("set_brightness")
            await self.add_entity(
                resource_id,
                EntityKind.LIGHT,
                name,
                state=changes or {"state": "off"},
                commands=commands,
            )
        elif changes:
            await self.hub.registry.update_state(entity_id, changes, available=True)

    async def _event_loop(self) -> None:
        """SSE-Eventstream der Bridge – liefert Änderungen praktisch sofort."""
        while True:
            try:
                async with self._session.get(
                    f"{self._base}/eventstream/clip/v2",
                    headers={"Accept": "text/event-stream"},
                    timeout=aiohttp.ClientTimeout(total=None, sock_read=None),
                ) as response:
                    response.raise_for_status()
                    async for raw_line in response.content:
                        line = raw_line.decode("utf-8", "ignore").strip()
                        if not line.startswith("data:"):
                            continue
                        await self._handle_events(json.loads(line[5:].strip()))
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.debug("Hue-Eventstream unterbrochen (%s), reconnect in 10s", err)
                await asyncio.sleep(10)

    async def _handle_events(self, events: list[dict[str, Any]]) -> None:
        for event in events:
            if event.get("type") != "update":
                continue
            for item in event.get("data", []):
                if item.get("type") == "light":
                    await self._apply_light(item)

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(float(self.config.get("scan_interval", 300)))
            await self._refresh()

    # ── Hub → Bridge ───────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        body: dict[str, Any] = {}
        if command == "turn_on":
            body["on"] = {"on": True}
            if "brightness" in data:
                body["dimming"] = {"brightness": float(data["brightness"])}
        elif command == "turn_off":
            body["on"] = {"on": False}
        elif command == "toggle":
            body["on"] = {"on": entity.state.get("state") != "on"}
        elif command == "set_brightness":
            brightness = float(data.get("brightness", 100))
            body["dimming"] = {"brightness": brightness}
            body["on"] = {"on": brightness > 0}

        resource_id = entity.id.split(".", 1)[1]
        async with self._session.put(
            f"{self._base}/clip/v2/resource/light/{resource_id}",
            json=body,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as response:
            response.raise_for_status()
        # Der Eventstream liefert danach den neuen Zustand; für schnelles
        # UI-Feedback optimistisch direkt nachziehen.
        changes: dict[str, Any] = {}
        if "on" in body:
            changes["state"] = "on" if body["on"]["on"] else "off"
        if "dimming" in body:
            changes["brightness"] = round(body["dimming"]["brightness"])
        if changes:
            await self.hub.registry.update_state(entity.id, changes)


INTEGRATION = HueIntegration
