"""Wann das Haus schweigt (rein, testbar).

Ein Fenster über Nacht, in dem Nachrichten nicht zugestellt werden. Es
stand zuerst in der Waschküche und galt nur fürs Nachhaken; inzwischen
brauchen es mehrere Stellen - die Erinnerung an die volle Maschine
ebenso wie ein selbst gebauter Ablauf, der «Geschirrspüler ist fertig»
meldet. Zweimal dieselbe Stundenrechnung wäre zweimal derselbe Fehler.

Was hier *nicht* steht: welche Nachricht still sein soll. Das
entscheidet die jeweilige Stelle - eine Nachtruhe, die alles
verschluckt, verschluckt irgendwann auch den Rauchmelder.
"""

from __future__ import annotations

import time

#: Das übliche Fenster. Nachts läuft in diesem Haushalt keine Maschine,
#: und was zwischen diesen Stunden ankommt, weckt jemanden, ohne etwas
#: zu ändern.
VON = 22
BIS = 8


def still(jetzt: float, von: float = VON, bis: float = BIS) -> bool:
    """Ist gerade Nachtruhe? (rein, testbar)

    Zwei Fälle, und nur einer geht über Mitternacht. «Ab 0 bis 8» mit
    dem Oder-Vergleich hiesse rund um die Uhr still, weil jede Stunde
    >= 0 ist - eine Einstellung, die in der App ein Tipp weit weg ist.

    Sind beide Zahlen gleich, gibt es keine Nachtruhe. Das ist der Weg,
    sie abzuschalten; ohne ihn hiesse «ab 22 bis 22 Uhr» für immer
    still, und niemand fände heraus, warum nichts mehr kommt.
    """
    if von == bis:
        return False
    stunde = time.localtime(jetzt).tm_hour
    if von < bis:
        return von <= stunde < bis
    return stunde >= von or stunde < bis
