"""Was der Hub gemeldet hat – zum Nachlesen in der App.

Eine weggewischte Mitteilung ist heute weg: Das Telefon vergisst sie,
und die App weiss nicht einmal, dass es sie gab. «Was hat vorhin
gebrummt?» ist danach nicht mehr zu beantworten - und genau dann will
man es wissen, wenn man am Steuer sass oder das Telefon in der Jacke
steckte.

Deshalb behält der Hub die letzten Meldungen: Titel, Text, Art, Zeit,
und an wen sie gingen. Bewusst begrenzt und mit Verfallszeit - das ist
ein Zettel zum Nachlesen, kein zweites Protokoll. Bilder bleiben
draussen: Sie leben ohnehin nur Minuten (core/snapshots.py).

Reines Rechnen über Listen; wer schreibt, ist der Push-Dienst.
"""

from __future__ import annotations

from typing import Any

#: Wo die Meldungen liegen.
STORE_KEY = "push_verlauf"

#: Mehr behält der Hub nicht - der Zettel soll lesbar bleiben.
HOECHSTENS = 50

#: Und nicht länger als eine Woche: Was älter ist, ist keine Frage von
#: «was hat vorhin gebrummt?» mehr.
TAGE = 7.0


def anhaengen(
    rows: Any, eintrag: dict[str, Any], jetzt: float
) -> list[dict[str, Any]]:
    """Eine verschickte Meldung vermerken (rein, testbar)."""
    frisch = [
        row
        for row in (rows or [])
        if isinstance(row, dict)
        and jetzt - float(row.get("at") or 0) <= TAGE * 86400
    ]
    frisch.append(
        {
            "title": str(eintrag.get("title") or ""),
            "body": str(eintrag.get("body") or ""),
            "category": str(eintrag.get("category") or "") or None,
            # Leer heisst: an alle. Sonst die Namen der Empfänger.
            "to": sorted(str(name) for name in (eintrag.get("to") or [])),
            # Warum sie nicht (bei allen) gebrummt hat: Ruhezeit,
            # stillgestellt, Tagesdeckel. Ohne das läse sich der Zettel
            # wie eine Meldung, die man bloss übersehen hat - und das
            # ist der Unterschied zwischen «ich habe geschlafen» und
            # «das Haus hat mich schlafen lassen».
            "held": str(eintrag.get("held") or "") or None,
            "held_for": sorted(str(name) for name in (eintrag.get("held_for") or [])),
            # Wohin ein Tipp führt (core/pushziel.py) - der Posteingang
            # braucht es, sonst ist er eine Liste zum Ansehen statt eine
            # zum Handeln (Punkt 472 der Werkbank).
            "ziel": str(eintrag.get("ziel") or "") or None,
            "at": float(jetzt),
        }
    )
    return frisch[-HOECHSTENS:]


def zustellung_vermerken(
    rows: Any, marke: float, probleme: list[str]
) -> list[dict[str, Any]] | None:
    """Nachtragen, ob eine Meldung wirklich ankam (Punkt 475 der Werkbank).

    ``accepted`` heisst «vom Push-Dienst angenommen», nicht «beim
    Empfänger angekommen». Ob Apple oder Google sie ausgeliefert haben,
    steht erst in der Quittung - und die holte bis hierher nur der
    Push-Test ab. Beim Alarm ist das der teuerste stille Fehler, den das
    System hat: Es sieht aus wie gemeldet, und niemand hat etwas gehört.

    ``marke`` ist der Zeitstempel der Meldung; genau die Zeile wird
    ergänzt, nicht die neueste - zwischen Senden und Quittung liegen
    Sekunden, in denen etwas anderes gemeldet worden sein kann.

    ``None``, wenn nichts zu tun war: Dann muss auch nichts geschrieben
    werden, und der Normalfall (alles zugestellt) kostet keinen
    Schreibvorgang auf die Platte.
    """
    if not probleme:
        return None
    geaendert = False
    frisch = []
    for row in rows or []:
        if isinstance(row, dict) and str(row.get("at")) == str(marke):
            frisch.append({**row, "nicht_zugestellt": list(probleme)})
            geaendert = True
        else:
            frisch.append(row)
    return frisch if geaendert else None


def fuer(rows: Any, name: str) -> list[dict[str, Any]]:
    """Die Meldungen, die diese Person bekommen hat – jüngste zuerst (rein).

    Eine Meldung ohne Empfängerliste ging an alle. Was nur an andere
    ging, gehört nicht auf diesen Zettel: Dass Lina ans Medikament
    erinnert wurde, geht die übrigen Telefone nichts an.
    """
    eigene = [
        {**row, "verpasst": name in (row.get("held_for") or [])}
        for row in (rows or [])
        if isinstance(row, dict) and (not row.get("to") or name in row.get("to", []))
    ]
    return sorted(eigene, key=lambda row: -float(row.get("at") or 0))


def verpasst(rows: Any, name: str) -> list[dict[str, Any]]:
    """Nur das, was diese Person nie gehört hat (rein, testbar).

    Der Unterschied zur ganzen Liste: Hier steht, was das Haus
    absichtlich für sich behalten hat - während der Nacht, während
    etwas stillgestellt war, über dem Tagesdeckel. Das ist die Liste,
    die man am Morgen durchgeht; die andere ist die zum Nachschlagen.
    """
    return [row for row in fuer(rows, name) if row.get("verpasst")]
