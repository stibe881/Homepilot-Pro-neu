"""Die Packliste der Kinder - was morgen in den Thek gehört.

Der Stundenplan weiss, wann Sport ist; dass dann der Turnsack mitmuss,
wusste bisher nur der Kopf der Eltern - und der Vorabend um neun ist
der Moment, in dem er es vergisst. Die Familienliste «gear» hält je
Kind fest, welcher Gegenstand an welchem Wochentag mitmuss («Turnsack,
Di», auf Wunsch nur in der A- oder B-Woche); am Vorabend fasst der
Wächter zusammen, was morgen ansteht.

Hier die reinen Hälften. Die A/B-Woche rechnet wie die App
(lib/kindseite.ts): ungerade ISO-Kalenderwochen sind «A» - zwei
verschiedene Rechnungen wären irgendwann zwei verschiedene Wochen.
"""

from __future__ import annotations

from datetime import date
from typing import Any

TAGE = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def woche_von(datum: date) -> str:
    """«A» oder «B» - ungerade Kalenderwochen sind A (rein, testbar)."""
    return "A" if datum.isocalendar()[1] % 2 == 1 else "B"


def tag_von(datum: date) -> str:
    return TAGE[datum.weekday()]


def morgen_zeilen(
    gear: list[Any] | None, morgen: date
) -> dict[str, list[str]]:
    """Je Kind, was morgen mitmuss (rein, testbar).

    Ein Eintrag ohne Woche gilt jede Woche; «A»/«B» nur in der ihren.
    Die Reihenfolge bleibt die der Liste - so, wie die Familie sie
    angelegt hat.
    """
    tag = tag_von(morgen)
    woche = woche_von(morgen)
    zeilen: dict[str, list[str]] = {}
    for eintrag in gear or []:
        if not isinstance(eintrag, dict):
            continue
        if str(eintrag.get("day") or "") != tag:
            continue
        eintrag_woche = str(eintrag.get("week") or "")
        if eintrag_woche and eintrag_woche != woche:
            continue
        text = str(eintrag.get("text") or "").strip()
        wer = str(eintrag.get("member") or "").strip()
        if not text or not wer:
            continue
        zeilen.setdefault(wer, []).append(text)
    return zeilen


def satz(zeilen: dict[str, list[str]]) -> str | None:
    """Der eine Satz für die Abend-Nachricht (rein, testbar).

    «Levin: Turnsack und Flöte · Lina: Flöte» - je Kind ein Stück, und
    bei nur einem Kind fällt der Name weg: Wessen Thek gemeint ist, ist
    dann keine Frage.
    """
    if not zeilen:
        return None
    stuecke = []
    for wer, sachen in zeilen.items():
        aufzaehlung = (
            sachen[0]
            if len(sachen) == 1
            else ", ".join(sachen[:-1]) + f" und {sachen[-1]}"
        )
        stuecke.append((wer, aufzaehlung))
    if len(stuecke) == 1:
        return f"{stuecke[0][0]} braucht morgen: {stuecke[0][1]}."
    return " · ".join(f"{wer}: {was}" for wer, was in stuecke)
