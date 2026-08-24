"""Batteriewarnungen: einmal melden, quittieren, morgen wieder.

Der Fall: «Die Meldung ‹Batterie schwach› kommt immer und immer wieder.»

Zwei Wege führten dorthin, und beide laufen hier zusammen:

1. **Der Wächter merkte sich im Arbeitsspeicher, was er gemeldet hat.**
   Jeder Neustart des Hubs setzte das zurück – und eine schwache
   Batterie ist wochenlang schwach. Wer über den Update-Knopf ein paar
   Mal am Abend baut, bekommt die Warnung ein paar Mal am Abend.
   Dieselbe Lehre wie bei `gemeldet.py`, nur an einer Stelle, die damals
   nicht mitgezogen wurde.

2. **Der Merker fiel weg, sobald ein Gerät kurz nichts meldete.** Er
   wurde nur behalten, solange das Gerät weiter «schwach» sagte. Meldet
   sich ein Funksensor neu an (Homematic tut das bei jedem
   Verbindungsabbruch), steht sein Zustand einen Moment ohne
   `low_battery` da, der Merker fällt weg – und beim nächsten «schwach»
   kommt die Warnung erneut. Deshalb wird hier nur vergessen, wenn ein
   Gerät ausdrücklich «Batterie in Ordnung» sagt.

Dazu kommt das Quittieren: «bis morgen stumm». Es ist kein Ausschalten,
sondern ein Aufschub – morgen früh erinnert der Hub noch einmal. Wer die
Batterie bis dahin gewechselt hat, hört nichts mehr; wer sie liegen
lässt, wird erinnert. Genau darum geht es bei einer Batterie, die man
sonst vergisst, bis der Melder still ist.

Hier steht nur das Rechnen: Zeilen rein, Zeilen raus. Wo sie liegen,
weiss der Wächter (`hub.data`, Schlüssel `battery_notified`).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

#: Wo die Zeilen liegen. Der Schlüssel steht hier und nicht beim
#: Wächter: Die Routen für das Quittieren brauchen ihn auch.
STORE_KEY = "battery_notified"

#: Zu dieser Stunde läuft ein «bis morgen» ab. Acht Uhr: früh genug, um
#: den Tag noch für einen Batteriewechsel zu nutzen, spät genug, um
#: niemanden zu wecken.
MORGENSTUNDE = 8

#: So lange bleibt eine Zeile liegen, auch wenn das Gerät längst weg ist.
#: Ein halbes Jahr ist mehr als jede Batterie hält – und wer ein Gerät
#: ausmustert, soll dessen Zeile nicht ewig mitschleppen.
TAGE = 180

#: Obergrenze, damit ein Fehler in einer Schleife die Datei nicht sprengt.
HOECHSTENS = 500


def _zeilen(rows: Any) -> list[dict[str, Any]]:
    return [row for row in rows or [] if isinstance(row, dict) and row.get("entity_id")]


def zeile(rows: Any, entity_id: str) -> dict[str, Any] | None:
    """Was zu diesem Gerät vermerkt ist – oder nichts (rein, testbar)."""
    for row in _zeilen(rows):
        if row.get("entity_id") == entity_id:
            return row
    return None


def _zahl(wert: Any) -> float:
    try:
        return float(wert or 0)
    except (TypeError, ValueError):
        return 0.0


def stumm_bis(now: float, stunde: int = MORGENSTUNDE) -> float:
    """Bis wann «bis morgen stumm» reicht (rein, testbar).

    Morgen früh, nicht «in 24 Stunden»: Wer abends um elf quittiert, will
    nicht am nächsten Abend um elf erinnert werden, sondern am Tag, an dem
    er die Batterie wechseln kann.
    """
    jetzt = datetime.fromtimestamp(now)
    morgen = (jetzt + timedelta(days=1)).replace(
        hour=stunde, minute=0, second=0, microsecond=0
    )
    return morgen.timestamp()


def ist_stumm(rows: Any, entity_id: str, now: float) -> bool:
    """Ist die Warnung für dieses Gerät gerade quittiert? (rein, testbar)"""
    eintrag = zeile(rows, entity_id)
    return eintrag is not None and _zahl(eintrag.get("until")) > now


def soll_melden(rows: Any, entity_id: str, now: float) -> bool:
    """Geht für dieses Gerät jetzt eine Warnung raus? (rein, testbar)

    Drei Fälle, drei Antworten:

    * **Noch nie gemeldet** – ja, einmal.
    * **Gemeldet und nicht quittiert** – nein. Die Batterie ist bekannt
      schwach; jeden Tag daran zu erinnern macht sie nicht voller.
    * **Quittiert** – nein bis morgen früh, danach noch einmal ja. Das ist
      der Sinn von «bis morgen stumm»: ein Aufschub, keine Abschaltung.
    """
    eintrag = zeile(rows, entity_id)
    if eintrag is None:
        return True
    bis = _zahl(eintrag.get("until"))
    return bis > 0 and now >= bis


def merke_meldung(rows: Any, entity_id: str, at: float) -> list[dict[str, Any]]:
    """Diese Warnung ist raus (rein, testbar).

    Ein etwaiges «bis morgen» fällt dabei weg: Es hat seinen Zweck getan,
    und die Erinnerung von heute wäre sonst zugleich schon quittiert.
    """
    return _setze(rows, {"entity_id": entity_id, "at": at, "until": 0.0}, at)


def quittiere(rows: Any, entity_id: str, now: float) -> list[dict[str, Any]]:
    """«Bis morgen stumm» für dieses Gerät (rein, testbar)."""
    eintrag = zeile(rows, entity_id) or {}
    return _setze(
        rows,
        {
            "entity_id": entity_id,
            "at": _zahl(eintrag.get("at")) or now,
            "until": stumm_bis(now),
        },
        now,
    )


def vergiss(rows: Any, entity_ids: Any) -> list[dict[str, Any]]:
    """Batterie gewechselt – die Warnung ist wieder scharf (rein, testbar).

    Aufgerufen wird das nur, wenn ein Gerät ausdrücklich «Batterie in
    Ordnung» meldet. Nicht schon dann, wenn es gerade gar nichts sagt:
    Ein Funksensor, der sich neu anmeldet, steht einen Moment ohne
    Batterieangabe da – und genau daran kam die Warnung zum zweiten Mal.
    """
    weg = set(entity_ids or [])
    return [row for row in _zeilen(rows) if row.get("entity_id") not in weg]


def _setze(
    rows: Any, neu: dict[str, Any], now: float, tage: int = TAGE
) -> list[dict[str, Any]]:
    """Eine Zeile ersetzen, Altes vergessen, Länge begrenzen."""
    grenze = now - tage * 24 * 3600
    behalten = [
        row
        for row in _zeilen(rows)
        if row.get("entity_id") != neu["entity_id"]
        and max(_zahl(row.get("at")), _zahl(row.get("until"))) >= grenze
    ]
    return [neu, *behalten][:HOECHSTENS]
