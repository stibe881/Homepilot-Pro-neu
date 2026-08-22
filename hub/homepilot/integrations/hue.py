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
from ..core.errors import ConfigError, HomePilotError
from ..core.integration import Integration


def parse_scenes(payload: dict[str, Any] | None) -> dict[str, str]:
    """Szenen der Bridge als Name → Kennung (rein, testbar).

    Der Raumname gehört dazu: «Entspannen» gibt es in jedem Zimmer, und
    ohne Unterscheidung wäre die Auswahl ein Ratespiel.
    """
    scenes: dict[str, str] = {}
    for entry in (payload or {}).get("data") or []:
        scene_id = entry.get("id")
        name = (entry.get("metadata") or {}).get("name")
        if not scene_id or not name:
            continue
        group = (entry.get("group") or {}).get("rid")
        label = str(name)
        if label in scenes and group:
            label = f"{label} ({group[:8]})"
        scenes[label] = str(scene_id)
    return scenes


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
        # Name → Szenen-Kennung, für die Aktion «Hue-Szene» in Abläufen.
        self._scenes: dict[str, str] = {}
        await self._refresh()
        await self._load_scenes()
        self.start_task(self._event_loop())
        self.start_polling(self._refresh)

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

    async def _load_scenes(self) -> None:
        """Die auf der Bridge gespeicherten Szenen holen.

        Sie gehören der Bridge, nicht dem Hub: Farben und Helligkeiten
        stecken dort, und nur die Bridge kann sie in einem Zug setzen. Der
        Hub kann sie deshalb aufrufen, aber nicht nachbauen.
        """
        try:
            async with self._session.get(
                f"{self._base}/clip/v2/resource/scene",
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                response.raise_for_status()
                payload = await response.json()
        except Exception as err:
            self.log.warning("Hue-Szenen nicht abrufbar: %s", err)
            return
        self._scenes = parse_scenes(payload)
        self.log.info("Hue: %d Szenen gefunden", len(self._scenes))

    def scenes(self) -> list[str]:
        """Namen der Bridge-Szenen – für die Auswahl in der App."""
        return sorted(self._scenes)

    async def activate_scene(self, name: str) -> None:
        """Eine Bridge-Szene aufrufen."""
        scene_id = self._scenes.get(name)
        if scene_id is None:
            raise HomePilotError(
                f"Unbekannte Hue-Szene '{name}'. Bekannt: "
                + (", ".join(self.scenes()) or "keine")
            )
        async with self._session.put(
            f"{self._base}/clip/v2/resource/scene/{scene_id}",
            json={"recall": {"action": "active"}},
            timeout=aiohttp.ClientTimeout(total=15),
        ) as response:
            response.raise_for_status()

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
        if "color_temperature" in light:
            mirek = light["color_temperature"].get("mirek")
            if isinstance(mirek, (int, float)):
                changes["color_temp"] = round(mirek)

        if self.hub.registry.get(entity_id) is None:
            name = (light.get("metadata") or {}).get("name") or "Hue Licht"
            commands = ["turn_on", "turn_off", "toggle"]
            if "dimming" in light:
                commands.append("set_brightness")
            if "color_temperature" in light:
                commands.append("set_color_temp")
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
        elif command == "set_color_temp":
            # Farbtemperatur als Mirek (153 = kalt/6500K … 500 = warm/2000K).
            # Alternativ 'kelvin' entgegennehmen und umrechnen.
            if "kelvin" in data and float(data["kelvin"]) > 0:
                mirek = 1_000_000 / float(data["kelvin"])
            else:
                mirek = float(data.get("color_temp", data.get("mirek", 366)))
            body["color_temperature"] = {"mirek": max(153, min(500, round(mirek)))}

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
        if "color_temperature" in body:
            changes["color_temp"] = body["color_temperature"]["mirek"]
        if changes:
            await self.hub.registry.update_state(entity.id, changes)


INTEGRATION = HueIntegration
