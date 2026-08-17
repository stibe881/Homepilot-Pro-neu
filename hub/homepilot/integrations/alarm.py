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

Beim Auslösen geht eine Push-Nachricht an alle Bewohner. Soll dabei noch
etwas geschaltet werden – etwa alle Lichter an –, gehört das in einen
Ablauf: Die Anlage ist eine Entität, ihr Zustand ``ausgeloest`` lässt sich
dort als Auslöser wählen.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import HomePilotError
from ..core.integration import Integration

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
    # Wie viele Ereignisse der Verlauf behält.
    "history_limit": 50,
}

# Sensorarten, die sich überwachen lassen. Kameras und Schalter gehören
# nicht dazu – sie melden keinen Öffnungs- oder Bewegungszustand.
SENSOR_KINDS = frozenset({EntityKind.BINARY_SENSOR, EntityKind.LOCK})


def is_sensor(entity: Entity) -> bool:
    """Taugt diese Entität als Alarmsensor? (rein, testbar)

    Kontakte und Bewegungsmelder melden ``on``; ein Schloss mit Türsensor
    meldet zusätzlich ``door``. Alles andere hat keinen Zustand, aus dem
    sich ein Einbruch ableiten liesse.
    """
    if entity.kind == EntityKind.BINARY_SENSOR:
        return True
    return entity.kind == EntityKind.LOCK and "door" in entity.state


def sensor_open(entity: Entity) -> bool:
    """Meldet der Sensor gerade etwas? (rein, testbar)

    Bei Kontakten und Bewegungsmeldern heisst das ``on``; beim Schloss
    zählt der Türsensor, nicht ob abgeschlossen ist – eine offene Tür ist
    auch dann ein Einbruch, wenn niemand den Riegel angefasst hat.
    """
    if entity.kind == EntityKind.LOCK:
        return str(entity.state.get("door")) == "open"
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
        self._last: dict[str, Any] | None = None

        stored = self.hub.data.get("alarm")
        config = stored[0] if stored else {}
        self._sensors = parse_sensors(config.get("sensors"))
        self._settings = {**DEFAULT_SETTINGS, **(config.get("settings") or {})}
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

    def open_sensors(self, mode: str) -> list[Entity]:
        """Sensoren, die in diesem Modus wachen und gerade offen sind.

        Grundlage der Bereitschaftsprüfung: Scharfschalten mit offenem
        Fenster wäre ein Alarm in dem Moment, in dem die Verzögerung endet.
        """
        return [
            entity
            for entity in self.candidates()
            if guards(self._sensors, entity.id, mode) and sensor_open(entity)
        ]

    # ── Bedienung ──────────────────────────────────────────────────────────

    async def arm(self, mode: str, force: bool = False, by: str = "") -> dict[str, Any]:
        """Scharf schalten. Gibt zurück, was daraus geworden ist."""
        if mode not in MODES:
            raise HomePilotError(f"Unbekannter Alarm-Modus: {mode}")
        open_now = self.open_sensors(mode)
        if open_now and not force:
            # Nicht einfach trotzdem scharf schalten: Der Benutzer soll
            # entscheiden, ob er das Fenster schliesst oder überbrückt.
            return {
                "ok": False,
                "reason": "offen",
                "open": [entity.name for entity in open_now],
            }

        self._cancel_timer()
        self._mode = mode
        delay = float(self._settings.get("exit_delay") or 0)
        if delay > 0:
            self._state = ARMING
            self._until = time.time() + delay
            self._timer = asyncio.create_task(self._after(delay, self._finish_arming))
        else:
            self._state = ARMED
            self._until = None
        await self._publish()
        self._note("armed", f"{MODE_LABELS[mode]} scharf geschaltet", by)
        if self._settings.get("notify_arming"):
            await self._notify(
                "Alarmanlage scharf", f"Modus {MODE_LABELS[mode]}"
            )
        return {"ok": True, "state": self._state}

    async def disarm(self, by: str = "") -> dict[str, Any]:
        self._cancel_timer()
        was = self._state
        self._state = DISARMED
        self._mode = None
        self._until = None
        await self._publish()
        self._note("disarmed", "Unscharf geschaltet", by)
        if self._settings.get("notify_arming") and was != DISARMED:
            await self._notify("Alarmanlage unscharf", "Die Anlage ist aus.")
        return {"ok": True, "state": self._state}

    async def _finish_arming(self) -> None:
        self._state = ARMED
        self._until = None
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
            self._timer = asyncio.create_task(
                self._after(delay, lambda: self._trigger(entity))
            )
            await self._publish()
            self._note("entry", f"{entity.name} geöffnet – Eingangsverzögerung läuft", "")
            return

        await self._trigger(entity)

    async def _trigger(self, entity: Entity) -> None:
        self._cancel_timer()
        self._state = TRIGGERED
        self._until = None
        self._last = {
            "entity_id": entity.id,
            "name": entity.name,
            "at": time.time(),
            "mode": self._mode,
        }
        await self._publish()
        self._note("triggered", f"Alarm ausgelöst: {entity.name}", "")

        if self._settings.get("notify_trigger"):
            await self._notify(
                "🚨 Alarm ausgelöst",
                f"{entity.name} – Modus {MODE_LABELS.get(self._mode or '', '?')}",
            )

    async def _notify(self, title: str, body: str) -> None:
        tokens = self.hub.push.recipients(self.hub.users.users, "all")
        await self.hub.push.send(tokens, title=title, body=body, data={"type": "alarm"})

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
        }

    def _save(self) -> None:
        self.hub.data.set("alarm", [{**self.config_dict(), "history": self._history}])

    async def update_config(self, patch: dict[str, Any]) -> None:
        """Sensorzuordnung und Einstellungen aus der App übernehmen."""
        if "sensors" in patch:
            self._sensors = parse_sensors(patch["sensors"])
        if "settings" in patch:
            self._settings = {**self._settings, **(patch["settings"] or {})}
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
