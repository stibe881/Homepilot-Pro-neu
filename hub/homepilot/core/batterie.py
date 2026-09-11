"""Batteriewarnungen: sofort melden, dann täglich zur Erinnerungsstunde.

Zwei Fälle haben diese Datei geformt, und sie ziehen in entgegengesetzte
Richtungen:

Erst: «Die Meldung ‹Batterie schwach› kommt immer und immer wieder» -
daraus wurde «einmal melden, fertig». Dann (September 2026, Punkt 258
der Werkbank): «Ich bekomme keine Push mehr» - die eine Meldung geriet
in Vergessenheit, und der Melder war still, bis die Batterie ganz leer
war. Eine Batterie ist eben beides: kein Minutenthema, aber auch keines,
das sich mit einem einzigen Satz erledigt.

Die Antwort ist der Tagesrhythmus: sofort melden, wenn ein Gerät schwach
wird, und danach **täglich zur Erinnerungsstunde** wieder, bis die
Batterie gewechselt ist. Stunde und Prozent-Schwelle stellt man in den
Push-Einstellungen der App ein (`PREFS_KEY`, Routen in
api/routes/push.py).

Der ursprüngliche Fall: «Die Meldung ‹Batterie schwach› kommt immer und immer wieder.»

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

Dazu kommt das Quittieren: «bis morgen stumm». Im Tagesrhythmus heisst
das schlicht: Die heutige Erinnerung ist gelesen, die nächste kommt wie
alle anderen morgen zur Erinnerungsstunde.

Hier steht nur das Rechnen: Zeilen rein, Zeilen raus. Wo sie liegen,
weiss der Wächter (`hub.data`, Schlüssel `battery_notified`).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

#: Wo die Zeilen liegen. Der Schlüssel steht hier und nicht beim
#: Wächter: Die Routen für das Quittieren brauchen ihn auch.
STORE_KEY = "battery_notified"

#: Zu dieser Stunde erinnert der Hub täglich (und ein «bis morgen» läuft
#: ab). Acht Uhr: früh genug, um den Tag noch für einen Batteriewechsel
#: zu nutzen, spät genug, um niemanden zu wecken. Nur die Vorgabe - die
#: wirkliche Stunde steht in den Push-Einstellungen (PREFS_KEY).
MORGENSTUNDE = 8

#: Wo Stunde und Schwelle liegen (hub.data). Der Schlüssel steht hier,
#: weil Wächter und Push-Route ihn beide brauchen.
PREFS_KEY = "battery_prefs"

#: Ab diesem Prozentwert gilt eine Batterie als schwach, wenn das Gerät
#: kein eigenes low_battery-Flag führt. Vorgabe; einstellbar in der App.
SCHWELLE = 10

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


def prefs_lesen(rows: Any) -> dict[str, int]:
    """Stunde und Schwelle der Batterie-Erinnerung (rein, testbar).

    Defensiv gelesen, mit Klemmen: Eine Stunde 25 oder eine Schwelle 90
    aus einer kaputten Datei soll den Wächter nicht in den Unsinn
    schicken - 50 % als Obergrenze, weil alles darüber keine «fast
    leere» Batterie mehr beschreibt, sondern einen Daueralarm.
    """
    # Der DataStore kennt nur Listen: `set()` macht aus jedem Dict eine
    # Liste seiner Schlüssel - und genau so ging die gespeicherte Stunde
    # wochenlang still verloren (gespeichert war ['hour', 'threshold'],
    # gelesen wurde die Vorgabe). Die Route legt das Dict deshalb als
    # Ein-Eintrag-Liste ab, und hier gilt beides.
    if isinstance(rows, list):
        rows = next((row for row in rows if isinstance(row, dict)), None)
    daten = rows if isinstance(rows, dict) else {}
    try:
        stunde = int(daten.get("hour", MORGENSTUNDE))
    except (TypeError, ValueError):
        stunde = MORGENSTUNDE
    try:
        schwelle = int(daten.get("threshold", SCHWELLE))
    except (TypeError, ValueError):
        schwelle = SCHWELLE
    return {
        "hour": min(23, max(0, stunde)),
        "threshold": min(50, max(1, schwelle)),
    }


def soll_melden(
    rows: Any, entity_id: str, now: float, stunde: int = MORGENSTUNDE
) -> bool:
    """Geht für dieses Gerät jetzt eine Warnung raus? (rein, testbar)

    Drei Fälle, drei Antworten:

    * **Noch nie gemeldet** – ja, sofort. Auf die Erinnerungsstunde
      wartet nur die Wiederholung, nicht die erste Nachricht.
    * **Gemeldet** – wieder ja ab der nächsten Erinnerungsstunde am
      Folgetag. Früher hiess es hier «nein, für immer» - und die eine
      Meldung geriet in Vergessenheit, bis der Melder still war
      (Punkt 258 der Werkbank).
    * **Quittiert** – dasselbe: Die heutige Erinnerung ist gelesen, die
      nächste kommt morgen zur Stunde.
    """
    eintrag = zeile(rows, entity_id)
    if eintrag is None:
        return True
    faellig = _zahl(eintrag.get("until")) or stumm_bis(
        _zahl(eintrag.get("at")), stunde
    )
    return now >= faellig


def merke_meldung(rows: Any, entity_id: str, at: float) -> list[dict[str, Any]]:
    """Diese Warnung ist raus (rein, testbar).

    Ein etwaiges «bis morgen» fällt dabei weg: Es hat seinen Zweck getan,
    und die Erinnerung von heute wäre sonst zugleich schon quittiert.
    """
    return _setze(rows, {"entity_id": entity_id, "at": at, "until": 0.0}, at)


def quittiere(
    rows: Any,
    entity_id: str,
    now: float,
    stunde: int = MORGENSTUNDE,
    by: str = "",
) -> list[dict[str, Any]]:
    """«Bis morgen stumm» für dieses Gerät (rein, testbar).

    ``by`` ist, wer gedrückt hat (Punkt 478 der Werkbank). Die Quittung
    gilt weiterhin fürs ganze Haus - das ist richtig so, sonst laufen
    zwei Leute wegen derselben Batterie in den Keller. Falsch war, dass
    sie *unsichtbar* für alle galt: Wer nachts die Warnung wegdrückte,
    drückte sie auch dem anderen weg, und der suchte am Morgen eine
    Meldung, die es nie mehr gab. Jetzt steht am Gerät, wer sie
    stillgestellt hat und bis wann - zurücknehmen kann es jeder.
    """
    eintrag = zeile(rows, entity_id) or {}
    return _setze(
        rows,
        {
            "entity_id": entity_id,
            "at": _zahl(eintrag.get("at")) or now,
            "until": stumm_bis(now, stunde),
            "by": str(by or "").strip() or None,
            "acked_at": now,
        },
        now,
    )


def quittung(rows: Any, entity_id: str, now: float) -> dict[str, Any] | None:
    """Wer die Warnung dieses Geräts stillgestellt hat - oder None (rein).

    Nur, solange sie wirklich stumm ist: Eine abgelaufene Quittung ist
    keine Auskunft mehr, sondern eine Zeile, die Ruhe behauptet, wo
    längst wieder gemeldet wird.
    """
    eintrag = zeile(rows, entity_id)
    if eintrag is None or _zahl(eintrag.get("until")) <= now:
        return None
    return {
        "by": eintrag.get("by") or None,
        "at": _zahl(eintrag.get("acked_at")) or None,
        "until": _zahl(eintrag.get("until")),
    }


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
