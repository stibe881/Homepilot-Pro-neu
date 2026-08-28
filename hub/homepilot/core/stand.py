"""Welcher Stand hier läuft - für die Diagnose-Aufrufe.

Zweimal ist dasselbe passiert: Ein neuer Diagnose-Aufruf wird gebaut, im
Container läuft aber noch das alte Abbild - und dann tut ``python -m
homepilot.integrations.…`` genau nichts. Kein Fehler, keine Ausgabe: Das
alte Modul hat keinen ``__main__``-Block, also importiert Python es und
ist fertig. Man sucht dann am falschen Ende.

Dagegen hilft nur eines: Jeder Diagnose-Aufruf sagt als Erstes, aus
welchem Stand er kommt. Stimmt der nicht mit dem überein, was man gerade
gebaut hat, weiss man sofort, woran es liegt - und kommt gar nicht erst
in die Verlegenheit, die Ausgabe zu deuten.
"""

from __future__ import annotations

import os

from .. import __version__


def stand_zeile() -> str:
    """Eine Zeile: Fassung, Commit, Bauzeit (rein bis auf die Umgebung)."""
    commit = os.environ.get("HOMEPILOT_COMMIT", "unbekannt")
    gebaut = os.environ.get("HOMEPILOT_BUILD_TIME", "unbekannt")
    return f"HomePilot {__version__} · Stand {commit} · gebaut {gebaut}"
