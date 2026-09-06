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

from datetime import date
from typing import Any

#: Wo die Antwort auf die Erinnerung liegt: {art, datum, trockentage}.
#: «gegossen» zählt wie Regen - die Zählung beginnt bei der Quittung
#: neu. «passt» heisst: Diese Trockenperiode ist versorgt (Bewässerung,
#: Schattenbalkon, jemand anders giesst) - Ruhe, bis es wieder einmal
#: geregnet hat und eine neue Periode beginnt.
QUITTUNG_KEY = "giessen_quittung"

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


def quittung(art: str, heute: str, trockentage: Any) -> list[dict[str, Any]]:
    """Die Antwort auf die Erinnerung, wie sie in hub.data geht (rein).

    Der Datenspeicher hält Listen - ein Zustand liegt als Liste mit
    einem Eintrag darin, wie beim Babysitter. ``trockentage`` ist der
    Stand des Wetters im Moment der Antwort: Daran erkennt
    ``unterdrueckt`` später, ob es seither geregnet hat.
    """
    try:
        stand = int(trockentage)
    except (TypeError, ValueError):
        stand = 0
    return [{"art": "passt" if art == "passt" else "gegossen", "datum": str(heute), "trockentage": stand}]


def quittung_lesen(rows: Any) -> dict[str, Any] | None:
    """Die abgelegte Antwort - oder None (rein, testbar)."""
    for row in rows or []:
        if isinstance(row, dict) and row.get("art") and row.get("datum"):
            return row
    return None


def unterdrueckt(
    rows: Any, dry_days: Any, heute: str, mindest_tage: int = 3
) -> bool:
    """Hält die Antwort von neulich die Erinnerung zurück? (rein, testbar)

    Der gemeldete Fall: «Hier soll man sagen können, dass man gegossen
    hat - oder ob passt so.» Ohne das kam die Meldung jeden Abend
    wieder, als wäre nichts geschehen.

    - **gegossen** zählt wie Regen: Ruhe, bis seit der Quittung wieder
      ``mindest_tage`` (trockene) Tage vergangen sind.
    - **passt** heisst: Diese Trockenperiode ist versorgt - Ruhe, bis es
      wieder einmal geregnet hat.

    Ob es seit der Quittung geregnet hat, verrät das Wetter selbst:
    Ohne Regen wächst ``dry_days`` Tag für Tag weiter - bleibt es hinter
    «Stand von damals plus vergangene Tage» zurück, wurde die Zählung
    unterwegs auf null gestellt. Dann ist die Quittung verbraucht, und
    die nächste Trockenperiode beginnt von vorn. Kaputte oder künftige
    Daten unterdrücken nichts: Lieber eine Meldung zu viel als ein
    vertrockneter Balkon.
    """
    zeile = quittung_lesen(rows)
    if zeile is None:
        return False
    try:
        dann = date.fromisoformat(str(zeile.get("datum")))
        jetzt = date.fromisoformat(str(heute))
        trocken = int(dry_days or 0)
        stand_dann = int(zeile.get("trockentage") or 0)
    except (TypeError, ValueError):
        return False
    tage_seit = (jetzt - dann).days
    if tage_seit < 0:
        return False
    if trocken < stand_dann + tage_seit:
        # Es hat seither geregnet - neue Trockenperiode, neue Frage.
        return False
    if zeile.get("art") == "passt":
        return True
    return tage_seit < max(1, int(mindest_tage))
