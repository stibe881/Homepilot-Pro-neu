"""Nachhaken, bis jemand in der Waschküche war (alle rein, testbar).

Die Meldung «Waschmaschine ist noch voll» ging bisher genau einmal
raus. Wer sie am Abend auf dem Sofa las und liegen liess, hörte nie
wieder davon: Der Merker fiel erst weg, wenn die Maschine irgendwann
wieder lief. Die Wäsche lag über Nacht in der Trommel und roch am
Morgen danach.

Wiederholen allein wäre aber schlimmer als schweigen. Eine Erinnerung,
die sich nicht abstellen lässt, schaltet man irgendwann ganz ab - und
dann fehlt auch die erste. Es braucht also ein Zeichen, dass jemand
sich gekümmert hat.

Die Maschinen selbst geben es nicht her: Weder V-Zug noch die
Messsteckdose merken, ob die Trommel leer ist. Die Türe der Waschküche
merkt es. Wer die Wäsche holt, geht hinein - und wer hineingeht, hat
die volle Maschine gesehen. Ob er sie ausgeräumt hat, weiss der Hub
nicht; nachzufragen wäre trotzdem falsch. Deshalb gilt hier: einmal
drin gewesen, und die Sache ist erledigt.

Der Umkehrschluss stimmt ebenso: Solange die Türe zu bleibt, war
niemand dort, und die Wäsche liegt noch. Genau dann darf gemahnt
werden.

Ohne Türkontakt bleibt es beim einen Hinweis wie bisher. Lieber eine
Erinnerung zu wenig als eine, die sich nur durch Abschalten der ganzen
Regel beenden lässt.
"""

from __future__ import annotations

import time
from typing import Any

from .watchrules import OPEN_CLASSES, OPENING_NAME

#: Woran eine Waschküche zu erkennen ist - Raumname oder Gerätename.
#: «Keller» steht bewusst nicht dabei: Dort hängt oft auch die
#: Aussentüre, und die geht auf, ohne dass jemand an der Wäsche war.
RAUM_WOERTER = (
    "waschküche",
    "waschkueche",
    "waschraum",
    "wäschekammer",
    "waeschekammer",
    "wäscheraum",
    "waescheraum",
)

#: Abstand zwischen zwei Mahnungen. Die erste kommt nach der Zeit aus
#: der Push-Regel (Vorgabe zwei Stunden), danach im Stundentakt: kurz
#: genug, dass es vor dem Schlafengehen noch einmal klingelt, lang
#: genug, dass es nicht nervt.
ABSTAND = 3600.0

#: Nach so vielen Mahnungen ist Schluss. Wer viermal nicht hingegangen
#: ist, geht auch beim fünften Mal nicht - und eine Nachricht, die bis
#: zum Morgen weiterläuft, weckt am Ende nur.
HOECHSTENS = 4

#: Zwischen 22 und 8 Uhr bleibt es still - und zwar ganz, auch bei der
#: ersten Nachricht. Lange ging die erste trotzdem raus, mit dem
#: Argument, wer um halb zehn fertig wasche, rechne mit ihr. In diesem
#: Haushalt läuft nachts keine Maschine: Was in diesem Fenster ankäme,
#: weckt also jemanden und ändert nichts - die Wäsche holt um zwei Uhr
#: niemand. Verloren geht die Nachricht dadurch nicht, sie wartet bis
#: am Morgen.
#:
#: Beide Zahlen stehen in der Push-Regel und lassen sich in der App
#: verstellen; gleiche Werte heben das Fenster auf.
RUHE_VON = 22
RUHE_BIS = 8


def ist_waschkueche(raum: str | None) -> bool:
    """Trägt dieser Raum einen Namen, der nach Waschküche klingt?"""
    if not raum:
        return False
    tief = raum.casefold()
    return any(wort in tief for wort in RAUM_WOERTER)


def ist_kontakt(entity: Any) -> bool:
    """Ist das ein Tür-/Fensterkontakt?

    Dieselbe Regel wie ``watchrules.open_contacts``, nur ohne die Frage
    nach dem Zustand: Hier wird ausgewählt, nicht gezählt. Ein Schloss
    zählt nicht mit - die Waschküche hat keines, und ein Riegel sagt
    nichts darüber, ob jemand durchgegangen ist.
    """
    if getattr(entity, "kind", "") != "binary_sensor":
        return False
    klasse = str(entity.state.get("device_class") or "")
    if klasse:
        return klasse in OPEN_CLASSES
    return bool(OPENING_NAME.search(str(getattr(entity, "label", "") or "")))


def kandidaten(entities: list[Any]) -> list[Any]:
    """Alle Kontakte, die als Waschküchentüre in Frage kommen.

    Bewusst alle und nicht nur die im passenden Raum: Nicht jeder
    beschriftet seine Räume, und eine Auswahl, die das gesuchte Gerät
    nicht enthält, ist keine.
    """
    return [entity for entity in entities if ist_kontakt(entity)]


def raten(entities: list[Any]) -> str | None:
    """Welcher Kontakt ist vermutlich die Waschküchentüre?

    Erst der Raum, dann der Name. Das Ergebnis ist ein Vorschlag, keine
    Einstellung: Es steht in der App als Vorauswahl und lässt sich
    überstimmen.
    """
    for entity in kandidaten(entities):
        if ist_waschkueche(getattr(entity, "room", None)):
            return str(entity.id)
    for entity in kandidaten(entities):
        if ist_waschkueche(str(getattr(entity, "label", "") or "")):
            return str(entity.id)
    return None


def tuer(entities: list[Any], gewaehlt: str | None) -> Any | None:
    """Die Türe, an der gemessen wird - gewählte vor geratener.

    Eine gewählte Türe, die es nicht mehr gibt, fällt auf die geratene
    zurück statt ins Leere: Sonst hörte das Nachhaken nach einem
    Batteriewechsel mit neuer Geräte-Id stillschweigend auf.
    """
    liste = kandidaten(entities)
    if gewaehlt:
        for entity in liste:
            if str(entity.id) == gewaehlt:
                return entity
    geraten = raten(entities)
    for entity in liste:
        if str(entity.id) == geraten:
            return entity
    return None


def ist_offen(entity: Any | None) -> bool:
    """Steht dieser Kontakt gerade offen?"""
    if entity is None:
        return False
    return str(entity.state.get("state") or "") == "on"


def ruhezeit(jetzt: float, von: float = RUHE_VON, bis: float = RUHE_BIS) -> bool:
    """Ist gerade Nacht? (rein, testbar)

    Das Fenster geht über Mitternacht, deshalb das «oder». Sind beide
    Zahlen gleich, gibt es keine Nachtruhe: Das ist der Weg, sie in der
    App abzuschalten - ohne ihn hiesse «ab 22 bis 22 Uhr» rund um die
    Uhr still, und niemand fände heraus, warum nichts mehr kommt.
    """
    if von == bis:
        return False
    stunde = time.localtime(jetzt).tm_hour
    # Zwei Fälle, und nur einer davon geht über Mitternacht. «Ab 0 bis 8»
    # mit dem Oder-Vergleich hiesse rund um die Uhr still, weil jede
    # Stunde >= 0 ist - eine Einstellung, die man in der App in einem
    # Tipp erreicht.
    if von < bis:
        return von <= stunde < bis
    return stunde >= von or stunde < bis


def faellig(
    seit: float,
    gemahnt: int,
    jetzt: float,
    erste_stunden: float,
    nachhaken: bool,
    hoechstens: int = HOECHSTENS,
    abstand: float = ABSTAND,
    zuletzt: float | None = None,
    ruhe_von: float = RUHE_VON,
    ruhe_bis: float = RUHE_BIS,
) -> bool:
    """Ist jetzt eine Mahnung dran? (rein, testbar)

    ``seit`` ist das Programmende, ``gemahnt`` die Anzahl der bisher
    verschickten Nachrichten, ``zuletzt`` der Zeitpunkt der letzten.
    ``nachhaken`` sagt, ob es eine Türe gibt, an der sich das Ende
    ablesen lässt - ohne sie bleibt es bei der ersten Nachricht.

    In der Nachtruhe ist nichts fällig, auch die erste Nachricht nicht.
    Hinfällig wird sie dadurch nicht: Um acht steht sie da, und
    ``mahnsatz`` rechnet die Stunden seit dem Programmende aus.

    Der Abstand zählt ab der letzten Mahnung und nicht ab dem
    Programmende. Sonst wären nach einer stillen Nacht alle
    liegengebliebenen Mahnungen auf einmal fällig, und das Telefon
    klingelte um acht Uhr viermal innert vier Minuten.
    """
    if gemahnt >= (hoechstens if nachhaken else 1):
        return False
    if ruhezeit(jetzt, ruhe_von, ruhe_bis):
        return False
    if gemahnt == 0:
        return jetzt - seit >= erste_stunden * 3600
    if zuletzt is not None:
        return jetzt - zuletzt >= abstand
    return jetzt - seit >= erste_stunden * 3600 + gemahnt * abstand


def mahnsatz(label: str, seit: float, jetzt: float, gemahnt: int) -> tuple[str, str]:
    """Titel und Text der Mahnung.

    Ab der zweiten Nachricht steht dabei, dass niemand in der Waschküche
    war - sonst liest sich die Wiederholung wie ein Fehler der App.
    """
    stunden = max(1, round((jetzt - seit) / 3600))
    wort = "Stunde" if stunden == 1 else "Stunden"
    if gemahnt == 0:
        return (
            f"{label} ist noch voll",
            f"Seit {stunden} {wort} fertig und seither nicht wieder gelaufen.",
        )
    return (
        f"{label} ist immer noch voll",
        f"Seit {stunden} {wort} fertig - und seither war niemand in der "
        "Waschküche.",
    )


# ── «Ich mach's» ───────────────────────────────────────────────────────────
#
# Die Meldung «Waschmaschine ist noch voll» geht an alle. Was danach
# passiert, ist beide Male falsch: Entweder geht niemand hinunter, weil
# jeder annimmt, ein anderer tue es - oder zwei stehen gleichzeitig vor
# der Trommel. Beides, weil niemand sieht, was die anderen vorhaben.
#
# Ein Knopf unter der Nachricht übernimmt sie. Danach hört das Nachhaken
# auf, und bei den anderen steht, wer sich kümmert.
#
# Die Übernahme gilt für *diesen* Programmlauf, nicht für das Gerät:
# gemerkt wird das Programmende, das sie meint. Läuft die Maschine
# wieder, ist das Ende ein anderes, und die nächste Ladung fängt bei
# null an - sonst hätte ein «Ich mach's» von letzter Woche die
# Erinnerungen für immer abgestellt.


def uebernahme_gilt(eintrag: Any, seit: float | None) -> bool:
    """Meint diese Übernahme den Programmlauf, der gerade ansteht?

    Verglichen wird das Programmende auf die Sekunde genau: Es ist ein
    Zeitstempel aus derselben Quelle, keine Messung. Ein Eintrag ohne
    Ende gehört zu keinem Lauf und zählt nicht.
    """
    if not isinstance(eintrag, dict) or seit is None:
        return False
    try:
        return float(eintrag.get("seit")) == float(seit)
    except (TypeError, ValueError):
        return False


def uebernahmesatz(name: str) -> str:
    """«Bine räumt aus» – was die anderen am Gerät lesen.

    Der Name und kein «übernommen»: Die Frage, die im Kopf steht, ist
    «muss ich?», und darauf antwortet nur ein Name.
    """
    sauber = str(name or "").strip()
    return f"{sauber} räumt aus" if sauber else "Jemand räumt aus"
