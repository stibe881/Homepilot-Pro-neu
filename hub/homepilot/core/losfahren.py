"""Der Losfahr-Wecker: «Jetzt losfahren, sonst zu spät.»

Werkbank-Punkt 258. Termine haben oft einen Ort, und der Hub weiss, wo
das Haus steht - zusammengezählt ergibt das eine Nachricht, die es
bisher nicht gab: Statt selber zu rechnen, wann man wegen des
Fussballtrainings in Sursee los muss, meldet sich das Haus, wenn es
knapp wird.

Wie gerechnet wird - und warum so grob:

- Der Ort des Termins wird einmal zu Koordinaten gemacht (Nominatim,
  mit Vorrat in der ``hub.data`` - jede Adresse wird genau einmal
  nachgeschlagen, auch über Neustarts hinweg).
- Die Fahrzeit entsteht aus der Luftlinie ab **zuhause**, nicht ab dem
  Telefon: Losgefahren wird praktisch immer von daheim, und eine
  Ortung, die gerade schweigt, soll den Wecker nicht stummschalten.
- Luftlinie mal Strassenfaktor, geteilt durch eine Durchschnitts-
  geschwindigkeit - kein Verkehr, keine Route. Das ist bewusst eine
  Schätzung mit Puffer: Der Wecker soll «eher jetzt als zu spät»
  sagen, nicht auf die Minute stimmen.

Termine ohne Ort bleiben still, ebenso Ganztägiges, Geburtstage und
alles ums Egg (unter einem Kilometer). Alle Funktionen hier sind rein;
Takt, Nachschlagen und Nachricht übernimmt der Wächter.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any

#: Weiter als das schaut der Wecker nicht voraus - wer um 8 Uhr einen
#: Abendtermin sähe, bekäme die Nachricht Stunden zu früh berechnet
#: (und der Ort wäre trotzdem längst nachgeschlagen).
FENSTER_STUNDEN = 6.0

#: Luftlinie → Strasse: Im Hügelland führt keine Strasse geradeaus.
STRASSENFAKTOR = 1.3

#: Durchschnittstempo in km/h - kurz durchs Dorf langsamer, weiter weg
#: hilft irgendwann die Autobahn.
TEMPO_KURZ = 40.0
TEMPO_LANG = 65.0
TEMPO_GRENZE_KM = 15.0

#: Näher als das braucht keinen Wecker - das ist der Weg ums Egg.
MINDEST_KM = 1.0

#: Wo die schon verschickten Wecker liegen (Zeilen, siehe DataStore).
ERINNERT_KEY = "departure_reminders"

#: Und wo die nachgeschlagenen Orte liegen: {ort, lat, lon}. lat kann
#: None sein - «nicht gefunden» ist auch eine Antwort, die man sich
#: merkt, sonst fragt jede Runde denselben Unsinn nach.
ORTE_KEY = "geo_cache"


def _zeitpunkt(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        wann = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return wann


def kandidaten(events: Any, jetzt: datetime) -> list[dict[str, Any]]:
    """Termine, für die sich das Rechnen lohnt (rein, testbar).

    Mit Ort, mit Uhrzeit, noch nicht begonnen und innert der nächsten
    Stunden. Rückgabe je Termin: kennung, summary, ort, start
    (datetime, in der Zeitzonen-Welt von ``jetzt``).
    """
    ergebnis: list[dict[str, Any]] = []
    for event in events if isinstance(events, list) else []:
        if not isinstance(event, dict):
            continue
        if event.get("all_day") or event.get("birthday"):
            continue
        ort = str(event.get("location") or "").strip()
        if not ort:
            continue
        start = _zeitpunkt(event.get("start"))
        if start is None:
            continue
        if (start.tzinfo is None) != (jetzt.tzinfo is None):
            start = start.replace(tzinfo=jetzt.tzinfo)
        abstand = (start - jetzt).total_seconds()
        if abstand <= 0 or abstand > FENSTER_STUNDEN * 3600:
            continue
        kennung = str(event.get("id") or f"{event.get('summary')}|{event.get('start')}")
        ergebnis.append(
            {
                "kennung": kennung,
                "summary": str(event.get("summary") or "Termin"),
                "ort": ort,
                "start": start,
            }
        )
    return ergebnis


def luftlinie_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Grosskreis-Entfernung in Kilometern (rein, testbar)."""
    erdradius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * erdradius * math.asin(math.sqrt(a))


def fahrminuten(km: float) -> int:
    """Geschätzte Fahrzeit in Minuten (rein, testbar).

    Aufgerundet - ein Wecker, der eine Minute zu früh klingelt, ist
    keiner, der eine zu spät klingelt.
    """
    tempo = TEMPO_KURZ if km < TEMPO_GRENZE_KM else TEMPO_LANG
    return max(1, math.ceil(km * STRASSENFAKTOR / tempo * 60))


def faellig(start: datetime, minuten: float, jetzt: datetime) -> bool:
    """Ist jetzt der Moment für die Nachricht? (rein, testbar)

    Fällig ab «Start minus Fahrzeit», und nur bis zum Start: Wer den
    Termin verpasst hat, weiss es dann selber.
    """
    abstand = (start - jetzt).total_seconds()
    return 0 < abstand <= minuten * 60


def ort_kurz(ort: str) -> str:
    """Der lesbare Teil einer Kalender-Adresse (rein, testbar).

    Google hängt gern «, 6144 Zell LU, Schweiz» an - in einer Push
    zählt der erste Teil, der Rest steht ja im Termin.
    """
    kurz = str(ort or "").split(",")[0].strip()
    return kurz or str(ort or "").strip()


def wecker_satz(
    summary: str, ort: str, start: datetime, minuten: int
) -> tuple[str, str]:
    """Titel und Text der Nachricht (rein, testbar)."""
    return (
        "Jetzt losfahren",
        f"{summary} um {start.strftime('%H:%M')} in {ort_kurz(ort)} – "
        f"Fahrzeit etwa {minuten} Minuten.",
    )


def erinnert_lesen(rows: object) -> set[str]:
    """Welche Termine ihren Wecker schon hatten (rein, testbar)."""
    ergebnis: set[str] = set()
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and isinstance(row.get("kennung"), str):
            ergebnis.add(row["kennung"])
    return ergebnis


def erinnert_zeilen(
    rows: object, hinzu: set[str], jetzt_ts: float
) -> list[dict[str, Any]]:
    """Das Gegenstück fürs Zurückschreiben (rein, testbar).

    ``hinzu`` sind nur die *neu* verschickten Wecker. Alte Einträge
    fliegen nach einem Tag hinaus - und zwar endgültig: Wer sie samt
    frischem Zeitstempel wieder einträge, hätte eine Liste, die wächst
    wie ein Kalenderjahr.
    """
    behalten = [
        row
        for row in (rows if isinstance(rows, list) else [])
        if isinstance(row, dict)
        and isinstance(row.get("kennung"), str)
        and isinstance(row.get("at"), (int, float))
        and jetzt_ts - float(row["at"]) < 24 * 3600
    ]
    vorhanden = {row["kennung"] for row in behalten}
    for kennung in sorted(hinzu - vorhanden):
        behalten.append({"kennung": kennung, "at": jetzt_ts})
    return behalten


def orte_lesen(rows: object) -> dict[str, tuple[float, float] | None]:
    """Den Orts-Vorrat lesen (rein, testbar). None heisst «nicht
    gefunden» - auch das ist gemerkt, damit nicht jede Runde fragt."""
    ergebnis: dict[str, tuple[float, float] | None] = {}
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not isinstance(row.get("ort"), str):
            continue
        lat, lon = row.get("lat"), row.get("lon")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            ergebnis[row["ort"]] = (float(lat), float(lon))
        else:
            ergebnis[row["ort"]] = None
    return ergebnis


def orte_zeilen(
    orte: dict[str, tuple[float, float] | None], hoechstens: int = 200
) -> list[dict[str, Any]]:
    """Das Gegenstück fürs Zurückschreiben (rein, testbar)."""
    zeilen: list[dict[str, Any]] = []
    for ort in sorted(orte)[:hoechstens]:
        koord = orte[ort]
        zeilen.append(
            {
                "ort": ort,
                "lat": koord[0] if koord else None,
                "lon": koord[1] if koord else None,
            }
        )
    return zeilen
