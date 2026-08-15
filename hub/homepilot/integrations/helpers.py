"""Helfer-Schalter: virtuelle An/Aus-Zustände (wie Home Assistants input_boolean).

Damit lassen sich Modi bauen, die es an keinem Gerät gibt – etwa „Abwesend",
„Gästemodus" oder „Nachtruhe". Automationen lesen und setzen sie wie jeden
Schalter.

Konfiguration:
  - integration: helpers
    switches:
      - id: abwesend
        name: Abwesend
        icon: airplane-outline
        initial: false
      - id: gaeste
        name: Gästemodus

Der Zustand bleibt erhalten, solange der Hub läuft. Nach einem Neustart
starten die Schalter wieder auf ihrem ``initial``-Wert.
"""

from __future__ import annotations

from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.integration import Integration


class HelpersIntegration(Integration):
    name = "helpers"

    async def setup(self) -> None:
        switches = self.config.get("switches") or []
        for item in switches:
            object_id = str(item["id"])
            initial = "on" if item.get("initial") else "off"
            state: dict[str, Any] = {"state": initial}
            if item.get("icon"):
                state["icon"] = str(item["icon"])
            await self.add_entity(
                object_id,
                EntityKind.SWITCH,
                str(item.get("name") or object_id),
                state=state,
                commands=["turn_on", "turn_off", "toggle"],
            )

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        if command == "turn_on":
            new = "on"
        elif command == "turn_off":
            new = "off"
        else:  # toggle
            new = "off" if entity.state.get("state") == "on" else "on"
        await self.hub.registry.update_state(entity.id, {"state": new})


INTEGRATION = HelpersIntegration
