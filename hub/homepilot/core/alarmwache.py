"""Was der Anlage die Sicht nimmt, während sie scharf ist.

Vor dem Scharfschalten prüft die Anlage schon, worauf kein Verlass ist:
offene Fenster, ausgefallene Sensoren, leere Batterien
(``alarm.blind_sensors``). Das ist die halbe Miete - denn zwischen
«scharf geschaltet» und «wieder unscharf» liegen acht Stunden, und genau
darin fällt ein Sensor aus.

Der Fall, der das nötig macht, sieht harmlos aus: Ein Funkkontakt am
Kellerfenster meldet sich nicht mehr. Die Anlage steht weiter auf
«scharf», die App zeigt ein grünes Schild, und niemand erfährt, dass das
Kellerfenster seit vier Stunden nicht überwacht wird. Aus Sicht der
Anlage ist das kein Ereignis - es kommt bloss nichts mehr. Ein Ausfall,
der sich als Ruhe tarnt.

Drei Arten, blind zu werden, und sie sind verschieden ernst:

- **Sabotage.** Ein Melder mit ``device_class: tamper`` sagt selbst, dass
  jemand an ihm war. Das ist eine Aussage, kein Schweigen.
- **Funkstille.** Der Sensor antwortet nicht mehr. Kann Sabotage sein,
  kann eine leere Batterie sein, kann das Gateway sein - von aussen
  nicht zu unterscheiden, und deshalb wird beides gleich gemeldet.
- **Batterie.** Der Sensor sagt selbst, dass er bald aufhört. Kein
  Notfall, aber während scharf geschaltet ist, gehört es auf den Tisch.

**Warum das nicht die Sirene auslöst**, obwohl echte Anlagen das tun: Um
drei Uhr nachts wegen einer leeren Knopfzelle geweckt zu werden, ist der
schnellste Weg zu einer Anlage, die niemand mehr scharf schaltet - und
eine nicht scharf geschaltete Anlage ist schlechter als eine, die einmal
zu spät gemeldet hat. Wer es anders will, stellt ``sabotage_alarm``
ein; dann löst gemeldete Sabotage (nicht die Funkstille) wirklich aus.

Reines Rechnen über Entitäten; wer meldet, ist die Alarm-Integration.
"""

from __future__ import annotations

from typing import Any

#: Wie lange ein Sensor schweigen darf, bevor es Funkstille heisst.
#:
#: Nicht sofort: Ein Funkkontakt, der eine Runde aussetzt, ist der
#: Normalfall - jede Anbindung hat ihre Aussetzer, und eine Meldung bei
#: jedem davon liest nach einer Woche niemand mehr. Fünf Minuten sind
#: lang genug, dass es kein Zufall mehr ist, und kurz genug, dass es
#: noch etwas nützt.
FUNKSTILLE_SEKUNDEN = 300.0

#: Die drei Arten, in der Reihenfolge, in der sie zählen.
SABOTAGE = "sabotage"
FUNKSTILLE = "funkstille"
BATTERIE = "batterie"

#: Was in der Nachricht steht.
WORTE: dict[str, str] = {
    SABOTAGE: "Sabotage gemeldet",
    FUNKSTILLE: "antwortet nicht mehr",
    BATTERIE: "Batterie fast leer",
}


def ist_sabotagemelder(entity: Any) -> bool:
    """Sagt dieser Melder selbst, dass jemand an ihm war? (rein, testbar)

    ``device_class: tamper`` kommt von Zigbee2MQTT
    (integrations/zigbee2mqtt.py, MELDER). Andere Anbindungen kennen es
    nicht - deshalb ist die Funkstille unten der Fall, der im Haus
    wirklich eintritt, und dieser hier der Fall, den man geschenkt
    bekommt, wenn ein Gerät ihn kann.
    """
    return str(getattr(entity, "state", {}).get("device_class") or "") == "tamper"


def _meldet(entity: Any) -> bool:
    return str(getattr(entity, "state", {}).get("state") or "") == "on"


def befund(
    entity: Any, jetzt: float, seit: float | None = None
) -> str | None:
    """Was diesem Sensor fehlt - oder ``None`` (rein, testbar).

    ``seit`` ist der Zeitpunkt, seit dem er als nicht verfügbar geführt
    wird. Ohne den zählt ein Ausfall sofort: Wer erst beim
    Scharfschalten hinsieht, hat keine Vorgeschichte, und ein Sensor,
    der in diesem Moment schon weg ist, ist weg.
    """
    if ist_sabotagemelder(entity) and _meldet(entity):
        return SABOTAGE
    if not getattr(entity, "available", True):
        if seit is None or jetzt - seit >= FUNKSTILLE_SEKUNDEN:
            return FUNKSTILLE
        return None
    if getattr(entity, "state", {}).get("low_battery") is True:
        return BATTERIE
    return None


def blindstellen(
    entities: list[Any], jetzt: float, seit: dict[str, float] | None = None
) -> list[dict[str, Any]]:
    """Alle blinden Flecken unter den wachenden Sensoren (rein, testbar).

    Erwartet die Sensoren, die im aktuellen Modus wirklich wachen -
    welche das sind, weiss die Integration (``guarding``). Ein Sensor,
    der in diesem Modus ohnehin nicht zählt, ist kein blinder Fleck: Der
    Bewegungsmelder im Schlafzimmer ist im Nachtmodus absichtlich aus.
    """
    gefunden = []
    for entity in entities:
        art = befund(entity, jetzt, (seit or {}).get(getattr(entity, "id", "")))
        if art is None:
            continue
        gefunden.append(
            {
                "entity_id": str(getattr(entity, "id", "")),
                "label": str(getattr(entity, "label", "") or getattr(entity, "id", "")),
                "art": art,
            }
        )
    # Sabotage zuerst, dann Funkstille, dann Batterie: Die Reihenfolge
    # ist die der Dringlichkeit, und die Nachricht zeigt nur die ersten.
    rang = {SABOTAGE: 0, FUNKSTILLE: 1, BATTERIE: 2}
    return sorted(gefunden, key=lambda zeile: (rang[zeile["art"]], zeile["label"]))


#: Höchstens so viele Namen in der Nachricht - der Rest wird gezählt.
NAMEN = 3


def satz(stellen: list[dict[str, Any]]) -> str:
    """Ein Satz über die blinden Flecken (rein, testbar).

    Die Art steht dabei, nicht bloss der Name: «Kellerfenster» allein
    liesse offen, ob es offen steht oder ob niemand mehr hinsieht - und
    das ist der ganze Unterschied.
    """
    if not stellen:
        return ""
    teile = [f"{zeile['label']}: {WORTE[zeile['art']]}" for zeile in stellen[:NAMEN]]
    rest = len(stellen) - len(teile)
    if rest > 0:
        teile.append(f"und {rest} weitere")
    return " · ".join(teile)


def titel(stellen: list[dict[str, Any]]) -> str:
    """Die Überschrift dazu (rein, testbar).

    Sie richtet sich nach dem Schlimmsten, das dabei ist: Steht Sabotage
    darunter, gehört sie in die Zeile, die man auf dem Sperrbildschirm
    liest - nicht in den Text darunter, den man aufklappen muss.
    """
    if not stellen:
        return ""
    arten = {zeile["art"] for zeile in stellen}
    if SABOTAGE in arten:
        return "Sabotage an der Alarmanlage"
    if FUNKSTILLE in arten:
        anzahl = sum(1 for zeile in stellen if zeile["art"] == FUNKSTILLE)
        return (
            "Alarmanlage: ein Sensor antwortet nicht"
            if anzahl == 1
            else f"Alarmanlage: {anzahl} Sensoren antworten nicht"
        )
    return "Alarmanlage: Batterien werden knapp"


def loest_aus(stellen: list[dict[str, Any]], settings: Any) -> bool:
    """Löst das die Sirene aus? (rein, testbar)

    Nur gemeldete Sabotage, nie die Funkstille, und nur wenn jemand den
    Schalter dafür umgelegt hat. Warum die Vorgabe «nein» ist, steht im
    Kopf dieser Datei: Eine Anlage, die wegen einer Knopfzelle um drei
    Uhr nachts heult, wird nicht mehr scharf geschaltet.
    """
    if not isinstance(settings, dict) or settings.get("sabotage_alarm") is not True:
        return False
    return any(zeile["art"] == SABOTAGE for zeile in stellen)
