"""Alarmanlage: Sensoren überwachen, je nach Modus scharf schalten.

Die Anlage läuft im Hub, nicht in der App – sonst wäre sie unscharf,
sobald jemand sein Telefon weglegt. Die App ist nur Bedienteil.

Drei scharfe Modi, weil sie unterschiedliche Sensoren brauchen:

  - ``nacht``       – man ist zuhause und schläft: Türen und Fenster ja,
                      Bewegungsmelder im Schlafzimmer nein.
  - ``ausser_haus`` – niemand da: alles überwachen.
  - ``urlaub``      – wie ausser Haus, aber ohne Karenz für Bewohner und
                      mit eigener Sensorauswahl (z.B. auch Innenräume).

Je Sensor wird eingestellt, in welchen Modi er wacht. Ein Sensor kann
zusätzlich als *verzögert* markiert werden: Die Haustür soll nicht sofort
Alarm auslösen, sondern die Eingangsverzögerung starten, damit man
unscharf schalten kann. Alles andere löst sofort aus.

Zustände der Anlage:

  ``unscharf`` → ``scharfschaltend`` (Ausgangsverzögerung) → ``scharf``
  ``scharf`` → ``eintritt`` (Eingangsverzögerung) → ``ausgeloest``
  jederzeit zurück auf ``unscharf``

Was *nach* einem Alarm passiert, wird je Modus eingestellt, weil die
Antwort davon abhängt, ob jemand zuhause ist: ausgelöst bleiben bis
jemand hinschaut (``stay``), sich abschalten (``disarm``) oder nach einer
Wartezeit von selbst wieder scharf werden (``rearm``).

Beim Auslösen geht eine Push-Nachricht an alle Bewohner. Zusätzlich
schaltet die Anlage selbst, was unter ``actions`` eingestellt ist – Sirene,
Licht, Storen. Das gehört hierher und nicht in einen Ablauf: Eine
Alarmanlage, die nur eine Nachricht schickt, informiert bloss; erst Lärm
und Licht vertreiben jemanden. Drei Anlässe:

  ``trigger``  beim Auslösen
  ``warning``  beim Beginn der Eingangsverzögerung (kurzes Zeichen)
  ``clear``    beim Unscharfschalten – sonst heult die Sirene weiter
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from typing import Any

from ..core import snapshots, streams
from ..core.entity import Entity, EntityKind
from ..core.errors import HomePilotError
from ..core.integration import Integration
from ..core.throttle import Throttle

# Die reine Logik wohnt in alarm_rules.py; die Namen bleiben von hier
# importierbar - Server und Tests beziehen sie seit je aus alarm.
from .alarm_rules import (  # noqa: F401
    ACTION_SLOTS,
    AFTER_ACTIONS,
    ARMED,
    ARMING,
    DEFAULT_AFTER,
    DEFAULT_SETTINGS,
    DISARM,
    DISARMED,
    ENTRY,
    MODE_LABELS,
    MODES,
    REARM,
    STAY,
    TEST_SIREN_SECONDS,
    TRIGGERED,
    camera_for,
    camera_motion_due,
    guards,
    hash_pin,
    is_sensor,
    motion_started,
    nearest_camera,
    parse_actions,
    parse_after,
    parse_sensors,
    sensor_open,
    valid_pin,
)

log = logging.getLogger(__name__)

# So lange darf ein Standbild die Alarm-Nachricht aufhalten – siehe die
# gleichnamige Konstante in core/automation.py. Bewusst dieselbe kurze
# Frist: Eine Kamera, die nicht antwortet, ist kein Grund, den Alarm
# später zu melden.
BILD_WARTEZEIT = 4.0


class AlarmIntegration(Integration):
    name = "alarm"

    async def setup(self) -> None:
        self._unsubscribe = None
        self._timer: asyncio.Task | None = None
        self._state = DISARMED
        self._mode: str | None = None
        # Fünf PIN-Fehlversuche in fünf Minuten, dann fünf Minuten Pause.
        self._pin_throttle = Throttle(limit=5, window=300.0, block=300.0)
        # Zeitpunkt, an dem die laufende Verzögerung abläuft.
        self._until: float | None = None
        # Was am Ende dieser Verzögerung passiert – die App beschriftet den
        # Countdown damit, sonst stünde bei jeder Wartezeit dasselbe da.
        self._next: str | None = None
        self._last: dict[str, Any] | None = None
        self._clip_task: asyncio.Task | None = None
        # Je Kamera, wann zuletzt eine Bewegungs-Nachricht rausging. Eine
        # Kamera meldet Bewegung im Sekundentakt, solange sich etwas regt;
        # ohne Abstand wäre das Telefon nach einer Minute unbenutzbar.
        self._motion_seen: dict[str, float] = {}

        stored = self.hub.data.get("alarm")
        config = stored[0] if stored else {}
        self._sensors = parse_sensors(config.get("sensors"))
        self._settings = {**DEFAULT_SETTINGS, **(config.get("settings") or {})}
        self._after_trigger = parse_after(config.get("after_trigger"))
        self._actions = parse_actions(config.get("actions"))
        self._history: list[dict[str, Any]] = list(config.get("history") or [])

        self._entity = await self.add_entity(
            "anlage",
            EntityKind.ALARM,
            self.config.get("name", "Alarmanlage"),
            state=self._state_dict(),
            commands=[
                "disarm",
                "arm_night",
                "arm_away",
                "arm_vacation",
                # Damit die Anlage auch dort schaltbar ist, wo nur ein
                # einfacher Ein/Aus-Knopf sitzt (Startseite, Szenen).
                "turn_on",
                "turn_off",
                "toggle",
            ],
        )
        self._unsubscribe = self.hub.bus.subscribe("state_changed", self._on_state_changed)

    async def teardown(self) -> None:
        if self._clip_task is not None:
            self._clip_task.cancel()
            self._clip_task = None
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None
        self._cancel_timer()
        await super().teardown()

    # ── Zustand ────────────────────────────────────────────────────────────

    def _state_dict(self) -> dict[str, Any]:
        return {
            "state": self._state,
            "mode": self._mode,
            "mode_label": MODE_LABELS.get(self._mode or "", ""),
            # Wie lange die laufende Verzögerung noch dauert – die App
            # zeigt daraus den Countdown.
            "seconds_left": (
                max(0, round(self._until - time.time())) if self._until else None
            ),
            "next_action": self._next,
            "last_trigger": self._last,
            # Die App zeigt daraus das PIN-Feld vor dem Entschärfen.
            "pin_required": self.pin_required(),
        }

    async def _publish(self) -> None:
        await self.hub.registry.update_state(
            self._entity.id, self._state_dict(), available=True
        )

    def _cancel_timer(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    # ── Sensoren ───────────────────────────────────────────────────────────

    def candidates(self) -> list[Entity]:
        """Alle Entitäten, die sich als Sensor eignen."""
        return [entity for entity in self.hub.registry.all() if is_sensor(entity)]

    def guarding(self, mode: str) -> list[Entity]:
        """Alle Sensoren, die in diesem Modus wachen."""
        return [
            entity
            for entity in self.candidates()
            if guards(self._sensors, entity.id, mode)
        ]

    def open_sensors(self, mode: str) -> list[Entity]:
        """Sensoren, die in diesem Modus wachen und gerade offen sind.

        Grundlage der Bereitschaftsprüfung: Scharfschalten mit offenem
        Fenster wäre ein Alarm in dem Moment, in dem die Verzögerung endet.
        """
        return [entity for entity in self.guarding(mode) if sensor_open(entity)]

    def blind_sensors(self, mode: str) -> dict[str, list[str]]:
        """Sensoren, auf die in diesem Modus kein Verlass ist.

        Ein offenes Fenster sieht man; einen Sensor mit leerer Batterie
        nicht. Beides muss vor dem Scharfschalten auf den Tisch – sonst
        schaltet man scharf und hat einen blinden Fleck, von dem man nichts
        weiss.
        """
        offline: list[str] = []
        battery: list[str] = []
        for entity in self.guarding(mode):
            if not entity.available:
                offline.append(entity.name)
            elif entity.state.get("low_battery") is True:
                battery.append(entity.name)
        return {"offline": offline, "battery": battery}

    # ── Bedienung ──────────────────────────────────────────────────────────

    async def arm(self, mode: str, force: bool = False, by: str = "") -> dict[str, Any]:
        """Scharf schalten. Gibt zurück, was daraus geworden ist."""
        if mode not in MODES:
            raise HomePilotError(f"Unbekannter Alarm-Modus: {mode}")
        open_now = self.open_sensors(mode)
        blind = self.blind_sensors(mode)
        if (open_now or blind["offline"] or blind["battery"]) and not force:
            # Nicht einfach trotzdem scharf schalten: Der Benutzer soll
            # entscheiden, ob er das Fenster schliesst oder überbrückt – und
            # von einem stummen Sensor überhaupt erst erfahren.
            return {
                "ok": False,
                "reason": "offen" if open_now else "blind",
                "open": [entity.name for entity in open_now],
                **blind,
            }

        self._cancel_timer()
        self._mode = mode
        delay = float(self._settings.get("exit_delay") or 0)
        if delay > 0:
            self._state = ARMING
            self._until = time.time() + delay
            self._next = "arm"
            self._timer = asyncio.create_task(self._after(delay, self._finish_arming))
        else:
            self._state = ARMED
            self._until = None
            self._next = None
        await self._publish()
        self._note("armed", f"{MODE_LABELS[mode]} scharf geschaltet", by)
        if self._settings.get("notify_arming"):
            await self._notify(
                "Alarmanlage scharf", f"Modus {MODE_LABELS[mode]}", "alarm_arming"
            )
        return {"ok": True, "state": self._state}

    # ── PIN fürs Entschärfen ───────────────────────────────────────────────
    # Die Anlage lässt sich aus der App entschärfen, sobald das Telefon
    # entsperrt ist. Eine kurze PIN nur für diesen einen Vorgang schützt,
    # falls das Telefon offen herumliegt. Bewusst überall durchgesetzt
    # (auch Szenen und Abläufe): Eine Hintertür, die der PIN ausweicht,
    # wäre keine PIN.

    def _pin_entry(self) -> dict[str, Any] | None:
        for entry in self.hub.data.get("alarm_pin"):
            if isinstance(entry, dict) and entry.get("hash"):
                return entry
        return None

    def pin_required(self) -> bool:
        return self._pin_entry() is not None

    def set_pin(self, pin: str | None) -> None:
        """PIN setzen oder (mit leerem Wert) entfernen - nur Besitzer."""
        if not pin:
            self.hub.data.set("alarm_pin", [])
            return
        if not pin.isdigit() or not (4 <= len(pin) <= 8):
            raise HomePilotError("Die PIN muss aus 4 bis 8 Ziffern bestehen.")
        salt = secrets.token_hex(8)
        self.hub.data.set("alarm_pin", [{"salt": salt, "hash": hash_pin(pin, salt)}])

    def check_pin(
        self, pin: str | None, address: str = "app", require_pin: bool = False
    ) -> None:
        """Wirft einen lesbaren Fehler, wenn die PIN fehlt oder falsch ist.

        Mit Drossel: Fünf Fehlversuche, dann fünf Minuten Pause - eine
        vierstellige PIN ohne Drossel wäre in Minuten durchprobiert.

        ``require_pin`` gilt für Geräte, die allen gehören - das Wandtablet
        im Flur. Dort steht die App immer offen; ohne PIN entschärft die
        Anlage, wer immer vorbeigeht. Ist keine gesetzt, wird nicht etwa
        durchgewinkt, sondern abgelehnt: Ein Wandtablet ohne PIN ist
        genau der Fall, den die PIN verhindern soll.
        """
        entry = self._pin_entry()
        if entry is None:
            if require_pin:
                raise HomePilotError(
                    "An diesem Gerät braucht das Entschärfen eine PIN. Sie "
                    "wird unter Alarm → PIN gesetzt."
                )
            return
        wait = self._pin_throttle.blocked_for(address)
        if wait > 0:
            raise HomePilotError(
                f"Zu viele Fehlversuche - gesperrt für {round(wait)} Sekunden."
            )
        if not pin:
            raise HomePilotError("Zum Entschärfen braucht es die PIN.")
        if not valid_pin(entry, str(pin)):
            self._pin_throttle.failed(address)
            raise HomePilotError("Falsche PIN.")
        self._pin_throttle.succeeded(address)

    async def disarm(
        self,
        by: str = "",
        pin: str | None = None,
        address: str = "app",
        require_pin: bool = False,
    ) -> dict[str, Any]:
        self.check_pin(pin, address, require_pin)
        self._cancel_timer()
        was = self._state
        self._state = DISARMED
        self._mode = None
        self._until = None
        self._next = None
        await self._publish()
        self._note("disarmed", "Unscharf geschaltet", by)
        # Sirene aus, Licht zurück – sonst heult sie weiter, obwohl die
        # Anlage aus ist.
        await self._run_actions("clear")
        if self._settings.get("notify_arming") and was != DISARMED:
            await self._notify(
                "Alarmanlage unscharf", "Die Anlage ist aus.", "alarm_arming"
            )
        return {"ok": True, "state": self._state}

    async def _finish_arming(self) -> None:
        self._state = ARMED
        self._until = None
        self._next = None
        await self._publish()

    async def _after(self, delay: float, action: Any) -> None:
        try:
            await asyncio.sleep(delay)
            await action()
        except asyncio.CancelledError:
            raise

    # ── Überwachung ────────────────────────────────────────────────────────

    async def _on_state_changed(self, _event_type: str, payload: dict[str, Any]) -> None:
        if self._state not in (ARMED, ARMING):
            return
        entity_id = payload.get("entity_id")
        entity = self.hub.registry.get(str(entity_id))
        if entity is None or self._mode is None:
            return
        await self._camera_motion(entity, payload)
        if not guards(self._sensors, entity.id, self._mode):
            return
        if not sensor_open(entity):
            return
        # Während der Ausgangsverzögerung darf man selbst noch durch die Tür.
        if self._state == ARMING:
            return

        entry = self._sensors.get(entity.id) or {}
        delay = float(self._settings.get("entry_delay") or 0)
        if entry.get("delayed") and delay > 0:
            self._cancel_timer()
            self._state = ENTRY
            self._until = time.time() + delay
            self._next = "trigger"
            self._timer = asyncio.create_task(
                self._after(delay, lambda: self._trigger(entity))
            )
            await self._publish()
            self._note("entry", f"{entity.name} geöffnet – Eingangsverzögerung läuft", "")
            # Die Verzögerung lief bisher stumm ab. Ein kurzes Zeichen sagt
            # dem Berechtigten «schalt mich ab» – und dem Unberechtigten,
            # dass die Uhr läuft. Beides ist besser als Stille.
            await self._run_actions("warning")
            if self._settings.get("notify_entry"):
                await self._notify(
                    "Eingangsverzögerung läuft",
                    f"{entity.name} geöffnet – noch {round(delay)} Sekunden zum "
                    "Unscharfschalten.",
                    "alarm_arming",
                )
            return

        await self._trigger(entity)

    async def _camera_motion(self, entity: Entity, payload: dict[str, Any]) -> None:
        """Kamera sieht Bewegung, während scharf ist: Bild aufs Telefon.

        Bisher gab es diese Nachricht nur, wenn die Kamera als Alarmsensor
        zugeordnet war – und dann gleich mit Sirene. Wer die Anlage nicht
        von einer vorbeilaufenden Katze auslösen lassen will, ordnet die
        Kamera aber gerade *nicht* zu und erfuhr damit gar nichts. Jetzt
        kommt das Bild, ohne dass etwas losgeht.

        Die Nachricht trägt die Kamera mit: Ein Tipp darauf öffnet sie in
        der App, statt dass man nachts erst durch die Räume sucht.
        """
        if entity.kind != EntityKind.CAMERA or self._state != ARMED:
            return
        if not self._settings.get("notify_camera_motion", True):
            return
        if not motion_started(payload.get("old_state"), payload.get("new_state")):
            return
        # Löst diese Kamera ohnehin den Alarm aus, kommt gleich die
        # Alarm-Nachricht – zwei Meldungen zum selben Ereignis sind eine
        # zu viel, und die mit der Sirene ist die wichtigere.
        if self._mode and guards(self._sensors, entity.id, self._mode):
            return
        jetzt = time.time()
        if not camera_motion_due(self._motion_seen, entity.id, jetzt):
            return
        self._motion_seen[entity.id] = jetzt
        self._note("motion", f"Bewegung vor {entity.name}", "")
        await self._notify(
            "Bewegung vor der Kamera",
            f"{entity.name} sieht Bewegung – die Anlage ist scharf.",
            category="camera_motion",
            data={
                "type": "camera_motion",
                "entity_id": entity.id,
                "camera": entity.id,
            },
            image=await self._snapshot_url(entity.id),
        )

    async def _trigger(self, entity: Entity) -> None:
        self._cancel_timer()
        mode = self._mode
        self._state = TRIGGERED
        self._until = None
        self._next = None
        self._last = {
            "entity_id": entity.id,
            "name": entity.name,
            "at": time.time(),
            "mode": mode,
        }
        await self._publish()
        self._note("triggered", f"Alarm ausgelöst: {entity.name}", "")

        if self._settings.get("notify_trigger"):
            # Die Kamera im selben Raum kommt zweimal mit: als Kennung,
            # damit die App sie beim Antippen mit dem Token des Benutzers
            # öffnet, und als Bild in der Nachricht selbst – sofern eine von
            # aussen erreichbare Adresse konfiguriert ist. Was dieses Bild
            # kostet, steht in core/snapshots.py.
            camera = camera_for(entity, self.hub.registry.all())
            await self._notify(
                "🚨 Alarm ausgelöst",
                f"{entity.name} – Modus {MODE_LABELS.get(mode or '', '?')}",
                data={"entity_id": entity.id, "camera": camera},
                image=await self._snapshot_url(camera),
            )

        # Erst melden, dann schalten: Eine Sirene, die hängt, darf die
        # Nachricht nicht aufhalten.
        await self._run_actions("trigger")

        # Der Mitschnitt läuft nebenher. In der Nachricht selbst kann er
        # nicht stehen – ein Banner zeigt nur Standbilder, und acht Sekunden
        # auf ein Video zu warten wäre bei einem Alarm die falsche Reihen-
        # folge. Er landet stattdessen beim letzten Auslösen, wo die App ihn
        # zeigt, sobald er da ist.
        self._start_clip(camera_for(entity, self.hub.registry.all()))

        await self._apply_after(mode)

    async def _apply_after(self, mode: str | None) -> None:
        """Das Nachverhalten des Modus ausführen.

        Erst melden, dann handeln – in dieser Reihenfolge, damit die
        Push-Nachricht auch dann draussen ist, wenn die Anlage sich gleich
        darauf selbst abschaltet.
        """
        plan = self._after_trigger.get(mode or "", DEFAULT_AFTER)
        action = plan.get("action")
        if action == DISARM:
            await self.disarm(by="automatisch")
            return
        if action != REARM:
            # STAY: ausgelöst bleiben, bis jemand von Hand unscharf schaltet.
            return
        seconds = float(plan.get("after") or DEFAULT_AFTER["after"])
        self._until = time.time() + seconds
        self._next = "rearm"
        self._timer = asyncio.create_task(self._after(seconds, self._rearm))
        await self._publish()

    async def _rearm(self) -> None:
        """Nach dem Alarm wieder scharf, im selben Modus.

        Ohne Ausgangsverzögerung und ohne Bereitschaftsprüfung: Es geht ja
        niemand hinaus, und ein Einbruch lässt die Tür offen stehen – würde
        die Anlage sich deswegen weigern, bliebe das Haus ungeschützt. Was
        noch offen ist, steht stattdessen im Verlauf.
        """
        mode = self._mode
        if mode is None:
            return
        self._state = ARMED
        self._until = None
        self._next = None
        await self._publish()
        still_open = [entity.name for entity in self.open_sensors(mode)]
        text = f"Wieder scharf geschaltet ({MODE_LABELS[mode]})"
        if still_open:
            text += " – noch offen: " + ", ".join(still_open)
        self._note("armed", text, "automatisch")
        if self._settings.get("notify_arming"):
            await self._notify("Alarmanlage wieder scharf", text, "alarm_arming")

    def _start_clip(self, camera: str | None) -> None:
        seconds = int(self._settings.get("clip_seconds") or 0)
        if not camera or seconds <= 0:
            return
        # Einzeln verwaltet statt über start_task(): Dessen Liste wird nie
        # geleert, und bei jedem Alarm käme ein Eintrag dazu.
        if self._clip_task and not self._clip_task.done():
            self._clip_task.cancel()
        self._clip_task = asyncio.create_task(self._record_clip(camera, seconds))

    async def _record_clip(self, camera: str, seconds: int) -> None:
        """Ein paar Sekunden mitschneiden und beim letzten Auslösen ablegen.

        Alles hier ist Zugabe: Fehlt ffmpeg oder liefert die Kamera kein
        RTSP, bleibt es beim Standbild. Ein Alarm darf daran nicht
        scheitern.
        """
        try:
            entity = self.hub.registry.get(camera)
            integration = self.hub.integrations.get(entity.integration) if entity else None
            source = await integration.stream_url(entity) if integration else None
            if not source:
                return
            data = await streams.record_clip(source, seconds)
            if not data or self._last is None:
                return
            public_url = (self.hub.config.push or {}).get("public_url")
            token = self.hub.snapshots.put(data)
            self._last["clip"] = snapshots.image_url(public_url, token) or (
                f"/api/push/image/{token}"
            )
            await self._publish()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            log.warning("Mitschnitt zum Alarm fehlgeschlagen: %s", err)

    async def test_run(self, by: str = "") -> dict[str, Any]:
        """Probealarm: einmal durchspielen, was ein Einbruch auslösen würde.

        Ob die Sirene angeht, die Push-Nachricht ankommt und die Lichter
        schalten, erfuhr man sonst beim ersten echten Einbruch – der
        denkbar schlechteste Moment, um ein leeres Aktionsfeld zu
        entdecken. Hier laufen die trigger-Aktionen für ein paar
        Sekunden, dann räumen die clear-Aktionen auf. Der Zustand der
        Anlage bleibt unangetastet: Ein Test schaltet nicht scharf und
        nicht unscharf.
        """
        if self._state != DISARMED:
            raise HomePilotError(
                "Probealarm nur bei unscharfer Anlage – ein Test, während "
                "sie wacht, wäre von einem Einbruch nicht zu unterscheiden."
            )
        await self._notify(
            "Probealarm",
            "Das ist ein Test. Sirene und Lichter gehen gleich für ein "
            "paar Sekunden an.",
            "alarm_test",
        )
        await self._run_actions("trigger")
        # Lang genug, um die Sirene zu hören; kurz genug, dass niemand
        # die Nachbarn beruhigen muss.
        await asyncio.sleep(TEST_SIREN_SECONDS)
        await self._run_actions("clear")
        self._note("test", "Probealarm ausgeführt", by)
        return {"ok": True, "hinweis": "Probealarm durchgespielt – Sirene, "
                "Lichter und Nachricht liefen einmal an und wieder aus."}

    async def _run_actions(self, slot: str) -> None:
        """Die eingestellten Schaltbefehle für diesen Anlass ausführen.

        Jeder einzeln abgesichert: Eine Sirene, die nicht antwortet, darf
        nicht verhindern, dass danach die Lichter angehen – und schon gar
        nicht, dass die Anlage ihren Zustand sauber zu Ende bringt.
        """
        for action in self._actions.get(slot) or []:
            try:
                await self.hub.integrations.dispatch_command(
                    action["entity_id"], action["command"], action.get("data") or {}
                )
            except Exception as err:
                log.warning(
                    "Alarm-Aktion %s (%s %s) fehlgeschlagen: %s",
                    slot,
                    action["entity_id"],
                    action["command"],
                    err,
                )

    async def _snapshot_url(self, camera: str | None) -> str | None:
        """Ein Standbild der Kamera für die Nachricht selbst.

        Wird jetzt aufgenommen und nicht später abgerufen: Das Bild soll den
        Moment zeigen, in dem der Alarm losging, nicht den Moment, in dem
        jemand das Telefon aus der Tasche zieht.

        Jeder Fehlschlag endet hier still in ``None`` – ein Alarm darf nicht
        daran scheitern, dass eine Kamera gerade nicht antwortet.
        """
        public_url = (self.hub.config.push or {}).get("public_url")
        if not camera or not public_url:
            return None
        try:
            entity = self.hub.registry.get(camera)
            integration = self.hub.integrations.get(entity.integration) if entity else None
            image = (
                await asyncio.wait_for(integration.snapshot(entity), BILD_WARTEZEIT)
                if integration
                else None
            )
        except TimeoutError:
            # Beim Alarm noch deutlicher als sonst: Die Nachricht ist das
            # Dringende, das Bild die Zugabe. Eine Kamera, die zu lange
            # braucht, darf den Alarm nicht aufhalten.
            log.info(
                "Bild für die Alarm-Nachricht kam nicht in %ss – Nachricht "
                "geht ohne raus",
                BILD_WARTEZEIT,
            )
            return None
        except Exception as err:
            log.warning("Kein Bild für die Alarm-Nachricht: %s", err)
            return None
        if not image:
            return None
        return snapshots.image_url(public_url, self.hub.snapshots.put(image))

    async def _notify(
        self,
        title: str,
        body: str,
        category: str = "alarm",
        data: dict[str, Any] | None = None,
        image: str | None = None,
    ) -> None:
        tokens = self.hub.push.recipients(self.hub.users.users, "all", category)
        await self.hub.push.send(
            tokens,
            title=title,
            body=body,
            data={"type": "alarm", **(data or {})},
            image=image,
            category=category,
        )

    # ── Verlauf ────────────────────────────────────────────────────────────

    def _note(self, kind: str, text: str, by: str) -> None:
        self._history.insert(0, {"kind": kind, "text": text, "by": by, "at": time.time()})
        limit = int(self._settings.get("history_limit") or 50)
        del self._history[limit:]
        self._save()

    @property
    def history(self) -> list[dict[str, Any]]:
        return list(self._history)

    # ── Konfiguration ──────────────────────────────────────────────────────

    def config_dict(self) -> dict[str, Any]:
        return {
            "sensors": [
                {"entity_id": entity_id, **entry}
                for entity_id, entry in self._sensors.items()
            ],
            "settings": dict(self._settings),
            "after_trigger": {
                mode: dict(entry) for mode, entry in self._after_trigger.items()
            },
            "actions": {slot: list(entries) for slot, entries in self._actions.items()},
        }

    def _save(self) -> None:
        self.hub.data.set("alarm", [{**self.config_dict(), "history": self._history}])

    async def update_config(self, patch: dict[str, Any]) -> None:
        """Sensorzuordnung und Einstellungen aus der App übernehmen."""
        if "sensors" in patch:
            self._sensors = parse_sensors(patch["sensors"])
        if "settings" in patch:
            self._settings = {**self._settings, **(patch["settings"] or {})}
        if "after_trigger" in patch:
            self._after_trigger = parse_after(patch["after_trigger"], self._after_trigger)
        if "actions" in patch:
            self._actions = parse_actions(patch["actions"])
        self._save()
        await self._publish()

    # ── Kommandos ──────────────────────────────────────────────────────────

    async def handle_command(
        self, entity: Entity, command: str, data: dict[str, Any]
    ) -> None:
        force = bool(data.get("force"))
        # Die PIN kann als data.pin mitkommen (Karten, Szenen); fehlt sie
        # und ist eine gesetzt, erklärt der Fehler, was zu tun ist.
        pin = str(data.get("pin") or "") or None
        # Setzt die API-Schicht für Gemeinschaftsgeräte - siehe check_pin().
        require_pin = bool(data.get("require_pin"))
        if command in ("disarm", "turn_off"):
            await self.disarm(pin=pin, require_pin=require_pin)
            return
        if command == "toggle":
            if self._state == DISARMED:
                await self.arm("ausser_haus", force=force)
            else:
                await self.disarm(pin=pin, require_pin=require_pin)
            return
        mode = {
            "arm_night": "nacht",
            "arm_away": "ausser_haus",
            "arm_vacation": "urlaub",
            "turn_on": "ausser_haus",
        }.get(command)
        if mode is None:
            await super().handle_command(entity, command, data)
            return
        result = await self.arm(mode, force=force)
        if not result.get("ok"):
            raise HomePilotError(
                "Scharfschalten nicht möglich, noch offen: "
                + ", ".join(result.get("open", []))
            )


INTEGRATION = AlarmIntegration
