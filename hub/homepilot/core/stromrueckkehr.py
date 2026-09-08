"""Nach dem Stromausfall: Was der Hub darüber weiss.

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

**Was aufgeräumt wird, steht in einem Ablauf**, nicht in der
config.yaml: Der Auslöser «Nach Stromausfall» (core/automation.py)
lässt sich mit allem verbinden, was ein Ablauf sonst auch kann - eine
Szene, ein Dutzend einzelner Lampen, eine Nachricht. Hier stehen nur
die Zahlen und die eine Frage, die der Hub selbst beantworten muss: Ist
er überhaupt nach einem Stromausfall hochgefahren?

**Woran er das erkennt.** Nicht an der Uhr: Ein Update dauert auch ein
paar Minuten, und danach dürfen die Lichter nicht ausgehen. Erkannt
wird am *sauberen* Ende: Wird der Hub geordnet beendet, hinterlässt er
einen Vermerk. Fehlt er beim nächsten Start, ist der Dienst mitten im
Lauf gestorben - Stromausfall, Stecker, abgestürzter Rechner. Beim
allerersten Start fehlt er auch; deshalb zählt nur ein ausdrücklich als
«läuft» hinterlassener Vermerk als Kaltstart. Sonst räumte ein frisch
eingerichteter Hub beim ersten Hochfahren das Haus ab.
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


def wartezeit(config: Any) -> int:
    """Wie lange nach dem Start gewartet wird (rein, testbar).

    Sofort wäre zu früh - die Anbindungen stehen noch nicht -, eine
    Stunde zu spät: Dann ist längst jemand durchs Haus gegangen und hat
    von Hand gelöscht.
    """
    try:
        sekunden = int((config or {}).get("delay", WARTEN_SEKUNDEN))
    except (TypeError, ValueError):
        return WARTEN_SEKUNDEN
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


def wer_fehlt(ziele: list[tuple[str, bool]]) -> set[str]:
    """Welche Geräte des Ablaufs noch nicht erreichbar sind (rein, testbar).

    Der Kniff am ganzen Aufräumen: Ein Haus kommt nicht auf einmal
    zurück. Die Lampe hat Strom, lange bevor Switch, Accesspoint und
    Bridge wieder stehen - ein Befehl an sie verpufft, und sie brennt
    weiter. Der Ablauf läuft deshalb noch einmal, sobald eines der
    fehlenden Geräte auftaucht.

    Eine leere Menge heisst «alle da» und beendet das Nachfassen.
    """
    return {entity_id for entity_id, erreichbar in ziele if not erreichbar}
