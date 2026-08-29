"""Der UV-Hinweis am Morgen: heute eincremen, oder nicht der Rede wert.

Der UV-Index steht in jeder Wetter-App - und niemand schaut morgens
nach. Gebraucht wird er genau einmal am Tag, bevor die Kinder aus dem
Haus sind, und nur, wenn er hoch ist: Ein Hinweis «UV 2, alles gut»
wäre eine Meldung, die man abbestellt.

Die Stufen sind die der WHO; die Grenze für den Hinweis liegt bei
«hoch» (ab 6). «Mässig» (3-5) steht auf der Wetterkarte, brummt aber
nicht - für eine Viertelstunde Pausenhof braucht es da keinen Alarm.
"""

from __future__ import annotations

from typing import Any

#: Ab dieser Stufe kommt am Morgen ein Hinweis.
WARNSTUFE = 6.0


def wort(index: Any) -> str | None:
    """Die WHO-Stufe als Wort (rein, testbar). None unter «mässig»."""
    try:
        wert = float(index)
    except (TypeError, ValueError):
        return None
    if wert >= 11:
        return "extrem"
    if wert >= 8:
        return "sehr hoch"
    if wert >= WARNSTUFE:
        return "hoch"
    if wert >= 3:
        return "mässig"
    return None


def hinweis(index: Any) -> str | None:
    """Die Morgen-Zeile - oder nichts (rein, testbar)."""
    stufe = wort(index)
    if stufe not in ("hoch", "sehr hoch", "extrem"):
        return None
    return f"UV heute {stufe} ({round(float(index))}) - eincremen, Mittagssonne meiden"
