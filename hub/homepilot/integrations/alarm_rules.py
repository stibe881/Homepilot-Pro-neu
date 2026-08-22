"""Die reine Logik der Alarmanlage (alles rein, testbar).

Herausgelöst aus alarm.py (Punkt 42 der Werkbank): Zustände, PIN-Prüfung,
das Einlesen von Sensoren und Aktions-Plätzen, «wer bewacht was in
welchem Modus». Die Integration daneben ist der Taktgeber mit Zustand -
Timer, Verlauf, Benachrichtigungen.
"""

from __future__ import annotations

import hashlib
import secrets
from typing import Any

from ..core.entity import Entity, EntityKind


def hash_pin(pin: str, salt: str) -> str:
    """PIN gesalzen hashen (rein, testbar) - im Klartext liegt sie nie."""
    return hashlib.sha256((salt + pin).encode("utf-8")).hexdigest()


def valid_pin(entry: dict[str, Any], pin: str) -> bool:
    """Stimmt die PIN mit dem gespeicherten Eintrag überein? (rein)"""
    salt = str(entry.get("salt") or "")
    return bool(salt) and secrets.compare_digest(
        hash_pin(pin, salt), str(entry.get("hash") or "")
    )

# Die scharfen Modi. «aus» ist kein Modus, sondern deren Abwesenheit.
MODES = ("nacht", "ausser_haus", "urlaub")

MODE_LABELS = {
    "nacht": "Nacht",
    "ausser_haus": "Ausser Haus",
    "urlaub": "Urlaub",
}

# Zustände der Anlage.
DISARMED = "unscharf"
# Wie lange die Sirene beim Probealarm läuft.
TEST_SIREN_SECONDS = 3.0
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
    # Push, wenn eine Kamera Bewegung sieht, während scharf ist – mit Bild.
    # Auch für Kameras, die *kein* Alarmsensor sind: Wer die Sirene nicht
    # von einer vorbeilaufenden Katze auslösen lassen will, möchte das Bild
    # trotzdem sehen.
    "notify_camera_motion": True,
}

# Mindestabstand zwischen zwei Bewegungs-Nachrichten derselben Kamera.
# Eine Kamera meldet Bewegung im Sekundentakt, solange sich etwas bewegt –
# ohne Abstand wäre das Telefon nach einer Minute unbenutzbar.
CAMERA_MOTION_COOLDOWN = 120.0

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


def motion_started(old_state: Any, new_state: Any) -> bool:
    """Hat gerade eine Bewegung *begonnen*? (rein, testbar)

    Die Flanke, nicht der Pegel: Eine Kamera meldet ihren Zustand immer
    wieder; interessant ist der Moment, in dem aus «nichts» ein «da ist
    jemand» wird.
    """
    alt = str((old_state or {}).get("motion") or "")
    neu = str((new_state or {}).get("motion") or "")
    return neu == "on" and alt != "on"


def camera_motion_due(
    seen: dict[str, float],
    camera: str,
    now: float,
    cooldown: float = CAMERA_MOTION_COOLDOWN,
) -> bool:
    """Ist eine neue Bewegungs-Nachricht dieser Kamera fällig? (rein, testbar)"""
    letzte = seen.get(camera)
    return letzte is None or now - letzte >= cooldown


def camera_for(entity: Entity, entities: list[Entity]) -> str | None:
    """Welche Kamera gehört zu diesem Auslöser? (rein, testbar)

    Ist der Auslöser selbst eine Kamera, ist die Frage beantwortet – auch
    dann, wenn ihr niemand einen Raum zugeordnet hat. Vorher suchte auch
    eine auslösende Kamera erst nach «einer Kamera in ihrem Raum» und ging
    ohne Raum leer aus: keine Bild, kein Sprung zur Kamera beim Antippen.
    """
    if entity.kind == EntityKind.CAMERA:
        return entity.id
    return nearest_camera(entities, entity.room)


def guards(sensors: dict[str, dict[str, Any]], entity_id: str, mode: str) -> bool:
    """Wacht dieser Sensor im angegebenen Modus? (rein, testbar)"""
    entry = sensors.get(entity_id)
    if entry is None or entry.get("bypass"):
        return False
    return mode in entry.get("modes", [])


