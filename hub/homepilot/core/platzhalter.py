"""Platzhalter in Nachrichtentexten (Punkt 251 der Werkbank).

«Die Waschküche hat {sensor.waschkueche_temp} Grad» soll in einer
Push-Nachricht oder Durchsage den Messwert tragen, ohne dass je Wert ein
eigener Ablauf gebaut wird. Erlaubt sind:

  - ``{entity_id}``           → der Zustand des Geräts («on», «21.5»)
  - ``{entity_id.attribut}``  → ein einzelnes Feld («…brightness»)
  - ``{time}``                → die Uhrzeit, die der Aufrufer mitgibt

Unbekannte Platzhalter bleiben unangetastet stehen. Das ist Absicht und
kein Verzicht: Eine Push mit «{tippfehler}» im Text ist auf einen Blick
als Tippfehler zu erkennen und die Nachricht kommt trotzdem an - ein
Ablauf, der wegen eines Platzhalters abstürzt, meldet dagegen gar
nichts, und genau nachts um drei fällt das niemandem auf. Aus demselben
Grund gehen auch die Platzhalter anderer Stellen hier unversehrt durch:
``{termin}``, ``{raum}`` und ``{meldung}`` füllt der Ablauf selbst
(core/terminkontext.py, core/kamera.py), und wer zuerst dran ist, darf
dem anderen nichts zerreissen.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

# Was wie ein Platzhalter aussieht: Buchstaben, Ziffern, Punkt, Strich.
# Kaputte Klammern («{offen» oder «}zu{») passen nicht aufs Muster und
# bleiben damit von selbst stehen - der sicherste Umgang mit ihnen.
MUSTER = re.compile(r"\{([A-Za-z0-9_][A-Za-z0-9_.\-]*)\}")

#: Der Platzhalter für die Uhrzeit. Sie kommt vom Aufrufer herein, nicht
#: aus der Uhr - so bleibt die Funktion rein und im Test steht nie ein
#: «flackernder» Minutenwechsel zwischen Erwartung und Ergebnis.
ZEIT = "time"


def fuellen(
    text: Any,
    nachschlagen: Callable[[str, str], Any],
    jetzt: str | None = None,
) -> str:
    """Platzhalter im Text durch Werte ersetzen (rein, testbar).

    ``nachschlagen(entity_id, attribut)`` liefert den Wert oder None.
    Erst wird der ganze Name als Gerätekennung mit Zustand versucht
    («demo.light» → Zustand), dann der Teil vor dem letzten Punkt mit
    dem Rest als Feld («demo.light.brightness»). Diese Reihenfolge,
    weil Gerätekennungen selbst Punkte tragen - andersherum fände
    «{demo.light}» nie sein Gerät.

    ``jetzt`` ist die fertig formatierte Uhrzeit für ``{time}``; ohne
    sie bleibt auch dieser Platzhalter stehen.
    """

    def ersetzen(treffer: re.Match[str]) -> str:
        name = treffer.group(1)
        if name == ZEIT:
            return jetzt if jetzt is not None else treffer.group(0)
        wert = _wert(name, nachschlagen)
        return treffer.group(0) if wert is None else str(wert)

    return MUSTER.sub(ersetzen, str(text or ""))


def _wert(name: str, nachschlagen: Callable[[str, str], Any]) -> Any:
    """Den Wert zu einem Platzhalter-Namen suchen (rein, testbar).

    Ein Fehler beim Nachschlagen zählt wie «nicht gefunden»: Der
    Platzhalter bleibt stehen, die Nachricht geht raus - siehe Kopf der
    Datei, warum das die richtige Reihenfolge ist.
    """
    try:
        wert = nachschlagen(name, "state")
    except Exception:
        wert = None
    if wert is not None:
        return wert
    if "." not in name:
        return None
    entity_id, _, attribut = name.rpartition(".")
    try:
        return nachschlagen(entity_id, attribut)
    except Exception:
        return None
