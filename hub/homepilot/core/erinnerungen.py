"""Erinnerungen: der Hub schickt den Push, die Bildschirme zeigen selbst.

Die Erinnerungen liegen als Familien-Sammlung in ``family_reminders``
(siehe api/routes/family.py); ob eine **am Bildschirm** fällig ist,
rechnet jedes Gerät aus seiner eigenen Uhr. Für den Push geht das
nicht: Er muss auch dann kommen, wenn gerade keine App offen ist. Also
führt der Hub genau dafür einen kleinen Takt - keine Wecker-Verwaltung,
nur ein Blick auf die Liste alle paar Sekunden.

Ein Eintrag trägt zwei Schalter aus der App: ``anzeigen`` (gross auf
den Schirmen, bis die erste Person bestätigt) und ``push`` samt
``push_an`` (an welche Haushaltsmitglieder). ``pushed`` setzt der Hub
nach dem Versand - in die Sammlung selbst, damit ein Neustart nicht
noch einmal schickt.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

log = logging.getLogger(__name__)

#: Der Blick auf die Liste. Grob mit Absicht: Eine Erinnerung ist auf
#: die Minute gestellt, nicht auf die Sekunde.
TAKT_SEKUNDEN = 15.0


def zu_pushen(rows: Any, jetzt_ms: float) -> list[dict[str, Any]]:
    """Welche Einträge jetzt einen Push brauchen (rein, testbar).

    ``at`` steht in Millisekunden - die App rechnet in ``Date.now()``,
    und der Hub übernimmt die Einheit, statt an einer Umrechnung zu
    scheitern, die niemand sieht.
    """
    faellig = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        if not row.get("push") or row.get("done") or row.get("pushed"):
            continue
        try:
            at = float(row.get("at") or 0)
        except (TypeError, ValueError):
            continue
        if 0 < at <= jetzt_ms:
            faellig.append(row)
    return faellig


def empfaenger(row: dict[str, Any]) -> list[str]:
    """Die gewählten Namen - leer heisst «alle» (rein, testbar)."""
    namen = row.get("push_an")
    if not isinstance(namen, list):
        return []
    return [str(name).strip() for name in namen if str(name).strip()]


def nach_versand(rows: Any, ids: set[str]) -> list[dict[str, Any]]:
    """Die Liste nach dem Versand (rein, testbar).

    ``pushed`` hält den Versand fest. Ein Eintrag, der **nur** pusht
    (``anzeigen`` aus), ist damit erledigt - es gibt keinen Bildschirm,
    auf dem ihn jemand bestätigen könnte, und offen stehen bliebe er
    sonst für immer.
    """
    neue = []
    for row in rows or []:
        if isinstance(row, dict) and str(row.get("id")) in ids:
            row = {**row, "pushed": True}
            if not row.get("anzeigen", True):
                row["done"] = True
        neue.append(row)
    return neue


def benutzer_umbenennen(rows: Any, alt: str, neu: str) -> list[Any]:
    """Einen Benutzernamen in offenen Erinnerungen nachziehen (rein, testbar).

    In ``push_an`` (wer den Push bekommt) und ``quittiert`` (wer schon
    für sich bestätigt hat) stehen Namen. Bleibt dort der alte, geht
    der Push an niemanden, und die Erinnerung erscheint wieder, obwohl
    man sie weggedrückt hat.
    """
    neue = []
    for row in rows or []:
        if isinstance(row, dict):
            geaendert = dict(row)
            for feld in ("push_an", "quittiert"):
                namen = geaendert.get(feld)
                if isinstance(namen, list) and alt in namen:
                    geaendert[feld] = [neu if name == alt else name for name in namen]
            row = geaendert
        neue.append(row)
    return neue


async def push_loop(hub: Any) -> None:
    """Alle TAKT_SEKUNDEN: fällige Pushes verschicken und festhalten."""
    while True:
        await asyncio.sleep(TAKT_SEKUNDEN)
        try:
            await _runde(hub)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Ein Fehler im Takt darf den Takt nicht beenden - sonst
            # bleibt jede weitere Erinnerung stumm, und niemand merkt es.
            log.exception("Erinnerungs-Push fehlgeschlagen")


async def _runde(hub: Any) -> None:
    rows = hub.data.get("family_reminders")
    faellig = zu_pushen(rows, time.time() * 1000)
    if not faellig:
        return
    for row in faellig:
        namen = empfaenger(row)
        tokens: list[str] = []
        # Je Person einzeln aufgelöst: recipients() kennt «alle», Rollen
        # und Namen - hier sind es Namen, und die Vereinigung vermeidet
        # doppelte Geräte, wenn jemand zweimal gewählt wurde.
        for ziel in namen or ["all"]:
            for token in hub.push.recipients(hub.users.users, to=ziel):
                if token not in tokens:
                    tokens.append(token)
        text = str(row.get("text") or "Erinnerung")
        result = await hub.push.send(tokens, "⏰ Erinnerung", text)
        log.info(
            "Erinnerung «%s» als Push an %s (%d Geräte angenommen)",
            text,
            ", ".join(namen) or "alle",
            getattr(result, "accepted", 0) or 0,
        )
    ids = {str(row.get("id")) for row in faellig}
    hub.data.set("family_reminders", nach_versand(hub.data.get("family_reminders"), ids))
    # Der Fingerzeig an die offenen Apps - ein nur-Push-Eintrag ist
    # jetzt erledigt und soll aus den Listen verschwinden.
    await hub.bus.publish("family_changed", {"collection": "reminders"})
