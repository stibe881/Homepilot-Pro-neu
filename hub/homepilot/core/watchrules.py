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
import time
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
            klasse in OPEN_CLASSES if klasse else bool(OPENING_NAME.search(entity.label))
        )
        if is_contact and str(entity.state.get("state")) == "on":
            result.append(entity)
    return result


def offen_satz(seit: float, jetzt: float) -> str:
    """«Offen seit 14:05 – eine Stunde» (rein, testbar).

    Die Uhrzeit steht vorne, weil sie nachprüfbar ist: Wer weiss, dass er
    um 14:20 aufgemacht hat, erkennt an «seit 14:05» sofort einen
    hängenden Sensor. Eine gerundete Dauer allein liesse ihn nur rätseln.
    """
    uhr = time.strftime("%H:%M", time.localtime(seit))
    minuten = max(0, int((jetzt - seit) // 60))
    if minuten < 60:
        return f"Offen seit {uhr} – {minuten} Minuten"
    stunden = minuten // 60
    rest = minuten % 60
    dauer = f"{stunden} Std." + (f" {rest} Min." if rest else "")
    return f"Offen seit {uhr} – {dauer}"


def leaks(entities: list[Any]) -> list[Any]:
    """Wassermelder, die gerade Wasser melden (rein, testbar)."""
    return [
        entity
        for entity in entities
        if str(entity.state.get("device_class") or "") == "moisture"
        and str(entity.state.get("state")) == "on"
    ]


#: Was die häufigsten Sauger-Meldungen auf Deutsch heissen. Die Namen
#: stammen aus der Roborock-Bibliothek (error_code_name und
#: dock_error_status_name); die Liste muss nicht vollständig sein - was
#: sie nicht kennt, kommt lesbar gemacht durch (sauger_wort). Lieber ein
#: englischer Restname als eine verschluckte Meldung.
SAUGER_TEXTE: dict[str, str] = {
    "water_empty": "Der Reinigungswassertank ist leer oder nicht eingesetzt.",
    "water_shortage": "Der Wasserstand ist niedrig - Tank auffüllen.",
    "waste_water_tank_full": "Der Schmutzwassertank ist voll.",
    "cleaning_tank_full_or_blocked": "Der Reinigungstank ist voll oder verstopft.",
    "dirty_tank_latch_open": "Der Verschluss des Schmutzwassertanks ist offen.",
    "duct_blockage": "Der Absaugkanal der Station ist verstopft.",
    "no_dustbin": "Der Staubbehälter fehlt.",
    "main_brush_jammed": "Die Hauptbürste ist blockiert.",
    "side_brush_jammed": "Die Seitenbürste ist blockiert.",
    "wheels_jammed": "Ein Rad ist blockiert.",
    "robot_trapped": "Der Sauger steckt fest.",
    "cliff_sensor_error": "Der Absturzsensor meldet ein Problem.",
    "filter_blocked": "Der Filter ist verstopft oder nass.",
    "low_battery": "Der Akku reicht nicht - erst laden lassen.",
    "charging_error": "Das Laden klappt nicht.",
    "return_to_dock_fail": "Der Sauger findet die Station nicht.",
    "vibrarise_jammed": "Das Wischmodul ist blockiert.",
}


def sauger_wort(name: str) -> str:
    """Eine Sauger-Meldung in einen lesbaren Satz bringen (rein, testbar)."""
    kern = str(name or "").strip().lower()
    bekannt = SAUGER_TEXTE.get(kern)
    if bekannt:
        return bekannt
    # Unbekanntes bleibt erkennbar Original: «vertical bumper pressed»
    # sagt dem, der nachschlägt, mehr als jede geratene Übersetzung.
    return f"Der Sauger meldet: {kern.replace('_', ' ')}."


def sauger_probleme(entities: list[Any]) -> list[tuple[Any, str, str]]:
    """Sauger mit gemeldetem Problem: (Gerät, Schlüssel, Satz) (rein, testbar).

    Zwei Quellen, weil es zwei sind: Der Roboter selbst meldet Fehler
    (``error``), die Station ihre eigenen (``dock.error``) - der volle
    Schmutzwassertank steht nur dort. Der Schlüssel unterscheidet beide,
    damit «Tank leer» und «steckt fest» je eine Nachricht bekommen.
    """
    ergebnis: list[tuple[Any, str, str]] = []
    for entity in entities:
        if getattr(entity, "kind", None) != "vacuum":
            continue
        state = entity.state or {}
        fehler = str(state.get("error") or "").strip()
        if fehler and fehler.lower() not in ("none", "ok"):
            ergebnis.append((entity, f"fehler:{fehler}", sauger_wort(fehler)))
        dock = state.get("dock")
        dock_fehler = (
            str(dock.get("error") or "").strip() if isinstance(dock, dict) else ""
        )
        if dock_fehler and dock_fehler.lower() not in ("none", "ok"):
            ergebnis.append((entity, f"dock:{dock_fehler}", sauger_wort(dock_fehler)))
    return ergebnis


#: So lange nach einer Klingel-Nachricht wird keine zweite verschickt.
#:
#: Ein Klingeln kommt beim Hub auf mehreren Wegen an - Ereigniskanal,
#: Abfrage, Verlauf -, und jeder Weg kann den Zustand für sich auf «an»
#: setzen. Liegt dazwischen ein «aus», zählt es als neues Klingeln, und
#: der Besucher bekommt vier Nachrichten statt einer.
#:
#: Eine Minute: Wer davorsteht und nochmals drückt, weil niemand kommt,
#: löst keine zweite Nachricht aus - er will ja dieselbe Sache. Ein
#: zweiter Besucher eine Minute später schon.
KLINGEL_SPERRE = 60.0


def klingel_gesperrt(
    zuletzt: float | None, jetzt: float, frist: float = KLINGEL_SPERRE
) -> bool:
    """Wurde für diese Türe eben schon gemeldet? (rein, testbar)

    Der Riegel an der letzten Stelle: Was auch immer davor schiefgeht -
    hier geht je Türe und Minute eine Nachricht hinaus.
    """
    if zuletzt is None:
        return False
    return 0 <= jetzt - zuletzt < frist


def klingelnde(entities: list[Any]) -> list[Any]:
    """Geräte, an denen es gerade klingelt (rein, testbar).

    Das Feld `ring` führt jedes Gerät, das klingeln kann - die Türklingel
    mit Kamera ebenso wie die Gegensprechanlage. Wer keines hat, taucht
    hier nie auf; ein Gerät, das nur gerade nicht klingelt, steht auf
    «off» und ebenfalls nicht.
    """
    return [
        entity
        for entity in entities
        if str(entity.state.get("ring") or "") == "on"
    ]


def low_batteries(entities: list[Any]) -> list[Any]:
    """Geräte, die eine schwache Batterie melden (rein, testbar)."""
    return [entity for entity in entities if entity.state.get("low_battery") is True]


# Ablage der schon gemahnten Öffnungen (hub.data): Zeilen mit Kennung
# und Zeitpunkt der Öffnung. Zeilen und kein Dict, weil der DataStore
# alles als Liste führt - ein Dict käme als Liste seiner Schlüssel zurück.
OPEN_REPORTED_KEY = "open_reported"


def offene_meldungen_lesen(rows: object, offen: set[str]) -> dict[str, float]:
    """Die Ablage der gemahnten Öffnungen lesen und aufräumen (rein, testbar).

    Geschlossene Kontakte fliegen heraus - damit ist der Merker für die
    nächste Öffnung automatisch frei. Und die Ablage kommt aus einer
    JSON-Datei: Was keine Zeile mit Kennung und Zeitstempel ist, wird
    verworfen statt später zu überraschen.
    """
    ergebnis: dict[str, float] = {}
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        kennung = row.get("entity_id")
        seit = row.get("seit")
        if (
            isinstance(kennung, str)
            and kennung in offen
            and isinstance(seit, (int, float))
            and not isinstance(seit, bool)
        ):
            ergebnis[kennung] = float(seit)
    return ergebnis


def offene_meldungen_zeilen(gemahnt: dict[str, float]) -> list[dict[str, float | str]]:
    """Das Gegenstück fürs Zurückschreiben (rein, testbar). Sortiert,
    damit sich die Datei nur ändert, wenn sich der Inhalt ändert."""
    return [
        {"entity_id": kennung, "seit": gemahnt[kennung]} for kennung in sorted(gemahnt)
    ]


def schon_gemahnt(
    gemeldet: dict[str, float], entity_id: str, seit: float, toleranz: float = 180.0
) -> bool:
    """Gilt die abgelegte Mahnung noch dieser Öffnung? (rein, testbar)

    Verglichen wird der Zeitpunkt der Öffnung, nicht nur die Kennung:
    Zu, wieder auf, wieder lange offen - das ist eine neue Öffnung und
    verdient eine neue Mahnung. Die Toleranz fängt ab, dass Protokoll
    und eigene Zählung um Sekunden auseinanderliegen können.

    Der gemeldete Fall dahinter: «Terrasse steht offen» kam mehrfach für
    dieselbe Öffnung. Der Merker lebte nur im Arbeitsspeicher, und jeder
    Hub-Neustart - jedes Update ist einer - leerte ihn.
    """
    alt = gemeldet.get(entity_id)
    return alt is not None and abs(alt - seit) <= toleranz
