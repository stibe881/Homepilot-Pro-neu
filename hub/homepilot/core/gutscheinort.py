"""Der Gutschein, der im Laden liegt, während man davorsteht.

Ein Gutschein verfällt, und die Erinnerung dazu gibt es (Punkt 264:
dreissig und sieben Tage vorher, morgens um neun). Sie hilft gegen den
einen Fehler - den vergessenen Gutschein - und nicht gegen den anderen,
der öfter vorkommt: Man steht bei Ochsner Sport, kauft Turnschuhe, und
der Gutschein von Weihnachten liegt zuhause in der App. Gemerkt hat man
sich ihn beim Frühstück; im Laden dachte man an die Schuhgrösse.

Das Haus weiss beides: welche Gutscheine offen sind und wo jemand
gerade steht (der Einkaufszettel meldet sich seit je im Laden,
core/shopping.py). Was fehlte, war die Verbindung dazwischen.

**Über den Namen und nicht über Koordinaten.** Ein Gutschein trägt
seinen Laden als Text - «Ochsner Sport», «Migros». Die Orte trägt der
Einkaufszettel, mit Koordinaten. Zusammengeführt wird über den Namen,
und zwar nachsichtig: Gross- und Kleinschreibung, Rechtsformen und
Filialzusätze gehören nicht dazu. «Ochsner Sport Sursee» und «Ochsner
Sport» sind derselbe Laden - und wer eine Kette meint, meint sie
überall.

**Warum das kein zweites Ortssystem ist**: Es bringt keine eigenen
Zonen mit. Wer einen Gutschein am Ort erinnert bekommen will, legt den
Laden dort an, wo er ohnehin hingehört - beim Einkaufszettel. Ein
zweiter Ort für dasselbe Geschäft wäre die Sorte Verdopplung, die
irgendwann auseinanderläuft.

Reines Rechnen über Listen; wer meldet, ist der Wächter.
"""

from __future__ import annotations

import re
from typing import Any

#: Was am Ladennamen nicht zum Laden gehört.
#:
#: Rechtsformen und die üblichen Filialzusätze. Nicht mehr: Wer zu viel
#: wegwirft, führt «Coop» und «Coop Bau+Hobby» zusammen, und das sind
#: zwei Läden, in denen verschiedene Gutscheine gelten.
_BEIWERK = re.compile(
    r"\b(ag|gmbh|sa|filiale|shop|store|online)\b|[.,()]",
    re.IGNORECASE,
)


def schluessel(name: Any) -> str:
    """Ein Ladenname, auf das Vergleichbare gebracht (rein, testbar).

    Kleingeschrieben, ohne Beiwerk, ohne doppelte Zwischenräume. Das
    Ergebnis ist nicht zum Anzeigen gedacht - angezeigt wird immer, was
    jemand geschrieben hat.
    """
    text = _BEIWERK.sub(" ", str(name or ""))
    return " ".join(text.lower().split())


def passt(gutschein_laden: Any, ort_name: Any) -> bool:
    """Gehören Gutschein und Ort zusammen? (rein, testbar)

    Nachsichtig in eine Richtung: «Ochsner Sport Sursee» als Ort trägt
    den Gutschein «Ochsner Sport». Umgekehrt genauso - wer den Gutschein
    genauer benannt hat als den Ort, meint denselben Laden.

    Leere Namen passen zu nichts. Sonst hinge an einem Gutschein ohne
    Laden jede Erinnerung im Haus.
    """
    a = schluessel(gutschein_laden)
    b = schluessel(ort_name)
    if not a or not b:
        return False
    return a == b or a.startswith(b) or b.startswith(a)


def offene(gutscheine: Any, jetzt: float) -> list[dict[str, Any]]:
    """Die Gutscheine, die man noch einlösen kann (rein, testbar).

    Eingelöste und verfallene bleiben draussen: Eine Erinnerung an einen
    abgelaufenen Gutschein ist ein Weg zur Kasse und wieder zurück.
    """
    raus = []
    for zeile in gutscheine or []:
        if not isinstance(zeile, dict):
            continue
        if zeile.get("redeemed") is True or zeile.get("done") is True:
            continue
        rest = zeile.get("balance")
        if isinstance(rest, (int, float)) and rest <= 0:
            continue
        raus.append(zeile)
    return raus


def hier_gueltig(gutscheine: Any, ort_name: Any, jetzt: float) -> list[dict[str, Any]]:
    """Welche offenen Gutscheine an diesem Ort gelten (rein, testbar)."""
    return [
        zeile
        for zeile in offene(gutscheine, jetzt)
        if passt(zeile.get("shop") or zeile.get("title"), ort_name)
    ]


def satz(treffer: list[dict[str, Any]], ort: str) -> tuple[str, str]:
    """Titel und Text der Erinnerung (rein, testbar).

    Der Betrag steht dabei, wo es einen gibt: «Du hast hier 50 Franken
    liegen» ist eine andere Nachricht als «du hast hier einen
    Gutschein». Und der Hinweis auf die Karte, wo der Gutschein nur
    gegen das Original gilt (Punkt 267) - im Laden zu stehen und die
    Nummer vorzulesen, wenn die Karte zuhause liegt, ist genau die
    Fahrt, die man sich sparen wollte.
    """
    anzahl = len(treffer)
    titel = (
        "Du hast hier einen Gutschein"
        if anzahl == 1
        else f"Du hast hier {anzahl} Gutscheine"
    )
    teile = []
    for zeile in treffer[:3]:
        name = str(zeile.get("title") or zeile.get("shop") or "Gutschein").strip()
        rest = zeile.get("balance")
        if isinstance(rest, (int, float)) and rest > 0:
            teile.append(f"{name} ({rest:.2f} CHF)".replace(".00 CHF", " CHF"))
        else:
            teile.append(name)
    if anzahl > 3:
        teile.append(f"und {anzahl - 3} weitere")
    text = f"Bei {ort}: " + ", ".join(teile) + "."
    if any(zeile.get("physical") is True for zeile in treffer):
        text += " Mindestens einer gilt nur gegen die Karte."
    return titel, text
