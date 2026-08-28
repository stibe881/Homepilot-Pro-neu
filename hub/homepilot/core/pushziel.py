"""Wohin ein Tipp auf eine Nachricht führt.

Die App wusste das lange für vier Fälle: Kamera, Batterie, Klingel,
Alarm. Alle anderen fünfundzwanzig Meldungen öffneten sie auf der
Startseite - «Milch steht auf der Einkaufsliste» genauso wie «Wasser im
Keller». Man tippt, weil man etwas tun will, und landet dort, wo man
ohnehin gelandet wäre.

Die Regel dafür gehört hierher und nicht in die App: Hier weiss man, was
für eine Meldung das ist. Die App muss nur wissen, wie man zu einem Raum
kommt (lib/pushziel.ts).

Die Schreibweise ist absichtlich schlicht - ``art`` oder ``art:wert``,
eine Zeichenkette, die durch JSON und durch die Push-Dienste geht, ohne
unterwegs etwas zu verlieren.
"""

from __future__ import annotations

## Je Kategorie der Ort, an dem man etwas tun kann.
#
# Nicht «wo steht davon etwas», sondern «wo tut man etwas»: Der
# Wasseralarm gehört nicht in eine Liste vergangener Meldungen, sondern
# in den Raum, in dem der Melder hängt.
ZIELE: dict[str, str] = {
    # Sicherheit: die Anlage selbst, dort steht auch der Verlauf.
    "alarm": "bereich:alarm",
    "alarm_arming": "bereich:alarm",
    # Betrieb: Integrationen und Platte stehen im System-Bereich.
    "outage": "bereich:system",
    "disk": "bereich:system",
    # Was mit einem Gerät nicht stimmt, steht auf einem Blatt zusammen -
    # samt Quittieren.
    "device_down": "sorgen",
    "maintenance": "sorgen",
    "battery": "batterien",
    # Wetter und Haushalt: die Startseite trägt die Karten dazu.
    "frost": "start",
    "rain": "start",
    "plants": "start",
    "appliance": "start",
    "morning": "start",
    "test": "start",
    "open": "offen",
    "leak": "sorgen",
    "doorbell": "klingel",
    "timer": "timer",
    # Familie: je Meldung ihre Kachel.
    "tasks": "familie:tasks",
    "shopping": "familie:shopping",
    "calendar": "familie:kalender",
    "medication": "familie:medications",
    "birthday": "familie:kalender",
    "weekahead": "familie:woche",
    # Wer wo ist, steht unter «Familie und Freunde».
    "presence": "bereich:personen",
    # Bewegung sieht man auf der Kamera - welche, sagt die Nachricht
    # selbst (data.camera).
    "camera_motion": "start",
}

## Meldungen, bei denen das Gerät selbst der beste Ort ist.
#
# Ein offenes Fenster ist im Raum zu schliessen, nicht in einer Liste;
# ein Wassermelder schickt einen dorthin, wo man den Hahn zudreht. Bei
# den anderen (Batterie, ausgefallenes Gerät) ist der Sammelplatz
# besser: Dort steht der Knopf zum Quittieren.
AM_GERAET = frozenset({"open", "leak", "appliance"})


def ziel_fuer(category: str | None, entity_id: str | None = None) -> str | None:
    """Das Ziel zu einer Kategorie (rein, testbar).

    ``None`` heisst: kein besonderer Ort - dann öffnet die App sich
    einfach, wie bisher. Das gilt auch für Meldungen aus Abläufen: Dort
    entscheidet der Ablauf selbst, wohin es geht.
    """
    if not category:
        return None
    if entity_id and category in AM_GERAET:
        return f"geraet:{entity_id}"
    return ZIELE.get(category)
