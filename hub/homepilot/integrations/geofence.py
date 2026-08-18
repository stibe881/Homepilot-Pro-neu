"""Geofence: Wer ist im Anflug, wer gerade weg.

Warum nicht über WLAN: Die Anwesenheit über UniFi merkt erst, dass jemand
kommt, wenn das Telefon sich einbucht – da steht man schon vor der Türe.
Ein Geofence meldet beim Verlassen des Quartiers, also Minuten vorher.
Genau diese Minuten braucht man, um die Heizung hochzufahren oder «alles
aus» anzubieten.

Das Telefon meldet den Wechsel selbst. Zwei Wege, beide ohne
Hintergrundrechte in der App:

  1. iOS-Kurzbefehle: Automation «Wenn ich ankomme/gehe» → «Inhalte von
     URL abrufen» → POST auf /api/presence/geofence.
  2. Android: Tasker, Home Assistant Companion o.ä. auf dieselbe Adresse.

Konfiguration – je Person eine Entität, die «home» oder «away» zeigt:

  - integration: geofence
    zones:
      - id: stefan
        name: Stefan
      - id: livia
        name: Livia

Die Entitäten heissen dann geofence.stefan usw. und lassen sich in
Abläufen wie jeder andere Zustand benutzen; zusätzlich gibt es den
Auslöser «Ort betreten/verlassen».
"""

from __future__ import annotations

import time
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Zustände, die eine Zone kennt.
HOME = "home"
AWAY = "away"


def parse_zones(raw: Any) -> list[dict[str, str]]:
    """Zonenliste einlesen (rein, testbar).

    Ohne Kennung kein Eintrag: Die Kennung ist die Adresse, unter der das
    Telefon später meldet – geraten werden kann sie nicht.
    """
    zones = []
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        zone_id = str(entry.get("id") or "").strip()
        if not zone_id:
            continue
        zones.append({"id": zone_id, "name": str(entry.get("name") or zone_id)})
    return zones


def normalise_event(value: Any) -> str | None:
    """«enter», «arrive», «home», true → home; «leave», «exit» → away.

    Die Kurzbefehle-App und Tasker nennen dasselbe verschieden – hier
    einmal übersetzt, statt in jedem Ablauf (rein, testbar).
    """
    text = str(value).strip().lower()
    if text in ("enter", "entered", "arrive", "arrived", "home", "in", "true", "1"):
        return HOME
    if text in ("leave", "left", "exit", "exited", "away", "out", "false", "0"):
        return AWAY
    return None


class GeofenceIntegration(Integration):
    name = "geofence"

    async def setup(self) -> None:
        zones = parse_zones(self.config.get("zones"))
        if not zones:
            raise ConfigError(
                "geofence braucht mindestens eine Zone unter 'zones' "
                "(je mit 'id', z.B. der Person)"
            )
        # Kennung → Entitäts-ID
        self._zones: dict[str, str] = {}
        for zone in zones:
            entity = await self.add_entity(
                zone["id"],
                EntityKind.BINARY_SENSOR,
                zone["name"],
                # Unbekannt ist ehrlich: Bis das Telefon das erste Mal
                # meldet, weiss der Hub es wirklich nicht.
                state={"state": "unknown", "device_class": "presence"},
                available=True,
            )
            self._zones[zone["id"]] = entity.id

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        raise ConfigError("Geofence-Zonen meldet das Telefon, sie lassen sich nicht schalten")

    def zone_entity(self, zone_id: str) -> str | None:
        return self._zones.get(zone_id)

    async def report(self, zone_id: str, event: str) -> str:
        """Einen gemeldeten Wechsel übernehmen. Gibt den neuen Zustand zurück."""
        entity_id = self._zones.get(zone_id)
        if entity_id is None:
            raise KeyError(zone_id)
        state = normalise_event(event)
        if state is None:
            raise ValueError(
                f"Unbekanntes Ereignis '{event}' – erlaubt sind enter/leave"
            )
        await self.hub.registry.update_state(
            entity_id,
            {"state": state, "device_class": "presence", "changed_at": time.time()},
            available=True,
        )
        self.log.info("Geofence: %s ist jetzt %s", zone_id, state)
        return state


INTEGRATION = GeofenceIntegration
