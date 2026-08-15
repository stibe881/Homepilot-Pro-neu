"""Zentraler Zustandsspeicher für alle Entitäten."""

from __future__ import annotations

from typing import Any, Callable

from .entity import Entity
from .errors import UnknownEntityError
from .events import EventBus
from .source import current as current_source

StateProvider = Callable[[str], "dict[str, Any] | None"]
RoomProvider = Callable[[str], "str | None"]


class EntityRegistry:
    def __init__(self, bus: EventBus) -> None:
        self._entities: dict[str, Entity] = {}
        self.bus = bus
        self.state_provider: StateProvider | None = None
        self.room_provider: RoomProvider | None = None

    def get(self, entity_id: str) -> Entity | None:
        return self._entities.get(entity_id)

    def all(self) -> list[Entity]:
        return list(self._entities.values())

    async def add(self, entity: Entity) -> None:
        if self.room_provider is not None:
            entity.room = self.room_provider(entity.id) or entity.room
        if self.state_provider is not None:
            restored = self.state_provider(entity.id)
            if restored:
                # Was die Integration liefert, gewinnt; Gespeichertes füllt
                # nur die Lücken (siehe supabase/README.md).
                entity.state = {**restored, **entity.state}
        self._entities[entity.id] = entity
        await self.bus.publish("entity_added", {"entity": entity.as_dict()})

    async def set_room(self, entity_id: str, room: str | None) -> None:
        """Ändert die Raumzuordnung einer Entität und meldet es der App."""
        entity = self._entities.get(entity_id)
        if entity is None:
            raise UnknownEntityError(entity_id)
        if entity.room == room:
            return
        entity.room = room
        await self.bus.publish(
            "state_changed",
            {
                "entity_id": entity_id,
                "old_state": dict(entity.state),
                "new_state": dict(entity.state),
                "entity": entity.as_dict(),
                "source": current_source(),
            },
        )

    async def remove(self, entity_id: str) -> None:
        entity = self._entities.pop(entity_id, None)
        if entity is not None:
            await self.bus.publish("entity_removed", {"entity_id": entity_id})

    async def update_state(
        self,
        entity_id: str,
        changes: dict[str, Any],
        available: bool | None = None,
    ) -> None:
        """Merged Änderungen in den Zustand und publiziert state_changed.

        Publiziert nur, wenn sich tatsächlich etwas geändert hat.
        """
        entity = self._entities.get(entity_id)
        if entity is None:
            raise UnknownEntityError(entity_id)

        old_state = dict(entity.state)
        new_state = {**old_state, **changes}
        availability_changed = available is not None and available != entity.available
        if new_state == old_state and not availability_changed:
            return

        entity.state = new_state
        if available is not None:
            entity.available = available

        await self.bus.publish(
            "state_changed",
            {
                "entity_id": entity_id,
                "old_state": old_state,
                "new_state": dict(new_state),
                "entity": entity.as_dict(),
                # Wer die Änderung ausgelöst hat – Grundlage für die Frage
                # „warum ist das passiert?“ in der App.
                "source": current_source(),
            },
        )
