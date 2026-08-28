"""Der Hub verdrahtet Event-Bus, Registry, Store, Integrationen, Szenen,
Automationen, Benutzer und Benachrichtigungen.

Die Reihenfolge in ``start()`` ist keine Geschmacksfrage - jeder Schritt
setzt den vorigen voraus. Wer etwas dazwischenschiebt, sollte wissen,
warum es dort steht und nicht anderswo:

1. **Daten laden** (``data.load``). Alles Weitere liest daraus.
2. **Raumzuordnung** setzen, *bevor* die erste Entität entsteht. Die
   Registry fragt sie beim Anlegen ab; wer sie später setzt, hat Geräte
   ohne Raum, bis sie das nächste Mal melden.
3. **Metadaten** (Name, Favorit, Gruppe) - aus demselben Grund vorher.
4. **Store** (Supabase, freiwillig). Er darf fehlen; dann fehlt der
   Verlauf, sonst nichts.
5. **Benutzer** aus der Datei. Muss vor der API stehen, sonst käme die
   erste Anfrage an einem leeren Benutzerverzeichnis an.
6. **Integrationen** (``setup_all``). Erst hier entstehen Entitäten. Die
   Alarmanlage kommt dazu, auch wenn sie nirgends steht: Sie gehört zum
   Haus, nicht zu einer Geräteanbindung.
7. **Szenen**, dann **Abläufe**. Abläufe verweisen auf Szenen und auf
   Entitäten - beide müssen vorher da sein, sonst zeigt ein frisch
   gestarteter Ablauf auf nichts.
8. **Wächter** und **Sicherungsschleife**. Zuletzt, weil sie beide auf
   den fertigen Zustand schauen: Ein Wächter, der während des Aufbaus
   losläuft, meldet lauter Geräte als vermisst, die es gleich gibt.
9. **Push** wiederherstellen. Ohne das wäre nach jedem Neustart niemand
   erreichbar, bis alle ihre App einmal geöffnet haben.

``stop()`` läuft sinngemäss rückwärts.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from .. import __version__
from . import (
    config_edit,
    erinnerungen,
    liveaktivitaet,
    livekarten,
    metrics,
    persistence,
    pushverlauf,
)
from . import push as push_service
from . import users as users_module
from .audit import AuditLog
from .automation import AutomationEngine
from .config import HubConfig
from .eventlog import EventLog
from .events import EventBus
from .guestpass import PassStore
from .integration import IntegrationManager
from .kurzverlauf import Kurzverlauf
from .lautplan import Lautplan
from .logbuffer import install as install_log_buffer
from .musik import Musikbuch
from .persistence import DataStore
from .push import PushService
from .registry import EntityRegistry
from .scenes import SceneManager
from .sessions import SessionStore
from .snapshots import SnapshotStore
from .store import Store
from .streams import MEDIAMTX_API, MEDIAMTX_HLS, StreamManager
from .supabase import SupabaseClient
from .timers import KitchenTimers
from .ton import Tonmeister
from .users import Role, User, parse_users
from .watchdog import Watchdog

log = logging.getLogger(__name__)

# «Nicht übergeben» - damit None als echter Wert («entfernen») frei bleibt.
UNSET: Any = object()


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
        # Wer hat wann was geschaltet - überlebt den Neustart, anders als
        # die flüchtige Liste «Zuletzt passiert» in der App.
        self.audit = AuditLog(self)
        # Ereignisprotokoll je Gerät (jeder Zustandswechsel samt Quelle,
        # auch von Abläufen und der Simulation) - siehe eventlog.py.
        # Es liegt neben der Datendatei und überlebt damit den Neustart:
        # Ohne das war der Verlauf nach jedem Update leer - also genau
        # dann, wenn man ihn braucht, weil sich etwas geändert hat.
        self.eventlog = EventLog(self._eventlog_path())
        self.bus.subscribe("state_changed", self.eventlog.record)
        # Die letzten Stunden je Messwert, nur im Speicher - für die
        # Funkenlinie auf der Sensor-Kachel (core/kurzverlauf.py).
        self.kurzverlauf = Kurzverlauf()
        self.bus.subscribe("state_changed", self.kurzverlauf.record)
        # Einmal-Links für die Türe – nur im Speicher, siehe guestpass.py.
        self.passes = PassStore()
        # Küchen-Timer (siehe timers.py) - nur im Speicher.
        self.timers = KitchenTimers(self)
        # Stand der Off-Site-Sicherung nach Supabase, für den System-Screen.
        self.offsite: dict[str, Any] | None = None
        self.users = parse_users(config.users, config.api.token)
        # In der App angelegte Benutzer und Automationen liegen neben der
        # Konfiguration, damit sie ohne Datenbank einen Neustart überleben.
        self.data = DataStore(config.data_file)
        # Was der Hub tut, mitzählen - siehe core/metrics.py.
        self.counters = metrics.Counters()
        # Sitzungen aus der Anmeldung mit E-Mail und Passwort. Sie liegen
        # lokal, damit der Hub ohne Internet weiterarbeitet - erst nach
        # dem DataStore, weil sie dort hineinschreiben.
        self.sessions = SessionStore(self.data)
        self.store: Store | None = None
        self.watchdog = Watchdog(self)
        # Lautstärke-Fragen an einem Ort: einblenden, beim Klingeln
        # dämpfen, nachts deckeln, Wiedergabe umziehen.
        self.ton = Tonmeister(self)
        # Was die Musik sich merkt: Favoriten, was zuletzt lief,
        # Schlummer-Timer und Musikwecker.
        self.musik = Musikbuch(self)
        # Lautstärke nach Tageszeit - der Plan, der vier gleichartige
        # Abläufe ersetzt (core/lautplan.py).
        self.lautplan = Lautplan(self)
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
        # Die Meldungen von vor dem Neustart zurück in den Ring – die
        # Frage «warum hat er neu gestartet?» stellt man genau jetzt.
        ring_pfad = self._log_ring_path()
        if ring_pfad:
            zurueck = self.log_buffer.load(ring_pfad)
            if zurueck:
                log.info("%d Meldungen aus dem vorigen Lauf übernommen", zurueck)
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
        self.ton.start()
        self.musik.start()
        self.lautplan.start()
        self._backup_task = asyncio.create_task(self._backup_loop())
        # Gesammelte Schreibvorgänge nachholen: Der DataStore schreibt bei
        # einem Schwall nur den ersten sofort (siehe persistence.FLUSH_DELAY);
        # dieser Takt bringt den Rest zeitnah auf die Platte.
        self._flush_task = asyncio.create_task(self._flush_loop())
        # Erinnerungen mit Push: Die Bildschirme rechnen ihre Fälligkeit
        # selbst, aber ein Push muss auch kommen, wenn keine App offen
        # ist - dafür schaut dieser Takt auf die Liste.
        self._erinnerungs_task = asyncio.create_task(erinnerungen.push_loop(self))
        # Haustür-Karte auf dem iPhone-Sperrbildschirm, solange man weg
        # ist. Ohne apns-Block in der config.yaml beendet sich der Takt
        # von selbst (core/liveaktivitaet.py).
        self._live_task = asyncio.create_task(liveaktivitaet.tuer_loop(self))
        # Die übrigen Karten (Timer, Geräte, Grill, Sauger, Erinnerungen,
        # Alarm) - gleiche Bedingung, gleicher Draht (livekarten.py).
        self._karten_task = asyncio.create_task(livekarten.karten_loop(self))

        if self.users.open_access:
            log.warning(
                "Kein Token und keine Benutzer konfiguriert – die API ist offen. "
                "Nur im eigenen Netz vertretbar."
            )
        # Die alte Sammelkategorie «Nachricht aus einem Ablauf» gibt es
        # nicht mehr; jeder meldende Ablauf hat seinen eigenen Schalter.
        # Wer sie abbestellt hatte, meinte alle - also wird daraus die
        # Liste der einzelnen. Sichtbar und einzeln wieder einschaltbar;
        # stillschweigend wieder alles zu schicken wäre die schlechtere
        # Richtung.
        gewandelt = push_service.migrate_muted(
            self.data.get("push_prefs"),
            [
                zeile["key"]
                for zeile in push_service.automation_categories(
                    self.automations.automations
                )
            ],
        )
        if gewandelt is not None:
            self.data.set("push_prefs", gewandelt)
            log.info("Push-Einstellungen: «Nachricht aus einem Ablauf» aufgeteilt")
        self.push.muted = push_service.parse_muted(self.data.get("push_prefs"))
        # Angemeldete Telefone zurückholen und künftige Änderungen sichern.
        # Ohne das wäre nach jedem Neustart niemand erreichbar, bis alle
        # ihre App wieder geöffnet haben - und ausgerechnet nach einem
        # Update will man Nachrichten am wenigsten missen.
        self.push.restore(self.data.get("push_devices"))
        self.push.on_change = lambda rows: self.data.set("push_devices", rows)
        # Jede verschickte Meldung auf den Nachlese-Zettel - eine
        # weggewischte Mitteilung ist sonst unauffindbar (pushverlauf.py).
        self.push.on_sent = lambda eintrag: self.data.set(
            pushverlauf.STORE_KEY,
            pushverlauf.anhaengen(
                self.data.get(pushverlauf.STORE_KEY), eintrag, time.time()
            ),
        )
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

    async def _flush_loop(self) -> None:
        """Vorgemerkte Schreibvorgänge des DataStore auf die Platte bringen.

        Der Takt entspricht der Sammelzeit: Länger warten hiesse bei einem
        harten Absturz mehr verlieren, kürzer brächte nichts, weil der
        DataStore ohnehin erst nach der Sammelzeit wieder schreibt.
        """
        try:
            while True:
                await asyncio.sleep(persistence.FLUSH_DELAY)
                self.data.flush()
                # Derselbe Takt, andere Drosselung: Der Verlauf sichert
                # sich höchstens alle paar Minuten (siehe eventlog.py).
                self.eventlog.save()
        except asyncio.CancelledError:
            raise

    async def _backup_loop(self) -> None:
        """Sichert die App-Daten täglich – beim Start sofort, sonst alle 24 h.

        Nur, wenn seit der letzten Sicherung ein Tag vergangen ist, damit ein
        oft neu startender Hub die Sicherungen nicht mit Kopien überflutet.
        """
        try:
            while True:
                age = self.data.last_backup_age()
                if age is None or age >= 86_400:
                    made = self.data.backup()
                    if made:
                        await self._offsite_backup(made["name"])
                await self._remind_due_tasks()
                await asyncio.sleep(86_400)
        except asyncio.CancelledError:
            raise

    async def _offsite_backup(self, name: str) -> None:
        """Die frische Sicherung zusätzlich in den Supabase-Bucket legen.

        Lokale Sicherungen liegen auf derselben Platte wie das Original -
        gegen einen Plattenschaden hilft nur die Kopie woanders. Jeder
        Fehler landet im Status (System → Sicherung), nie im Weg der
        lokalen Sicherung.
        """
        supabase = self.config.supabase or {}
        bucket = str(supabase.get("backup_bucket", "backups") or "")
        url, key = supabase.get("url"), supabase.get("service_key")
        if not (bucket and url and key):
            return
        from . import offsite

        try:
            payload = self.data.backup_bytes(name)
            await offsite.upload(str(url), str(key), bucket, name, payload)
            await offsite.prune(str(url), str(key), bucket)
            # Die Matter-Fabrik dazu: Ohne sie müsste nach einem
            # Plattenschaden jedes Matter-Gerät neu gekoppelt werden.
            matter = offsite.matter_tar(self._matter_dir())
            if matter is not None:
                heute = datetime.now().strftime("%Y-%m-%d")
                await offsite.upload(
                    str(url), str(key), bucket, f"matter-fabrik-{heute}.tar.gz", matter
                )
                await offsite.prune_prefix(
                    str(url), str(key), bucket, "matter-fabrik-", offsite.MATTER_KEEP
                )
            self.offsite = {"ok": True, "at": time.time(), "name": name, "error": None}
        except Exception as err:
            self.offsite = {"ok": False, "at": time.time(), "name": name, "error": str(err)}
            log.warning("Off-Site-Sicherung fehlgeschlagen: %s", err)

    def _matter_dir(self) -> str:
        """Wo die Matter-Fabrik liegt: neben der config.yaml, wie in der
        Anleitung – ohne Konfigurationspfad gibt es auch keine Fabrik."""
        if not self.config.source_path:
            return ""
        return str(Path(self.config.source_path).parent / "matter")

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
            data={"type": "task_due", "ziel": "familie:tasks"},
            category="tasks",
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
                        simple_rooms=entry.get("simple_rooms") or [],
                        # Ohne diese beiden verlor ein in der App angelegter
                        # Gast sein Ablaufdatum und Zeitfenster beim ersten
                        # Neustart - still, und genau dann, wenn man sich
                        # darauf verliess.
                        expires=str(entry["expires"]) if entry.get("expires") else None,
                        hours=users_module.parse_hours(entry.get("hours")),
                        # Dasselbe für das Wandtablet: Ohne diese beiden
                        # war es nach einem Neustart wieder eine Person -
                        # mit Begrüssung, ohne PIN-Zwang und mit offenen
                        # persönlichen Bereichen.
                        shared=bool(entry.get("shared")),
                        area_lock=dict(entry.get("area_lock") or {}),
                    )
                )
            except Exception as err:
                log.warning("Gespeicherter Benutzer übersprungen: %s", err)
        # Anmelde-Adressen: getrennt gespeichert, damit auch Benutzer aus
        # der config.yaml eine bekommen können, ohne die Datei anzufassen.
        #
        # Abgelegt sind sie nach Namen, und genau daran ging schon einmal
        # ein Zugang verloren: Wer sich in der config.yaml umbenennt
        # («Stefan» zu «stibe»), dessen Adresse zeigt danach auf einen
        # Benutzer, den es nicht mehr gibt. Die Anmeldung sagt dann nur
        # «Diese Adresse ist im Haus nicht freigegeben» - und das ist beim
        # eigenen Besitzer eine rätselhafte Auskunft. Darum bleibt die
        # verwaiste Zeile im Protokoll stehen, mit dem Weg zurück.
        for entry in self.data.get("emails"):
            name = str(entry.get("name") or "")
            adresse = str(entry.get("email") or "").strip().lower() or None
            user = self.users.by_name(name)
            if user is not None:
                user.email = adresse
            elif adresse:
                log.warning(
                    "Anmelde-Adresse %s gehört zu '%s' - diesen Benutzer gibt es "
                    "nicht mehr. Nach einer Umbenennung neu eintragen: "
                    "PUT /api/users/<neuer Name>/email",
                    adresse,
                    name,
                )
        # Ab jetzt jede Änderung mitschreiben.
        self.users.on_change = lambda users: self.data.set("users", users)
        self.users.on_email_change = lambda rows: self.data.set("emails", rows)
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
        name: Any = UNSET,
        favorite: Any = UNSET,
        group: Any = UNSET,
    ) -> None:
        """Setzt Anzeigename, Favorit-Flag oder Gruppe einer Entität.

        Nur die übergebenen Felder ändern sich; der Rest bleibt. UNSET statt
        None als Vorgabe, weil None hier eine Bedeutung hat: «Keine Gruppe»
        kommt aus der App als group=null - das muss die Gruppe entfernen,
        nicht stillschweigend nichts tun. Gespeichert wird in der
        homepilot-data.json und überlebt Neustarts.
        """
        current = dict(self._meta_by_entity.get(entity_id, {}))
        current.pop("entity_id", None)
        if name is not UNSET:
            current["name"] = (name or "").strip() or None
        if favorite is not UNSET:
            current["favorite"] = bool(favorite)
        if group is not UNSET:
            current["group"] = (group or "").strip() or None
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

        Alles Fehler, die man sonst erst Wochen später bemerkt, weil
        nichts abstürzt: ein doppelt kopierter Geräteeintrag, eine
        Raumzuordnung auf ein längst umbenanntes Gerät – und ein doppelt
        vergebener Schlüssel, von dem YAML wortlos den letzten nimmt.
        """
        known = {entity.id for entity in self.registry.all()}
        return [
            *(
                f"'{key}' steht mehrfach in der config.yaml – YAML nimmt "
                "den letzten Eintrag, der erste ist wirkungslos."
                for key in self.config.duplicate_keys
            ),
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
            # Was der Hub über sich selbst weiss. Bisher stand hier nur der
            # Plattenplatz; ein wachsender Speicherverbrauch fiel deshalb
            # erst auf, wenn der Rechner stand.
            "runtime": {
                **metrics.process_stats(),
                "counters": self.counters.as_dict(),
                "commands_per_hour": self.counters.pro_stunde("commands"),
            },
            # Speicherplatz: läuft er voll, scheitert jedes Speichern.
            "disk": self.watchdog.disk,
            # Ausfall-Protokoll des Wächters (jüngste zuerst).
            "outages": self.watchdog.outages,
            "down": sorted(self.watchdog.down_since),
        }

    def _eventlog_path(self) -> str | None:
        """Wo der Geräte-Verlauf liegt: neben der Datendatei.

        Eine eigene Datei und nicht die Datendatei selbst: Zweitausend
        Einträge sind ein paar hundert Kilobyte, und die Datendatei wird
        bei jeder Kleinigkeit neu geschrieben.
        """
        if not self.config.data_file:
            return None
        return str(Path(self.config.data_file).parent / "geraete-verlauf.json")

    def _log_ring_path(self) -> str | None:
        """Wo der Log-Ring den Neustart überdauert: neben der Datendatei.
        Ohne Datendatei (Tests, Demo im Speicher) auch keine Übergabe."""
        if not self.config.data_file:
            return None
        return str(Path(self.config.data_file).parent / "log-uebergabe.json")

    async def stop(self) -> None:
        log.info("Hub stoppt …")
        # Den Ring einmal weglegen – ein Schreibvorgang je Neustart, und
        # die Antwort auf «warum hat er neu gestartet?» übersteht ihn.
        ring_pfad = self._log_ring_path()
        if ring_pfad:
            self.log_buffer.save(ring_pfad)
        for name in ("_backup_task", "_flush_task", "_erinnerungs_task", "_live_task", "_karten_task"):
            task = getattr(self, name, None)
            if task is not None:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        await self.streams.stop_all()
        await self.watchdog.stop()
        await self.timers.stop()
        await self.musik.stop()
        await self.lautplan.stop()
        await self.automations.stop()
        await self.integrations.teardown_all()
        if self.store:
            await self.store.stop()
            self.store = None
        # Und der Verlauf: Hier ohne Drosselung, denn ein zweiter
        # Versuch kommt nicht.
        self.eventlog.save(force=True)
        # Was der DataStore noch gesammelt hat, muss vor dem Ende auf die
        # Platte - der Takt dafür ist oben schon beendet.
        self.data.flush()
        self.registry.state_provider = None
        self.registry.room_provider = None
        self.registry.meta_provider = None
