"""Integrations-Framework.

Eine Integration ist eine Klasse mit ``setup()``, ``teardown()`` und
``handle_command()``. Sie wird per Name aus ``homepilot.integrations.<name>``
geladen (Modul-Attribut ``INTEGRATION``) und bekommt den Hub plus ihren
Konfigurationsblock aus config.yaml.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, ClassVar, Coroutine

import aiohttp

from .entity import Entity
from .errors import HomePilotError, UnknownEntityError, UnsupportedCommandError

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)


class Integration(ABC):
    name: ClassVar[str]

    def __init__(self, hub: "Hub", config: dict[str, Any]) -> None:
        self.hub = hub
        self.config = config
        self.log = logging.getLogger(f"homepilot.integrations.{self.name}")
        self._tasks: list[asyncio.Task] = []
        self._sessions: list[aiohttp.ClientSession] = []

    @abstractmethod
    async def setup(self) -> None:
        """Verbindung aufbauen und Entitäten registrieren."""

    async def teardown(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks.clear()
        for session in self._sessions:
            await session.close()
        self._sessions.clear()

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        raise UnsupportedCommandError(entity.id, command)

    def start_task(self, coro: Coroutine) -> asyncio.Task:
        """Hintergrund-Task starten, der beim Teardown automatisch aufgeräumt wird."""
        task = asyncio.create_task(coro)
        self._tasks.append(task)
        return task

    def http_session(self, **kwargs: Any) -> aiohttp.ClientSession:
        """HTTP-Session, die beim Teardown automatisch geschlossen wird."""
        kwargs.setdefault("timeout", aiohttp.ClientTimeout(total=20))
        session = aiohttp.ClientSession(**kwargs)
        self._sessions.append(session)
        return session

    def entity_id(self, object_id: str) -> str:
        return f"{self.name}.{object_id}"

    async def add_entity(
        self,
        object_id: str,
        kind: str,
        name: str,
        state: dict[str, Any] | None = None,
        commands: list[str] | None = None,
        available: bool = True,
    ) -> Entity:
        entity = Entity(
            id=self.entity_id(object_id),
            kind=kind,
            name=name,
            integration=self.name,
            state=state or {},
            commands=commands or [],
            available=available,
        )
        await self.hub.registry.add(entity)
        return entity


def load_integration_class(name: str) -> type[Integration]:
    try:
        module = importlib.import_module(f"homepilot.integrations.{name}")
    except ImportError as err:
        raise HomePilotError(f"Integration '{name}' nicht gefunden") from err
    cls = getattr(module, "INTEGRATION", None)
    if cls is None:
        raise HomePilotError(f"Integration '{name}' exportiert kein INTEGRATION-Attribut")
    return cls


class IntegrationManager:
    def __init__(self, hub: "Hub") -> None:
        self.hub = hub
        self._integrations: dict[str, Integration] = {}

    @property
    def loaded(self) -> list[str]:
        return list(self._integrations)

    async def setup_all(self, configs: list[dict[str, Any]]) -> None:
        for config in configs:
            name = config.get("integration")
            if not name:
                log.error("Integrations-Eintrag ohne 'integration'-Schlüssel: %s", config)
                continue
            try:
                cls = load_integration_class(name)
                instance = cls(self.hub, config)
                await instance.setup()
                self._integrations[name] = instance
                log.info("Integration %s geladen", name)
            except Exception:
                # Eine kaputte Integration darf den Hub-Start nicht verhindern.
                log.exception("Setup der Integration '%s' fehlgeschlagen", name)

    async def teardown_all(self) -> None:
        for integration in self._integrations.values():
            try:
                await integration.teardown()
            except Exception:
                log.exception("Teardown der Integration '%s' fehlgeschlagen", integration.name)
        self._integrations.clear()

    async def dispatch_command(
        self, entity_id: str, command: str, data: dict[str, Any] | None = None
    ) -> Entity:
        entity = self.hub.registry.get(entity_id)
        if entity is None:
            raise UnknownEntityError(entity_id)
        if command not in entity.commands:
            raise UnsupportedCommandError(entity_id, command)
        integration = self._integrations.get(entity.integration)
        if integration is None:
            raise HomePilotError(f"Integration '{entity.integration}' ist nicht geladen")
        await integration.handle_command(entity, command, data or {})
        return entity
