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

Dazu kann ein Eintrag ``repeat`` tragen (daily/weekly/monthly/yearly):
Dann wird er nie erledigt, sondern weitergestellt - vom Bestätigen in
der App, oder bei reinen Push-Erinnerungen vom Hub nach dem Versand.
"""

from __future__ import annotations

import asyncio
import calendar
import logging
import time
from datetime import datetime, timedelta
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


#: Wiederholungen, die eine Erinnerung kennt - dieselben Schlüssel wie
#: in der App (lib/erinnerungen.ts) und bei den Familien-Aufgaben.
WIEDERHOLUNGEN = ("daily", "weekly", "monthly", "yearly")


def naechste_faelligkeit(
    at_ms: float, wiederholung: str, jetzt_ms: float
) -> float | None:
    """Der nächste Termin nach «jetzt» (rein, testbar).

    Das Spiegelbild von ``naechsteFaelligkeit`` in lib/erinnerungen.ts -
    beide Seiten müssen denselben Termin ausrechnen, sonst stellt der
    Hub eine Erinnerung anders weiter als die App. Gerechnet wird im
    Kalender, nicht in Millisekunden: 7 Uhr bleibt 7 Uhr, auch über die
    Zeitumstellung. Monat und Jahr zählen vom **ursprünglichen** Termin
    aus - der 31. rutscht im kurzen Monat auf dessen letzten Tag und
    kehrt danach zurück. Verpasste Termine werden übersprungen, nicht
    nachgeholt.
    """
    if wiederholung not in WIEDERHOLUNGEN:
        return None
    try:
        start = datetime.fromtimestamp(float(at_ms) / 1000)
    except (TypeError, ValueError, OSError, OverflowError):
        return None
    for schritt in range(1, 5001):
        if wiederholung == "daily":
            wann = start + timedelta(days=schritt)
        elif wiederholung == "weekly":
            wann = start + timedelta(days=7 * schritt)
        else:
            jahr = start.year + (schritt if wiederholung == "yearly" else 0)
            monat = start.month + (schritt if wiederholung == "monthly" else 0)
            jahr += (monat - 1) // 12
            monat = (monat - 1) % 12 + 1
            tag = min(start.day, calendar.monthrange(jahr, monat)[1])
            wann = start.replace(year=jahr, month=monat, day=tag)
        ergebnis = wann.timestamp() * 1000
        if ergebnis > jetzt_ms:
            return ergebnis
    return None


def nach_versand(
    rows: Any, ids: set[str], jetzt_ms: float | None = None
) -> list[dict[str, Any]]:
    """Die Liste nach dem Versand (rein, testbar).

    ``pushed`` hält den Versand fest. Ein Eintrag, der **nur** pusht
    (``anzeigen`` aus), ist damit erledigt - es gibt keinen Bildschirm,
    auf dem ihn jemand bestätigen könnte, und offen stehen bliebe er
    sonst für immer. Ausser er wiederholt sich: Dann wird er auf den
    nächsten Termin weitergestellt, frisch (kein ``pushed``, kein
    ``quittiert``), damit der nächste Push wieder rausgeht. Bei
    Einträgen **mit** Bildschirm stellt erst das Bestätigen weiter -
    die App rechnet dort denselben Termin aus (bestaetigung()).
    """
    neue = []
    for row in rows or []:
        if isinstance(row, dict) and str(row.get("id")) in ids:
            wiederholung = str(row.get("repeat") or "")
            if not row.get("anzeigen", True):
                naechste = naechste_faelligkeit(
                    row.get("at") or 0,
                    wiederholung,
                    jetzt_ms if jetzt_ms is not None else time.time() * 1000,
                )
                if naechste is not None:
                    row = {**row, "at": naechste, "pushed": False, "quittiert": []}
                else:
                    row = {**row, "pushed": True, "done": True}
            else:
                row = {**row, "pushed": True}
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
