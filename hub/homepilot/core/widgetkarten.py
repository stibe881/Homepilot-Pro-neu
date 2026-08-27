"""Was ein einzelnes Widget über sein Gerät wissen muss.

Bis hierher gab es genau ein Widget: eine Knopfleiste mit Türstatus. Wer
wissen wollte, ob das Küchenlicht brennt, musste die App öffnen - obwohl
ein Widget dafür gemacht ist, im Vorbeigehen gelesen zu werden.

Jetzt darf man sich Widgets zusammenstellen, je eines für ein Gerät oder
eine Szene. Dafür braucht der Widget-Prozess zweierlei, was ihm bisher
niemand geben konnte: den Namen und den Zustand - und zwar in Worten, wie
sie auch in der App stehen. Ein Widget, das «on» anzeigt, hat den Weg von
der Steckdose bis zum Homescreen umsonst gemacht.

Bewusst hier und nicht im Widget selbst: Deutsch gehört dorthin, wo es
schon steht, und ein Widget in Swift soll keine zweite Wortliste pflegen.
"""

from __future__ import annotations

from typing import Any

from .entity import Entity

## Was «eingeschaltet» heisst - je nach Geräteart dasselbe Wort für
## verschiedene Zustände. Der Punkt in der Anzeige ist der gleiche: Hier
## läuft etwas.
AN_ZUSTAENDE = frozenset(
    {"on", "open", "opening", "playing", "cleaning", "unlocked", "triggered"}
)

## Zustand → Wort. Was hier nicht steht, wird durchgereicht: Ein
## Messwert ist sein eigener Text, und «24.5» braucht keine Übersetzung.
WORTE: dict[str, str] = {
    "on": "an",
    "off": "aus",
    "open": "offen",
    "closed": "zu",
    "opening": "öffnet",
    "closing": "schliesst",
    "locked": "verriegelt",
    "unlocked": "offen",
    "playing": "spielt",
    "paused": "pausiert",
    "idle": "bereit",
    "standby": "bereit",
    "cleaning": "saugt",
    "docked": "in der Station",
    "returning": "fährt heim",
    "charging": "lädt",
    "armed": "scharf",
    "armed_away": "scharf",
    "armed_home": "scharf (zuhause)",
    "armed_night": "scharf (Nacht)",
    "disarmed": "unscharf",
    "triggered": "ausgelöst",
    "unavailable": "nicht erreichbar",
}


def ist_an(zustand: Any) -> bool:
    """Brennt es, läuft es, steht es offen? (rein, testbar)"""
    return str(zustand).casefold() in AN_ZUSTAENDE


def zustand_text(entity: Entity) -> str:
    """Der Zustand in einem Wort - so kurz, wie ein Widget Platz hat.

    Messwerte bekommen ihre Einheit mit: «21 °C» ist eine Aussage, «21»
    ist ein Rätsel. Was der Hub nicht kennt, geht unverändert durch -
    lieber ein englisches Wort als ein leeres Feld.
    """
    roh = entity.state.get("state")
    if roh is None:
        return "–"
    wort = WORTE.get(str(roh).casefold())
    if wort is not None:
        return wort
    einheit = entity.state.get("unit")
    if isinstance(roh, (int, float)) or (isinstance(roh, str) and _ist_zahl(roh)):
        zahl = _kurz(roh)
        return f"{zahl} {einheit}".strip() if einheit else zahl
    return str(roh)


def _ist_zahl(text: str) -> bool:
    try:
        float(text)
    except ValueError:
        return False
    return True


def _kurz(wert: Any) -> str:
    """Eine Nachkommastelle genügt - im Widget zählt jede Ziffer Platz."""
    try:
        zahl = float(wert)
    except (TypeError, ValueError):
        return str(wert)
    if abs(zahl - round(zahl)) < 0.05:
        return str(int(round(zahl)))
    return f"{zahl:.1f}".replace(".", ",")


def zeilen(entities: list[Entity], ids: list[str]) -> list[dict[str, Any]]:
    """Zu den gefragten Kennungen je eine Zeile fürs Widget (rein, testbar).

    Die Reihenfolge ist die der Frage, nicht die des Bestands: Das Widget
    hat seine Karten in einer bestimmten Ordnung hinterlegt. Was es nicht
    mehr gibt, fällt still heraus - ein Widget für ein abgebautes Gerät
    soll leer bleiben und nicht das nächstbeste zeigen.
    """
    bestand = {entity.id: entity for entity in entities}
    ausgabe = []
    for kennung in ids:
        entity = bestand.get(kennung)
        if entity is None:
            continue
        ausgabe.append(
            {
                "id": entity.id,
                "name": entity.label,
                "kind": entity.kind,
                "text": zustand_text(entity),
                "on": ist_an(entity.state.get("state")),
                "available": bool(entity.available),
            }
        )
    return ausgabe


def gefragte_ids(roh: str | None, hoechstens: int = 12) -> list[str]:
    """Aus «a,b,c» eine Liste machen - gedeckelt (rein, testbar).

    Der Deckel ist keine Schikane: Die Frage kommt aus einem Widget, das
    seit Monaten auf einem Homescreen liegt, und eine Adresse mit
    dreihundert Kennungen wäre eine Anfrage, die den Hub beschäftigt,
    ohne dass jemand hinsieht.
    """
    if not roh:
        return []
    gesehen: list[str] = []
    for teil in roh.split(","):
        kennung = teil.strip()
        if kennung and kennung not in gesehen:
            gesehen.append(kennung)
        if len(gesehen) >= hoechstens:
            break
    return gesehen
