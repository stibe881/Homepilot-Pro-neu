"""Wie lange die Batterie noch reicht – aus ihrem eigenen Tempo gerechnet.

«12 %» ist keine Antwort auf die Frage, die man wirklich hat: Muss ich
diese Woche eine Batterie kaufen oder erst im Frühling? Die Antwort
steckt im Tempo, mit dem der Stand fällt - und das ist je Gerät völlig
verschieden: Ein Fensterkontakt verliert ein Prozent im Monat, ein
Bewegungsmelder im Flur eines pro Woche.

Dafür merkt sich der Hub **einen Stand je Gerät und Woche** (mehr
braucht die Rechnung nicht, Batterien fallen über Monate) und legt eine
Gerade hindurch. Erst ab drei Wochenwerten über mindestens drei Wochen
gibt es eine Aussage - zwei Punkte sind keine Kurve, und ein geschätzter
Termin, der jede Woche um Monate springt, wäre schlimmer als keiner.

Steigt der Stand (Batterie gewechselt), beginnt die Reihe neu: Die alte
Batterie sagt nichts über die neue.
"""

from __future__ import annotations

from datetime import date
from typing import Any

#: Wo die Wochenstände liegen.
STORE_KEY = "battery_verlauf"

#: So viele Wochenwerte je Gerät bleiben stehen - ein halbes Jahr.
WOCHEN = 26

#: Unter diesem Gefälle (Prozent je Tag) gilt der Stand als stabil -
#: Messrauschen, keine Entladung. 0.02 %/Tag wären fünf Jahre für eine
#: volle Batterie; feiner rechnen heisst raten.
MIN_GEFAELLE = 0.02


def _woche(tag: date) -> str:
    jahr, woche, _ = tag.isocalendar()
    return f"{jahr}-W{woche:02d}"


def aufnehmen(
    rows: Any, entity_id: str, prozent: float, heute: date
) -> list[dict[str, Any]]:
    """Den Wochenstand eines Geräts vermerken (rein, testbar).

    Ein Wert je Woche, der jüngste gewinnt: Innerhalb der Woche zählt
    der letzte gemeldete Stand. Steigt der Stand deutlich (Batterie
    gewechselt), fliegt die alte Reihe raus - sie beschreibt eine
    Batterie, die es nicht mehr gibt.
    """
    woche = _woche(heute)
    eigene = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and row.get("entity_id") == entity_id
    ]
    fremde = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and row.get("entity_id") != entity_id
    ]
    letzter = eigene[-1] if eigene else None
    if letzter is not None and prozent > float(letzter.get("percent") or 0) + 10:
        eigene = []
    if eigene and eigene[-1].get("week") == woche:
        eigene[-1] = {**eigene[-1], "percent": float(prozent)}
    else:
        eigene.append({"entity_id": entity_id, "week": woche, "percent": float(prozent)})
    return fremde + eigene[-WOCHEN:]


def _tage(von: str, bis: str) -> float:
    """Abstand zweier ISO-Wochen in Tagen (rein)."""
    try:
        jahr1, woche1 = von.split("-W")
        jahr2, woche2 = bis.split("-W")
        start = date.fromisocalendar(int(jahr1), int(woche1), 4)
        ende = date.fromisocalendar(int(jahr2), int(woche2), 4)
        return float((ende - start).days)
    except (ValueError, TypeError):
        return 0.0


def resttage(rows: Any, entity_id: str) -> int | None:
    """Wie viele Tage die Batterie noch reicht (rein, testbar).

    None heisst «keine Aussage» - zu wenig Verlauf, oder der Stand fällt
    gar nicht. Beides ist keine schlechte Nachricht und soll auch nicht
    wie eine aussehen.
    """
    eigene = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and row.get("entity_id") == entity_id
    ]
    if len(eigene) < 3:
        return None
    erste = str(eigene[0].get("week") or "")
    letzte = str(eigene[-1].get("week") or "")
    spanne = _tage(erste, letzte)
    if spanne < 21:
        return None
    # Kleinste Quadrate über (Tage seit erstem Wert, Prozent).
    punkte = [
        (_tage(erste, str(row.get("week") or "")), float(row.get("percent") or 0))
        for row in eigene
    ]
    n = len(punkte)
    mx = sum(x for x, _ in punkte) / n
    my = sum(y for _, y in punkte) / n
    nenner = sum((x - mx) ** 2 for x, _ in punkte)
    if nenner == 0:
        return None
    gefaelle = sum((x - mx) * (y - my) for x, y in punkte) / nenner
    if gefaelle > -MIN_GEFAELLE:
        return None
    zuletzt = punkte[-1][1]
    tage = zuletzt / -gefaelle
    return max(0, min(int(tage), 730))


def restwort(tage: int | None) -> str | None:
    """Die Zahl als Wort (rein, testbar).

    Grob mit Absicht: Die Gerade ist eine Schätzung, und «~87 Tage»
    klänge genauer, als sie ist.
    """
    if tage is None:
        return None
    if tage <= 14:
        return "reicht noch wenige Tage"
    if tage <= 60:
        return f"reicht noch ~{max(2, round(tage / 7))} Wochen"
    return f"reicht noch ~{max(2, round(tage / 30))} Monate"
