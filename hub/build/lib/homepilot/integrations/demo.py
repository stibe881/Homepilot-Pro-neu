"""Virtuelle Geräte zum Entwickeln der App und Testen von Automationen.

Konfiguration:
  - integration: demo
"""

from __future__ import annotations

import asyncio
import random
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.integration import Integration


class DemoIntegration(Integration):
    name = "demo"

    async def setup(self) -> None:
        await self.add_entity(
            "light_livingroom",
            EntityKind.LIGHT,
            "Licht Wohnzimmer",
            state={"state": "off", "brightness": 100},
            commands=["turn_on", "turn_off", "toggle", "set_brightness"],
        )
        await self.add_entity(
            "light_bedroom",
            EntityKind.LIGHT,
            "Licht Schlafzimmer",
            state={"state": "off", "brightness": 60},
            commands=["turn_on", "turn_off", "toggle", "set_brightness"],
        )
        await self.add_entity(
            "switch_coffee",
            EntityKind.SWITCH,
            "Kaffeemaschine",
            state={"state": "off"},
            commands=["turn_on", "turn_off", "toggle"],
        )
        await self.add_entity(
            "motion_hall",
            EntityKind.BINARY_SENSOR,
            "Bewegung Flur",
            state={"state": "off"},
            # Manuell schaltbar, um Automationen aus der App zu testen.
            commands=["turn_on", "turn_off", "toggle"],
        )
        await self.add_entity(
            "temp_livingroom",
            EntityKind.SENSOR,
            "Temperatur Wohnzimmer",
            state={"state": 21.5, "unit": "°C"},
        )
        self.start_task(self._temperature_drift())

    async def _temperature_drift(self) -> None:
        rng = random.Random()
        entity_id = self.entity_id("temp_livingroom")
        while True:
            await asyncio.sleep(15)
            entity = self.hub.registry.get(entity_id)
            if entity is None:
                return
            current = float(entity.state.get("state", 21.0))
            drift = rng.uniform(-0.3, 0.3)
            value = round(min(28.0, max(17.0, current + drift)), 1)
            await self.hub.registry.update_state(entity_id, {"state": value})

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        changes: dict[str, Any] = {}
        if command == "turn_on":
            changes["state"] = "on"
        elif command == "turn_off":
            changes["state"] = "off"
        elif command == "toggle":
            changes["state"] = "off" if entity.state.get("state") == "on" else "on"
        elif command == "set_brightness":
            changes["brightness"] = max(0, min(100, int(data.get("brightness", 100))))
            changes["state"] = "on" if changes["brightness"] > 0 else "off"
        if "brightness" in data and command == "turn_on":
            changes["brightness"] = max(0, min(100, int(data["brightness"])))
        if changes:
            await self.hub.registry.update_state(entity.id, changes)


INTEGRATION = DemoIntegration
