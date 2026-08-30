"""Der laufende Kalendertermin als Platzhalter in Nachrichten.

Der Fall dahinter: Am Tag, an dem laut Kalender Raymond kommt, soll die
Klingel-Durchsage «Das ist wohl Raymond zu Besuch» sagen - und zwar bei
jedem solchen Termin, nicht fest verdrahtet für einen. Deshalb kein
eigener Ablauf-Baustein, sondern ein Platzhalter: Wer in einer Durchsage
oder Nachricht ``{termin}`` schreibt, bekommt den Titel des gerade
laufenden Termins eingesetzt - und «Besuch», wenn keiner läuft. So bleibt
der Satz in jedem Fall sprechbar.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

#: So viele Minuten vor dem Beginn zählt ein Termin schon als «läuft» -
#: Besuch klingelt gern eine Viertelstunde zu früh.
VORLAUF_MINUTEN = 20
#: Termine ohne Ende gelten so lange - länger sitzt kein Coiffeur-Termin.
STANDARD_DAUER = timedelta(hours=2)


def _zeitpunkt(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        wann = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return wann


def laufender_termin(events: Any, jetzt: datetime) -> str | None:
    """Der Titel des Termins, der jetzt gerade läuft (rein, testbar).

    Ganztägige und Geburtstage zählen nicht - «Das ist wohl Elternabend»
    an der Haustüre wäre Unsinn. Läuft mehr als einer, gewinnt der mit
    dem späteren Beginn: Wer um 18 Uhr Gäste hat, meint nicht den
    Nachmittagstermin, der noch nicht zu Ende ist.
    """
    treffer: list[tuple[datetime, str]] = []
    for event in events if isinstance(events, list) else []:
        if not isinstance(event, dict):
            continue
        if event.get("all_day") or event.get("birthday"):
            continue
        start = _zeitpunkt(event.get("start"))
        if start is None:
            continue
        # Naive und bewusste Zeitzonen mischen sich nicht - dann lieber
        # beide auf dieselbe Art ansehen wie der Vergleichszeitpunkt.
        if (start.tzinfo is None) != (jetzt.tzinfo is None):
            start = start.replace(tzinfo=jetzt.tzinfo)
        ende = _zeitpunkt(event.get("end"))
        if ende is not None and (ende.tzinfo is None) != (jetzt.tzinfo is None):
            ende = ende.replace(tzinfo=jetzt.tzinfo)
        if ende is None:
            ende = start + STANDARD_DAUER
        if start - timedelta(minutes=VORLAUF_MINUTEN) <= jetzt <= ende:
            titel = str(event.get("summary") or "").strip()
            if titel:
                treffer.append((start, titel))
    if not treffer:
        return None
    treffer.sort(key=lambda paar: paar[0])
    return treffer[-1][1]


def platzhalter_fuellen(text: str, events: Any, jetzt: datetime) -> str:
    """``{termin}`` im Text ersetzen (rein, testbar).

    Ohne Platzhalter kommt der Text unangetastet zurück - der häufige
    Fall kostet nichts. Ohne laufenden Termin steht «Besuch» da: Der
    Satz «Das ist wohl Besuch» stimmt an der Klingel immer.
    """
    if "{termin}" not in text:
        return text
    return text.replace("{termin}", laufender_termin(events, jetzt) or "Besuch")
