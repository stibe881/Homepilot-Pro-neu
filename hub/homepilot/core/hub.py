"""Der Hub verdrahtet Event-Bus, Registry, Store, Integrationen, Szenen,
Automationen, Benutzer und Benachrichtigungen."""

from __future__ import annotations

import logging
import time
from typing import Any

from .automation import AutomationEngine
from .config import HubConfig
from .events import EventBus
from .integration import IntegrationManager
from .persistence import DataStore
from .watchdog import Watchdog
from .push import PushService
from .registry import EntityRegistry
from .scenes import SceneManager
from .store import Store
from .supabase import SupabaseClient
from .users import Role, User, parse_users

log = logging.getLogger(__name__)


class Hub:
    def __init__(self, config: HubConfig) -> None:
        self.config = config
        self.bus = EventBus()
        self.registry = EntityRegistry(self.bus)
        self.integrations = IntegrationManager(self)
        self.automations = AutomationEngine(self)
        self.scenes = SceneManager(self)
        self.push = PushService()
        self.users = parse_users(config.users, config.api.token)
        # In der App angelegte Benutzer und Automationen liegen neben der
        # Konfiguration, damit sie ohne Datenbank einen Neustart überleben.
        self.data = DataStore(config.data_file)
        self.store: Store | None = None
        self.watchdog = Watchdog(self)
        self.started_at = time.time()

    async def start(self) -> None:
        log.info("Hub startet …")
        # Die Raumzuordnung muss stehen, bevor die erste Entität entsteht.
        # Grundlage ist die config.yaml; in der App gesetzte Zuordnungen
        # (aus der homepilot-data.json) haben Vorrang.
        self.data.load()
        self._rooms_by_entity = {
            entity_id: room
            for room, members in self.config.rooms.items()
            for entity_id in members
        }
        for entry in self.data.get("entity_rooms"):
            entity_id, room = entry.get("entity_id"), entry.get("room")
            if entity_id:
                if room:
                    self._rooms_by_entity[entity_id] = room
                else:
                    self._rooms_by_entity.pop(entity_id, None)
        self.registry.room_provider = self._rooms_by_entity.get
        await self._start_store()
        self._load_stored_users()
        await self.integrations.setup_all(self.config.integrations)
        self.scenes.load(self.config.scenes, self.data.get("scenes"))
        await self.automations.start(
            self.config.automations, self.data.get("automations")
        )
        self.started_at = time.time()
        self.watchdog.start()

        if self.users.open_access:
            log.warning(
                "Kein Token und keine Benutzer konfiguriert – die API ist offen. "
                "Nur im eigenen Netz vertretbar."
            )
        log.info(
            "Hub bereit: %d Integrationen, %d Entitäten, %d Szenen, "
            "%d Benutzer, Datenbank: %s",
            len(self.integrations.loaded),
            len(self.registry.all()),
            len(self.scenes.scenes),
            len(self.users.users),
            "Supabase" if self.store else "keine",
        )

    def _load_stored_users(self) -> None:
        self.data.load()
        for entry in self.data.get("users"):
            try:
                self.users.add(
                    User(
                        name=entry["name"],
                        role=entry.get("role", Role.RESIDENT),
                        token=entry["token"],
                        allow=entry.get("allow") or [],
                        editable=True,
                        enabled=bool(entry.get("enabled", True)),
                        features=entry.get("features") or [],
                    )
                )
            except Exception as err:
                log.warning("Gespeicherter Benutzer übersprungen: %s", err)
        # Ab jetzt jede Änderung mitschreiben.
        self.users.on_change = lambda users: self.data.set("users", users)
        # Gibt es gespeicherte Benutzer, ist die API nicht mehr offen.
        if self.users.users:
            self.users.open_access = False

    async def reload_automations(self) -> None:
        """Nach einer Änderung in der App neu aufsetzen."""
        await self.automations.stop()
        await self.automations.start(
            self.config.automations, self.data.get("automations")
        )

    def reload_scenes(self) -> None:
        """Nach einer Szenen-Änderung in der App neu laden."""
        self.scenes.load(self.config.scenes, self.data.get("scenes"))

    def known_rooms(self) -> list[str]:
        """Alle Räume: aus der config.yaml plus die per App zugewiesenen,
        Reihenfolge der config zuerst."""
        rooms = list(self.config.rooms.keys())
        for room in self._rooms_by_entity.values():
            if room and room not in rooms:
                rooms.append(room)
        return rooms

    async def set_entity_room(self, entity_id: str, room: str | None) -> None:
        """Weist einer Entität in der App einen Raum zu (oder entfernt ihn).

        Wirkt sofort und bleibt über Neustarts erhalten – gespeichert wird
        die Zuordnung in der homepilot-data.json, nicht in der config.yaml.
        """
        if room:
            self._rooms_by_entity[entity_id] = room
        else:
            self._rooms_by_entity.pop(entity_id, None)

        # In der App gesetzte Zuordnungen persistieren (config-Einträge
        # bleiben in der config.yaml und werden hier nicht dupliziert).
        stored = [
            entry
            for entry in self.data.get("entity_rooms")
            if entry.get("entity_id") != entity_id
        ]
        stored.append({"entity_id": entity_id, "room": room})
        self.data.set("entity_rooms", stored)

        await self.registry.set_room(entity_id, room)

    async def _start_store(self) -> None:
        config = self.config.supabase
        url, key = config.get("url"), config.get("service_key")
        if not url or not key:
            log.info("Kein Supabase konfiguriert – Zustände werden nicht persistiert")
            return
        try:
            client = SupabaseClient(url, key)
            store = Store(self, client, config)
            await store.start()
        except Exception:
            # Ohne Datenbank läuft der Hub weiter – nur ohne Verlauf.
            log.exception("Supabase-Anbindung fehlgeschlagen, Hub läuft ohne Datenbank")
            return
        self.store = store
        # Muss vor dem Setup der Integrationen stehen, damit neu angelegte
        # Entitäten ihren gespeicherten Zustand mitbekommen.
        self.registry.state_provider = store.restored_state

    def status(self) -> dict[str, Any]:
        """Betriebszustand für die Diagnose-Ansicht der App."""
        entities = self.registry.all()
        by_integration: dict[str, dict[str, int]] = {}
        for entity in entities:
            counts = by_integration.setdefault(
                entity.integration, {"entities": 0, "unavailable": 0}
            )
            counts["entities"] += 1
            if not entity.available:
                counts["unavailable"] += 1

        integrations = []
        for name, info in self.integrations.status().items():
            counts = by_integration.get(name, {"entities": 0, "unavailable": 0})
            integrations.append({"name": name, **info, **counts})

        return {
            "uptime_seconds": round(time.time() - self.started_at),
            "database": "supabase" if self.store else None,
            "entities": len(entities),
            "unavailable": sum(1 for entity in entities if not entity.available),
            "integrations": sorted(integrations, key=lambda item: item["name"]),
            "automations": {
                "count": len(self.automations.automations),
                "paused_until": (
                    self.automations.paused_until.isoformat()
                    if self.automations.paused_until
                    else None
                ),
            },
            "push_devices": len(self.push.devices),
            "energy": self.config.energy,
            # Ausfall-Protokoll des Wächters (jüngste zuerst).
            "outages": self.watchdog.outages,
            "down": sorted(self.watchdog.down_since),
        }

    async def stop(self) -> None:
        log.info("Hub stoppt …")
        await self.watchdog.stop()
        await self.automations.stop()
        await self.integrations.teardown_all()
        if self.store:
            await self.store.stop()
            self.store = None
        self.registry.state_provider = None
        self.registry.room_provider = None
