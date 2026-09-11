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

#: Die eingebauten Klänge, in Anzeige-Reihenfolge: erst die klassischen
#: Glocken, dann die kurzen Signale, zuletzt die zum Schmunzeln - beides
#: darf man wollen.
#:
#: ``abklingen`` bedeutet: Der Ton schlägt an und schwingt aus, statt
#: gleichmässig zu stehen. Glocken, Harfe und Gong brauchen das, sonst
#: klingen sie wie ein Piepser (siehe ``ton_samples``). Hupe, Sirene und
#: Quietscheente stehen bewusst ohne - eine Hupe, die ausschwingt, ist
#: keine Hupe mehr.
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
        "key": "bimbam",
        "label": "Bim-Bam",
        "abklingen": True,
        "noten": [
            (659.0, 0.8),
            (0.0, 0.06),
            (494.0, 1.1),
        ],
    },
    {
        "key": "westminster",
        "label": "Westminster",
        "abklingen": True,
        # Die ersten vier Schläge des Big Ben (E-C-D-G, eine Oktave
        # höher gelegt, damit es auf kleinen Boxen nicht dumpf wird).
        "noten": [
            (659.0, 0.55),
            (0.0, 0.04),
            (523.0, 0.55),
            (0.0, 0.04),
            (587.0, 0.55),
            (0.0, 0.04),
            (392.0, 1.2),
        ],
    },
    {
        "key": "glocke",
        "label": "Glocke",
        "abklingen": True,
        # Eine Glocke klingt nicht auf einer Frequenz: Der Grundton und
        # seine Quinte zusammen geben das Schwebende, das ein einzelner
        # Sinus nicht hat. Hier nacheinander statt gleichzeitig - die
        # Notenfolge kann nur nacheinander, und das Ohr ergänzt es.
        "noten": [
            (880.0, 0.12),
            (587.0, 1.4),
        ],
    },
    {
        "key": "gong",
        "label": "Gong",
        "abklingen": True,
        "noten": [(196.0, 0.1), (147.0, 1.8)],
    },
    {
        "key": "harfe",
        "label": "Harfe",
        "abklingen": True,
        # Ein Arpeggio aufwärts: kurz angeschlagen, jede Note klingt aus.
        "noten": [
            (523.0, 0.16),
            (659.0, 0.16),
            (784.0, 0.16),
            (1047.0, 0.16),
            (1319.0, 0.6),
        ],
    },
    {
        "key": "spieluhr",
        "label": "Spieluhr",
        "abklingen": True,
        "noten": [
            (1047.0, 0.18),
            (1319.0, 0.18),
            (1568.0, 0.18),
            (1319.0, 0.18),
            (1047.0, 0.45),
        ],
    },
    {
        "key": "piepser",
        "label": "Piepser",
        "noten": [
            (1047.0, 0.1),
            (0.0, 0.08),
            (1047.0, 0.1),
            (0.0, 0.08),
            (1047.0, 0.1),
        ],
    },
    {
        "key": "hupe",
        "label": "Hupe",
        "noten": [(220.0, 0.22), (0.0, 0.07), (220.0, 0.3)],
    },
    {
        "key": "schiffshorn",
        "label": "Schiffshorn",
        "noten": [(110.0, 0.9), (0.0, 0.12), (110.0, 1.2)],
    },
    {
        "key": "sirene",
        "label": "Sirene",
        # Auf und ab in Stufen - eine echte Sirene gleitet, eine
        # Notenfolge kann nur springen. Kurze Schritte reichen, damit
        # das Ohr daraus ein Gleiten macht.
        "noten": [
            (440.0, 0.09),
            (523.0, 0.09),
            (659.0, 0.09),
            (784.0, 0.16),
            (659.0, 0.09),
            (523.0, 0.09),
            (440.0, 0.2),
        ],
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
    {
        "key": "fanfare",
        "label": "Fanfare",
        "noten": [
            (392.0, 0.14),
            (523.0, 0.14),
            (659.0, 0.14),
            (784.0, 0.18),
            (659.0, 0.1),
            (784.0, 0.5),
        ],
    },
    {
        "key": "roboter",
        "label": "Roboter",
        "noten": [
            (330.0, 0.08),
            (0.0, 0.03),
            (494.0, 0.08),
            (0.0, 0.03),
            (262.0, 0.08),
            (0.0, 0.03),
            (587.0, 0.08),
            (0.0, 0.03),
            (392.0, 0.22),
        ],
    },
    {
        "key": "entchen",
        "label": "Alle meine Entchen",
        "abklingen": True,
        # Die ersten sechs Töne - mehr wäre an der Haustür zu lang.
        "noten": [
            (523.0, 0.22),
            (587.0, 0.22),
            (659.0, 0.22),
            (698.0, 0.22),
            (784.0, 0.45),
            (784.0, 0.45),
        ],
    },
]

BY_KEY: dict[str, dict[str, Any]] = {klang["key"]: klang for klang in KLAENGE}

#: Der Ton, der gilt, solange niemand einen anderen gewählt hat.
STANDARD = "dingdong"


#: Wie schnell ein anschlagender Ton leiser wird. 3.5 heisst: Nach der
#: halben Dauer ist er noch bei rund einem Sechstel - so klingt ein
#: Anschlag, der ausschwingt.
ABKLINGRATE = 3.5


def ton_samples(
    frequenz: float,
    dauer: float,
    samplerate: int = SAMPLERATE,
    abklingen: bool = False,
) -> list[float]:
    """Ein Sinuston als Werte zwischen -1 und 1 (rein, testbar).

    Mit kurzer Ein- und Ausblendung (5 ms): Ohne sie knackt jeder Ton
    beim Einsetzen und Enden, hörbar als Klicken - besonders bei der
    Quietscheente, die aus lauter kurzen Tönen besteht.

    ``abklingen`` macht aus dem gleichmässigen Ton einen Anschlag: laut
    am Anfang, dann ausschwingend. Ohne das klingt jede Glocke wie ein
    Piepton - ein Sinus mit flacher Hüllkurve hat nichts, woran das Ohr
    «Glocke» erkennt, und «Harfe» und «Hupe» wären dasselbe mit anderen
    Frequenzen. Es ist die einzige Zutat, die aus Zahlen einen Klang
    mit Charakter macht, und sie kostet eine Multiplikation je Wert.
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
        if abklingen:
            huellkurve *= math.exp(-ABKLINGRATE * i / anzahl)
        werte.append(huellkurve * math.sin(2 * math.pi * frequenz * i / samplerate))
    return werte


def noten_zu_samples(
    noten: list[Note], samplerate: int = SAMPLERATE, abklingen: bool = False
) -> list[float]:
    """Eine Notenfolge aneinandergehängt (rein, testbar)."""
    samples: list[float] = []
    for frequenz, dauer in noten:
        samples.extend(ton_samples(frequenz, dauer, samplerate, abklingen))
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
    return wav_bytes(
        noten_zu_samples(klang["noten"], abklingen=bool(klang.get("abklingen")))
    )


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
