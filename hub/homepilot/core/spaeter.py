"""«Später erinnern» – die Warteschlange dazu.

Eine Meldung kommt zur Unzeit: «Fenster offen», während man am Herd
steht. Wegwischen heisst vergessen, und die nächste Erinnerung kommt bei
den meisten Meldungen erst wieder, wenn sich der Zustand ändert - beim
offenen Fenster also gar nicht mehr (core/watchdog.py meldet einmal je
Öffnung).

Deshalb der Knopf «Später» in der Mitteilung (core/push.py: knoepfe) und
diese Schlange dahinter: Die App legt die Meldung mit einem Zeitpunkt
zurück, der Wächter schickt sie im nächsten Takt danach noch einmal.

Reines Rechnen über Listen - wer schickt, ist der Wächter; wer einreiht,
ist die Route. Bewusst dieselbe Meldung noch einmal und keine neue: Wer
«in 30 Minuten» wählt, will genau diesen Satz wieder lesen, nicht eine
Zusammenfassung dessen, was inzwischen gilt.
"""

from __future__ import annotations

from typing import Any

#: Schlüssel, unter dem die Schlange in hub.data liegt.
SCHLANGE = "push_snooze"

#: Mehr als das wartet nicht. Ein Telefon, das eine Woche lang jede
#: weggeschobene Meldung sammelt, schüttet sie irgendwann alle auf einmal
#: aus - und das ist schlimmer als die eine, die man verpasst hat.
HOECHSTENS = 50
#: So lange darf man höchstens schieben. Alles darüber ist kein
#: «später», sondern ein «nie», und dafür gibt es das Wegwischen.
MAX_MINUTEN = 24 * 60


def minuten_pruefen(wert: Any) -> int:
    """Eine brauchbare Wartezeit daraus machen (rein, testbar).

    Unsinn wird zu einer halben Stunde: Das ist die Zeit, die man meint,
    wenn man auf «später» drückt, ohne darüber nachzudenken.
    """
    try:
        minuten = int(wert)
    except (TypeError, ValueError):
        return 30
    if minuten <= 0:
        return 30
    return min(minuten, MAX_MINUTEN)


def einreihen(
    rows: Any, eintrag: dict[str, Any], jetzt: float, minuten: Any = 30
) -> list[dict[str, Any]]:
    """Eine Meldung zurücklegen (rein, testbar).

    Dieselbe Meldung ein zweites Mal zu schieben verschiebt sie, statt
    sie zu verdoppeln: Wer zweimal auf «später» drückt, will sie einmal
    wiedersehen, nicht zweimal.

    ``ziel`` reist mit, wenn eines dabei ist: Dieselbe Schlange trägt
    seit Neuestem auch die selbst gestellten Erinnerungen an ein Gerät
    («sag mir in zwei Stunden Bescheid»), und die sollen beim Antippen
    dorthin führen (core/pushziel.py).
    """
    titel = str(eintrag.get("title") or "").strip()
    if not titel:
        return [row for row in rows or [] if isinstance(row, dict)]
    faellig = jetzt + minuten_pruefen(minuten) * 60
    neu = {
        "title": titel,
        "body": str(eintrag.get("body") or ""),
        "category": str(eintrag.get("category") or "") or None,
        "to": str(eintrag.get("to") or "") or None,
        "at": faellig,
    }
    if eintrag.get("ziel"):
        neu["ziel"] = str(eintrag["ziel"])
    behalten = [
        row
        for row in rows or []
        if isinstance(row, dict) and str(row.get("title") or "") != titel
    ]
    behalten.append(neu)
    behalten.sort(key=lambda row: float(row.get("at") or 0))
    return behalten[-HOECHSTENS:]


def faellig(rows: Any, jetzt: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Was jetzt raus muss – und was liegen bleibt (rein, testbar)."""
    dran: list[dict[str, Any]] = []
    rest: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        try:
            zeitpunkt = float(row.get("at") or 0)
        except (TypeError, ValueError):
            continue
        (dran if zeitpunkt <= jetzt else rest).append(row)
    return dran, rest
