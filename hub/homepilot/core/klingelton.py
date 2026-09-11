"""Der Ton, der auf gewählten Lautsprechern spielt, wenn es klingelt.

Der Tonmeister (core/ton.py) dämpfte beim Klingeln bisher nur eine
laufende Wiedergabe - wer gerade keine Musik hörte, bekam nichts als
die stille Push-Nachricht. Hier kommt ein eigener, hörbarer Ton dazu.

Eingebaut statt eingekauft: ein paar Sekunden Sinuston aus Frequenz und
Dauer brauchen keine Lizenz, kein Internet und keine Datei im Abbild -
sie entstehen beim Klingeln aus reinen Zahlen. Das erlaubt auch, ein
paar zum Schmunzeln dazuzunehmen: «wer klingelt» darf auch mal die
Quietscheente sein, nicht nur der klassische Gong.

Gespielt wird über denselben Weg wie eine Durchsage (core/say.py:
play_audio) - kurzlebige Adresse, play_url auf die Box, danach der alte
Zustand zurück. Der eigentliche Anstoss (welcher Ton, auf welchen
Boxen, überhaupt) steht in ``Tonmeister.klingelton_abspielen``.

Bewusst *ohne* Vorgabe-Lautsprecher: Ohne gewählte Box bleibt es still.
Bei den Storen-Wächtern (core/storenwaechter.py) heisst eine leere Wahl
«alle», weil dort ein Unwetter alle schützen soll. Ein Klingelton ist
kein Sicherheitsfall - er soll erst losgehen, wenn jemand ihn wirklich
eingerichtet hat, nicht beim ersten Klingeln nach der Auslieferung auf
jeder Box im Haus.
"""

from __future__ import annotations

import math
import struct
from typing import Any

#: Eine Note: (Frequenz in Hz, Dauer in Sekunden). 0 Hz heisst Stille -
#: eine Pause zwischen zwei Tönen, kein Ton bei 0 Hz.
Note = tuple[float, float]

SAMPLERATE = 22050

#: Lautstärke des Klingeltons in Prozent - hörbar, aber kein Schreck.
#: Etwas leiser als eine Durchsage (DURCHSAGE_VOLUME in core/say.py):
#: Eine Durchsage hat einen Satz zu sagen, der Klingelton nur «da ist
#: wer».
LAUTSTAERKE = 55

#: Wo die Wahl (Ton, Boxen) in der Datendatei liegt.
DATA_KEY = "klingelton"

#: Die eingebauten Klänge, in Anzeige-Reihenfolge. Die ersten drei sind
#: klassisch, die letzten drei zum Schmunzeln - beides darf man wollen.
KLAENGE: list[dict[str, Any]] = [
    {
        "key": "dingdong",
        "label": "Ding-Dong",
        "noten": [(784.0, 0.35), (0.0, 0.05), (523.0, 0.55)],
    },
    {
        "key": "dreiklang",
        "label": "Dreiklang",
        "noten": [(523.0, 0.18), (659.0, 0.18), (784.0, 0.42)],
    },
    {
        "key": "kuckuck",
        "label": "Kuckuck",
        "noten": [
            (659.0, 0.3),
            (0.0, 0.08),
            (523.0, 0.3),
            (0.0, 0.2),
            (659.0, 0.3),
            (0.0, 0.08),
            (523.0, 0.3),
        ],
    },
    {
        "key": "hupe",
        "label": "Hupe",
        "noten": [(220.0, 0.22), (0.0, 0.07), (220.0, 0.3)],
    },
    {
        "key": "quietscheente",
        "label": "Quietscheente",
        "noten": [
            (1150.0, 0.07),
            (850.0, 0.06),
            (1250.0, 0.07),
            (900.0, 0.06),
            (1400.0, 0.12),
        ],
    },
    {
        "key": "tusch",
        "label": "Tusch",
        "noten": [(523.0, 0.12), (659.0, 0.12), (784.0, 0.12), (1047.0, 0.4)],
    },
]

BY_KEY: dict[str, dict[str, Any]] = {klang["key"]: klang for klang in KLAENGE}

#: Der Ton, der gilt, solange niemand einen anderen gewählt hat.
STANDARD = "dingdong"

#: Die Note des Eingangs-Countdowns (Punkt 487 der Werkbank).
#:
#: Ein einzelner kurzer Piep, hoch genug, um durch eine geschlossene Tür
#: zu kommen, und kurz genug, dass er in einen Sekundentakt passt.
PIEP_HZ = 1046.0
PIEP_DAUER = 0.12

#: Wie eng die Piepser gegen Ende zusammenrücken.
#:
#: Der Ton soll nicht nur sagen «die Uhr läuft», sondern «sie läuft
#: ab» - und das ist der Unterschied zwischen einem Wecker und einer
#: Anlage. Zwei Sekunden Abstand am Anfang, eine halbe am Schluss: Wer
#: zur Tür hereinkommt, hört an der Dichte, wie viel Zeit bleibt, ohne
#: etwas anzusehen.
PIEP_ABSTAND_START = 2.0
PIEP_ABSTAND_ENDE = 0.5


def countdown_noten(sekunden: float) -> list[Note]:
    """Der Ton der Eingangsverzögerung (rein, testbar) - Punkt 487.

    Die Verzögerung lief im Hub korrekt ab und war nur zu sehen, wer die
    App öffnete - dann sind zehn der dreissig Sekunden weg. Ein Ton, der
    schneller wird, sagt dasselbe ohne Bildschirm und ohne Hände.

    Ein Stück Stille am Schluss bleibt bewusst weg: Die letzte Sekunde
    gehört dem Alarm, nicht dem Countdown.
    """
    dauer = max(0.0, float(sekunden))
    noten: list[Note] = []
    vergangen = 0.0
    while True:
        anteil = min(1.0, vergangen / dauer) if dauer > 0 else 1.0
        abstand = PIEP_ABSTAND_START + anteil * (PIEP_ABSTAND_ENDE - PIEP_ABSTAND_START)
        if vergangen + PIEP_DAUER + abstand > dauer:
            break
        noten.append((PIEP_HZ, PIEP_DAUER))
        noten.append((0.0, abstand))
        vergangen += PIEP_DAUER + abstand
    # Die letzte Pause weg: Sie würde die Wiedergabe künstlich in die
    # Sekunde hineinziehen, in der der Alarm losgeht.
    if noten and noten[-1][0] == 0.0:
        noten.pop()
    return noten


def ton_samples(frequenz: float, dauer: float, samplerate: int = SAMPLERATE) -> list[float]:
    """Ein Sinuston als Werte zwischen -1 und 1 (rein, testbar).

    Mit kurzer Ein- und Ausblendung (5 ms): Ohne sie knackt jeder Ton
    beim Einsetzen und Enden, hörbar als Klicken - besonders bei der
    Quietscheente, die aus lauter kurzen Tönen besteht.
    """
    anzahl = max(1, int(round(dauer * samplerate)))
    if frequenz <= 0:
        return [0.0] * anzahl
    fade = max(1, min(anzahl // 4, int(0.005 * samplerate)))
    werte: list[float] = []
    for i in range(anzahl):
        huellkurve = 1.0
        if i < fade:
            huellkurve = i / fade
        elif i >= anzahl - fade:
            huellkurve = (anzahl - i) / fade
        werte.append(huellkurve * math.sin(2 * math.pi * frequenz * i / samplerate))
    return werte


def noten_zu_samples(noten: list[Note], samplerate: int = SAMPLERATE) -> list[float]:
    """Eine Notenfolge aneinandergehängt (rein, testbar)."""
    samples: list[float] = []
    for frequenz, dauer in noten:
        samples.extend(ton_samples(frequenz, dauer, samplerate))
    return samples


def wav_bytes(samples: list[float], samplerate: int = SAMPLERATE) -> bytes:
    """16-Bit-Mono-WAV aus Werten zwischen -1 und 1 (rein, testbar).

    Von Hand statt mit dem ``wave``-Modul zusammengesetzt: Das Format
    ist für einen kurzen Mono-Ton einfach genug, und so bleibt die
    ganze Erzeugung ohne Seiteneffekt - kein Öffnen einer Datei, kein
    Zwischenspeicher, nur Bytes aus Zahlen.
    """
    frames = b"".join(
        struct.pack("<h", max(-32767, min(32767, int(round(wert * 32767)))))
        for wert in samples
    )
    kanaele, bits = 1, 16
    block_align = kanaele * bits // 8
    byte_rate = samplerate * block_align
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(frames),
        b"WAVE",
        b"fmt ",
        16,
        1,
        kanaele,
        samplerate,
        byte_rate,
        block_align,
        bits,
        b"data",
        len(frames),
    )
    return header + frames


def klang_wav(key: str) -> bytes:
    """Der fertige Klingelton zu einem Schlüssel - die Vorgabe bei einem
    unbekannten (rein genug: rechnet nur, greift auf nichts zu)."""
    klang = BY_KEY.get(key) or BY_KEY[STANDARD]
    return wav_bytes(noten_zu_samples(klang["noten"]))


def einstellung_lesen(rows: Any) -> dict[str, Any]:
    """Die gespeicherte Wahl - Ton und Boxen (rein, testbar).

    ``rows`` ist der Datenspeicher-Eintrag (höchstens ein Dict in einer
    Liste, wie beim Gute-Nacht-Knopf). Ein unbekannter Ton fällt auf
    die Vorgabe zurück, damit eine spätere Auslieferung, die einen
    Klang umbenennt, niemanden mit einer kaputten Einstellung
    zurücklässt. Keine Boxen gewählt heisst still - siehe Kopf dieser
    Datei.
    """
    for row in rows or []:
        if isinstance(row, dict):
            sound = str(row.get("sound") or STANDARD)
            if sound not in BY_KEY:
                sound = STANDARD
            boxen = row.get("speakers")
            return {
                "sound": sound,
                "speakers": (
                    [str(eintrag) for eintrag in boxen if str(eintrag)]
                    if isinstance(boxen, list)
                    else []
                ),
            }
    return {"sound": STANDARD, "speakers": []}
