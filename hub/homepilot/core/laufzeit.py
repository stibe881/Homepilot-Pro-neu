"""Wie weit ist die Maschine? – für Widget und Sperrbildschirm.

Die Waschmaschine meldet «noch 23 Minuten», und das ist die halbe
Auskunft: Ob das viel oder wenig ist, weiss nur, wer die Programmdauer
kennt. Ein Balken beantwortet dieselbe Frage im Vorbeigehen, ohne dass
man rechnet – aber nur, wenn er ehrlich ist.

Ehrlich heisst hier: Die Gesamtdauer wird nicht geraten. Die meisten
Maschinen nennen nur die Restzeit, nie die Programmlänge. Woher der Hub
sie trotzdem weiss: Er schreibt jeden fertigen Lauf mit
(``appliance_cycles`` im Wächter). Der Mittelwert der letzten Läufe
*desselben* Geräts ist die beste Schätzung, die es ohne Handbuch gibt –
und mit weniger als zwei Läufen gibt es eben keinen Balken, sondern nur
die Zahl.

Das ist auch der Grund, warum nicht einfach eine feste Stunde
angenommen wird: Ein Tumbler läuft doppelt so lang wie eine
Kurzwäsche, und ein Balken, der bei 30 Minuten Restzeit «fast fertig»
zeigt, obwohl noch eine Stunde kommt, ist schlimmer als kein Balken.
"""

from __future__ import annotations

from statistics import median
from typing import Any

#: Unter so vielen aufgezeichneten Läufen bleibt der Balken weg.
MINDEST_LAEUFE = 2

#: So viele vergangene Läufe fliessen in die Schätzung ein. Mehr wäre
#: Gedächtnis für ein Gerät, dessen Programme sich ohnehin ändern.
LETZTE_LAEUFE = 8

#: Mehr Geräte zeigt kein Widget - und mehr laufen selten zugleich.
HOECHSTENS = 3


def typische_dauer(cycles: Any, entity_id: str) -> float | None:
    """Wie lange dieses Gerät üblicherweise läuft, in Minuten (rein, testbar).

    Der Median und nicht der Mittelwert: Ein abgebrochener Lauf von zwei
    Minuten zieht einen Mittelwert nach unten und den Balken damit nach
    oben - er behauptete dann Fortschritt, den es nicht gibt.
    """
    dauern: list[float] = []
    for eintrag in cycles or []:
        if not isinstance(eintrag, dict) or eintrag.get("entity_id") != entity_id:
            continue
        try:
            sekunden = float(eintrag.get("seconds") or 0)
        except (TypeError, ValueError):
            continue
        if sekunden > 0:
            dauern.append(sekunden / 60)
        if len(dauern) >= LETZTE_LAEUFE:
            break
    if len(dauern) < MINDEST_LAEUFE:
        return None
    return round(median(dauern), 1)


def fortschritt(rest_minuten: Any, dauer_minuten: float | None) -> float | None:
    """Anteil zwischen 0 und 1 – oder nichts (rein, testbar).

    Läuft die Maschine länger als üblich (anderes Programm, Vorwäsche),
    steht der Balken still statt rückwärts zu laufen: Ein Balken, der
    schrumpft, sieht nach Fehler aus.
    """
    if not dauer_minuten or dauer_minuten <= 0:
        return None
    try:
        rest = float(rest_minuten)
    except (TypeError, ValueError):
        return None
    if rest < 0:
        return None
    anteil = (dauer_minuten - rest) / dauer_minuten
    return round(max(0.0, min(1.0, anteil)), 2)


def laufende(
    entities: list[Any], cycles: Any = None, hoechstens: int = HOECHSTENS
) -> list[dict[str, Any]]:
    """Die gerade laufenden Haushaltgeräte fürs Widget (rein, testbar).

    Der Grill fällt heraus: Er ist auch ein «appliance», führt aber ein
    Temperaturziel statt einer Restzeit - für ihn wäre ein Zeitbalken
    eine Erfindung (dieselbe Unterscheidung wie in core/livekarten.py).

    Wer am kürzesten braucht, steht oben: Das ist das Gerät, für das man
    aufsteht.
    """
    zeilen: list[dict[str, Any]] = []
    for entity in entities:
        if getattr(entity, "kind", "") != "appliance":
            continue
        if str(entity.state.get("state") or "") != "running":
            continue
        if entity.state.get("target") is not None:
            continue
        rest = entity.state.get("minutes_left")
        dauer = typische_dauer(cycles, entity.id)
        try:
            rest_min = int(round(float(rest))) if rest is not None else None
        except (TypeError, ValueError):
            rest_min = None
        zeilen.append(
            {
                "id": entity.id,
                "name": entity.label,
                "program": str(entity.state.get("program") or "") or None,
                "minutes_left": rest_min,
                "percent": fortschritt(rest_min, dauer),
            }
        )
    # Ohne Restzeit ans Ende: «läuft» ist eine schwächere Auskunft als
    # «noch 12 Minuten», und der Platz oben gehört der stärkeren.
    zeilen.sort(key=lambda z: (z["minutes_left"] is None, z["minutes_left"] or 0))
    return zeilen[:hoechstens]
