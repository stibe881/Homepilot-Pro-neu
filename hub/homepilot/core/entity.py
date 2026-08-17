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
    # Türöffner (z.B. Ring Intercom). Bewusst nicht in den Gast-Standards –
    # wer die Haustür öffnen darf, bekommt sie explizit freigegeben.
    LOCK = "lock"
    # Storen/Rollläden/Markisen (auf/ab/stopp, Position).
    COVER = "cover"
    # Wetterlage mit heutigem Wert und Mehrtagesvorhersage.
    WEATHER = "weather"
    # Die Alarmanlage selbst: scharf/unscharf und in welchem Modus. Gäste
    # sehen sie bewusst nie – wer scharfschalten darf, ist eine Frage der
    # Rolle, nicht der Freigabe einzelner Bereiche.
    ALARM = "alarm"


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
    # In der App vergebener Anzeigename (überschreibt den der Integration).
    display_name: str | None = None
    # Auf der Startseite als Favorit anzeigen.
    favorite: bool = False
    # Frei wählbare Gruppe (z.B. «Storen Süd»), zum gemeinsamen Schalten.
    group: str | None = None
    # Zeitpunkt (Epoch-Sekunden), zu dem das Gerät zuletzt erreichbar war –
    # für «zuletzt gesehen vor …» bei offline-Geräten.
    last_seen: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.display_name or self.name,
            "integration": self.integration,
            "state": dict(self.state),
            "commands": list(self.commands),
            "available": self.available,
            "room": self.room,
            "favorite": self.favorite,
            "group": self.group,
            "last_seen": self.last_seen,
        }
