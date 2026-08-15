"""Einheitliches Entitätsmodell.

Jede Integration übersetzt ihre Geräte in Entities. Konvention für den
Zustand: der Hauptwert liegt immer unter dem Schlüssel ``state``
(z.B. "on"/"off" bei Lichtern, ein Messwert bei Sensoren), weitere
Attribute (brightness, unit, ...) liegen daneben. Automationen und die
App verlassen sich auf diese Konvention.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class EntityKind:
    LIGHT = "light"
    SWITCH = "switch"
    SENSOR = "sensor"
    BINARY_SENSOR = "binary_sensor"
    ALERT = "alert"
    MEDIA_PLAYER = "media_player"
    CAMERA = "camera"
    VACUUM = "vacuum"
    APPLIANCE = "appliance"
    CALENDAR = "calendar"


@dataclass
class Entity:
    id: str  # "<integration>.<object_id>"
    kind: str
    name: str
    integration: str
    state: dict[str, Any] = field(default_factory=dict)
    commands: list[str] = field(default_factory=list)
    available: bool = True
    # Raum aus der Konfiguration; die App gruppiert danach.
    room: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "integration": self.integration,
            "state": dict(self.state),
            "commands": list(self.commands),
            "available": self.available,
            "room": self.room,
        }
