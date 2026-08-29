"""Was regelmässig ausgeht, kommt von selbst auf die Liste.

Kaffee, Waschmittel, Katzenstreu: Dinge, die niemand vergisst, weil er
sie nicht kennt, sondern weil sie erst auffallen, wenn die Packung leer
ist - beim Kochen, beim Waschen, vor dem Sack.

Zwei Dinge gab es dafür schon, und beide reichen nicht:

  - **Standardartikel** sind eine Liste zum Antippen. Sie helfen dem,
    der ohnehin gerade auf die Einkaufsliste schaut. Wer nicht
    hinschaut, dem helfen sie nicht.
  - Der **gelernte Rhythmus** (``shopping.rhythm``) schlägt vor, was
    nach dem üblichen Abstand wieder fällig wäre. Er braucht aber drei
    frühere Einträge, und er schlägt nur vor - eintragen muss man
    weiterhin selbst, und dazu die Liste öffnen.

Hier steht das Gegenstück: An einem Standardartikel hängt ein Abstand
(«alle 21 Tage»), und der Hub trägt ihn selbst ein, wenn er dran ist.
Kein Vorschlag, sondern ein Posten auf der Liste - denn genau dort
schaut man nach, wenn man im Laden steht.

Gezählt wird ab dem **Einkauf**, nicht ab dem Eintrag: Der Takt beginnt,
wenn der Posten abgehakt wird. Ab dem Eintragen zu rechnen hiesse, dass
eine Liste, die zwei Wochen liegen bleibt, den Kaffee zwei Wochen zu
früh wieder vorschlägt.

Alle Funktionen rein und testbar; wer sie ruft, steht im Wächter
(``_check_vorrat``) und in den Familienrouten.
"""

from __future__ import annotations

import time
from typing import Any

#: Grenzen für den Abstand. Ein Tag ist die tägliche Zeitung, ein halbes
#: Jahr der Vorrat, den man zweimal jährlich auffüllt. Darüber hinaus
#: wäre es keine Einkaufsliste mehr, sondern eine Wartungserinnerung -
#: und die gibt es schon (core/maintenance.py).
MIN_TAGE = 1
MAX_TAGE = 180


def takt(staple: Any) -> int | None:
    """Der eingestellte Abstand in Tagen - oder nichts (rein, testbar).

    Unsinn zählt als «kein Takt» statt als Fehler: Ein Standardartikel
    mit krummem Wert soll weiter zum Antippen dastehen, statt die ganze
    Liste zu Fall zu bringen.
    """
    if not isinstance(staple, dict):
        return None
    try:
        tage = int(float(staple.get("days")))
    except (TypeError, ValueError):
        return None
    if tage < MIN_TAGE or tage > MAX_TAGE:
        return None
    return tage


def gekauft_am(staple: dict[str, Any]) -> float | None:
    """Wann dieser Artikel zuletzt abgehakt wurde."""
    try:
        wert = float(staple.get("last") or 0)
    except (TypeError, ValueError):
        return None
    return wert or None


def naechster(staple: dict[str, Any], jetzt: float) -> float | None:
    """Wann er das nächste Mal auf die Liste gehört (rein, testbar).

    Ohne bekannten Einkauf: sofort. Wer einen Takt einstellt, will nicht
    erst einen Durchgang lang zusehen - der erste Eintrag ist zugleich
    die Antwort auf die Frage «ist noch genug da?».
    """
    tage = takt(staple)
    if tage is None:
        return None
    zuletzt = gekauft_am(staple)
    if zuletzt is None:
        return jetzt
    return zuletzt + tage * 86400.0


def faellig(
    staples: list[Any], offen: set[str], jetzt: float
) -> list[dict[str, Any]]:
    """Welche Artikel jetzt auf die Liste gehören (rein, testbar).

    ``offen`` sind die Posten, die schon offen auf der Liste stehen -
    kleingeschrieben, wie überall beim Abgleich von Einkaufstexten. Was
    dort steht, wird nicht doppelt eingetragen: Zwei Zeilen «Kaffee»
    sähen nach einem Fehler aus, und abhaken müsste man beide.
    """
    dran = []
    for staple in staples or []:
        if not isinstance(staple, dict):
            continue
        wann = naechster(staple, jetzt)
        if wann is None or wann > jetzt:
            continue
        text = str(staple.get("text") or "").strip()
        if not text or text.lower() in offen:
            continue
        dran.append(staple)
    return dran


def nachgekauft(
    staples: list[Any], text: str, jetzt: float | None = None
) -> tuple[list[Any], bool]:
    """Den Takt neu starten, weil dieser Posten abgehakt wurde.

    Zurück kommt die (gegebenenfalls geänderte) Liste und ob überhaupt
    etwas passiert ist - der Aufrufer soll nur dann speichern und die
    Apps benachrichtigen, wenn es etwas zu speichern gibt.

    Verglichen wird über den kleingeschriebenen Text: Die Verbindung
    zwischen Standardartikel und Listenposten ist der Name, nicht eine
    Id. Wer «Kaffee» von Hand einträgt und abhakt, hat genauso Kaffee
    gekauft wie der, dem der Hub ihn hingelegt hat.
    """
    gesucht = str(text or "").strip().lower()
    if not gesucht:
        return list(staples or []), False
    jetzt = time.time() if jetzt is None else jetzt
    geaendert = False
    neu = []
    for staple in staples or []:
        if (
            isinstance(staple, dict)
            and takt(staple) is not None
            and str(staple.get("text") or "").strip().lower() == gesucht
        ):
            staple = {**staple, "last": jetzt}
            geaendert = True
        neu.append(staple)
    return neu, geaendert


def satz(staple: dict[str, Any], jetzt: float) -> str | None:
    """«Alle 21 Tage · in 4 Tagen» (rein, testbar).

    Beides zusammen, weil beides gefragt wird: der Takt, um ihn zu
    beurteilen, und der nächste Termin, um zu sehen, ob er stimmt.
    """
    tage = takt(staple)
    if tage is None:
        return None
    wann = naechster(staple, jetzt)
    if wann is None:
        return None
    offen = int((wann - jetzt) // 86400)
    if wann <= jetzt:
        rest = "jetzt fällig"
    elif offen <= 0:
        rest = "heute"
    elif offen == 1:
        rest = "morgen"
    else:
        rest = f"in {offen} Tagen"
    return f"Alle {tage} Tage · {rest}"


def meldung(namen: list[str]) -> tuple[str, str]:
    """Was der Hub sagt, wenn er selbst etwas eingetragen hat.

    Er darf nicht schweigend in die Einkaufsliste schreiben: Wer sie
    aufschlägt und Posten findet, die er nicht kennt, glaubt eher an
    einen Fehler als an einen Dienst.
    """
    if len(namen) == 1:
        return ("Auf die Einkaufsliste gesetzt", f"{namen[0]} ist nach dem Vorrat dran.")
    return (
        "Auf die Einkaufsliste gesetzt",
        ", ".join(namen) + " sind nach dem Vorrat dran.",
    )
