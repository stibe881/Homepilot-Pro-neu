#!/usr/bin/env python3
"""Die Typprüfung dort bindend machen, wo sie es sein kann.

`mypy homepilot` meldete 213 Fehler in 48 Dateien, als dieses Werkzeug
entstand - und stand deshalb im Prüflauf auf «darf rot sein». Eine
Prüfung, die immer rot ist, liest niemand; sie ist dann keine Prüfung,
sondern Hintergrundrauschen.

Also andersherum: `mypy-sauber.txt` führt die Module, die sauber sind,
und genau die werden bindend geprüft. Der Rest wartet, bis ihn jemand
aufräumt. Die Liste kann nur wachsen.

    python3 tools/mypy_sauber.py              # prüfen (Rückgabewert != 0 bei Fehlern)
    python3 tools/mypy_sauber.py --ergaenzen  # aufnehmen, was inzwischen sauber ist

Warum eine Liste und keine Einstellung in der pyproject.toml: mypy kann
zwar je Modul strenger werden, aber nicht «dieses Modul darf gar keine
Fehler haben, jenes schon». Und eine Datei, die man liest, sagt mehr als
ein Abschnitt mit vierzig Mustern.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
LISTE = WURZEL / "mypy-sauber.txt"
PAKET = "homepilot"


def gelistet() -> list[str]:
    """Die Module, die sauber sein müssen (Kommentare und Leeres weg)."""
    zeilen = LISTE.read_text(encoding="utf-8").splitlines()
    return [
        zeile.strip()
        for zeile in zeilen
        if zeile.strip() and not zeile.lstrip().startswith("#")
    ]


def mypy_aufruf() -> list[str]:
    """Wie mypy hier gestartet wird.

    Erst das Programm im Pfad: In dieser Umgebung liegt mypy als eigenes
    Werkzeug mit eigenem Python, und `python3 -m mypy` findet es dann
    nicht («No module named mypy»). Wo es als Paket installiert ist,
    greift der zweite Weg.
    """
    programm = shutil.which("mypy")
    return [programm] if programm else [sys.executable, "-m", "mypy"]


def mypy_lauf(ziele: list[str]) -> tuple[int, str]:
    """mypy über die genannten Dateien - Rückgabewert und Ausgabe."""
    lauf = subprocess.run(
        [*mypy_aufruf(), *ziele],
        cwd=WURZEL,
        capture_output=True,
        text=True,
    )
    return lauf.returncode, lauf.stdout + lauf.stderr


def fehler_je_modul() -> dict[str, list[str]]:
    """Welche Datei des ganzen Pakets welche Fehler meldet.

    Immer über das **ganze** Paket, nie über eine Auswahl: mypy folgt
    den Importen, und eine Datei, die im Gesamtlauf sauber ist, meldet
    allein geprüft plötzlich die Fehler ihrer Nachbarn mit. Beim ersten
    Versuch waren das 95 Fehler in Modulen, an denen nichts falsch war.
    """
    _, ausgabe = mypy_lauf([PAKET])
    treffer: dict[str, list[str]] = {}
    for zeile in ausgabe.splitlines():
        if ": error:" not in zeile:
            continue
        datei = zeile.split(":", 1)[0].strip()
        treffer.setdefault(datei, []).append(zeile)
    return treffer


def pruefen() -> int:
    ziele = gelistet()
    fehlend = [name for name in ziele if not (WURZEL / name).exists()]
    if fehlend:
        print("Diese Einträge gibt es nicht mehr - aus mypy-sauber.txt nehmen:")
        for name in fehlend:
            print(f"  {name}")
        return 2
    schmutzig = fehler_je_modul()
    getroffen = [name for name in ziele if name in schmutzig]
    if getroffen:
        for name in getroffen:
            for zeile in schmutzig[name]:
                print(zeile)
        print()
        print(
            f"{len(getroffen)} Modul(e) aus mypy-sauber.txt melden Fehler.\n"
            "Entweder beheben - oder, wenn das Modul gerade umgebaut wird,\n"
            "den Eintrag bewusst entfernen und das im Commit begründen."
        )
        return 1
    print(f"Typen sauber: {len(ziele)} Module.")
    return 0


def ergaenzen() -> int:
    """Aufnehmen, was inzwischen sauber ist - die Liste wächst nur."""
    schmutzig = set(fehler_je_modul())
    alle = sorted(
        str(pfad.relative_to(WURZEL))
        for pfad in (WURZEL / PAKET).rglob("*.py")
    )
    neu = [name for name in alle if name not in schmutzig]
    bisher = set(gelistet())
    dazu = [name for name in neu if name not in bisher]
    if not dazu:
        print("Nichts Neues - die Liste ist auf dem Stand.")
        return 0
    kopf = []
    for zeile in LISTE.read_text(encoding="utf-8").splitlines():
        if zeile.strip() and not zeile.lstrip().startswith("#"):
            break
        kopf.append(zeile)
    LISTE.write_text(
        "\n".join([*kopf, *sorted(bisher | set(dazu))]) + "\n", encoding="utf-8"
    )
    print(f"{len(dazu)} Modul(e) aufgenommen:")
    for name in dazu:
        print(f"  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(ergaenzen() if "--ergaenzen" in sys.argv else pruefen())
