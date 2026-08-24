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
from collections.abc import Callable, Coroutine
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


# Wie oft eine Integration von sich aus nachfragt, in Sekunden.
#
# Diese Zahlen standen je einzeln in ihrer Integration – acht verschiedene
# Werte an fünfzehn Stellen, jede für sich plausibel und zusammen nicht zu
# überblicken. Wer wissen wollte, was der Hub im Leerlauf eigentlich tut,
# musste fünfzehn Dateien öffnen.
#
# Die Werte selbst bleiben, wie sie waren; sie sind nicht willkürlich:
#
# - **30 s** – etwas, das man im Sekundentakt erwartet: Anwesenheit, was
#   gerade läuft, ein Lichtereffekt. Alles lokal, also billig.
# - **60 s** – Geräte, die eine Weile brauchen und nichts von selbst
#   melden: Staubsauger, Waschmaschine, Schloss.
# - **120–300 s** – Cloud und Bridges. Häufiger wäre unhöflich gegenüber
#   fremden Servern und bringt nichts: Was schnell sein muss, kommt bei
#   diesen ohnehin per Push.
# - **900–1800 s** – Wetter und Unwetterwarnungen. Sie ändern sich nicht
#   schneller.
#
# `scan_interval` in der config.yaml sticht immer. Wer einen Wert hier
# ändert, ändert ihn für alle, die ihn nicht selbst gesetzt haben.
SCAN_INTERVALS: dict[str, float] = {
    "google_calendar": 300,
    "homematic": 300,
    "hue": 300,
    "hue_sync": 30,
    "meteoalarm": 900,
    "nuki": 60,
    "pitboss": 30,
    "ring": 300,
    "roborock": 60,
    "spotify": 30,
    "twinkly": 30,
    "unifi": 30,
    "unifi_protect": 120,
    "vzug": 60,
    "weather": 1800,
}

# Für alles, was in der Tabelle fehlt. Eine Minute ist der Kompromiss, mit
# dem man nichts kaputt macht: schnell genug, dass es nicht auffällt, und
# langsam genug, dass es niemanden stört.
FALLBACK_INTERVAL = 60.0


class Integration(ABC):
    name: ClassVar[str]

    def __init__(self, hub: Hub, config: dict[str, Any]) -> None:
        self.hub = hub
        self.config = config
        self.log = logging.getLogger(f"homepilot.integrations.{self.name}")
        self._tasks: list[asyncio.Task] = []
        self._sessions: list[aiohttp.ClientSession] = []

    def scan_interval(self) -> float:
        """Wie oft diese Integration nachfragt, in Sekunden.

        Reihenfolge: was in der config.yaml steht, sonst die Tabelle
        `SCAN_INTERVALS` oben, sonst `FALLBACK_INTERVAL`. Eine unsinnige
        Angabe (null, negativ, Text) fällt auf die Vorgabe zurück statt
        eine Schleife ohne Pause zu bauen – ein Tippfehler in der
        config.yaml soll den Hub nicht auf hundert Prozent CPU bringen.
        """
        vorgabe = SCAN_INTERVALS.get(self.name, FALLBACK_INTERVAL)
        try:
            gewuenscht = float(self.config.get("scan_interval", vorgabe))
        except (TypeError, ValueError):
            self.log.warning(
                "scan_interval ist keine Zahl – bleibe bei %.0f s", vorgabe
            )
            return float(vorgabe)
        if gewuenscht <= 0:
            self.log.warning(
                "scan_interval %.0f ist kein sinnvoller Takt – bleibe bei %.0f s",
                gewuenscht,
                vorgabe,
            )
            return float(vorgabe)
        return gewuenscht

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

    def start_polling(
        self,
        refresh: Callable[[], Coroutine],
        interval: float | None = None,
        sofort: bool = False,
    ) -> asyncio.Task:
        """Der Standard-Polltakt: schlafen, auffrischen, weiterleben.

        Sechs Integrationen hatten sich dieselbe Schleife selbst gebaut -
        und nicht alle gleich gut: Wo der Fehlerfang fehlte, beendete die
        erste kaputte Antwort den Takt für immer, und die Geräte froren
        kommentarlos ein. Hier ist er eingebaut: Ein Fehlschlag wird
        protokolliert, der nächste Takt kommt trotzdem.

        ``interval`` überschreibt scan_interval(); ``sofort`` frischt
        einmal vor dem ersten Schlafen auf (wer seine Entitäten erst über
        den ersten Abruf findet, braucht das).
        """
        takt = float(interval) if interval is not None else self.scan_interval()

        async def _loop() -> None:
            if sofort:
                await self._poll_once(refresh)
            while True:
                await asyncio.sleep(takt)
                await self._poll_once(refresh)

        return self.start_task(_loop())

    async def _poll_once(self, refresh: Callable[[], Coroutine]) -> None:
        try:
            await refresh()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            self.log.warning("%s-Abfrage fehlgeschlagen: %s", self.name, err)

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
        room: str | None = None,
    ) -> Entity:
        """``room`` ist ein Vorschlag, keine Ansage.

        Die config.yaml sticht ihn (siehe ``registry.add``) – dort steht,
        wie das Haus wirklich geschnitten ist. Er ist für Entitäten
        gedacht, die niemand von Hand einträgt, weil es zu viele sind und
        die Gegenseite den Raum ohnehin kennt: die Szenen einer
        Hue-Bridge etwa, die dort schon einem Zimmer zugeordnet sind.
        """
        entity = Entity(
            id=self.entity_id(object_id),
            kind=kind,
            name=name,
            integration=self.name,
            state=state or {},
            commands=commands or [],
            available=available,
            room=room,
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

    async def reload(self, name: str) -> dict[str, Any]:
        """Eine einzelne Integration neu anlaufen lassen.

        Beim Einrichten eines neuen Geräts ist das der Unterschied
        zwischen zwei Sekunden und zwei Minuten: config.yaml ändern,
        neu laden, fertig – statt den ganzen Hub durchzustarten und
        dabei jede andere Integration mitzureissen.

        Die Konfiguration kommt frisch von der Platte: Wer die
        config.yaml geändert hat, will genau diese Änderung sehen, nicht
        den Stand vom Hub-Start. Alte Entitäten der Integration werden
        vorher ausgetragen – sonst blieben umbenannte oder entfernte
        Geräte als Karteileichen stehen.
        """
        from .config import load_config

        if not self.hub.config.source_path:
            raise HomePilotError(
                "Ohne config.yaml-Pfad (Tests, eingebetteter Hub) gibt es "
                "nichts neu zu laden."
            )
        frisch = load_config(self.hub.config.source_path)
        config = next(
            (
                entry
                for entry in frisch.integrations
                if entry.get("integration") == name
            ),
            None,
        )
        # Die Alarmanlage steht oft nicht in der Datei – sie gehört zum
        # Haus und wird beim Start still ergänzt. Gleiches Recht hier.
        if config is None and name == "alarm":
            config = {"integration": "alarm"}
        if config is None:
            raise HomePilotError(
                f"'{name}' steht nicht (mehr) in der config.yaml – zum "
                "Entfernen reicht das; zum Laden muss sie dort stehen."
            )

        alt_instanz = self._integrations.pop(name, None)
        if alt_instanz is not None:
            try:
                await alt_instanz.teardown()
            except Exception:
                log.exception("Teardown von '%s' beim Neuladen fehlgeschlagen", name)
        # Karteileichen austragen: Entitäten der alten Fassung.
        for entity in list(self.hub.registry.all()):
            if entity.integration == name:
                await self.hub.registry.remove(entity.id)
        self._failed.pop(name, None)
        self._retry.pop(name, None)

        try:
            cls = load_integration_class(name)
            instance = cls(self.hub, config)
            await asyncio.wait_for(instance.setup(), timeout=SETUP_TIMEOUT)
        except Exception as err:
            self._failed[name] = setup_error(name, err)
            if not is_permanent(err):
                self._retry[name] = config
                self._start_retries()
            log.error("Neuladen von '%s' fehlgeschlagen: %s", name, self._failed[name])
            return {"ok": False, "error": self._failed[name]}
        self._integrations[name] = instance
        log.info("Integration %s neu geladen", name)
        return {"ok": True, "error": None}

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
