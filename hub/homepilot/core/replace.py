"""Ein Gerät durch ein anderes ersetzen.

Der Fall: Eine Lampe geht kaputt, die neue meldet sich unter einer
anderen Kennung. Damit zeigen alle Verweise ins Leere – Szenen, Abläufe,
Favoriten, die Raumzuordnung, die zusammengefassten Leuchten. Und weil
nichts davon einen Fehler wirft (der Hub überspringt nur stillschweigend,
was er nicht kennt), merkt man es erst Wochen später, wenn abends ein
Licht nicht mehr angeht.

Von Hand ist das eine halbe Stunde Suchen an sechs Stellen. Hier ist es
eine reine Umschreibung: alte Kennung raus, neue rein – in allen
gespeicherten Daten auf einmal.

Bewusst als reine Funktionen über einfache Listen: So lässt sich jede
Stelle prüfen, ohne einen Hub zu starten, und es bleibt sichtbar, welche
Datenformen es überhaupt gibt.
"""

from __future__ import annotations

from typing import Any


def swap_in_actions(actions: list[dict[str, Any]], old: str, new: str) -> int:
    """Aktionen einer Szene oder eines Ablaufs umschreiben (rein).

    Gibt zurück, wie viele Stellen betroffen waren – die Zahl ist die
    Antwort auf «hat es etwas gebracht?».
    """
    count = 0
    for action in actions:
        if action.get("entity_id") == old:
            action["entity_id"] = new
            count += 1
        # «Gemeinsam umschalten» nennt seine Geräte in einer Liste. Ohne
        # diesen Zweig bliebe genau dort die alte Kennung stehen - und das
        # ist der Fehler, gegen den es diese Datei gibt.
        liste = action.get("entity_ids")
        if isinstance(liste, list):
            for index, entry in enumerate(liste):
                if entry == old:
                    liste[index] = new
                    count += 1
    return count


def _swap_in_condition(condition: dict[str, Any], old: str, new: str) -> int:
    """Eine Bedingung samt Untergruppen (rein).

    Bedingungsgruppen ({type: group, conditions: [...]}) schachteln
    beliebig tief - ein flacher Durchlauf liesse genau die Verweise
    stehen, die in einer Gruppe stecken.
    """
    count = 0
    if condition.get("entity_id") == old:
        condition["entity_id"] = new
        count += 1
    for sub in condition.get("conditions") or []:
        if isinstance(sub, dict):
            count += _swap_in_condition(sub, old, new)
    return count


def swap_in_automation(automation: dict[str, Any], old: str, new: str) -> int:
    """Alle Stellen eines Ablaufs (rein).

    Ein Ablauf verweist an vier Stellen auf Geräte, und es genügt nicht,
    nur die Aktionen zu ändern: Ein Bewegungsmelder, der ausgetauscht
    wird, steht im Auslöser; ein «warte bis» in einer Aktion; und
    «otherwise» ist der Zweig, den man beim Suchen von Hand am ehesten
    übersieht.
    """
    count = 0
    # Gespeichert wird in der Einzahl-Form der config.yaml (trigger,
    # condition, action); die App spricht in der Mehrzahl. Beides
    # bedienen, statt sich auf eine Schreibweise zu verlassen - sonst
    # greift das Ersetzen genau dort nicht, wo die Daten wirklich liegen.
    for key in ("trigger", "triggers"):
        for entry in automation.get(key) or []:
            if isinstance(entry, dict) and entry.get("entity_id") == old:
                entry["entity_id"] = new
                count += 1
    for key in ("condition", "conditions"):
        for entry in automation.get(key) or []:
            if isinstance(entry, dict):
                count += _swap_in_condition(entry, old, new)
    for key in ("action", "actions", "otherwise"):
        count += swap_in_actions(automation.get(key) or [], old, new)
    return count


def swap_in_rows(
    rows: list[dict[str, Any]], old: str, new: str, field: str = "entity_id"
) -> int:
    """Einfache Zeilen mit einem Kennungsfeld (Räume, Metadaten) (rein)."""
    count = 0
    for row in rows:
        if row.get(field) == old:
            row[field] = new
            count += 1
    return count


def swap_in_light_groups(rows: list[dict[str, Any]], old: str, new: str) -> int:
    """Mitglieder zusammengefasster Leuchten (rein).

    Die neue Lampe rutscht an die Stelle der alten, statt hinten
    angehängt zu werden: In einer Deckenlampe mit fünf Spots ist die
    Reihenfolge die räumliche.
    """
    count = 0
    for row in rows:
        members = row.get("members")
        if not isinstance(members, list):
            continue
        for index, member in enumerate(members):
            if member == old:
                members[index] = new
                count += 1
    return count


def stale_entity_rows(
    rows: list[dict[str, Any]], known: set[str], loaded: set[str]
) -> list[str]:
    """Verwaiste Kennungen in entity_meta/entity_rooms (rein, testbar).

    Verwaist heisst: Das Gerät gibt es nicht mehr, obwohl seine
    Integration läuft. Die zweite Bedingung ist der Kern - eine
    Integration, die heute nicht startet (Bridge aus, Cloud zickt), lässt
    ihre Geräte nur *vorübergehend* verschwinden, und deren Namen und
    Räume wegzuwerfen wäre genau der Fehlgriff, vor dem diese Funktion
    schützen soll.
    """
    weg: list[str] = []
    for row in rows or []:
        entity_id = str(row.get("entity_id") or "")
        if not entity_id or entity_id in known:
            continue
        integration = entity_id.split(".", 1)[0]
        if integration in loaded:
            weg.append(entity_id)
    return weg


def swap_in_list(values: list[Any], old: str, new: str) -> int:
    """Blosse Kennungslisten (Favoriten, Ausgeblendete, Gesperrte) (rein).

    Steht die neue Kennung schon drin, fällt die alte weg statt doppelt
    zu werden.
    """
    count = 0
    for index, value in enumerate(list(values)):
        if value == old:
            if new in values:
                values.remove(old)
            else:
                values[index] = new
            count += 1
    return count
