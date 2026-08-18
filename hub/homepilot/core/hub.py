"""Der Hub verdrahtet Event-Bus, Registry, Store, Integrationen, Szenen,
Automationen, Benutzer und Benachrichtigungen."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

from .. import __version__
from . import config_edit
from .automation import AutomationEngine
from .config import HubConfig
from .events import EventBus
from .integration import IntegrationManager
from .logbuffer import install as install_log_buffer
from .persistence import DataStore
from .watchdog import Watchdog
from . import push as push_service
from .push import PushService
from .registry import EntityRegistry
from .scenes import SceneManager
from .snapshots import SnapshotStore
from .store import Store
from .streams import MEDIAMTX_API, MEDIAMTX_HLS, StreamManager
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
        # Kamerabilder, die einer Push-Nachricht beiliegen: nur im Speicher
        # und nur wenige Minuten gültig (siehe core/snapshots.py).
        self.snapshots = SnapshotStore()
        # Die letzten Warnungen und Fehler – die App zeigt sie unter System,
        # damit man dafür nicht per SSH ins Container-Log muss.
        self.log_buffer = install_log_buffer()
        self.users = parse_users(config.users, config.api.token)
        # In der App angelegte Benutzer und Automationen liegen neben der
        # Konfiguration, damit sie ohne Datenbank einen Neustart überleben.
        self.data = DataStore(config.data_file)
        self.store: Store | None = None
        self.watchdog = Watchdog(self)
        # Wandelt Kamerabilder in HLS um – läuft nur, solange jemand zuschaut.
        # Bevorzugt über mediamtx (Low-Latency), sonst über ffmpeg.
        self.streams = StreamManager(
            api_url=config.streaming.get("mediamtx_api", MEDIAMTX_API),
            hls_url=config.streaming.get("mediamtx_hls", MEDIAMTX_HLS),
        )
        self.started_at = time.time()

    async def start(self) -> None:
        # Version und Startzeit gleich in die erste Zeile: Nach einem
        # Rebuild ist sonst nicht zu erkennen, ob der Container den neuen
        # Stand fährt oder den alten weiterlaufen lässt.
        log.info("Hub startet … (HomePilot %s)", __version__)
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
        # In der App gesetzte Metadaten (Name, Favorit, Gruppe) pro Entität.
        self._meta_by_entity = {
            entry["entity_id"]: entry
            for entry in self.data.get("entity_meta")
            if entry.get("entity_id")
        }
        self.registry.meta_provider = self._meta_by_entity.get
        await self._start_store()
        self._load_stored_users()
        # Die Alarmanlage gehört zum Haus, nicht zu einer Geräteanbindung:
        # Sie ist immer da, auch ohne Eintrag in der config.yaml. Wer sie
        # dort umbenennen will, kann sie trotzdem selbst aufführen.
        integrations = list(self.config.integrations)
        if not any(entry.get("integration") == "alarm" for entry in integrations):
            integrations.append({"integration": "alarm"})
        await self.integrations.setup_all(integrations)
        self.scenes.load(self.config.scenes, self.data.get("scenes"))
        await self.automations.start(
            self.config.automations, self.data.get("automations")
        )
        self.started_at = time.time()
        self.watchdog.start()
        self._backup_task = asyncio.create_task(self._backup_loop())

        if self.users.open_access:
            log.warning(
                "Kein Token und keine Benutzer konfiguriert – die API ist offen. "
                "Nur im eigenen Netz vertretbar."
            )
        self.push.muted = push_service.parse_muted(self.data.get("push_prefs"))
        for problem in self._config_problems():
            log.warning("Konfiguration: %s", problem)
        log.info(
            "Hub bereit: %d Integrationen, %d Entitäten, %d Szenen, "
            "%d Benutzer, Datenbank: %s",
            len(self.integrations.loaded),
            len(self.registry.all()),
            len(self.scenes.scenes),
            len(self.users.users),
            "Supabase" if self.store else "keine",
        )

    async def _backup_loop(self) -> None:
        """Sichert die App-Daten täglich – beim Start sofort, sonst alle 24 h.

        Nur, wenn seit der letzten Sicherung ein Tag vergangen ist, damit ein
        oft neu startender Hub die Sicherungen nicht mit Kopien überflutet.
        """
        try:
            while True:
                age = self.data.last_backup_age()
                if age is None or age >= 86_400:
                    self.data.backup()
                await self._remind_due_tasks()
                await asyncio.sleep(86_400)
        except asyncio.CancelledError:
            raise

    async def _remind_due_tasks(self) -> None:
        """Schickt einmal am Tag eine Push für heute fällige Familien-Aufgaben.

        Ein Datums-Merker verhindert, dass ein oft neu startender Hub mehrmals
        am selben Tag erinnert. Ohne fällige Aufgaben passiert nichts.
        """
        today = time.strftime("%Y-%m-%d", time.localtime())
        marker = self.data.get("task_reminder")
        if marker and marker[0].get("date") == today:
            return
        self.data.set("task_reminder", [{"date": today}])
        due = [
            task
            for task in self.data.get("family_tasks")
            if not task.get("done") and task.get("due") and str(task["due"]) <= today
        ]
        if not due:
            return
        tokens = self.push.recipients(self.users.users, "all", "tasks")
        names = ", ".join(str(task.get("text", "?")) for task in due[:5])
        await self.push.send(
            tokens,
            title="Aufgaben heute fällig",
            body=f"{len(due)} offen: {names}",
            data={"type": "task_due"},
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

    async def set_entity_meta(
        self,
        entity_id: str,
        *,
        name: str | None = None,
        favorite: bool | None = None,
        group: str | None = None,
    ) -> None:
        """Setzt Anzeigename, Favorit-Flag oder Gruppe einer Entität.

        Nur die übergebenen Felder ändern sich; der Rest bleibt. Gespeichert
        wird in der homepilot-data.json und überlebt Neustarts.
        """
        current = dict(self._meta_by_entity.get(entity_id, {}))
        current.pop("entity_id", None)
        if name is not None:
            current["name"] = name.strip() or None
        if favorite is not None:
            current["favorite"] = bool(favorite)
        if group is not None:
            current["group"] = group.strip() or None
        # Leere Felder entfernen, damit der Eintrag nicht anwächst.
        cleaned = {k: v for k, v in current.items() if v}
        if cleaned:
            self._meta_by_entity[entity_id] = {"entity_id": entity_id, **cleaned}
        else:
            self._meta_by_entity.pop(entity_id, None)

        stored = [
            entry
            for entry in self.data.get("entity_meta")
            if entry.get("entity_id") != entity_id
        ]
        if cleaned:
            stored.append({"entity_id": entity_id, **cleaned})
        self.data.set("entity_meta", stored)

        await self.registry.set_meta(entity_id, cleaned)

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

    def _config_problems(self) -> list[str]:
        """Was in der config.yaml auffällt – einmal beim Start ins Log.

        Beides sind Fehler, die man sonst erst Wochen später bemerkt, weil
        nichts abstürzt: ein doppelt kopierter Geräteeintrag und eine
        Raumzuordnung, die auf ein längst umbenanntes Gerät zeigt.
        """
        known = {entity.id for entity in self.registry.all()}
        return [
            *config_edit.duplicate_devices(self.config.integrations),
            *config_edit.unused_rooms(self.config.rooms, known),
        ]

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
            entry = {"name": name, **info, **counts}
            # Manche Integrationen wissen mehr über ihren Zustand, als sich
            # von aussen ablesen lässt – etwa ob die CCU den Hub noch als
            # Event-Empfänger kennt. Wer will, sagt es über health().
            service = self.integrations.get(name)
            health = getattr(service, "health", None)
            if callable(health):
                try:
                    entry["health"] = health()
                except Exception:
                    log.exception("health() der Integration '%s' fehlgeschlagen", name)
            integrations.append(entry)

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
            # Welcher Stand hier läuft – nach einem Update die einzige Art
            # festzustellen, ob der Container wirklich der neue ist.
            "build": {
                "version": __version__,
                "commit": os.environ.get("HOMEPILOT_COMMIT", "unbekannt"),
                "built_at": os.environ.get("HOMEPILOT_BUILD_TIME", "unbekannt"),
            },
            "energy": self.config.energy,
            # Speicherplatz: läuft er voll, scheitert jedes Speichern.
            "disk": self.watchdog.disk,
            # Ausfall-Protokoll des Wächters (jüngste zuerst).
            "outages": self.watchdog.outages,
            "down": sorted(self.watchdog.down_since),
        }

    async def stop(self) -> None:
        log.info("Hub stoppt …")
        task = getattr(self, "_backup_task", None)
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self.streams.stop_all()
        await self.watchdog.stop()
        await self.automations.stop()
        await self.integrations.teardown_all()
        if self.store:
            await self.store.stop()
            self.store = None
        self.registry.state_provider = None
        self.registry.room_provider = None
        self.registry.meta_provider = None
