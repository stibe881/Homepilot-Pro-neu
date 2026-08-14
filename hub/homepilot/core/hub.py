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
from .push import PushService
from .registry import EntityRegistry
from .scenes import SceneManager
from .store import Store
from .supabase import SupabaseClient
from .users import parse_users

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
        self.store: Store | None = None
        self.started_at = time.time()

    async def start(self) -> None:
        log.info("Hub startet …")
        # Die Raumzuordnung muss stehen, bevor die erste Entität entsteht.
        self._rooms_by_entity = {
            entity_id: room
            for room, members in self.config.rooms.items()
            for entity_id in members
        }
        self.registry.room_provider = self._rooms_by_entity.get
        await self._start_store()
        await self.integrations.setup_all(self.config.integrations)
        self.scenes.load(self.config.scenes)
        await self.automations.start(self.config.automations)
        self.started_at = time.time()

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
        }

    async def stop(self) -> None:
        log.info("Hub stoppt …")
        await self.automations.stop()
        await self.integrations.teardown_all()
        if self.store:
            await self.store.stop()
            self.store = None
        self.registry.state_provider = None
        self.registry.room_provider = None
