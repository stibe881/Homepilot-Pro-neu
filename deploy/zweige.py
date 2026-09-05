#!/usr/bin/env python3
"""Die Arbeitszweige gleich halten – prüfen und stossen.

Warum es das braucht: Gebaut wird, was auf dem Auslieferzweig liegt
(`rebuild-hub.sh`, `BRANCH`). Gearbeitet wird längst auf mehreren
Zweigen gleichzeitig, und mehrere Sitzungen schieben parallel darauf.
Jeder Push wurde damit zur Handarbeit aus Holen, Zusammenführen und
Nochmal-Versuchen – und ging genau so lange gut, wie jemand daran
dachte.

Der teure Fall ist nicht der abgelehnte Push, den sieht man. Teuer ist
der Zweig, der still zurückfällt: Die Änderung ist eingecheckt, die
Prüfung grün, der Commit da – nur eben nicht dort, wo gebaut wird. Von
aussen sieht das aus wie erledigt. Genau gegen diese Sorte Fehler ist
die CLAUDE.md geschrieben worden.

Zwei Aufrufe:

    python3 deploy/zweige.py pruefen    # nur nachsehen, ändert nichts
    python3 deploy/zweige.py stossen    # zusammenführen und pushen

`pruefen` beantwortet die eine Frage, die man von Auge nicht sieht:
Liegt auf einem Zweig etwas, das auf dem Auslieferzweig fehlt? Es
verändert nichts und eignet sich deshalb auch für die Prüfung.

`stossen` holt jeden Zweig, führt ihn in den aktuellen Stand und stösst
diesen auf alle. Wird ein Push abgelehnt, weil jemand anders schneller
war, wird geholt, zusammengeführt und noch einmal versucht – bis zu
`VERSUCHE` mal. Mit Gewalt (`--force`) wird nie gestossen: Ein
überschriebener Zweig ist genau der Verlust, den dieses Skript
verhindern soll.

Welche Zweige? `HOMEPILOT_ZWEIGE`, mit Komma getrennt, sonst die
Vorgabe unten. Der erste in der Liste ist der Auslieferzweig – gegen
ihn wird gemessen.
"""

from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass

# Der erste ist der Auslieferzweig: Was dort fehlt, läuft nicht im Haus.
# Er heisst main - dasselbe steht in rebuild-hub.sh (BRANCH). Eine Weile
# stand hier ein claude/-Zweig zuoberst, und das Werkzeug mass damit
# gegen einen Zweig, den der Bau gar nicht nimmt: Die Meldung «dort wird
# gebaut» stimmte nicht mehr, seit der Knopf main baut.
VORGABE = (
    "main",
    "claude/besuch-babysitter-page-redesign-kvedqh",
    "claude/custom-home-automation-t9lvq3",
    "claude/hallo-9vjbg6",
    "claude/push-ablauf-anzeige-6t5awb",
)

# So oft wird ein abgelehnter Push wiederholt. Drei reichen: Wer öfter
# abgelehnt wird, hat nicht Pech, sondern einen Konflikt, den ein Mensch
# ansehen muss.
VERSUCHE = 3


@dataclass(frozen=True)
class Zweigstand:
    """Wie ein Zweig zum gemessenen Stand steht."""

    name: str
    voraus: int
    """Commits, die der Zweig hat und der gemessene Stand nicht."""
    hinterher: int
    """Commits, die der gemessene Stand hat und der Zweig nicht."""
    da: bool = True
    """False, wenn es den Zweig auf dem Server (noch) nicht gibt."""


def urteil(stand: Zweigstand) -> str:
    """Ein Wort für den Zustand eines Zweigs (rein, testbar).

    «auseinander» ist der einzige Fall, der einen Menschen braucht: Beide
    Seiten haben etwas Eigenes, und welche gewinnt, entscheidet kein
    Skript.
    """
    if not stand.da:
        return "fehlt"
    if stand.voraus and stand.hinterher:
        return "auseinander"
    if stand.voraus:
        return "voraus"
    if stand.hinterher:
        return "hinterher"
    return "gleichauf"


def satz(stand: Zweigstand) -> str:
    """Eine Zeile für den Bericht (rein, testbar).

    Sagt beim Auslieferzweig ausdrücklich, was auf dem Spiel steht: Was
    dort fehlt, wird nicht gebaut. Eine Zahl allein («2 Commits voraus»)
    beantwortet die Frage nicht, wegen der man hinsieht.
    """
    art = urteil(stand)
    if art == "fehlt":
        return f"{stand.name}: gibt es auf dem Server nicht"
    if art == "gleichauf":
        return f"{stand.name}: gleichauf"
    if art == "hinterher":
        return f"{stand.name}: {stand.hinterher} Commit(s) fehlen dort"
    if art == "voraus":
        return f"{stand.name}: hat {stand.voraus} Commit(s), die hier fehlen"
    return (
        f"{stand.name}: {stand.voraus} dort, {stand.hinterher} hier – "
        "auseinandergelaufen, das muss jemand ansehen"
    )


def alles_gleich(staende: list[Zweigstand]) -> bool:
    """Sind alle Zweige auf demselben Stand? (rein, testbar)"""
    return all(urteil(stand) == "gleichauf" for stand in staende)


def zweige_aus_umgebung(roh: str | None) -> tuple[str, ...]:
    """Die Zweigliste aus `HOMEPILOT_ZWEIGE` lesen (rein, testbar).

    Leere Einträge fallen weg: Ein abschliessendes Komma ist der
    häufigste Tippfehler in einer solchen Zeile, und ein Zweig namens ""
    bringt nur eine unverständliche Fehlermeldung von git.
    """
    if not roh or not roh.strip():
        return VORGABE
    namen = tuple(teil.strip() for teil in roh.split(",") if teil.strip())
    return namen or VORGABE


# ── Ab hier wird mit git gesprochen ────────────────────────────────────


def _git(*args: str, still: bool = False) -> tuple[int, str]:
    fertig = subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    )
    if fertig.returncode and not still:
        print(f"  git {' '.join(args)}: {fertig.stderr.strip()}", file=sys.stderr)
    return fertig.returncode, fertig.stdout.strip()


def _holen(zweig: str) -> bool:
    code, _ = _git("fetch", "--quiet", "origin", zweig, still=True)
    return code == 0


def _messen(zweig: str, gegen: str) -> Zweigstand:
    if not _holen(zweig):
        return Zweigstand(zweig, 0, 0, da=False)
    code, text = _git(
        "rev-list", "--left-right", "--count", f"origin/{zweig}...{gegen}"
    )
    if code or not text:
        return Zweigstand(zweig, 0, 0, da=False)
    links, rechts = text.split()
    return Zweigstand(zweig, int(links), int(rechts))


def pruefen(zweige: tuple[str, ...], gegen: str = "HEAD") -> int:
    print(f"Gemessen gegen {gegen}:\n")
    staende = [_messen(zweig, gegen) for zweig in zweige]
    for stand in staende:
        zeichen = "✓" if urteil(stand) == "gleichauf" else "•"
        print(f"  {zeichen} {satz(stand)}")
    print()
    if alles_gleich(staende):
        print("Alle Zweige sind gleichauf.")
        return 0
    if any(urteil(stand) == "hinterher" for stand in staende[:1]):
        print(
            f"Auf {zweige[0]} fehlt etwas – dort wird gebaut, also läuft es "
            "im Haus nicht.\nZusammenführen und stossen:  "
            "python3 deploy/zweige.py stossen"
        )
    else:
        print("Zum Angleichen:  python3 deploy/zweige.py stossen")
    return 1


def stossen(zweige: tuple[str, ...]) -> int:
    code, dreck = _git("status", "--porcelain")
    if code or dreck:
        print("Der Arbeitsbaum ist nicht sauber – erst einchecken, dann stossen.")
        return 2

    # Zuerst alles hereinholen, dann erst stossen. Andersherum stösst man
    # auf den ersten Zweig einen Stand, der die Arbeit der anderen noch
    # nicht kennt - und muss danach zweimal ran.
    for zweig in zweige:
        if not _holen(zweig):
            continue
        code, _ = _git("merge", "--no-edit", "--quiet", f"origin/{zweig}")
        if code:
            print(
                f"Zusammenführen mit {zweig} ging nicht auf. Konflikte von "
                "Hand lösen, dann noch einmal."
            )
            return 3

    fehler = 0
    for zweig in zweige:
        for versuch in range(1, VERSUCHE + 1):
            code, _ = _git("push", "--quiet", "origin", f"HEAD:{zweig}", still=True)
            if code == 0:
                print(f"  ✓ {zweig}")
                break
            # Abgelehnt heisst fast immer: jemand war schneller. Holen,
            # hereinnehmen, noch einmal.
            _holen(zweig)
            _git("merge", "--no-edit", "--quiet", f"origin/{zweig}", still=True)
            if versuch == VERSUCHE:
                print(f"  ✗ {zweig} – nach {VERSUCHE} Versuchen abgelehnt")
                fehler += 1
    return 1 if fehler else 0


def main(argv: list[str]) -> int:
    zweige = zweige_aus_umgebung(os.environ.get("HOMEPILOT_ZWEIGE"))
    befehl = argv[1] if len(argv) > 1 else "pruefen"
    if befehl == "pruefen":
        return pruefen(zweige)
    if befehl == "stossen":
        ergebnis = stossen(zweige)
        if ergebnis == 0:
            print()
            return pruefen(zweige)
        return ergebnis
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
