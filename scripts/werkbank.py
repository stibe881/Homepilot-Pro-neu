#!/usr/bin/env python3
"""Die beiden Werkbank-Dateien prüfen: jede Nummer genau einmal.

Punkt 505 der Werkbank. Seit dem Aufteilen gibt es zwei Dateien -
`docs/werkbank.md` führt, was offen ist, `docs/werkbank-archiv.md`, was
erledigt ist. Damit gibt es auch zwei Arten, sich zu vertun, und beide
fallen von Auge nie auf:

  - Ein Punkt steht **doppelt**, weil er beim Erledigen kopiert statt
    verschoben wurde. Dann liest man in der einen Datei «offen» und in
    der anderen «erledigt», und beide sehen richtig aus.
  - Eine Nummer wird **wiederverwendet**, weil die höchste vergebene in
    der jeweils anderen Datei stand. Ein Kommentar «Punkt 273 der
    Werkbank» im Code zeigt danach auf etwas anderes als gemeint - und
    das ist genau der Fehler, gegen den die Nummernregel seit jeher
    steht.

    python3 scripts/werkbank.py            # prüfen (Rückgabewert != 0 bei Fehlern)
    python3 scripts/werkbank.py --zahlen   # nur die Übersicht

Die Lücken in der Nummerierung sind erlaubt und gewollt: Nummern, die
vergeben, aber nie gebaut wurden, bleiben leer stehen.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
OFFEN = WURZEL / "docs" / "werkbank.md"
ARCHIV = WURZEL / "docs" / "werkbank-archiv.md"

#: Ein Punkt beginnt entweder als Überschrift oder als fetter Absatz.
#:
#: Zwei Schreibweisen, weil die Runden unterschiedlich entstanden sind -
#: hier zusammenzuführen hiesse, vierhundert Punkte umzuschreiben, und
#: dabei geht mehr kaputt, als die Einheitlichkeit wert ist.
MARKE = re.compile(r"^(?:### |\*\*)(\d+)\.")


def nummern(pfad: Path) -> list[int]:
    """Welche Punkte diese Datei definiert, in ihrer Reihenfolge (rein, testbar)."""
    gefunden = []
    for zeile in pfad.read_text(encoding="utf-8").splitlines():
        treffer = MARKE.match(zeile)
        if treffer:
            gefunden.append(int(treffer.group(1)))
    return gefunden


def pruefen(offen: list[int], archiv: list[int]) -> list[str]:
    """Die Beanstandungen, Klartext (rein, testbar)."""
    meldungen = []
    for name, liste in (("werkbank.md", offen), ("werkbank-archiv.md", archiv)):
        doppelt = sorted({n for n in liste if liste.count(n) > 1})
        if doppelt:
            meldungen.append(
                f"{name}: doppelt definiert: {', '.join(str(n) for n in doppelt)}"
            )
    beide = sorted(set(offen) & set(archiv))
    if beide:
        meldungen.append(
            "in beiden Dateien: "
            + ", ".join(str(n) for n in beide)
            + " - beim Erledigen verschieben, nicht kopieren."
        )
    return meldungen


def main() -> int:
    offen = nummern(OFFEN)
    archiv = nummern(ARCHIV)
    alle = sorted(set(offen) | set(archiv))

    if "--zahlen" in sys.argv:
        print(f"offen:    {len(set(offen)):>4}")
        print(f"erledigt: {len(set(archiv)):>4}")
        print(f"vergeben: bis {alle[-1]} - die nächste freie Nummer ist {alle[-1] + 1}")
        return 0

    meldungen = pruefen(offen, archiv)
    if meldungen:
        for meldung in meldungen:
            print(f"Werkbank: {meldung}")
        return 1
    print(
        f"Werkbank: {len(set(offen))} offen, {len(set(archiv))} erledigt, "
        f"nächste freie Nummer {alle[-1] + 1}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
