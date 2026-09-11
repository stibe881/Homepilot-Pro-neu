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

#: Nachts (Punkt 429): «normal» wie am Tag, «leise» gedämpft, «still»
#: gar nicht - die Push-Nachricht kommt in jedem Fall. Ein Gong um
#: Mitternacht weckt das ganze Haus, dabei ist der Pöstler um diese
#: Zeit ohnehin nicht da.
NACHT_MODI = ("normal", "leise", "still")
NACHT_STANDARD = {"mode": "normal", "from": 22, "to": 7}
#: So laut ist «leise» - hörbar im Zimmer, nicht im Kinderzimmer nebenan.
NACHT_LAUTSTAERKE = 30

#: Die Ansage nach dem Ton (Punkt 430): «Es klingelt» als gesprochener
#: Satz auf denselben Boxen. Für den Fernseher gedacht, der über
#: Google Cast eine Box ist: Ein Bild einblenden kann der Hub dort
#: nicht (die Android-TV-Fernbedienung kennt nur Tasten), aber sagen
#: kann er es. Ohne Kamera an der Klingel ist der Satz die Meldung.
ANSAGE_STANDARD = "Es klingelt."
ANSAGE_MAX = 80

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


def nacht_lesen(raw: Any) -> dict[str, Any]:
    """Die Nacht-Regel aus der Ablage (rein, testbar) - Unsinn wird zur Vorgabe."""
    if not isinstance(raw, dict):
        return dict(NACHT_STANDARD)
    mode = str(raw.get("mode") or NACHT_STANDARD["mode"])
    if mode not in NACHT_MODI:
        mode = str(NACHT_STANDARD["mode"])

    def stunde(wert: Any, vorgabe: int) -> int:
        try:
            zahl = int(wert)
        except (TypeError, ValueError):
            return vorgabe
        return zahl if 0 <= zahl <= 23 else vorgabe

    return {
        "mode": mode,
        "from": stunde(raw.get("from"), int(NACHT_STANDARD["from"])),
        "to": stunde(raw.get("to"), int(NACHT_STANDARD["to"])),
    }


def ansage_lesen(raw: Any) -> str:
    """Der Ansage-Text - gekürzt und ohne Leerraum; leer heisst Vorgabe (rein, testbar)."""
    text = str(raw or "").strip()
    return text[:ANSAGE_MAX] if text else ANSAGE_STANDARD


def lautstaerke_jetzt(stand: dict[str, Any], jetzt: float) -> int | None:
    """Wie laut der Ton jetzt spielt - ``None`` heisst gar nicht (rein, testbar).

    Die Nacht rechnet wie die Ruhezeit der Meldungen (core/nachtruhe.py):
    «von 22 bis 7» geht über Mitternacht, «von 0 bis 0» ist keine Nacht.
    """
    from . import nachtruhe

    nacht = stand.get("night") or NACHT_STANDARD
    if nacht["mode"] == "normal" or not nachtruhe.still(jetzt, nacht["from"], nacht["to"]):
        return LAUTSTAERKE
    if nacht["mode"] == "still":
        return None
    return NACHT_LAUTSTAERKE


def einstellung_lesen(rows: Any) -> dict[str, Any]:
    """Die gespeicherte Wahl - Ton, Boxen, Nacht und Ansage (rein, testbar).

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
                "night": nacht_lesen(row.get("night")),
                "announce": bool(row.get("announce")),
                "announce_text": ansage_lesen(row.get("announce_text")),
            }
    return {
        "sound": STANDARD,
        "speakers": [],
        "night": dict(NACHT_STANDARD),
        "announce": False,
        "announce_text": ANSAGE_STANDARD,
    }
