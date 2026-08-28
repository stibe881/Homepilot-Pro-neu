"""Sprachnotiz: einen selbst gesprochenen Satz auf die Boxen legen.

Eine Durchsage schreibt man («Essen ist fertig»), und der Hub spricht
sie vor. Das ist gut für die immergleichen Sätze und schlecht für alles
andere: Wer «Levin, in fünf Minuten gehen wir» tippt, hat länger
getippt, als er gebraucht hätte, es zu sagen – und die Stimme aus der
Box klingt nach niemandem.

Deshalb hier derselbe Weg, nur mit dem Mikrofon davor: aufnehmen,
hochladen, auf die Boxen legen (say.play_audio). Der Hub wandelt nichts
um; er reicht durch, was ankommt, und nennt der Box den richtigen Typ.
Umwandeln hiesse ffmpeg auf dem Hub, und das ist ein grosses Stück
Software für einen Satz.

**Was die Boxen davon spielen.** Google-Cast-Geräte spielen WebM/Opus –
also genau das, was ein Browser aufnimmt. Ältere Boxen wollen MP3 oder
WAV. Was nicht spielt, ist an der Box still und steht als Fehler in der
Antwort; der Hub kann das nicht vorher wissen.

**Warum es die Aufnahme nur im Browser gibt.** Die native App
(Telefon/iPad) hat kein Aufnahmemodul – das nachzurüsten hiesse ein
neues Expo-Modul, also eine neue ``runtimeVersion`` und damit ein
gekappter OTA-Kanal für alle anderen Lieferungen (siehe CLAUDE.md,
«Ausliefern»). Das ist ein hoher Preis für eine Kleinigkeit. Auf dem
Wandpanel und im Browser geht es ohne all das, und dort steht man beim
Weggehen ohnehin.
"""

from __future__ import annotations

from .errors import HomePilotError

#: Kürzer ist keine Aufnahme, sondern ein Verrutschen am Knopf.
MINDESTENS = 800

#: Rund eine Minute Opus. Eine Sprachnotiz ist ein Zuruf, kein Vortrag -
#: und der Ton liegt bis zum Abspielen im Arbeitsspeicher des Hubs.
HOECHSTENS = 2_000_000

#: Anfangsbytes → Medientyp. Ein Dateiname existiert hier nicht; die
#: Aufnahme kommt als roher Rumpf an.
KOEPFE: tuple[tuple[bytes, str], ...] = (
    (b"RIFF", "audio/wav"),
    (b"OggS", "audio/ogg"),
    (b"\x1a\x45\xdf\xa3", "audio/webm"),
    (b"ID3", "audio/mpeg"),
    (b"\xff\xfb", "audio/mpeg"),
    (b"\xff\xf3", "audio/mpeg"),
)


def medientyp(audio: bytes) -> str:
    """Was für ein Ton das ist (rein, testbar).

    Die Box bekommt den Typ als Content-Type und richtet sich danach.
    Vorher stand dort «audio/mpeg» für alles, was nicht mit RIFF anfing -
    bei einer WebM-Aufnahme ist das schlicht gelogen, und eine Box, die
    einer falschen Angabe glaubt, spielt Rauschen oder gar nichts.
    """
    for kopf, typ in KOEPFE:
        if audio.startswith(kopf):
            return typ
    # MP4/M4A trägt seine Kennung erst an Position vier.
    if len(audio) > 11 and audio[4:8] == b"ftyp":
        return "audio/mp4"
    # Unbekannt: MP3 ist die wahrscheinlichste Annahme und die, mit der
    # die meisten Boxen etwas anfangen.
    return "audio/mpeg"


def pruefen(audio: bytes) -> None:
    """Grösse prüfen, sonst nichts. Wirft HomePilotError mit Klartext.

    Bewusst keine Formatprüfung: Welche Formate ein Browser aufnimmt,
    ändert sich mit jeder Version, und eine Liste, die der Hub pflegen
    müsste, wäre in einem Jahr falsch. Was die Box nicht spielt, meldet
    sie - das ist die ehrlichere Grenze.
    """
    if len(audio) < MINDESTENS:
        raise HomePilotError(
            "Die Aufnahme ist zu kurz - hat der Knopf gewackelt?"
        )
    if len(audio) > HOECHSTENS:
        raise HomePilotError(
            "Die Aufnahme ist zu lang - eine Sprachnotiz ist ein Zuruf "
            "(höchstens etwa eine Minute)."
        )
