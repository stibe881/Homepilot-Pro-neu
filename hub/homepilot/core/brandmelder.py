"""Die Brandmeldeanlage - das Rechnen (alle Funktionen rein, testbar).

Punkt 445 der Werkbank. Rauchmelder waren im Hub bisher gewöhnliche
Melder: eine Kachel, ein Auslöser für Abläufe, ein Sensor für die
Alarmanlage. Die Doku versprach «warnt sofort, unabhängig von der
Alarmanlage» - getan hat das nur der Wassermelder. Ein Rauchalarm um
drei Uhr nachts blieb ohne Ablauf still, und die Alarmanlage hätte ihn
nur gehört, wenn sie scharf war. Feuer hält sich nicht an Modi.

Hier steht, was die Anlage entscheidet, ohne den Hub anzufassen:
welche Geräte Brandmelder sind, wann sie ausgelöst ist, was dann zu
schalten ist, wann eine Erinnerung an die Prüfung fällig wird. Die
Seiteneffekte (Push, Durchsage, Befehle, Verlauf) macht die
Integration ``integrations/brand.py``.
"""

from __future__ import annotations

import time
from typing import Any

#: Geräteklassen, die als Brandmelder zählen. Gas gehört dazu: Ein
#: Gasmelder meldet dieselbe Art von «sofort raus», und die Aqara-Familie
#: führt beide gleich.
KLASSEN = ("smoke", "gas")

#: Kamera-Erkennungen, die als zweite Quelle gelten (UniFi Protect hört
#: einen piependen Melder, auch einen ohne Funk).
KAMERA_FELDER = ("detected_smoke_alarm", "detected_co_alarm")

#: Zustände der Anlage.
BEREIT = "bereit"
AUSGELOEST = "ausgeloest"
#: Quittiert: Jemand hat gesehen, dass es brennt (oder brannte), und will
#: keine Wiederholung mehr - die Melder selbst bleiben, was sie sind.
QUITTIERT = "quittiert"
#: Kein Melder zugeordnet oder alle abgeschaltet.
UNBESETZT = "unbesetzt"

DATA_KEY = "brandmeldeanlage"

#: Was die Anlage beim Auslösen tut - jeder Schalter einzeln, damit man
#: den Teil weglassen kann, der im eigenen Haus falsch wäre (wer keine
#: Storen hat, hat keine; wer die Haustüre nicht entriegeln will, will
#: es nicht).
DEFAULT_SETTINGS: dict[str, Any] = {
    # Push an alle, mit Bild der nächsten Kamera.
    "notify": True,
    # Alle Lichter an, voll: Man soll den Weg nach draussen sehen.
    "lights_on": True,
    # Storen hoch: Fluchtweg und Sicht für die Feuerwehr.
    "covers_open": True,
    # Türen entriegeln: aus, bis jemand es will - ein entriegeltes Haus
    # ist auch ein offenes, und ein Fehlalarm ist häufiger als ein Brand.
    "unlock_doors": False,
    # Durchsage auf allen Boxen, mit Raum.
    "announce": True,
    "announce_text": "Achtung, Rauch in {raum}. Bitte das Haus verlassen.",
    # Die anderen Melder mitheulen lassen (Aqara: buzzer alarm). Nur die
    # angeschlossenen Melder, die den Befehl kennen.
    "buzz_others": True,
    # Wiederholung, solange Rauch gemeldet wird und niemand quittiert.
    "repeat_minutes": 3,
    # Entwarnung als Nachricht, wenn alle Melder wieder ruhig sind.
    "notify_clear": True,
    # Prüfintervall in Monaten - die Erinnerung geht als Wartungsmeldung.
    "test_months": 6,
    # Wie viele Ereignisse der Verlauf behält.
    "history_limit": 50,
}

#: Schalter, die auf der Seite als Ja/Nein stehen (fürs Bereinigen).
SCHALTER = (
    "notify",
    "lights_on",
    "covers_open",
    "unlock_doors",
    "announce",
    "buzz_others",
    "notify_clear",
)


def settings_lesen(raw: Any) -> dict[str, Any]:
    """Die Einstellungen in ihre Grenzen zwingen (rein, testbar)."""
    sauber = dict(DEFAULT_SETTINGS)
    if not isinstance(raw, dict):
        return sauber
    for key in SCHALTER:
        if key in raw:
            sauber[key] = bool(raw[key])
    text = str(raw.get("announce_text") or "").strip()
    if text:
        sauber["announce_text"] = text[:200]
    for key, unten, oben in (
        ("repeat_minutes", 0, 60),
        ("test_months", 0, 24),
        ("history_limit", 10, 500),
    ):
        try:
            sauber[key] = max(unten, min(oben, int(raw.get(key, sauber[key]))))
        except (TypeError, ValueError):
            pass
    return sauber


def ist_melder(entity: Any) -> bool:
    """Ist dieses Gerät ein Brandmelder? (rein, testbar)

    Rauch- und Gasmelder als ``binary_sensor`` - und Kameras, die einen
    Melder *hören* können (UniFi Protect meldet das als eigenes Feld).
    """
    state = getattr(entity, "state", None) or {}
    if getattr(entity, "kind", "") == "binary_sensor":
        return str(state.get("device_class") or "") in KLASSEN
    if getattr(entity, "kind", "") == "camera":
        return any(feld in state for feld in KAMERA_FELDER)
    return False


def melder(entities: list[Any]) -> list[Any]:
    """Alle Brandmelder des Hauses, Melder vor Kameras (rein, testbar)."""
    gefunden = [entity for entity in entities if ist_melder(entity)]
    return sorted(
        gefunden,
        key=lambda entity: (
            getattr(entity, "kind", "") == "camera",
            str(getattr(entity, "room", None) or "~"),
            str(getattr(entity, "label", getattr(entity, "name", ""))),
        ),
    )


def meldet(entity: Any) -> bool:
    """Schlägt dieser Melder gerade an? (rein, testbar)"""
    state = getattr(entity, "state", None) or {}
    if getattr(entity, "kind", "") == "camera":
        return any(str(state.get(feld)) == "on" for feld in KAMERA_FELDER)
    return str(state.get("state")) == "on"


def alarmierend(entities: list[Any], abgeschaltet: set[str] | None = None) -> list[Any]:
    """Welche zugeordneten Melder gerade Rauch melden (rein, testbar).

    ``abgeschaltet`` sind die Melder, die jemand bewusst aus der Anlage
    genommen hat (der Melder in der Werkstatt, der beim Schweissen
    anschlägt). Sie bleiben Geräte, zählen hier aber nicht.
    """
    weg = abgeschaltet or set()
    return [entity for entity in melder(entities) if entity.id not in weg and meldet(entity)]


def zustand(entities: list[Any], abgeschaltet: set[str], quittiert: bool) -> str:
    """Der Zustand der Anlage aus dem Stand der Melder (rein, testbar)."""
    aktive = [entity for entity in melder(entities) if entity.id not in abgeschaltet]
    if not aktive:
        return UNBESETZT
    if alarmierend(entities, abgeschaltet):
        return QUITTIERT if quittiert else AUSGELOEST
    return BEREIT


def durchsage_text(vorlage: str, entity: Any) -> str:
    """Den Ansage-Satz mit Raum und Gerät füllen (rein, testbar).

    Ohne Raum steht der Gerätename: «Rauch in Rauchmelder Flur» liest
    sich schief, aber «Rauch in» ohne Ort wäre die schlechtere Ansage.
    """
    raum = str(getattr(entity, "room", None) or "") or str(
        getattr(entity, "label", getattr(entity, "name", "")) or "unbekanntem Raum"
    )
    name = str(getattr(entity, "label", getattr(entity, "name", "")) or "")
    return vorlage.replace("{raum}", raum).replace("{gerät}", name).replace("{geraet}", name)


def schaltbefehle(
    entities: list[Any], settings: dict[str, Any], ausloeser: set[str]
) -> list[tuple[str, str, dict[str, Any]]]:
    """Was beim Auslösen geschaltet wird: (Gerät, Befehl, Daten) (rein, testbar).

    Lichter an und voll, Storen auf, Türen entriegelt, die übrigen Melder
    mit Summer - je nach Schalter. Der auslösende Melder selbst bleibt
    ungeschaltet: Er heult ohnehin, und ein «alarm» darauf könnte ihn
    zurücksetzen.
    """
    befehle: list[tuple[str, str, dict[str, Any]]] = []
    for entity in entities:
        kind = getattr(entity, "kind", "")
        commands = set(getattr(entity, "commands", []) or [])
        if settings.get("lights_on") and kind == "light" and "turn_on" in commands:
            daten = {"brightness": 100} if "set_brightness" in commands else {}
            befehle.append((entity.id, "set_brightness" if daten else "turn_on", daten))
        elif settings.get("covers_open") and kind == "cover" and "open" in commands:
            befehle.append((entity.id, "open", {}))
        elif settings.get("unlock_doors") and kind == "lock" and "unlock" in commands:
            befehle.append((entity.id, "unlock", {}))
        elif (
            settings.get("buzz_others")
            and ist_melder(entity)
            and entity.id not in ausloeser
            and "buzzer_alarm" in commands
        ):
            befehle.append((entity.id, "buzzer_alarm", {}))
    return befehle


def stummbefehle(entities: list[Any]) -> list[tuple[str, str, dict[str, Any]]]:
    """Alle Melder, die sich stummschalten lassen (rein, testbar)."""
    return [
        (entity.id, "mute", {})
        for entity in melder(entities)
        if "mute" in (getattr(entity, "commands", []) or [])
    ]


def wiederholung_faellig(
    zuletzt: float | None, jetzt: float, minuten: int, quittiert: bool
) -> bool:
    """Ist die nächste Wiederholung dran? (rein, testbar)

    Nicht nach dem Quittieren und nicht bei 0 Minuten - dann gibt es
    genau eine Meldung, wie beim Wassermelder vor Punkt 391.
    """
    if quittiert or minuten <= 0 or zuletzt is None:
        return False
    return jetzt - zuletzt >= minuten * 60


def pruefung_faellig(
    letzter_test: float | None, jetzt: float, monate: int, erinnert: float | None = None
) -> bool:
    """Ist die Prüfung der Melder überfällig? (rein, testbar)

    Nie geprüft heisst überfällig - der Melder hängt seit dem Einbau
    ungeprüft, und genau das ist der Fall, für den es die Erinnerung
    gibt. Erinnert wird höchstens einmal im Monat: Eine tägliche Meldung
    wischt man weg, bis man auch die Wichtige wegwischt.
    """
    if monate <= 0:
        return False
    if erinnert is not None and jetzt - erinnert < 30 * 86400:
        return False
    if letzter_test is None:
        return True
    return jetzt - letzter_test >= monate * 30.4375 * 86400


def melder_zeile(entity: Any, abgeschaltet: set[str], tests: dict[str, float], jetzt: float | None = None) -> dict[str, Any]:
    """Eine Zeile der Melderliste für die App (rein, testbar)."""
    moment = time.time() if jetzt is None else jetzt
    state = getattr(entity, "state", None) or {}
    letzter_test = tests.get(entity.id)
    return {
        "entity_id": entity.id,
        "name": str(getattr(entity, "label", getattr(entity, "name", "")) or entity.id),
        "room": getattr(entity, "room", None),
        "kind": getattr(entity, "kind", ""),
        "device_class": state.get("device_class"),
        "alarm": meldet(entity),
        "active": entity.id not in abgeschaltet,
        "available": bool(getattr(entity, "available", True)),
        "battery": state.get("battery"),
        "low_battery": bool(state.get("low_battery")),
        "last_seen": getattr(entity, "last_seen", None),
        "last_test": letzter_test,
        "test_overdue": letzter_test is None or (moment - letzter_test) >= 6 * 30.4375 * 86400,
        "can_mute": "mute" in (getattr(entity, "commands", []) or []),
        "can_self_test": "self_test" in (getattr(entity, "commands", []) or []),
    }
