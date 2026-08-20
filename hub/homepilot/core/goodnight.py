"""Gute Nacht: der letzte Gang durchs Haus als ein Knopf.

Lichter aus (ausser den Nachtlichtern), dann der Bericht: Welche Fenster
stehen offen, welche Tür ist nicht abgeschlossen - und auf Wunsch geht
die Alarmanlage in den Nachtmodus.

Bewusst wird nur gemeldet, nicht abgeschlossen: Eine Tür, die sich um
22 Uhr von selbst verriegelt, sperrt irgendwann jemanden aus. Melden und
selber entscheiden ist die richtige Arbeitsteilung.
"""

from __future__ import annotations

from typing import Any

from .watchdog import open_contacts


def lights_to_off(entities: list[Any], keep: list[str]) -> list[Any]:
    """Welche Lichter jetzt ausgehen (rein, testbar).

    Nur Lichter, keine Steckdosen: Hinter einem Schalter kann der Router
    oder die Tiefkühltruhe hängen - «alles aus» wäre dort ein teurer
    Knopf. Spots, die in einer zusammengefassten Leuchte aufgehen, werden
    übersprungen; ihre Leuchte bekommt den Befehl selbst.
    """
    keep_set = set(keep)
    return [
        entity
        for entity in entities
        if entity.kind == "light"
        and str(entity.state.get("state")) == "on"
        and entity.id not in keep_set
        and not getattr(entity, "combined_into", None)
    ]


def unlocked_locks(entities: list[Any]) -> list[Any]:
    """Türen, die nicht abgeschlossen sind (rein, testbar)."""
    return [
        entity
        for entity in entities
        if entity.kind == "lock" and str(entity.state.get("state")) == "unlocked"
    ]


def open_windows(entities: list[Any]) -> list[Any]:
    """Offene Fenster und Türen - dieselbe Auswahl wie beim Wächter."""
    return open_contacts(entities)
