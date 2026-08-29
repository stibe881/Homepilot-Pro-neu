"""Grosse Griffe zurücknehmen – «Alles aus» und «Gute Nacht».

Der einzelne Befehl hat sein Zurück längst: Die App merkt sich den
Zustand von vorher und bietet ihn ein paar Sekunden lang an
(hooks/useHub.ts). Beim Griff, der zwanzig Geräte auf einmal schaltet,
hilft das nicht – wer nach «Alles aus» merkt, dass im Büro noch jemand
sitzt, müsste zwanzig Kacheln von Hand wiederfinden.

Gerechnet wird der Rückweg mit ``szenenrueckweg.plane_rueckweg``: Das
ist dieselbe Frage wie bei einer Szene («was hat sich dadurch wirklich
geändert?»), also gehört sie nicht ein zweites Mal beantwortet. Ein
Licht, das schon aus war, steht deshalb nicht im Rückweg, und die
Alarmanlage steht nie darin (``OHNE_RUECKWEG``) – eine Anlage, die sich
auf «Rückgängig» hin entschärft, ist ein Loch.

Warum die Befehle beim **Aufnehmen** berechnet werden und nicht beim
Drücken: Beim Aufnehmen ist der Zustand von vorher noch da. Eine Minute
später ist er weg, und niemand wüsste mehr, wie hell das Licht war.

Hier steht nur das Rechnen über der Liste. Wer die Befehle ausführt,
ist die Route (api/routes/haus.py).
"""

from __future__ import annotations

from typing import Any

#: Schlüssel, unter dem die aufgenommenen Rückwege in hub.data liegen.
SCHLANGE = "undo_bundles"

#: So lange lässt sich ein Griff zurücknehmen. Länger wäre kein
#: «rückgängig» mehr, sondern ein «wieder einschalten» – und das gehört
#: auf die Kacheln, nicht auf einen Knopf, der einen Stand von gestern
#: wiederherstellt.
GUELTIG = 15 * 60

#: Mehr Rückwege behält der Hub nicht. Sie werden ohnehin nur je einmal
#: gebraucht, und der letzte ist der, den jemand meint.
HOECHSTENS = 5


def geraetestand(entities: Any) -> dict[str, dict[str, Any]]:
    """Der Stand aller Geräte, wie ``plane_rueckweg`` ihn erwartet (rein).

    Bewusst über alle Geräte und nicht nur über die betroffenen: Die
    Zuordnung kostet nichts, und der Aufrufer soll nicht zweimal
    dieselbe Liste durchgehen müssen.
    """
    stand: dict[str, dict[str, Any]] = {}
    for entity in entities or []:
        stand[str(entity.id)] = {
            "kind": str(entity.kind),
            "commands": list(entity.commands),
            "state": dict(entity.state or {}),
        }
    return stand


def aufnehmen(
    rows: Any, eintrag: dict[str, Any], jetzt: float
) -> list[dict[str, Any]]:
    """Einen Rückweg ablegen und dabei aufräumen (rein, testbar).

    Ein Rückweg ohne Befehle wird nicht abgelegt: «Alles aus» in einem
    Haus, in dem nichts mehr an war, hinterlässt nichts, was man
    zurücknehmen könnte.
    """
    behalten = gueltige(rows, jetzt)
    befehle = [
        befehl for befehl in eintrag.get("commands") or [] if isinstance(befehl, dict)
    ]
    if not befehle:
        return behalten
    behalten.append(
        {
            "id": str(eintrag.get("id") or ""),
            "title": str(eintrag.get("title") or "").strip() or "Griff",
            "by": str(eintrag.get("by") or "") or None,
            "commands": befehle,
            "at": float(jetzt),
        }
    )
    return behalten[-HOECHSTENS:]


def gueltige(rows: Any, jetzt: float) -> list[dict[str, Any]]:
    """Was noch nicht abgelaufen ist (rein, testbar)."""
    frisch: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        try:
            zeitpunkt = float(row.get("at") or 0)
        except (TypeError, ValueError):
            continue
        if jetzt - zeitpunkt <= GUELTIG:
            frisch.append(row)
    return frisch


def holen(rows: Any, kennung: str, jetzt: float) -> dict[str, Any] | None:
    """Der Rückweg zu dieser Kennung, sofern er noch gilt (rein, testbar)."""
    for row in gueltige(rows, jetzt):
        if str(row.get("id")) == str(kennung):
            return row
    return None


def entfernen(rows: Any, kennung: str) -> list[dict[str, Any]]:
    """Ohne diesen Rückweg (rein, testbar).

    Nach dem Ausführen weg: Ein zweites «Rückgängig» würde den Stand von
    vor dem Griff ein zweites Mal herstellen – über allem, was seither
    von Hand geschaltet wurde.
    """
    return [
        row
        for row in rows or []
        if isinstance(row, dict) and str(row.get("id")) != str(kennung)
    ]


def ablegen(hub: Any, titel: str, entity_ids: list[str], command: str, wer: str) -> dict[str, Any] | None:
    """Den Rückweg zu einem Griff festhalten – **vor** dem Schalten.

    Danach ist es zu spät: Der Zustand von vorher ist dann weg, und wie
    hell das Licht war, weiss niemand mehr.

    Stand als Hilfsfunktion in api/routes/haus.py und wurde dort von
    «alles aus» und vom Gästemodus gebraucht. Seit der Babysitter-Modus
    das Empfangslicht übernommen hat, braucht ihn eine dritte Route in
    einer anderen Datei - also gehört er hierher, wo das Rechnen dazu
    ohnehin steht.
    """
    import secrets
    import time

    from . import szenenrueckweg

    befehle = szenenrueckweg.plane_rueckweg(
        [{"entity_id": entity_id, "command": command} for entity_id in entity_ids],
        geraetestand(hub.registry.all()),
    )
    if not befehle:
        return None
    kennung = secrets.token_hex(8)
    hub.data.set(
        SCHLANGE,
        aufnehmen(
            hub.data.get(SCHLANGE),
            {"id": kennung, "title": titel, "by": wer, "commands": befehle},
            time.time(),
        ),
    )
    return {"id": kennung, "count": len(befehle)}
