"""Der Dokumentsafe kennt ein Ablaufdatum (Punkt 623 der Werkbank).

Ein Dokument war Titel plus Freitext: kein «gültig bis», keine Person,
keine Erinnerung. Kinderpässe gelten fünf Jahre, ID, Halbtax, Vignette
und Impfungen laufen ab - Gutscheine bekamen zwei Stufen Vorwarnung,
Filter eine Wartungsfrist, Dokumente nichts. Der abgelaufene Kinderpass
fällt dann am Flughafen auf.

Hier steht das Rechnen: Wann läuft was ab, welche Stufe ist dran, wie
heisst die Nachricht, und wie wird «erneuert» festgehalten, ohne den
Verlauf zu verlieren (dieselbe Bauart wie maintenance.quittieren). Der
Wächter meldet; die App pflegt die Einträge (screens/family/module.tsx,
lib/dokumente.ts liest dieselben Felder).
"""

from __future__ import annotations

import calendar
import re
from datetime import date
from typing import Any

#: Wo die Dokumente liegen - die Familienliste «documents».
KEY = "family_documents"

#: Die Vorwarnstufen in Tagen: die erste, um einen neuen Pass zu
#: beantragen (das dauert Wochen), die zweite als letzte Mahnung.
STUFEN: tuple[int, ...] = (60, 14)

#: So viele Erneuerungen bleiben im Verlauf - wie bei der Wartung.
VERLAUF = 10


def ablauf(row: Any) -> date | None:
    """Das Ablaufdatum eines Dokuments (rein, testbar).

    Drei Schreibweisen, weil drei Sorten Dokumente: «2027-03-15» und
    «15.03.2027» für Pass und ID, «03.2027» für Impfungen und die
    Vignette, die auf den Monat genau gelten - da zählt der letzte Tag
    des Monats. Alles andere heisst «läuft nicht ab».
    """
    if not isinstance(row, dict):
        return None
    text = str(row.get("expires") or "").strip()
    if not text:
        return None
    iso = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", text)
    if iso:
        try:
            return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        except ValueError:
            return None
    schweizer = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", text)
    if schweizer:
        try:
            return date(int(schweizer.group(3)), int(schweizer.group(2)), int(schweizer.group(1)))
        except ValueError:
            return None
    monat = re.fullmatch(r"(\d{1,2})\.(\d{4})", text)
    if monat:
        jahr, mon = int(monat.group(2)), int(monat.group(1))
        if not 1 <= mon <= 12:
            return None
        return date(jahr, mon, calendar.monthrange(jahr, mon)[1])
    return None


def stufe(tage: int) -> int | None:
    """Welche Stufe zu diesem Restlauf gehört (rein, testbar).

    0 heisst «abgelaufen oder heute» - auch das wird einmal gemeldet:
    Ein Pass, der gestern ablief, ist die Auskunft, die man vor der
    Reise braucht. None heisst: noch nichts zu sagen.
    """
    if tage <= 0:
        return 0
    for grenze in sorted(STUFEN):
        if tage <= grenze:
            return grenze
    return None


def faellig(rows: Any, heute: date) -> list[dict[str, Any]]:
    """Welche Dokumente jetzt eine Meldung brauchen (rein, testbar).

    Je Dokument: der Eintrag, die Resttage, die Stufe und eine Marke,
    mit der der Wächter sich merkt, dass diese Stufe zu diesem Ablauf
    schon gemeldet wurde. Der Ablauf steht in der Marke: Wer den Pass
    erneuert, bekommt für das neue Datum wieder alle Stufen.
    """
    treffer: list[dict[str, Any]] = []
    for row in rows if isinstance(rows, list) else []:
        wann = ablauf(row)
        if wann is None:
            continue
        tage = (wann - heute).days
        welche = stufe(tage)
        if welche is None:
            continue
        kennung = str(row.get("id") or row.get("text") or "")
        treffer.append(
            {
                "row": row,
                "tage": tage,
                "stufe": welche,
                "marke": f"documents:{kennung}:{wann.isoformat()}:{welche}",
            }
        )
    return sorted(treffer, key=lambda eintrag: eintrag["tage"])


def satz(row: dict[str, Any], tage: int) -> tuple[str, str]:
    """Titel und Text der Nachricht (rein, testbar)."""
    titel = str(row.get("text") or "Dokument").strip()
    wer = str(row.get("member") or "").strip()
    wessen = f"{titel} ({wer})" if wer else titel
    if tage < 0:
        rest = f"ist seit {-tage} Tagen abgelaufen" if tage != -1 else "ist seit gestern abgelaufen"
    elif tage == 0:
        rest = "läuft heute ab"
    elif tage == 1:
        rest = "läuft morgen ab"
    else:
        rest = f"läuft in {tage} Tagen ab"
    return ("Dokument läuft ab", f"{wessen} {rest}.")


def erneuern(
    row: dict[str, Any], neues_datum: str, heute: date, wer: str = ""
) -> dict[str, Any]:
    """Ein Dokument als erneuert vermerken - mit Verlauf (rein, testbar).

    Das alte Ablaufdatum wandert ins Protokoll, das neue wird gültig.
    Dieselbe Bauart wie maintenance.quittieren: Wer wissen will, wann
    der Pass zuletzt erneuert wurde, findet es hier statt im Kopf.
    """
    verlauf = [
        eintrag
        for eintrag in (row.get("log") or [])
        if isinstance(eintrag, dict) and eintrag.get("at")
    ]
    return {
        **row,
        "expires": str(neues_datum or "").strip(),
        "log": [
            {
                "at": heute.isoformat(),
                "by": wer or None,
                "expired": str(row.get("expires") or "").strip() or None,
            },
            *verlauf,
        ][:VERLAUF],
    }


def bald(rows: Any, heute: date, tage: int = STUFEN[0]) -> int:
    """Wie viele Dokumente in den nächsten Tagen ablaufen oder abgelaufen
    sind (rein, testbar) - die Zahl auf der Kachel."""
    zahl = 0
    for row in rows if isinstance(rows, list) else []:
        wann = ablauf(row)
        if wann is not None and (wann - heute).days <= tage:
            zahl += 1
    return zahl
