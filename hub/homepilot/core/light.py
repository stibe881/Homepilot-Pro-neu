"""Licht, das zur Umgebung passt: aus Lux wird Helligkeit.

Ein Bewegungs- oder Präsenzmelder mit Helligkeitsfühler weiss, wie dunkel
es dort gerade ist, wo das Licht angehen soll. Bisher blieb dieses Wissen
ungenutzt: Ein Ablauf konnte «Licht an» sagen und höchstens eine feste
Prozentzahl mitgeben. Beides ist zur falschen Zeit falsch – volle
Deckenbeleuchtung um drei Uhr nachts blendet, und dieselben 20 %, die
nachts angenehm sind, sieht am trüben Nachmittag niemand.

Die Richtung ist deshalb: je dunkler die Umgebung, desto zurückhaltender
die Lampe. Nicht andersherum. Der Weg zur Toilette braucht ein Nachtlicht,
der Flur am grauen Novembernachmittag eine Lampe, die gegen das Tageslicht
ankommt.

Gerechnet wird logarithmisch, weil das Auge so sieht: Von 1 auf 10 Lux ist
gefühlt derselbe Sprung wie von 10 auf 100 – linear gerechnet läge die
halbe Kennlinie im Bereich, den man nie erlebt.
"""

from __future__ import annotations

import math
from typing import Any

# Die Grenzen der Kennlinie. Unten kein Nullwert: «angepasst» heisst
# gedämpft, nicht aus – eine Lampe, die auf 0 % «angeht», wäre ein Fehler,
# den niemand als solchen erkennt.
MIN_PERCENT = 15
MAX_PERCENT = 100

# Ab dieser Umgebungshelligkeit gibt die Lampe alles. 150 Lux sind ein
# trüber Tag am Fenster; darüber ist ohnehin selten Licht nötig.
FULL_LUX = 150.0


def brightness_from_lux(
    lux: float, minimum: int = MIN_PERCENT, maximum: int = MAX_PERCENT
) -> int:
    """Die passende Lampenhelligkeit in Prozent (rein, testbar).

    0 Lux (stockdunkel) ergibt das Minimum, {@link FULL_LUX} und mehr das
    Maximum, dazwischen wird logarithmisch übergeblendet.
    """
    try:
        wert = float(lux)
    except (TypeError, ValueError):
        return maximum
    if not math.isfinite(wert) or wert <= 0:
        return minimum
    anteil = math.log10(wert + 1) / math.log10(FULL_LUX + 1)
    anteil = max(0.0, min(1.0, anteil))
    return int(round(minimum + anteil * (maximum - minimum)))


# Wann das Licht wie hell sein soll, wenn es sich nach der Uhr richtet.
# Die Anker stammen aus dem Haushalt und nicht aus einer Formel: Um sechs
# steht der Erste auf, um acht ist der Tag da, um sechs am Abend fängt
# das Dämmern an, und um zehn geht das erste Kind ins Bett.
NACHT_ENDE = 6.0
TAG_BEGINN = 8.0
TAG_ENDE = 18.0
NACHT_BEGINN = 22.0


def brightness_from_time(
    stunde: float,
    minute: float = 0.0,
    minimum: int = MIN_PERCENT,
    maximum: int = MAX_PERCENT,
) -> int:
    """Die Lampenhelligkeit nach der Uhr (rein, testbar).

    Die zweite Antwort auf dieselbe Frage wie ``brightness_from_lux``:
    Volle Deckenbeleuchtung um drei Uhr nachts blendet. Nur braucht diese
    hier keinen Fühler - und genau darum gibt es sie. Die Anpassung an
    die Umgebungshelligkeit setzt einen Melder voraus, der Lux meldet;
    in den meisten Räumen des Hauses steht keiner.

    Dafür weiss sie weniger: Ein Gewitternachmittag ist ihr so hell wie
    ein Julitag. Wer einen Fühler hat, nimmt den anderen Weg.

    Nachts das Minimum, tagsüber voll, dazwischen linear übergeblendet -
    linear und nicht logarithmisch wie bei den Lux, weil hier die Uhr
    gemeint ist und nicht das Auge.
    """
    try:
        uhr = float(stunde) + float(minute) / 60.0
    except (TypeError, ValueError):
        return maximum
    if not math.isfinite(uhr):
        return maximum
    uhr %= 24.0
    if uhr < NACHT_ENDE or uhr >= NACHT_BEGINN:
        anteil = 0.0
    elif uhr < TAG_BEGINN:
        anteil = (uhr - NACHT_ENDE) / (TAG_BEGINN - NACHT_ENDE)
    elif uhr < TAG_ENDE:
        anteil = 1.0
    else:
        anteil = (NACHT_BEGINN - uhr) / (NACHT_BEGINN - TAG_ENDE)
    return int(round(minimum + anteil * (maximum - minimum)))


def raum_lux(entities: list[Any], raum: str | None) -> float | None:
    """Die gemessene Helligkeit in einem Raum (rein, testbar).

    Der zweite Weg zu einem Lux-Wert: Bisher zählte nur, was der Melder
    meldete, der den Ablauf ausgelöst hat. Das passt für ein
    Bewegungslicht und für sonst nichts - «wenn es 18:00 ist, mach das
    Wohnzimmerlicht an» hat gar keinen Melder, und die Wahl «an die
    Helligkeit angepasst» stand deshalb gar nicht erst zur Verfügung.

    Gefragt wird der Raum, in dem die Lampe steht: Ein Fühler zwei
    Zimmer weiter sagt nichts über das Licht hier.
    """
    if not raum:
        return None
    for entity in entities or []:
        if getattr(entity, "room", None) != raum:
            continue
        wert = getattr(entity, "state", {}).get("illumination")
        if isinstance(wert, (int, float)) and not isinstance(wert, bool):
            return float(wert)
    return None


def lux_sources(triggers: list[dict[str, Any]]) -> list[str]:
    """Die Geräte, die als Helligkeitsquelle in Frage kommen (rein, testbar).

    Das sind schlicht die Auslöser des Ablaufs, in ihrer Reihenfolge: Wer
    «wenn der Melder im Flur Bewegung sieht» schreibt, meint mit «an die
    Helligkeit angepasst» die Helligkeit an genau dieser Stelle. Ob das
    Gerät überhaupt Lux meldet, entscheidet sich erst am Zustand – hier
    steht nur, wen man fragen würde.
    """
    ids: list[str] = []
    for trigger in triggers or []:
        if not isinstance(trigger, dict):
            continue
        entity_id = trigger.get("entity_id")
        if isinstance(entity_id, str) and entity_id and entity_id not in ids:
            ids.append(entity_id)
    return ids


# Zustände, die als «an» zählen. Dieselbe Liste führt die group-Integration
# für ihre eigene Frage («ist die Leuchte an?») – hier steht sie erneut,
# weil der Kern nicht von einer Integration abhängen soll.
ON_STATES = ("on", "true", "open", "playing")


def common_target(states: list[Any]) -> str:
    """Gemeinsam umschalten: «alle an» oder «alle aus»? (rein, testbar)

    Der Fall dahinter: Ein Wandtaster schaltet das Licht im Eingang und im
    Gang. Drei einzelne «umschalten» machen daraus zuverlässig das
    Gegenteil – ist eines an und eines aus, sind danach beide vertauscht,
    aber nie beide gleich. Wer zweimal drückt, ist wieder am Anfang.

    Deshalb wird nach der Gruppe gefragt, nicht nach jeder Lampe: Ist
    alles an, geht alles aus; sonst geht alles an. Der erste Druck bringt
    damit immer Licht – und das ist der Druck, den jemand im Dunkeln tut.

    Lampen, die gerade nicht erreichbar sind (``None``), zählen nicht mit:
    Eine stumme Lampe soll die Entscheidung für die anderen nicht kippen.
    """
    bekannt = [str(state) for state in states if state is not None]
    if bekannt and all(state in ON_STATES for state in bekannt):
        return "turn_off"
    return "turn_on"
