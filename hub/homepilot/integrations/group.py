"""Gerätegruppen: mehrere Entitäten als eine Kachel schalten.

Konfiguration:
  - integration: group
    groups:
      - id: lichter_eg
        name: Lichter EG
        members: [hue.stehlampe, hue.decke_kueche, homematic.Licht_Flur]
        kind: light          # optional: light (Standard) oder switch

Ein Gruppenschalter ist „an", sobald ein Mitglied an ist. turn_on/turn_off/
toggle werden an alle Mitglieder weitergereicht; bei Lichtgruppen auch
set_brightness. Die Gruppe folgt den Mitgliedern live: ändert sich eines,
aktualisiert sich der Gruppenzustand.
"""

from __future__ import annotations

from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.integration import Integration


class GroupIntegration(Integration):
    name = "group"

    async def setup(self) -> None:
        # Mitglieder je Gruppen-Entität und Umkehrung Mitglied → Gruppen.
        self._members: dict[str, list[str]] = {}
        self._groups_of: dict[str, list[str]] = {}
        self._is_light: dict[str, bool] = {}

        for item in self.config.get("groups") or []:
            object_id = str(item["id"])
            members = [str(m) for m in (item.get("members") or [])]
            is_light = str(item.get("kind", "light")) == "light"
            commands = ["turn_on", "turn_off", "toggle"]
            if is_light:
                commands.append("set_brightness")
            entity = await self.add_entity(
                object_id,
                EntityKind.LIGHT if is_light else EntityKind.SWITCH,
                str(item.get("name") or object_id),
                state={"state": "off", "members": len(members)},
                commands=commands,
            )
            self._members[entity.id] = members
            self._is_light[entity.id] = is_light
            for member in members:
                self._groups_of.setdefault(member, []).append(entity.id)

        # Auf Mitglieder-Änderungen und spätere Registrierung reagieren.
        self.hub.bus.subscribe("state_changed", self._on_change)
        self.hub.bus.subscribe("entity_added", self._on_added)
        for group_id in self._members:
            await self._recompute(group_id)

    def _on_change(self, _event: str, data: dict[str, Any]) -> None:
        for group_id in self._groups_of.get(data.get("entity_id", ""), []):
            self.start_task(self._recompute(group_id))

    def _on_added(self, _event: str, data: dict[str, Any]) -> None:
        entity = data.get("entity") or {}
        for group_id in self._groups_of.get(entity.get("id", ""), []):
            self.start_task(self._recompute(group_id))

    async def _recompute(self, group_id: str) -> None:
        on = False
        brightness_values = []
        for member_id in self._members.get(group_id, []):
            member = self.hub.registry.get(member_id)
            if member is None:
                continue
            if str(member.state.get("state")).lower() in ("on", "true", "playing", "open"):
                on = True
            level = member.state.get("brightness")
            if isinstance(level, (int, float)):
                brightness_values.append(level)
        changes: dict[str, Any] = {"state": "on" if on else "off"}
        if self._is_light.get(group_id) and brightness_values:
            changes["brightness"] = round(sum(brightness_values) / len(brightness_values))
        await self.hub.registry.update_state(group_id, changes)

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        # toggle einheitlich auflösen: ist die Gruppe an, alle aus, sonst an.
        if command == "toggle":
            command = "turn_off" if entity.state.get("state") == "on" else "turn_on"
        for member_id in self._members.get(entity.id, []):
            member = self.hub.registry.get(member_id)
            if member is None or command not in member.commands:
                continue
            try:
                await self.hub.integrations.dispatch_command(member_id, command, data)
            except Exception as err:
                self.log.warning("Gruppe %s: Mitglied %s (%s) – %s", entity.id, member_id, command, err)


INTEGRATION = GroupIntegration
