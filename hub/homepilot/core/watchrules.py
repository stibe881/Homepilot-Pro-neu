"""Die reinen Prüf-Regeln des Wächters (alle rein, testbar).

Herausgelöst aus watchdog.py (Punkt 45 der Werkbank): Der Wächter selbst
ist der Taktgeber mit Zustand (wer wurde wann gemahnt); *was* auffällig
ist - offene Kontakte, schwache Batterien, ausgefallene Integrationen,
Frostnächte -, entscheiden diese Funktionen über blossen Listen. So lässt
sich jede Regel prüfen, ohne einen Hub zu starten.
"""

from __future__ import annotations

import re
import shutil
from typing import Any

# Melder, bei denen «offen» Heizkosten bedeutet. Ein Bewegungsmelder, der
# lange «on» meldet, ist dagegen kein Grund zur Sorge.
OPEN_CLASSES = frozenset({"contact", "door", "window", "garage"})

# Integrationen ohne eigene Verbindung, die nie „ausfallen" können.
IGNORE = frozenset({"demo", "helpers", "group", "adaptive", "presence_sim", "alarm"})

# So viele Programmläufe bleiben gespeichert – reicht für Monate.
CYCLE_LIMIT = 300

# Ab dieser Nachtprognose wird an die Balkonpflanzen erinnert, wenn niemand
# etwas anderes einstellt. Drei Grad statt null: Am Boden ist es kälter als
# in zwei Metern Höhe, und wer erst bei null gewarnt wird, hat die Geranien
# schon verloren.
FROST_BELOW = 3.0

def frost_night(
    days: list[Any], today: str, below: float = FROST_BELOW
) -> dict[str, Any] | None:
    """Kommt heute Nacht Frost? (rein, testbar)

    Geschaut wird auf die Tiefstwerte von heute und morgen – die kalte
    Stunde liegt vor Sonnenaufgang und gehört je nach Uhrzeit zum einen
    oder anderen Kalendertag.
    """
    for entry in list(days or [])[:2]:
        if not isinstance(entry, dict):
            continue
        day = str(entry.get("date") or "")
        if day < today:
            continue
        try:
            low = float(entry.get("low"))
        except (TypeError, ValueError):
            continue
        if low < below:
            return {"date": day, "low": low}
    return None


def disk_usage(path: str) -> dict[str, Any] | None:
    """Belegung des Datenträgers, auf dem ``path`` liegt (None = unlesbar)."""
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return None
    if usage.total <= 0:
        return None
    return {
        "percent": round(usage.used / usage.total * 100),
        "free_gb": round(usage.free / 1_000_000_000, 1),
        "total_gb": round(usage.total / 1_000_000_000, 1),
    }


def down_integrations(entities: list[Any]) -> set[str]:
    """Integrationen, deren Entitäten allesamt nicht erreichbar sind (rein).

    Eine Integration ganz ohne Entitäten zählt nicht als ausgefallen – sie
    ist entweder noch am Starten oder liefert bewusst nichts.
    """
    seen: dict[str, bool] = {}
    for entity in entities:
        name = entity.integration
        seen[name] = seen.get(name, False) or entity.available
    return {
        name for name, any_available in seen.items()
        if not any_available and name not in IGNORE
    }


def watched_entities(entities: list[Any], guarded: set[str]) -> list[Any]:
    """Welche Geräte einzeln überwacht werden (rein, testbar).

    Alles zu melden wäre Lärm; nichts zu melden hiesse, einen toten
    Rauchmelder erst beim Brand zu bemerken. Überwacht wird deshalb, was
    die Alarmanlage bewacht – diese Auswahl hat jemand bewusst getroffen.
    """
    return [entity for entity in entities if entity.id in guarded]


def cycle_stats(cycles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Läufe je Gerät zusammenfassen (rein, testbar).

    Neben Anzahl und Durchschnitt steht der letzte Lauf – erst der
    Vergleich der beiden sagt, ob ein Gerät schleichend länger braucht.
    """
    by_entity: dict[str, list[dict[str, Any]]] = {}
    for cycle in cycles or []:
        if not isinstance(cycle, dict) or not cycle.get("entity_id"):
            continue
        by_entity.setdefault(str(cycle["entity_id"]), []).append(cycle)

    result = []
    for entity_id, entries in by_entity.items():
        seconds = [int(entry.get("seconds") or 0) for entry in entries]
        seconds = [value for value in seconds if value > 0]
        if not seconds:
            continue
        result.append(
            {
                "entity_id": entity_id,
                "name": entries[0].get("name") or entity_id,
                "runs": len(seconds),
                "average_seconds": round(sum(seconds) / len(seconds)),
                "last_seconds": seconds[0],
                "last_finished": entries[0].get("finished"),
            }
        )
    return sorted(result, key=lambda entry: entry["name"])


# Wo die Integration keine Geräteklasse liefert, entscheidet der Name –
# dieselbe Regel wie in der App (components/OpenDoors.tsx). Die beiden
# Fassungen müssen dasselbe zählen: Das Widget hat «Alles zu» behauptet,
# während die App das offene Küchenfenster zeigte, weil der Hub hier nur
# Schlösser zählte.
OPENING_NAME = re.compile(
    r"t(ü|ue)r|door|fenster|window|balkon|terrasse|garage|tor\b", re.IGNORECASE
)


def open_contacts(entities: list[Any]) -> list[Any]:
    """Fenster und Türen, die gerade offen stehen (rein, testbar).

    Die eine Fassung für Wächter, Glance (Widget) und Hausblatt – das
    Gegenstück zu ``openContacts`` in der App, mit denselben Regeln:

    - Nur Kontakte: Ein Bewegungsmelder, der lange «on» meldet, heizt
      nicht zum Fenster hinaus.
    - Ein Schloss mit Türsensor zählt mit: Der Riegel sagt nichts
      darüber, ob die Türe offen *steht* (``door: open``).
    - Ohne ``device_class`` entscheidet der Name – besser als einen
      Kontakt zu übergehen, dessen Integration die Klasse nicht meldet.
    - Nicht erreichbare Geräte zählen nicht: Ihr letzter Stand kann
      Stunden alt sein, und «Fenster offen» ist eine Behauptung, die
      stimmen muss.
    """
    result = []
    for entity in entities:
        if not getattr(entity, "available", True):
            continue
        if entity.kind == "lock":
            if str(entity.state.get("door") or "") == "open":
                result.append(entity)
            continue
        if entity.kind != "binary_sensor":
            continue
        klasse = str(entity.state.get("device_class") or "")
        is_contact = (
            klasse in OPEN_CLASSES if klasse else bool(OPENING_NAME.search(entity.name))
        )
        if is_contact and str(entity.state.get("state")) == "on":
            result.append(entity)
    return result


def leaks(entities: list[Any]) -> list[Any]:
    """Wassermelder, die gerade Wasser melden (rein, testbar)."""
    return [
        entity
        for entity in entities
        if str(entity.state.get("device_class") or "") == "moisture"
        and str(entity.state.get("state")) == "on"
    ]


def low_batteries(entities: list[Any]) -> list[Any]:
    """Geräte, die eine schwache Batterie melden (rein, testbar)."""
    return [entity for entity in entities if entity.state.get("low_battery") is True]


