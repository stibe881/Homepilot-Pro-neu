"""Gästemodus: ein Griff statt fünf Handgriffen.

Wenn Besuch kommt, tut man jedes Mal dasselbe: das WLAN weitergeben, im
Eingang Licht machen – und dafür sorgen, dass nicht mitten im Abend die
Storen herunterfahren oder «alles aus» läuft, weil kein Telefon mehr
zuhause gemeldet ist. Das sind fünf Wege durch die App, und den letzten
vergisst man.

Der Unterschied zum Babysitter-Modus (core/babysitter.py): Der läuft,
bis ihn jemand ausschaltet – gedacht für einen Abend, an dem man selbst
weg ist und ans Ausschalten denkt. Der Gästemodus **endet von selbst**,
denn an dem Abend, an dem er läuft, denkt garantiert niemand daran. Er
trägt darum eine Frist und keinen Schalter.

Was er anfasst, steht in der Route (api/routes/haus.py): Abläufe
pausieren, Licht anmachen. Was er *nicht* anfasst, ist dasselbe wie
beim Babysitter: Rauch- und Wassermelder, die Alarmanlage selbst und
die Meldungen des Wächters. Sie sind kein Komfort, den man abschaltet.

Hier steht der Zustand, das Rechnen daran – und das Beenden. Letzteres
hier und nicht in der Route, weil es zwei Aufrufer hat, die einander
nicht kennen sollen: den Knopf in der App und den Wächter, wenn die
Frist abläuft.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

#: Wo der Zustand liegt.
KEY = "guest_mode"

#: Wie lange ein Besuch dauert, wenn niemand etwas anderes sagt. Vier
#: Stunden decken einen Abend ab; wer länger bleibt, verlängert mit
#: einem zweiten Druck.
STUNDEN_VORGABE = 4.0
#: Länger als einen Tag ist kein Besuch mehr, sondern ein Umzug - und
#: eine Frist, die man vergisst, ist keine Frist.
MAX_STUNDEN = 24.0


def stunden_pruefen(wert: Any) -> float:
    """Eine brauchbare Dauer daraus machen (rein, testbar)."""
    try:
        stunden = float(wert)
    except (TypeError, ValueError):
        return STUNDEN_VORGABE
    if stunden <= 0:
        return STUNDEN_VORGABE
    return min(stunden, MAX_STUNDEN)


def read(roh: Any) -> dict[str, Any]:
    """Den gespeicherten Zustand lesen (rein, testbar).

    Nachsichtig wie beim Babysitter: Ein kaputter Eintrag heisst «Modus
    aus», nicht «Absturz».
    """
    if isinstance(roh, list):
        roh = next((x for x in roh if isinstance(x, dict)), None)
    if not isinstance(roh, dict):
        return {"active": False, "until": None, "since": None, "by": None, "undo": None}
    try:
        bis = float(roh.get("until")) if roh.get("until") is not None else None
    except (TypeError, ValueError):
        bis = None
    return {
        "active": bool(roh.get("active")) and bis is not None,
        "until": bis,
        "since": roh.get("since"),
        "by": str(roh.get("by") or "") or None,
        # Die Kennung des Rückwegs (core/rueckgriff.py): Was der Modus
        # eingeschaltet hat, geht am Ende wieder in den Stand von vorher.
        "undo": str(roh.get("undo") or "") or None,
    }


def laeuft(roh: Any, jetzt: float) -> bool:
    """Läuft der Modus gerade? (rein, testbar)

    Die Frist zählt, nicht der Schalter: Ein Eintrag, dessen Zeit
    abgelaufen ist, gilt als aus, auch wenn ihn noch niemand
    aufgeräumt hat. Sonst hinge das ganze Haus an einer Aufräumrunde,
    die aus irgendeinem Grund nicht lief.
    """
    stand = read(roh)
    return bool(stand["active"] and stand["until"] and stand["until"] > jetzt)


def restminuten(roh: Any, jetzt: float) -> int:
    """Wie lange noch – aufgerundet auf Minuten (rein, testbar)."""
    stand = read(roh)
    if not laeuft(roh, jetzt) or stand["until"] is None:
        return 0
    return max(1, int((stand["until"] - jetzt + 59) // 60))


def starten(
    stunden: Any, wer: str, jetzt: float, undo: str | None = None
) -> dict[str, Any]:
    """Den Modus aufsetzen (rein, testbar)."""
    return {
        "active": True,
        "since": jetzt,
        "until": jetzt + stunden_pruefen(stunden) * 3600,
        "by": wer or None,
        "undo": undo,
    }


def beenden() -> dict[str, Any]:
    """Aus – und ohne Rest, an dem später jemand hängenbliebe (rein)."""
    return {"active": False, "since": None, "until": None, "by": None, "undo": None}


def summary(roh: Any, jetzt: float) -> dict[str, Any]:
    """Was die App über den Modus wissen will (rein, testbar)."""
    stand = read(roh)
    an = laeuft(roh, jetzt)
    return {
        "active": an,
        "until": stand["until"] if an else None,
        "minutes_left": restminuten(roh, jetzt),
        "by": stand["by"] if an else None,
    }


def darf_entpausieren(paused_until: float | None, unser_ende: float | None) -> bool:
    """Die Pause der Abläufe nur aufheben, wenn sie unsere ist (rein).

    Wer während des Besuchs von Hand «bis morgen pausieren» gewählt hat,
    soll das behalten: Das Ende des Gästemodus ist kein Grund, eine
    fremde Entscheidung zurückzunehmen. Eine Minute Spielraum, weil
    zwischen Setzen und Ablesen Sekunden vergehen.
    """
    if paused_until is None or unser_ende is None:
        return False
    return abs(paused_until - unser_ende) <= 60


def store(stand: dict[str, Any]) -> list[dict[str, Any]]:
    """Wie der Zustand in den Datenspeicher geht (rein, testbar).

    Der hält Listen; ein Zustand als blosses dict käme dort als Liste
    seiner Schlüssel wieder heraus.
    """
    return [stand]


async def beenden_ausfuehren(hub: Any, grund: str) -> dict[str, Any]:
    """Den Modus beenden: Abläufe wieder frei, Licht wie vorher.

    Nicht rein - hier wird geschaltet. Aufgerufen von der Route (jemand
    drückt «beenden») und vom Wächter (die Frist ist um); beide sollen
    dasselbe tun, also steht es einmal da.
    """
    import time

    from . import rueckgriff

    stand = read(hub.data.get(KEY))
    hub.data.set(KEY, store(beenden()))
    # Die Pause der Abläufe nur aufheben, wenn sie unsere ist.
    laufend = hub.automations.paused_until
    if darf_entpausieren(
        laufend.timestamp() if laufend else None, stand["until"]
    ):
        hub.automations.pause(0)

    zurueck: list[str] = []
    if stand["undo"]:
        rows = hub.data.get(rueckgriff.SCHLANGE)
        eintrag = rueckgriff.holen(rows, stand["undo"], time.time())
        if eintrag:
            hub.data.set(rueckgriff.SCHLANGE, rueckgriff.entfernen(rows, stand["undo"]))
            for befehl in eintrag.get("commands") or []:
                entity_id = str(befehl.get("entity_id") or "")
                try:
                    await hub.integrations.dispatch_command(
                        entity_id,
                        str(befehl.get("command") or ""),
                        befehl.get("data") or {},
                    )
                    zurueck.append(entity_id)
                except Exception:
                    log.debug("Gästemodus: Rückweg hakt bei %s", entity_id, exc_info=True)
    log.info("Gästemodus beendet (%s)", grund)
    return {**summary(hub.data.get(KEY), time.time()), "restored": zurueck}
