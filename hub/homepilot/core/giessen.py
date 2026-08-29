"""Giess-Erinnerung: wann der Himmel es nicht macht.

Die Frage stellt sich im Sommer jeden Abend, und beantwortet wird sie
mit einem Blick auf die Erde – wenn man daran denkt. Der Hub weiss die
halbe Antwort ohnehin: Er holt das Wetter, also weiss er, wann es
zuletzt geregnet hat und ob heute Nacht etwas kommt.

Drei Bedingungen, und alle drei müssen zusammenkommen:

*Es hat länger nicht geregnet.* Ein trockener Tag ist normal, drei sind
der Balkon.

*Es kommt auch nichts.* Wer abends giesst, obwohl es um zehn regnet,
giesst zweimal. Die Vorhersage der nächsten zwei Tage entscheidet mit.

*Es war warm.* Bei 14 Grad verdunstet nichts, da hält die Erde eine
Woche.

Gemeldet wird abends: Morgens giessen verdunstet, mittags verbrennt,
und wer es um zehn Uhr liest, hat es um sieben vergessen.
"""

from __future__ import annotations

from typing import Any

#: Weniger Niederschlag zählt als trockener Tag. Ein halber Millimeter
#: ist Tau, kein Regen - er kommt nicht bis an die Wurzeln.
TROCKEN_MM = 1.0

#: So viel Regen in den nächsten Tagen erspart das Giessen.
REICHT_MM = 3.0


def _mm(wert: Any) -> float:
    try:
        return float(wert)
    except (TypeError, ValueError):
        return 0.0


def trockentage(vergangen: list[dict[str, Any]], heute: dict[str, Any] | None) -> int:
    """Wie viele Tage in Folge es nicht geregnet hat (rein, testbar).

    Heute zählt mit: Ein Regenschauer am Mittag beendet die Trockenheit,
    auch wenn die drei Tage davor staubig waren.
    """
    if heute is not None and _mm(heute.get("rain_mm")) >= TROCKEN_MM:
        return 0
    tage = 1 if heute is not None else 0
    for eintrag in reversed(vergangen or []):
        if _mm(eintrag.get("rain_mm")) >= TROCKEN_MM:
            break
        tage += 1
    return tage


def regen_kommt(tage: list[dict[str, Any]], wieviele: int = 2) -> float:
    """Wie viel Regen die nächsten Tage bringen (rein, testbar).

    Der heutige Tag zählt nicht mit: Was heute schon gefallen ist, steht
    in ``trockentage``; hier geht es um das, was noch kommt.
    """
    return round(sum(_mm(eintrag.get("rain_mm")) for eintrag in (tage or [])[1 : 1 + wieviele]), 1)


def soll_giessen(
    stand: Any, mindest_tage: int = 3, mindest_grad: float = 18.0
) -> bool:
    """Alle drei Bedingungen zusammen (rein, testbar)."""
    if not isinstance(stand, dict):
        return False
    try:
        trocken = int(stand.get("dry_days") or 0)
        kommt = float(stand.get("rain_next") or 0)
        warm = float(stand.get("high") or 0)
    except (TypeError, ValueError):
        return False
    return trocken >= mindest_tage and kommt < REICHT_MM and warm >= mindest_grad


def satz(stand: Any) -> str:
    """Die Meldung (rein, testbar)."""
    trocken = int((stand or {}).get("dry_days") or 0)
    return (
        f"Seit {trocken} Tagen kein Regen, und es kommt keiner. "
        "Balkon und Beete hätten gern Wasser."
    )
