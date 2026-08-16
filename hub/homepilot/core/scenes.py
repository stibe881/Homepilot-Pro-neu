"""Szenen: eine benannte Liste von Kommandos.

  scenes:
    - id: kino
      name: Kino
      icon: film-outline
      actions:
        - {entity_id: hue.stehlampe, command: set_brightness, data: {brightness: 15}}
        - {entity_id: mqtt.sonoff_tv, command: turn_on}

Bewusst simpel gehalten: Eine Szene stellt einen Zustand her, sie hat keine
Bedingungen und keinen Zeitverlauf. Alles Weitere gehört in eine Automation.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .errors import ConfigError, HomePilotError
from .source import as_source, scene_source

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)


@dataclass
class Scene:
    id: str
    name: str
    icon: str = "sparkles-outline"
    actions: list[dict[str, Any]] = field(default_factory=list)
    # In der App angelegte Szenen lassen sich dort auch wieder ändern und
    # löschen; die aus der config.yaml gehören der Datei.
    editable: bool = False
    # Optionaler Raum – dann erscheint die Szene in dessen Kategorie „Szenen“.
    room: str | None = None
    # Auf der Startseite als Schnellaktion anzeigen.
    on_start: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "icon": self.icon,
            "actions": self.actions,
            "entity_ids": [action.get("entity_id") for action in self.actions],
            "editable": self.editable,
            "room": self.room,
            "on_start": self.on_start,
        }


def parse_scenes(configs: list[dict[str, Any]], editable: bool = False) -> list[Scene]:
    scenes = []
    for index, config in enumerate(configs):
        scene_id = str(config.get("id") or f"scene_{index}")
        actions = config.get("actions") or []
        if not isinstance(actions, list):
            raise ConfigError(f"Szene '{scene_id}': 'actions' muss eine Liste sein")
        for action in actions:
            if not action.get("entity_id") or not action.get("command"):
                raise ConfigError(
                    f"Szene '{scene_id}': jede Aktion braucht 'entity_id' und 'command'"
                )
        room = config.get("room")
        scenes.append(
            Scene(
                id=scene_id,
                name=str(config.get("name") or scene_id),
                icon=str(config.get("icon") or "sparkles-outline"),
                actions=actions,
                editable=editable,
                room=str(room) if room else None,
                on_start=bool(config.get("on_start")),
            )
        )
    return scenes


class SceneManager:
    def __init__(self, hub: "Hub") -> None:
        self.hub = hub
        self.scenes: list[Scene] = []

    def load(
        self,
        configs: list[dict[str, Any]],
        stored: list[dict[str, Any]] | None = None,
    ) -> None:
        """Szenen aus der config.yaml plus die in der App angelegten."""
        self.scenes = parse_scenes(configs) + parse_scenes(stored or [], editable=True)
        if self.scenes:
            log.info("%d Szenen geladen", len(self.scenes))

    def get(self, scene_id: str) -> Scene | None:
        return next((scene for scene in self.scenes if scene.id == scene_id), None)

    async def activate(self, scene_id: str) -> dict[str, Any]:
        """Führt alle Aktionen aus und meldet, was nicht geklappt hat.

        Ein defektes Gerät darf die restliche Szene nicht verhindern – das
        Licht soll auch dann angehen, wenn der Verstärker nicht antwortet.
        """
        scene = self.get(scene_id)
        if scene is None:
            raise HomePilotError(f"Unbekannte Szene: {scene_id}")

        failed: list[dict[str, str]] = []
        with as_source(scene_source(scene.id, scene.name)):
            for action in scene.actions:
                try:
                    await self.hub.integrations.dispatch_command(
                        action["entity_id"], action["command"], action.get("data") or {}
                    )
                except Exception as err:
                    log.warning(
                        "Szene '%s': %s konnte nicht geschaltet werden: %s",
                        scene.name,
                        action["entity_id"],
                        err,
                    )
                    failed.append({"entity_id": action["entity_id"], "error": str(err)})
                await asyncio.sleep(0)

        log.info(
            "Szene '%s' ausgelöst (%d von %d Aktionen erfolgreich)",
            scene.name,
            len(scene.actions) - len(failed),
            len(scene.actions),
        )
        return {"scene": scene.as_dict(), "failed": failed}
