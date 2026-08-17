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
import time
from typing import Any

from ..core import snapshots
from ..core import streams
from ..core.entity import Entity, EntityKind
from ..core.errors import HomePilotError
from ..core.integration import Integration

log = logging.getLogger(__name__)

# Die scharfen Modi. «aus» ist kein Modus, sondern deren Abwesenheit.
MODES = ("nacht", "ausser_haus", "urlaub")

MODE_LABELS = {
    "nacht": "Nacht",
    "ausser_haus": "Ausser Haus",
    "urlaub": "Urlaub",
}

# Zustände der Anlage.
DISARMED = "unscharf"
ARMING = "scharfschaltend"
ARMED = "scharf"
ENTRY = "eintritt"
TRIGGERED = "ausgeloest"

DEFAULT_SETTINGS: dict[str, Any] = {
    # Sekunden zum Verlassen des Hauses nach dem Scharfschalten.
    "exit_delay": 45,
    # Sekunden zum Unscharfschalten nach dem Öffnen eines verzögerten Sensors.
    "entry_delay": 30,
    # Push beim Auslösen (praktisch immer gewollt) …
    "notify_trigger": True,
    # … und optional auch beim Scharf-/Unscharfschalten.
    "notify_arming": False,
    # Sekunden Videomitschnitt beim Auslösen (0 = keiner). Das Standbild
    # in der Nachricht zeigt einen Moment; erst ein paar Sekunden zeigen,
    # in welche Richtung jemand ging.
    "clip_seconds": 8,
    # Push beim Beginn der Eingangsverzögerung. Der Berechtigte weiss dann,
    # dass die Uhr läuft; wer nicht berechtigt ist, weiss es sowieso gleich.
    "notify_entry": False,
    # Wie viele Ereignisse der Verlauf behält.
    "history_limit": 50,
}

# Was die Anlage selbst schaltet. Bisher schickte sie ausschliesslich eine
# Push-Nachricht – für eine Alarmanlage zu wenig: Eine Sirene und volles
# Licht vertreiben, eine Nachricht allein informiert nur.
#
#   trigger  – beim Auslösen: Sirene, alle Lichter, Storen hoch
#   warning  – beim Beginn der Eingangsverzögerung (kurzes Piepen)
#   clear    – beim Unscharfschalten: Sirene wieder aus
ACTION_SLOTS = ("trigger", "warning", "clear")


def parse_actions(raw: Any) -> dict[str, list[dict[str, Any]]]:
    """Die Schaltbefehle je Anlass einlesen (rein, testbar).

    Was keine Entität und kein Kommando nennt, fliegt raus: Ein halber
    Eintrag würde beim Auslösen scheitern, und das ist der schlechteste
    Zeitpunkt für einen Fehler.
    """
    result: dict[str, list[dict[str, Any]]] = {slot: [] for slot in ACTION_SLOTS}
    if not isinstance(raw, dict):
        return result
    for slot, entries in raw.items():
        if slot not in ACTION_SLOTS:
            continue
        for entry in entries or []:
            if not isinstance(entry, dict):
                continue
            entity_id = str(entry.get("entity_id") or "")
            command = str(entry.get("command") or "")
            if not entity_id or not command:
                continue
            action = {"entity_id": entity_id, "command": command}
            if isinstance(entry.get("data"), dict):
                action["data"] = entry["data"]
            result[slot].append(action)
    return result

# Was nach einem Alarm passiert. Je Modus einstellbar, weil die Antwort
# unterschiedlich ausfällt: Nachts ist man da und schaltet selbst ab, im
# Urlaub ist niemand da, der das täte.
STAY = "stay"  # ausgelöst bleiben, bis jemand von Hand unscharf schaltet
DISARM = "disarm"  # sofort abschalten – gemeldet ist gemeldet
REARM = "rearm"  # nach einer Wartezeit wieder scharf
AFTER_ACTIONS = (STAY, DISARM, REARM)

# Fünf Minuten: lang genug, dass der Einbrecher nicht sofort den nächsten
# Alarm auslöst, kurz genug, dass das Haus bald wieder wach ist.
DEFAULT_AFTER: dict[str, Any] = {"action": STAY, "after": 300}


def parse_after(
    raw: Any, base: dict[str, dict[str, Any]] | None = None
) -> dict[str, dict[str, Any]]:
    """Nachverhalten je Modus einlesen (rein, testbar).

    Was fehlt oder unsinnig ist, bleibt auf ``base`` – beim Laden also auf
    ``stay``: Die Anlage bleibt ausgelöst, bis jemand hinschaut, und nichts
    schaltet sich unbemerkt ab. Beim Speichern ist ``base`` der bisherige
    Stand, damit die App nur den Modus schicken muss, den sie geändert hat.
    """
    result = {
        mode: {**DEFAULT_AFTER, **((base or {}).get(mode) or {})} for mode in MODES
    }
    if not isinstance(raw, dict):
        return result
    for mode, entry in raw.items():
        if mode not in MODES or not isinstance(entry, dict):
            continue
        action = str(entry.get("action") or "")
        if action in AFTER_ACTIONS:
            result[mode]["action"] = action
        try:
            after = int(entry.get("after"))
        except (TypeError, ValueError):
            continue
        # Untergrenze, damit eine 0 nicht zur Dauerschleife aus Alarm und
        # sofortigem Wiederscharfschalten wird.
        result[mode]["after"] = max(10, after)
    return result

def is_sensor(entity: Entity) -> bool:
    """Taugt diese Entität als Alarmsensor? (rein, testbar)

    Drei Quellen, weil dieselbe Frage unterschiedlich beantwortet wird:

      - Kontakte und Bewegungsmelder (``binary_sensor``) melden ``on``.
      - Ein Schloss mit Türsensor meldet zusätzlich ``door``.
      - Kameras melden ``motion`` – UniFi Protect wie Ring. Sie sind damit
        vollwertige Bewegungsmelder und gehören zur Auswahl; ob man sie
        wirklich zuordnet, entscheidet der Modus.

    Alles ohne einen dieser Zustände lässt keinen Rückschluss auf einen
    Einbruch zu.
    """
    if entity.kind == EntityKind.BINARY_SENSOR:
        return True
    if entity.kind == EntityKind.CAMERA:
        return "motion" in entity.state
    return entity.kind == EntityKind.LOCK and "door" in entity.state


def sensor_open(entity: Entity) -> bool:
    """Meldet der Sensor gerade etwas? (rein, testbar)

    Bei Kontakten und Bewegungsmeldern heisst das ``on``; beim Schloss
    zählt der Türsensor, nicht ob abgeschlossen ist – eine offene Tür ist
    auch dann ein Einbruch, wenn niemand den Riegel angefasst hat. Bei
    Kameras zählt allein die Bewegung: Ein Klingeln ist kein Einbruch.
    """
    if entity.kind == EntityKind.LOCK:
        return str(entity.state.get("door")) == "open"
    if entity.kind == EntityKind.CAMERA:
        return str(entity.state.get("motion")) == "on"
    return str(entity.state.get("state")) == "on"


def parse_sensors(raw: Any) -> dict[str, dict[str, Any]]:
    """Gespeicherte Sensorzuordnung einlesen (rein, testbar).

    Unbekannte Modi fliegen raus, damit ein Tippfehler in der Datei nicht
    stillschweigend einen Sensor stilllegt.
    """
    result: dict[str, dict[str, Any]] = {}
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        entity_id = str(entry.get("entity_id") or "")
        if not entity_id:
            continue
        modes = [mode for mode in (entry.get("modes") or []) if mode in MODES]
        result[entity_id] = {
            "modes": modes,
            "delayed": bool(entry.get("delayed")),
            # Vorübergehend überbrückt: Der Sensor bleibt zugeordnet, wacht
            # aber nicht mit – für das Fenster, das gerade offen bleiben soll.
            "bypass": bool(entry.get("bypass")),
        }
    return result


def nearest_camera(entities: list[Entity], room: str | None) -> str | None:
    """Die Kamera im selben Raum wie der Auslöser (rein, testbar).

    Bei einem Alarm ist die erste Frage «was ist da los?». Die Antwort
    steht auf dem Kamerabild – aber nur, wenn die App weiss, welche der
    Kameras gemeint ist. Ohne Raum lässt sich das nicht raten, dann lieber
    keine als die falsche.
    """
    if not room:
        return None
    for entity in entities:
        if entity.kind == EntityKind.CAMERA and entity.room == room:
            return entity.id
    return None


def guards(sensors: dict[str, dict[str, Any]], entity_id: str, mode: str) -> bool:
    """Wacht dieser Sensor im angegebenen Modus? (rein, testbar)"""
    entry = sensors.get(entity_id)
    if entry is None or entry.get("bypass"):
        return False
    return mode in entry.get("modes", [])


class AlarmIntegration(Integration):
    name = "alarm"

    async def setup(self) -> None:
        self._unsubscribe = None
        self._timer: asyncio.Task | None = None
        self._state = DISARMED
        self._mode: str | None = None
        # Zeitpunkt, an dem die laufende Verzögerung abläuft.
        self._until: float | None = None
        # Was am Ende dieser Verzögerung passiert – die App beschriftet den
        # Countdown damit, sonst stünde bei jeder Wartezeit dasselbe da.
        self._next: str | None = None
        self._last: dict[str, Any] | None = None
        self._clip_task: asyncio.Task | None = None

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

    async def disarm(self, by: str = "") -> dict[str, Any]:
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
            camera = nearest_camera(self.hub.registry.all(), entity.room)
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
        self._start_clip(nearest_camera(self.hub.registry.all(), entity.room))

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
            image = await integration.snapshot(entity) if integration else None
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
        if command in ("disarm", "turn_off"):
            await self.disarm()
            return
        if command == "toggle":
            if self._state == DISARMED:
                await self.arm("ausser_haus", force=force)
            else:
                await self.disarm()
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
