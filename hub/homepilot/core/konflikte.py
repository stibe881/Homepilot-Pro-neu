"""Gegensätzliche Abläufe: gesehen, geprüft, abgehakt.

Die Liste «X Geräte werden gegensätzlich geschaltet» ist ein Hinweis,
kein Fehler - meistens ist genau das gewollt: Der eine Ablauf schaltet
das Licht ein, der andere schaltet es später wieder aus. Genau darum
stand sie irgendwann mit neun Zeilen da, von denen acht in Ordnung
waren, und die neunte, die es nicht war, ging darin unter.

Also quittieren: Wer eine Zeile geprüft hat, hakt sie ab. Sie
verschwindet aus der Liste und steht nur noch hinter «3 quittiert».

Zwei Entscheidungen, die man im Betrieb merkt:

  - **Die Quittung gilt fürs Haus, nicht für die Person.** Wer prüft,
    prüft für alle - sonst hakt dieselbe Zeile jeder einmal ab.
  - **Ändert sich der Widerspruch, kommt er wieder.** Der Schlüssel
    enthält die beteiligten Abläufe *und* die gegensätzlichen Befehle.
    Wer einen der beiden umbaut, bekommt die Zeile erneut zu sehen -
    denn quittiert wurde, was vorher dastand.

Reines Rechnen; wer speichert, ist die API.
"""

from __future__ import annotations

from typing import Any

#: Wo die Quittungen liegen.
KEY = "conflict_acks"


def schluessel(conflict: dict[str, Any]) -> str:
    """Der Schlüssel einer Zeile (rein, testbar).

    Gerät, beide Abläufe (sortiert, damit die Reihenfolge egal ist) und
    die gegensätzlichen Befehle. Letztere gehören dazu: «ein/aus» ist
    etwas anderes als «auf/zu», auch zwischen denselben zwei Abläufen.
    """
    entity = str(conflict.get("entity_id") or "")
    ids = sorted(
        str(eintrag.get("id") or "")
        for eintrag in conflict.get("automations") or []
        if isinstance(eintrag, dict)
    )
    befehle = sorted(str(x) for x in conflict.get("commands") or [])
    return "|".join([entity, ",".join(ids), ",".join(befehle)])


def read(roh: Any) -> dict[str, dict[str, Any]]:
    """Die gespeicherten Quittungen (rein, testbar).

    Nachsichtig gegen alles, was da stehen könnte: Eine kaputte Zeile
    heisst «nicht quittiert» - die Zeile taucht dann wieder auf, und das
    ist die harmlose Richtung.
    """
    quittungen: dict[str, dict[str, Any]] = {}
    for eintrag in roh or []:
        if not isinstance(eintrag, dict):
            continue
        key = str(eintrag.get("key") or "")
        if key:
            quittungen[key] = {
                "key": key,
                "by": str(eintrag.get("by") or ""),
                "at": eintrag.get("at"),
            }
    return quittungen


def quittieren(
    roh: Any, key: str, by: str = "", now: float | None = None
) -> list[dict[str, Any]]:
    """Eine Zeile abhaken (rein, testbar)."""
    quittungen = read(roh)
    if key:
        quittungen[key] = {"key": key, "by": by, "at": now}
    return sorted(quittungen.values(), key=lambda eintrag: eintrag["key"])


def zuruecknehmen(roh: Any, key: str) -> list[dict[str, Any]]:
    """Eine Quittung wieder aufheben - die Zeile steht danach wieder da."""
    quittungen = read(roh)
    quittungen.pop(key, None)
    return sorted(quittungen.values(), key=lambda eintrag: eintrag["key"])


def teilen(
    conflicts: list[dict[str, Any]], roh: Any
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Offene und quittierte Zeilen trennen (rein, testbar).

    Jede Zeile bekommt ihren Schlüssel mit; die App braucht ihn, um zu
    quittieren, und soll ihn nicht selbst zusammensetzen müssen - sonst
    stünde dieselbe Regel an zwei Orten.
    """
    quittungen = read(roh)
    offen, erledigt = [], []
    for conflict in conflicts or []:
        key = schluessel(conflict)
        eintrag = {**conflict, "key": key}
        if key in quittungen:
            erledigt.append({**eintrag, "ack": quittungen[key]})
        else:
            offen.append(eintrag)
    return offen, erledigt


def aufraeumen(roh: Any, conflicts: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    """Quittungen ohne Zeile entfernen (rein, testbar).

    Wer einen der beiden Abläufe löscht, löst den Widerspruch auf - die
    Quittung dazu ist dann Altpapier. Gibt None zurück, wenn nichts zu
    tun ist: So schreibt der Hub die Datei nur, wenn sich wirklich etwas
    ändert.
    """
    quittungen = read(roh)
    lebend = {schluessel(conflict) for conflict in conflicts or []}
    uebrig = {key: wert for key, wert in quittungen.items() if key in lebend}
    if len(uebrig) == len(quittungen):
        return None
    return sorted(uebrig.values(), key=lambda eintrag: eintrag["key"])
