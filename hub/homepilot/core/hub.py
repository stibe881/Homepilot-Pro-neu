"""Der Hub verdrahtet Event-Bus, Registry, Store, Integrationen und Automationen."""

from __future__ import annotations

import logging

from .automation import AutomationEngine
from .config import HubConfig
from .events import EventBus
from .integration import IntegrationManager
from .registry import EntityRegistry
from .store import Store
from .supabase import SupabaseClient

log = logging.getLogger(__name__)


class Hub:
    def __init__(self, config: HubConfig) -> None:
        self.config = config
        self.bus = EventBus()
        self.registry = EntityRegistry(self.bus)
        self.integrations = IntegrationManager(self)
        self.automations = AutomationEngine(self)
        self.store: Store | None = None

    async def start(self) -> None:
        log.info("Hub startet …")
        await self._start_store()
        await self.integrations.setup_all(self.config.integrations)
        await self.automations.start(self.config.automations)
        log.info(
            "Hub bereit: %d Integrationen, %d Entitäten, Datenbank: %s",
            len(self.integrations.loaded),
            len(self.registry.all()),
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

    async def stop(self) -> None:
        log.info("Hub stoppt …")
        await self.automations.stop()
        await self.integrations.teardown_all()
        if self.store:
            await self.store.stop()
            self.store = None
        self.registry.state_provider = None
