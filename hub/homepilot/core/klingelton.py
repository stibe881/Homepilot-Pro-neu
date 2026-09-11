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

#: Nachts (Punkt 518): «normal» wie am Tag, «leise» gedämpft, «still»
#: gar nicht - die Push-Nachricht kommt in jedem Fall. Ein Gong um
#: Mitternacht weckt das ganze Haus, dabei ist der Pöstler um diese
#: Zeit ohnehin nicht da.
NACHT_MODI = ("normal", "leise", "still")
NACHT_STANDARD = {"mode": "normal", "from": 22, "to": 7}
#: So laut ist «leise» - hörbar im Zimmer, nicht im Kinderzimmer nebenan.
NACHT_LAUTSTAERKE = 30

#: Die Ansage nach dem Ton (Punkt 519): «Es klingelt» als gesprochener
#: Satz auf denselben Boxen. Für den Fernseher gedacht, der über
#: Google Cast eine Box ist: Ein Bild einblenden kann der Hub dort
#: nicht (die Android-TV-Fernbedienung kennt nur Tasten), aber sagen
#: kann er es. Ohne Kamera an der Klingel ist der Satz die Meldung.
ANSAGE_STANDARD = "Es klingelt."
ANSAGE_MAX = 80

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


# ── Je Box: wie laut, und wann überhaupt ──────────────────────────────
#
# «Bei jedem Lautsprecher, den man aktiviert, soll man die Lautstärke
# einzeln definieren» und «die Zeit, wann es da klingelt».
#
# Beides sind Fragen, die nur je Box eine Antwort haben. Die Küchenbox
# steht neben dem Esstisch und darf leise sein; im Keller hört man sonst
# nichts. Und die Box im Kinderzimmer soll abends nicht mehr losgehen,
# während die im Flur immer darf. Eine Zahl fürs ganze Haus beantwortet
# davon keine.

#: Zeitspanne einer Box, wenn nichts anderes dasteht: den ganzen Tag.
#: Bewusst nicht «ab jetzt still» - wer eine Box wählt, will sie hören.
GANZER_TAG = ("00:00", "24:00")


def uhrzeit_lesen(wert: Any, vorgabe: str) -> str:
    """«7:5» → «07:05» (rein, testbar).

    Was nicht als Uhrzeit lesbar ist, fällt auf die Vorgabe zurück statt
    die Box stumm zu schalten: Eine kaputte Einstellung darf dazu führen,
    dass es zu oft klingelt, nicht dass es nie klingelt.
    """
    text = str(wert or "").strip()
    if text in ("24:00", "2400"):
        return "24:00"
    teile = text.split(":")
    if len(teile) != 2:
        return vorgabe
    try:
        stunde, minute = int(teile[0]), int(teile[1])
    except ValueError:
        return vorgabe
    if not (0 <= stunde <= 23 and 0 <= minute <= 59):
        return vorgabe
    return f"{stunde:02d}:{minute:02d}"


def box_lesen(eintrag: Any) -> dict[str, Any] | None:
    """Eine gewählte Box aus dem Datenspeicher (rein, testbar).

    Zwei Formen, weil die ältere im Haus schon gespeichert ist: früher
    stand hier bloss die Kennung als Text, heute ein Eintrag mit
    Lautstärke und Zeitspanne. Wer aus der alten Form liest, bekommt die
    Vorgaben - laut wie bisher, den ganzen Tag. Nichts wird stiller oder
    lauter, nur weil eine Auslieferung dazwischenlag.
    """
    if isinstance(eintrag, str):
        kennung = eintrag.strip()
        if not kennung:
            return None
        return {
            "id": kennung,
            "volume": LAUTSTAERKE,
            "from": GANZER_TAG[0],
            "to": GANZER_TAG[1],
        }
    if not isinstance(eintrag, dict):
        return None
    kennung = str(eintrag.get("id") or "").strip()
    if not kennung:
        return None
    try:
        laut = int(eintrag.get("volume", LAUTSTAERKE))
    except (TypeError, ValueError):
        laut = LAUTSTAERKE
    return {
        "id": kennung,
        "volume": max(0, min(100, laut)),
        "from": uhrzeit_lesen(eintrag.get("from"), GANZER_TAG[0]),
        "to": uhrzeit_lesen(eintrag.get("to"), GANZER_TAG[1]),
    }


def in_spanne(jetzt: str, von: str, bis: str) -> bool:
    """Liegt diese Uhrzeit in der Spanne? (rein, testbar)

    Über Mitternacht hinweg gilt die Spanne umgekehrt: «22:00 bis 07:00»
    heisst abends *und* morgens, nicht nie. Das ist der Fall, der ohne
    eigene Zeile falsch herauskommt - und es ist genau die Spanne, die
    man für ein Kinderzimmer einstellt.
    """
    if von == bis:
        # Kein Fenster, sondern gar keine Einschränkung.
        return True
    if bis == "24:00":
        return jetzt >= von
    if von < bis:
        return von <= jetzt < bis
    return jetzt >= von or jetzt < bis


def klingelt_jetzt(box: dict[str, Any], jetzt: str) -> bool:
    """Klingelt es auf dieser Box zu dieser Uhrzeit? (rein, testbar)"""
    return in_spanne(jetzt, str(box.get("from") or GANZER_TAG[0]),
                     str(box.get("to") or GANZER_TAG[1]))


def aktive_boxen(speakers: Any, jetzt: str) -> list[dict[str, Any]]:
    """Die Boxen, auf denen es jetzt wirklich klingelt (rein, testbar)."""
    return [box for box in (speakers or []) if klingelt_jetzt(box, jetzt)]


def lautstaerken(speakers: Any) -> dict[str, int]:
    """Kennung → Lautstärke (rein, testbar) - für say.play_audio."""
    return {
        str(box["id"]): int(box.get("volume", LAUTSTAERKE))
        for box in (speakers or [])
        if box.get("id")
    }


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

    Jede Box kommt als Eintrag mit Lautstärke und Zeitspanne heraus,
    auch wenn im Speicher noch die alte Form (nur die Kennung) steht -
    siehe ``box_lesen``.
    """
    for row in rows or []:
        if isinstance(row, dict):
            sound = str(row.get("sound") or STANDARD)
            if sound not in BY_KEY:
                sound = STANDARD
            boxen = row.get("speakers")
            gelesen = []
            if isinstance(boxen, list):
                for eintrag in boxen:
                    box = box_lesen(eintrag)
                    if box is not None:
                        gelesen.append(box)
            return {
                "sound": sound,
                "speakers": gelesen,
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
