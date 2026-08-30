"""Der Ofen sagt Bescheid: «parat» beim Aufheizen, «fertig» am Ende.

Werkbank-Punkt 248. Der Fall aus der Küche: Wer den Backofen vorheizt,
geht derweil weg - und schaut dann dreimal nach, ob er endlich auf
Temperatur ist. Die V-ZUG-Anbindung liest den Zustand längst im
Minutentakt; es folgerte nur niemand etwas daraus.

Zwei Momente, zwei Sätze:

- Das Vorheizen endet, das Programm läuft weiter → «Der Backofen ist
  parat.» Erkannt am Programm- oder Statustext: Die Geräte schreiben
  dort «Vorheizen»/«Aufheizen», solange sie heizen. Verschwindet das
  Wort, ist die Temperatur erreicht. Meldet eine Firmware das Wort nie,
  passiert schlicht nichts - besser stumm als falsch.
- Das Programm endet (running → idle) → «Der Backofen ist fertig.»

Bewusst nur Küchen-Kochgeräte: Die Waschküche hat ihren eigenen Weg
(watchdog._check_appliances mahnt die volle Maschine), und eine
Geschirrspüler-Durchsage um 22:30 will niemand. Alle Funktionen hier
sind rein; den Takt und die Durchsage übernimmt der Wächter.
"""

from __future__ import annotations

import re

#: Woran ein Kochgerät erkannt wird - am Namen, den ihm jemand in der
#: Konfiguration gegeben hat. «Steam» deckt Combi-Steam und Steamer ab.
KOCHGERAET = re.compile(r"ofen|steam|dampfgar|mikrowell", re.IGNORECASE)

#: Woran die Aufheizphase erkannt wird, in beiden Sprachen der Firmware.
VORHEIZEN = re.compile(r"vorheiz|aufheiz|preheat|heating\s*up", re.IGNORECASE)


def kochgeraet(label: str) -> bool:
    """Ist das ein Gerät, an dem gekocht wird? (rein, testbar)"""
    return bool(KOCHGERAET.search(str(label or "")))


def heizt_vor(program: object, status: object) -> bool:
    """Steht das Gerät in der Aufheizphase? (rein, testbar)

    Beide Textfelder ansehen: Je nach Firmware steht «Vorheizen» als
    Programm oder als Status.
    """
    return bool(
        VORHEIZEN.search(str(program or "")) or VORHEIZEN.search(str(status or ""))
    )


def parat_satz(label: str) -> str:
    """«Der Backofen ist parat.» (rein, testbar)"""
    return f"Der {str(label or 'Ofen').strip()} ist parat."


def fertig_satz(label: str) -> str:
    """«Der Backofen ist fertig.» (rein, testbar)"""
    return f"Der {str(label or 'Ofen').strip()} ist fertig."
