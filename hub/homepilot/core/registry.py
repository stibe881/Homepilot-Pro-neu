"""Zentraler Zustandsspeicher für alle Entitäten."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from .entity import Entity
from .errors import UnknownEntityError
from .eventlog import worth_recording
from .events import EventBus
from .source import current as current_source

StateProvider = Callable[[str], "dict[str, Any] | None"]
RoomProvider = Callable[[str], "str | None"]
MetaProvider = Callable[[str], "dict[str, Any] | None"]


class EntityRegistry:
    def __init__(self, bus: EventBus) -> None:
        self._entities: dict[str, Entity] = {}
        self.bus = bus
        self.state_provider: StateProvider | None = None
        self.room_provider: RoomProvider | None = None
        # Liefert {name?, favorite?, group?} pro Entität (in der App gesetzt).
        self.meta_provider: MetaProvider | None = None
        # Liefert die Kennung der zusammengefassten Leuchte, in der eine
        # Entität aufgeht – oder None. Gefüllt von der group-Integration.
        self.combined_provider: RoomProvider | None = None

    def _apply_meta(self, entity: Entity) -> None:
        if self.combined_provider is not None:
            entity.combined_into = self.combined_provider(entity.id)
        if self.meta_provider is None:
            return
        meta = self.meta_provider(entity.id) or {}
        entity.display_name = meta.get("name") or None
        entity.favorite = bool(meta.get("favorite"))
        entity.group = meta.get("group") or None

    def get(self, entity_id: str) -> Entity | None:
        return self._entities.get(entity_id)

    def all(self) -> list[Entity]:
        return list(self._entities.values())

    async def add(self, entity: Entity) -> None:
        if self.room_provider is not None:
            entity.room = self.room_provider(entity.id) or entity.room
        self._apply_meta(entity)
        if entity.available:
            entity.last_seen = time.time()
        if self.state_provider is not None:
            restored = self.state_provider(entity.id)
            if restored:
                # Was die Integration liefert, gewinnt; Gespeichertes füllt
                # nur die Lücken (siehe supabase/README.md).
                entity.state = {**restored, **entity.state}
        self._entities[entity.id] = entity
        await self.bus.publish("entity_added", {"entity": entity.as_dict()})

    async def set_combined(self, entity_id: str, group_id: str | None) -> None:
        """Diese Entität geht in einer zusammengefassten Leuchte auf – oder
        nicht mehr. Meldet die Änderung, damit die App sie sofort aus- bzw.
        wieder einblendet."""
        entity = self._entities.get(entity_id)
        if entity is None or entity.combined_into == group_id:
            return
        entity.combined_into = group_id
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

    async def set_meta(self, entity_id: str, meta: dict[str, Any]) -> None:
        """Setzt Anzeigename/Favorit/Gruppe einer Entität und meldet es."""
        entity = self._entities.get(entity_id)
        if entity is None:
            raise UnknownEntityError(entity_id)
        entity.display_name = meta.get("name") or None
        entity.favorite = bool(meta.get("favorite"))
        entity.group = meta.get("group") or None
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

        Achtung, Falle: Gemerged heisst *gemerged*. Ein Feld, das eine
        Integration in ``changes`` weglässt, behält seinen bisherigen
        Wert - was Teil-Aktualisierungen erlaubt, aber Werte auch
        festkleben lässt. Was verschwinden können muss (eine Restzeit,
        ein laufendes Programm), gehört deshalb ausdrücklich als ``None``
        hinein, nicht weggelassen. Genau daran hing wochenlang ein «noch
        1 min» an einer längst fertigen Waschmaschine.
        """
        entity = self._entities.get(entity_id)
        if entity is None:
            raise UnknownEntityError(entity_id)

        old_state = dict(entity.state)
        new_state = {**old_state, **changes}
        availability_changed = available is not None and available != entity.available

        # «Zuletzt gesehen» hängt am Melden, nicht am Ändern. Das stand
        # vorher unter der Abkürzung weiter unten – mit der Folge, dass ein
        # Licht, das seit einer Woche brennt und alle fünf Minuten
        # brav dasselbe meldet, in der App als «zuletzt gesehen vor 7
        # Tagen» stand. Genau umgekehrt: Es meldet sich pausenlos.
        if available is not False and (available is True or entity.available):
            entity.last_seen = time.time()

        if new_state == old_state and not availability_changed:
            return

        # Wer war es? Dieselbe Frage wie im Protokoll, dieselbe Regel -
        # und die Antwort reist am Zustand mit, statt einen eigenen
        # Abruf je Kachel zu kosten.
        if worth_recording(entity.kind, old_state, new_state):
            entity.last_change = time.time()
            quelle = current_source()
            entity.last_source = dict(quelle) if quelle else None

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
                # Ob sich gerade die *Erreichbarkeit* geändert hat – der
                # Zustand sagt das nicht, und der Auslöser «meldet sich
                # nicht mehr» braucht genau diese Flanke, nicht den Pegel.
                "availability_changed": availability_changed,
                # Wer die Änderung ausgelöst hat – Grundlage für die Frage
                # „warum ist das passiert?“ in der App.
                "source": current_source(),
            },
        )
