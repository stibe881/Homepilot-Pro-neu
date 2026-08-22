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
