"""Einstellungen zusammenführen statt ersetzen.

Beide Ablagen der Oberfläche - die persönliche (``/api/prefs``) und die
haushaltsweite (``/api/houseprefs``) - wurden bisher als Ganzes
überschrieben: Was die App schickte, war danach der Bestand. Das
funktioniert genau so lange, wie immer dieselbe Stelle schreibt und immer
alles mitschickt.

Beides stimmt nicht mehr. Der Anblick der App wird im Profil gesetzt, die
Playlist-Reihenfolge an der Musikkarte, die Vorlese-Box im Kochbuch - drei
Stellen, von denen keine die Einstellungen der anderen kennt. Wer den
ganzen Bestand schicken müsste, um ein Feld zu ändern, löscht bei jedem
Zug alles, was er nicht kennt: Auf einem zweiten Telefon verschwände die
Reihenfolge, sobald jemand am ersten den Anblick wechselt.

Darum gilt hier: Genannt wird nur, was sich ändert. Was nicht im Zug
steht, bleibt liegen. ``None`` als Wert löscht einen Eintrag - sonst
bekäme man das, was man einmal gesetzt hat, nie wieder los.

Absichtlich nur die oberste Ebene. Tiefer zu verschmelzen klänge
gründlicher, machte aber das Kürzen einer Liste unmöglich: Wer seine
Favoriten von fünf auf drei setzt, meint drei - nicht «drei und die alten
fünf».
"""

from __future__ import annotations

from typing import Any


def verschmelzen(alt: dict[str, Any], neu: dict[str, Any]) -> dict[str, Any]:
    """Den Bestand um die genannten Schlüssel ergänzen (rein, testbar)."""
    zusammen = dict(alt)
    for schluessel, wert in neu.items():
        if wert is None:
            zusammen.pop(schluessel, None)
        else:
            zusammen[schluessel] = wert
    return zusammen
