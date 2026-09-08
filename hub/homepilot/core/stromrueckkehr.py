"""Nach dem Stromausfall: nur das Licht, das man vorgegeben hat.

Kommt der Strom zurück, gehen die meisten Lampen von selbst an - das
entscheidet das Leuchtmittel, nicht der Hub, denn der war zu diesem
Zeitpunkt ja auch stromlos. Um drei Uhr nachts steht damit das ganze
Haus in vollem Licht, und jemand geht durch alle Zimmer.

**Der Hub kann das nicht verhindern, nur aufräumen.** Er braucht selbst
eine Minute zum Hochfahren; solange brennt alles. Wer den Blitz auch
noch loswerden will, stellt es am Gerät ein (bei Hue heisst es
«Verhalten bei Stromrückkehr», Homematic hat je Aktor einen
Einschaltwert). Das hier ist das Netz darunter - es gilt für jede
Anbindung und auch für die Lampe, die diese Einstellung nicht kennt.

**Woran der Hub den Stromausfall erkennt.** Nicht an der Uhr: Ein
Update dauert auch ein paar Minuten, und danach dürfen die Lichter
nicht ausgehen. Erkannt wird am *sauberen* Ende: Wird der Hub geordnet
beendet, hinterlässt er einen Vermerk. Fehlt er beim nächsten Start,
ist der Dienst mitten im Lauf gestorben - Stromausfall, Stecker,
abgestürzter Rechner. Beim allerersten Start fehlt er auch; deshalb
zählt nur ein ausdrücklich als «läuft» hinterlassener Vermerk als
Kaltstart. Sonst räumte ein frisch eingerichteter Hub beim ersten
Hochfahren das Haus ab.

**Nur Licht.** Nach einem Stromausfall wahllos Geräte abzuschalten wäre
gefährlich: Am selben Strang hängen Gefriertruhe, Pumpe, Router. Licht
ist die einzige Art, bei der «aus» nie schadet.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

#: So lange wartet der Hub nach dem Start, bevor er das erste Mal
#: hinschaut. Kurz gehalten: Was jetzt schon erreichbar ist, soll auch
#: gleich ausgehen - für alles Übrige gibt es die Runden danach.
WARTEN_SEKUNDEN = 20

#: Abstand zwischen den Runden.
TAKT_SEKUNDEN = 15

#: Und so lange wird nachgesehen. Zehn Minuten, weil die eigentliche
#: Schwierigkeit nicht der Hub ist, sondern die Reihenfolge, in der ein
#: Haus zurückkommt: Die Lampe hat Strom, lange bevor Switch, Accesspoint
#: und Bridge wieder stehen. Eine einzelne Aufräumrunde nach fester
#: Wartezeit ginge deshalb ins Leere - sie fände die halbe Wohnung noch
#: «nicht erreichbar» und liesse sie brennen.
FENSTER_SEKUNDEN = 600


def kaltstart(vermerk: Any) -> bool:
    """Ist der Hub nach einem Stromausfall hochgefahren? (rein, testbar)

    ``vermerk`` ist, was der vorige Lauf hinterlassen hat. «läuft» heisst:
    Er kam nie zum geordneten Ende. Alles andere - sauber beendet, gar
    kein Vermerk, etwas Unbekanntes - heisst «kein Kaltstart», und das
    ist die sichere Seite: Wer hier irrt, schaltet einem das Licht aus,
    während man im Zimmer steht.
    """
    if not isinstance(vermerk, dict):
        return False
    return vermerk.get("state") == "laeuft"


def gewuenschte_lichter(config: Any) -> list[str]:
    """Welche Lichter nach dem Stromausfall brennen sollen (rein, testbar)."""
    roh = (config or {}).get("lights_on")
    if isinstance(roh, str):
        roh = [roh]
    if not isinstance(roh, list):
        return []
    return [str(eintrag) for eintrag in roh if str(eintrag).strip()]


def wartezeit(config: Any) -> int:
    """Wie lange gewartet wird, bevor aufgeräumt wird (rein, testbar)."""
    try:
        sekunden = int((config or {}).get("delay", WARTEN_SEKUNDEN))
    except (TypeError, ValueError):
        return WARTEN_SEKUNDEN
    # Sofort wäre zu früh (die Anbindungen stehen noch nicht), eine
    # Stunde zu spät - dann ist längst jemand durchs Haus gegangen.
    return max(5, min(3600, sekunden))


def takt(config: Any) -> int:
    """Abstand zwischen den Runden (rein, testbar)."""
    try:
        return max(5, min(300, int((config or {}).get("interval", TAKT_SEKUNDEN))))
    except (TypeError, ValueError):
        return TAKT_SEKUNDEN


def fenster(config: Any) -> int:
    """Wie lange nachgesehen wird (rein, testbar).

    Nicht länger als nötig: Nach dem Fenster ist eine Lampe, die angeht,
    wieder das, was sie sonst ist - jemandes Entscheidung. Ein Hub, der
    noch eine Stunde später eigenmächtig ausschaltet, wäre ein Gespenst.
    """
    try:
        return max(30, min(3600, int((config or {}).get("window", FENSTER_SEKUNDEN))))
    except (TypeError, ValueError):
        return FENSTER_SEKUNDEN


def zu_stellen(
    lichter: list[tuple[str, str, bool]],
    gewuenscht: list[str],
    erledigt: set[str] | None = None,
) -> list[tuple[str, str]]:
    """Welche Befehle in dieser Runde zu schicken sind (rein, testbar).

    Hinein die Lichter als (Kennung, Zustand, erreichbar), heraus die
    Liste (Kennung, Befehl).

    Drei Regeln, und jede hat ihren Grund:

    **Nicht erreichbar heisst überspringen, nicht aufgeben.** Nach einem
    Stromausfall hat die Lampe Strom, lange bevor der Accesspoint wieder
    steht - ein Befehl an sie verpufft, und sie brennt weiter. Sie kommt
    in einer der nächsten Runden dran.

    **Geschickt wird nur, was etwas ändert.** Eine Lampe, die ohnehin
    aus ist, bekommt kein zweites «aus» - manche Bridge quittiert einen
    Schwung Befehle mit einer Denkpause, und dann kommt der eine, auf
    den es ankommt, zu spät.

    **Und jede Lampe nur einmal.** ``erledigt`` sind die schon
    gestellten. Sonst wäre der Hub zehn Minuten lang ein Gegner: Wer im
    Dunkeln Licht macht, während noch aufgeräumt wird, bekäme es sofort
    wieder ausgeschaltet.
    """
    soll = set(gewuenscht)
    fertig = erledigt or set()
    befehle: list[tuple[str, str]] = []
    for entity_id, zustand, erreichbar in lichter:
        if not erreichbar or entity_id in fertig:
            continue
        an = str(zustand).lower() == "on"
        if entity_id in soll:
            if not an:
                befehle.append((entity_id, "turn_on"))
        elif an:
            befehle.append((entity_id, "turn_off"))
    return befehle
