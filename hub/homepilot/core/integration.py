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
from collections.abc import Coroutine
from typing import TYPE_CHECKING, Any, ClassVar

import aiohttp

from .entity import Entity
from .errors import (
    ConfigError,
    HomePilotError,
    UnknownEntityError,
    UnsupportedCommandError,
)

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)


class Integration(ABC):
    name: ClassVar[str]

    def __init__(self, hub: Hub, config: dict[str, Any]) -> None:
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

    async def snapshot(self, entity: Entity) -> bytes | None:
        """Aktuelles Standbild (JPEG) einer Kamera-Entität – None, wenn die
        Integration keine Bilder liefert."""
        return None

    async def stream_url(self, entity: Entity) -> str | None:
        """RTSP-Adresse für das Live-Bild – None, wenn die Kamera keines
        anbietet. Der Hub wandelt sie für die App in HLS um; die Adresse
        selbst verlässt den Hub nie."""
        return None

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


# Wie oft ein gescheiterter Anlauf wiederholt wird. Fünf Minuten sind
# lang genug, dass ein Dienst sich erholen kann, und kurz genug, dass man
# nicht den halben Abend ohne Türklingel dasteht.
RETRY_SECONDS = 300

# Wie lange der Start einer Integration dauern darf.
#
# Einzelne HTTP-Aufrufe haben längst ein Limit (siehe http_session), der
# Start selbst hatte keines: Hängt eine Bibliothek beim Verbinden - eine
# Bridge, die den Handschlag nicht beendet -, wartet der ganze Hub auf
# sie, und kein einziges Gerät im Haus reagiert. Neunzig Sekunden sind
# grosszügig für Matter und Bluetooth und immer noch weit unter «das Haus
# ist kaputt».
SETUP_TIMEOUT = 90.0


def is_permanent(err: Exception) -> bool:
    """Lohnt sich ein zweiter Anlauf? (rein, testbar)

    ConfigError heisst: An der Konfiguration stimmt etwas nicht - eine
    fehlende Bibliothek, eine Datei, die es nicht gibt, ein Pflichtfeld,
    das leer blieb. Das wird beim zwanzigsten Versuch nicht anders.

    Alles andere ist im Zweifel vorübergehend: eine Zeitüberschreitung zur
    Hersteller-Cloud, ein Gerät, das gerade neu startet, ein Netz, das
    beim Hochfahren des Rechners noch nicht stand. Genau dafür ist der
    Wiederanlauf da.
    """
    return isinstance(err, ConfigError)


def setup_error(name: str, err: Exception) -> str:
    """Warum der Start scheiterte, in einem Satz (rein, testbar).

    «TimeoutError» allein sagt niemandem, was zu tun ist. Ein abgelaufenes
    Zeitlimit beim Start heisst fast immer: Das Gerät oder die Cloud
    antwortet nicht - und dann will man wissen, dass es nicht am Hub liegt.
    """
    if isinstance(err, TimeoutError):
        return (
            f"'{name}' hat sich in {SETUP_TIMEOUT:.0f} Sekunden nicht "
            "gemeldet - Gerät, Bridge oder Cloud antwortet nicht. Der Hub "
            "läuft weiter und versucht es erneut."
        )
    return str(err) or err.__class__.__name__


class IntegrationManager:
    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        self._integrations: dict[str, Integration] = {}
        # Auch fehlgeschlagene Integrationen merken, damit die App zeigen
        # kann, was klemmt – sonst steht es nur im Log auf dem Hub-Rechner.
        self._failed: dict[str, str] = {}
        # Und ihre Konfiguration, um es später noch einmal zu versuchen.
        # Ohne das blieb eine Integration bis zum nächsten Neustart des
        # Hubs weg, bloss weil ihre Cloud im falschen Moment nicht
        # antwortete - und niemand startet den Hub neu, ohne es zu merken.
        self._retry: dict[str, dict[str, Any]] = {}
        self._retry_task: asyncio.Task | None = None

    @property
    def loaded(self) -> list[str]:
        return list(self._integrations)

    def get(self, name: str) -> Integration | None:
        return self._integrations.get(name)

    def status(self) -> dict[str, dict[str, Any]]:
        status: dict[str, dict[str, Any]] = {
            name: {"ok": True, "error": None} for name in self._integrations
        }
        status.update(
            {name: {"ok": False, "error": error} for name, error in self._failed.items()}
        )
        return status

    async def setup_all(self, configs: list[dict[str, Any]]) -> None:
        for config in configs:
            name = config.get("integration")
            if not name:
                log.error("Integrations-Eintrag ohne 'integration'-Schlüssel: %s", config)
                continue
            try:
                cls = load_integration_class(name)
                instance = cls(self.hub, config)
                await asyncio.wait_for(instance.setup(), timeout=SETUP_TIMEOUT)
                self._integrations[name] = instance
                self._failed.pop(name, None)
                log.info("Integration %s geladen", name)
            except Exception as err:
                # Eine kaputte Integration darf den Hub-Start nicht verhindern.
                self._failed[name] = setup_error(name, err)
                if is_permanent(err):
                    self._retry.pop(name, None)
                    log.error("Integration '%s': %s", name, self._failed[name])
                else:
                    self._retry[name] = config
                    log.exception(
                        "Setup der Integration '%s' fehlgeschlagen – neuer "
                        "Anlauf in %d Minuten",
                        name,
                        RETRY_SECONDS // 60,
                    )
        self._start_retries()

    def _start_retries(self) -> None:
        if not self._retry:
            return
        if self._retry_task is None or self._retry_task.done():
            self._retry_task = asyncio.create_task(self._retry_loop())

    async def _retry_loop(self) -> None:
        """Gescheiterte Anläufe in Ruhe wiederholen, bis sie stehen."""
        while self._retry:
            await asyncio.sleep(RETRY_SECONDS)
            for name, config in list(self._retry.items()):
                try:
                    cls = load_integration_class(name)
                    instance = cls(self.hub, config)
                    await asyncio.wait_for(instance.setup(), timeout=SETUP_TIMEOUT)
                except Exception as err:
                    self._failed[name] = setup_error(name, err)
                    if is_permanent(err):
                        self._retry.pop(name, None)
                        log.error("Integration '%s': %s", name, self._failed[name])
                    else:
                        # Leise: Der erste Fehlschlag steht schon im Log,
                        # und der Zustand ist im System-Bildschirm zu sehen.
                        log.debug(
                            "Integration '%s' weiterhin nicht bereit: %s", name, err
                        )
                    continue
                self._integrations[name] = instance
                self._failed.pop(name, None)
                self._retry.pop(name, None)
                log.info("Integration %s geladen (nach erneutem Anlauf)", name)

    def stop_retries(self) -> None:
        task = self._retry_task
        self._retry_task = None
        self._retry.clear()
        if task is not None and not task.done():
            task.cancel()

    async def teardown_all(self) -> None:
        self.stop_retries()
        for integration in self._integrations.values():
            try:
                await integration.teardown()
            except Exception:
                log.exception("Teardown der Integration '%s' fehlgeschlagen", integration.name)
        self._integrations.clear()

    async def dispatch_command(
        self, entity_id: str, command: str, data: dict[str, Any] | None = None
    ) -> Entity:
        self.hub.counters.zaehle("commands")
        entity = self.hub.registry.get(entity_id)
        if entity is None:
            self.hub.counters.zaehle("commands_unknown_entity")
            raise UnknownEntityError(entity_id)
        if command not in entity.commands:
            self.hub.counters.zaehle("commands_unsupported")
            raise UnsupportedCommandError(entity_id, command)
        integration = self._integrations.get(entity.integration)
        if integration is None:
            raise HomePilotError(f"Integration '{entity.integration}' ist nicht geladen")
        await integration.handle_command(entity, command, data or {})
        return entity
