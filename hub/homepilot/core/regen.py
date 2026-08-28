"""Regen, der gleich kommt – und was dann noch offen steht.

Die Wochenvorhersage beantwortet die Frage nicht, die man am Fenster
stellt: Muss ich die Wäsche jetzt hereinholen? «60 % Regenwahrscheinlichkeit
heute» heisst dafür gar nichts.

Open-Meteo liefert neben der Tagesvorhersage Viertelstundenwerte für die
nächsten Stunden (``minutely_15``). Daraus wird hier die einzige Zahl
gerechnet, die zählt: in wie vielen Minuten es anfängt.

**Viertelstunden, keine Minuten.** Das ist die Auflösung der Quelle, und
sie wird nicht schöngerechnet: «in etwa 15 Minuten» ist ehrlich, «in 12
Minuten» wäre erfunden. Ein Radarbild mit Minutenauflösung gäbe es nur
bei Diensten mit Schlüssel und Kontingent - dafür ist die Frage zu
klein.

Reines Rechnen über den Listen der Antwort. Wer sie holt, ist die
Wetter-Integration; wer meldet, ist der Wächter.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

#: Ab wie viel Niederschlag je Viertelstunde von Regen die Rede ist.
#: Darunter ist es feucht - für nasse Wäsche reicht das nicht, und eine
#: Meldung darüber wäre eine, die man abschaltet.
SCHWELLE_MM = 0.2

#: So weit wird vorausgeschaut. Weiter voraus ist es keine Vorwarnung
#: mehr, sondern eine Vorhersage - und dafür gibt es die Wochenansicht.
VORSCHAU_MINUTEN = 120


def _zeit(wert: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(wert))
    except (TypeError, ValueError):
        return None


def _mm(wert: Any) -> float:
    try:
        return float(wert)
    except (TypeError, ValueError):
        return 0.0


def analyse(minutely: Any, jetzt: datetime) -> dict[str, Any]:
    """Wann fängt es an, und wie stark? (rein, testbar)

    Zurück kommt immer ein Wörterbuch, auch wenn nichts ansteht: Die
    Wetter-Entität trägt es mit, und ein fehlendes Feld wäre in der App
    nicht von «es regnet nicht» zu unterscheiden.

    ``minutes`` ist None, wenn in der Vorschau nichts kommt. Regnet es
    jetzt schon, ist ``now`` wahr und ``minutes`` die Zeit bis zum Ende -
    die andere Hälfte derselben Frage: Wie lange muss ich warten?
    """
    zeiten = list((minutely or {}).get("time") or [])
    werte = list((minutely or {}).get("precipitation") or [])
    reihen = [
        (_zeit(zeit), _mm(werte[index] if index < len(werte) else 0))
        for index, zeit in enumerate(zeiten)
    ]
    reihen = [(zeit, mm) for zeit, mm in reihen if zeit is not None]
    if not reihen:
        return {"now": False, "minutes": None, "mm": 0.0}

    # Der Eimer, in dem wir gerade stehen: der letzte, der nicht in der
    # Zukunft liegt. Regnet es dort, regnet es jetzt.
    laufend = [(zeit, mm) for zeit, mm in reihen if zeit <= jetzt]
    jetzt_mm = laufend[-1][1] if laufend else 0.0
    kommend = [(zeit, mm) for zeit, mm in reihen if zeit > jetzt]

    if jetzt_mm >= SCHWELLE_MM:
        # Wann hört es auf? Der erste trockene Eimer danach.
        for zeit, mm in kommend:
            if mm < SCHWELLE_MM:
                return {
                    "now": True,
                    "minutes": max(0, int((zeit - jetzt).total_seconds() // 60)),
                    "mm": round(jetzt_mm, 1),
                }
        return {"now": True, "minutes": None, "mm": round(jetzt_mm, 1)}

    for zeit, mm in kommend:
        minuten = int((zeit - jetzt).total_seconds() // 60)
        if minuten > VORSCHAU_MINUTEN:
            break
        if mm >= SCHWELLE_MM:
            return {"now": False, "minutes": max(0, minuten), "mm": round(mm, 1)}
    return {"now": False, "minutes": None, "mm": 0.0}


def balken(minutely: Any, jetzt: datetime, anzahl: int = 8) -> list[float]:
    """Die nächsten Viertelstunden als Zahlenreihe (rein, testbar).

    Für die kleine Grafik auf der Wetterkarte: acht Balken sind zwei
    Stunden - dieselbe Spanne wie die Vorschau der Meldung. Mehr wäre
    keine Vorwarnung mehr, sondern eine Wetterkarte, und die gibt es
    eine Zeile tiefer schon.

    Fehlende Werte werden nicht erfunden: Liefert die Quelle weniger,
    ist die Reihe kürzer, und die App zeichnet entsprechend weniger.
    """
    zeiten = list((minutely or {}).get("time") or [])
    werte = list((minutely or {}).get("precipitation") or [])
    reihe: list[float] = []
    for index, zeit in enumerate(zeiten):
        wann = _zeit(zeit)
        if wann is None or wann <= jetzt - timedelta(minutes=15):
            # Der laufende Viertelstunden-Eimer zählt mit - in ihm
            # stehen wir gerade.
            continue
        reihe.append(round(_mm(werte[index] if index < len(werte) else 0), 1))
        if len(reihe) >= anzahl:
            break
    return reihe


#: So lange nach einer Vorwarnung kommt keine zweite - es sei denn, der
#: Schauer ist inzwischen durch (siehe ``vorbei``).
#:
#: Zwei Stunden, weil das die Spanne der Vorschau ist: Was innerhalb
#: davon noch kommt, ist derselbe Schauer, über den schon geschrieben
#: wurde.
SPERRE_MINUTEN = 120


def vorbei(stand: Any) -> bool:
    """Ist die Sache erledigt, über die gewarnt wurde? (rein, testbar)

    Zwei Enden, und beide zählen: Es regnet jetzt (die Warnung hat ihren
    Zweck erfüllt), oder in der Vorschau steht nichts mehr (der Schauer
    ist an uns vorbeigezogen). Danach darf wieder gewarnt werden.
    """
    if not isinstance(stand, dict):
        return False
    return bool(stand.get("now")) or stand.get("minutes") is None


def melden(
    stand: Any,
    gemeldet_um: float | None,
    jetzt: float,
    grenze_minuten: float,
    sperre_minuten: float = SPERRE_MINUTEN,
) -> bool:
    """Soll jetzt eine Vorwarnung raus? (rein, testbar)

    Hier stand einmal eine Entprellung über den *errechneten*
    Regenbeginn: ``(jetzt + minuten * 60) // 900``. Das sah nach einer
    stabilen Kennung aus und war keine. ``minuten`` steht im Zustand der
    Wetter-Entität und ändert sich nur, wenn der Hub das Wetter neu
    holt; der Wächter läuft jede Minute. Zwischen zwei Abrufen wandert
    ``jetzt`` also weiter, während ``minuten`` stehen bleibt - der
    errechnete Beginn rückt mit, fällt irgendwann in die nächste
    Viertelstunde, und die Meldung kam wieder. Und wieder.

    Gemerkt wird deshalb, *wann* gewarnt wurde, und nicht, *wovor*.
    """
    if not isinstance(stand, dict) or stand.get("now"):
        return False
    minuten = stand.get("minutes")
    if minuten is None or minuten > grenze_minuten:
        return False
    if gemeldet_um is None:
        return True
    return jetzt - gemeldet_um >= sperre_minuten * 60


def satz(stand: Any) -> str | None:
    """Der Satz für die Meldung (rein, testbar).

    None, wenn nichts zu sagen ist. «In etwa» gehört dazu: Die Quelle
    kennt Viertelstunden, und eine Zahl, die genauer klingt, als sie
    ist, glaubt man einmal.
    """
    if not isinstance(stand, dict):
        return None
    minuten = stand.get("minutes")
    if stand.get("now"):
        if minuten is None:
            return "Es regnet."
        return f"Es regnet noch etwa {minuten} Minuten."
    if minuten is None:
        return None
    if minuten <= 5:
        return "Es fängt gleich an zu regnen."
    return f"Regen in etwa {minuten} Minuten."
