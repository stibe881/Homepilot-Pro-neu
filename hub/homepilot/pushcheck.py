"""Kam die Meldung zu spät - oder erst das Ereignis?

Aufruf auf dem Docker-Host:
    docker exec homepilot-hub python -m homepilot.pushcheck

Der Anlass: «Dass jemand geklingelt hat und dass die Alarmanlage
ausgelöst wurde - die Benachrichtigung kam genau eine Stunde später als
das Ereignis.» Dahinter stecken drei ganz verschiedene Dinge, und ohne
diese Ausgabe rät man zwischen ihnen:

- Der Hub hat spät verschickt. Dann liegen hier Ereigniszeit und
  Sendezeit eine Stunde auseinander, und der Fehler sitzt im Hub.
- Der Hub hat sofort verschickt, das Telefon bekam es später. Dann
  stehen beide Zeiten dicht beieinander, und es liegt am Weg dorthin
  (Expo, Apple, oder die Mitteilungs-Zusammenfassung des iPhones -
  «Geplante Zusammenfassung» hält alles zurück, was nicht ausdrücklich
  als zeitkritisch durchgelassen wird).
- Die Uhr des Hubs geht falsch. Dann stimmt oben die Zeitzone nicht -
  und weil «genau eine Stunde» in unseren Breiten fast immer Sommer-
  gegen Winterzeit heisst, steht sie als Erstes da.

Die Zeiten stammen aus zwei getrennten Quellen: das Ereignis aus dem
Protokoll (/api/log), die Meldung aus dem Nachlese-Zettel
(core/pushverlauf.py, geschrieben *vor* dem Versand). Die Differenz ist
damit die Zeit, die der Hub selbst gebraucht hat - nicht die Zustellung.

Meldet Python «No module named homepilot.pushcheck», läuft noch ein
altes Abbild - dann zuerst deploy/rebuild-hub.sh und in Portainer neu
deployen.
"""

import functools
import json
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime

from .core.pushverlauf import STORE_KEY
from .storencheck import DATEN, token_und_port

# docker exec ohne Terminal puffert blockweise - jede Zeile sofort raus.
print = functools.partial(print, flush=True)

#: So nah beieinander gilt als «im selben Atemzug verschickt».
NAH_SEKUNDEN = 90.0


def uhr(wann: object) -> str:
    """Ein Zeitstempel als Ortszeit «Mo 22:14:03» (rein, testbar)."""
    try:
        zeit = datetime.fromtimestamp(float(wann))  # type: ignore[arg-type]
    except (TypeError, ValueError, OSError):
        return "?"
    return zeit.strftime("%a %H:%M:%S")


def spanne(sekunden: float) -> str:
    """«+3 s», «+58 min», «+1 Std 2 min» (rein, testbar).

    Mit Vorzeichen, denn die Richtung ist die halbe Auskunft: Eine
    Meldung *vor* ihrem Ereignis gibt es nicht - steht da ein Minus,
    gehen zwei Uhren auseinander.
    """
    zeichen = "-" if sekunden < 0 else "+"
    rest = abs(round(sekunden))
    if rest < 90:
        return f"{zeichen}{rest} s"
    if rest < 5400:
        return f"{zeichen}{rest // 60} min"
    return f"{zeichen}{rest // 3600} Std {(rest % 3600) // 60} min"


def mit_geraeten(antwort: dict) -> list[dict]:
    """Die Ereignisse mit Art und Name daneben (rein, testbar).

    `/api/log` liefert `events` und `devices` getrennt, damit derselbe
    Gerätename nicht hundertmal über die Leitung geht. Beim ersten
    Anlauf las dieses Werkzeug `kind` direkt am Ereignis - dort steht
    nie etwas, und die Spalte «Verzug» blieb bei jeder Zeile leer,
    obwohl Klingel und Alarm sauber im Protokoll standen.
    """
    geraete = (antwort or {}).get("devices") or {}
    return [
        {**eintrag, **(geraete.get(str(eintrag.get("entity_id") or "")) or {})}
        for eintrag in ((antwort or {}).get("events") or [])
        if isinstance(eintrag, dict)
    ]


def zettel() -> list[dict]:
    """Die verschickten Meldungen aus der Datendatei (jüngste zuletzt)."""
    try:
        with open(DATEN, encoding="utf-8") as datei:
            daten = json.load(datei)
    except (OSError, ValueError):
        return []
    return [row for row in (daten.get(STORE_KEY) or []) if isinstance(row, dict)]


def passendes_ereignis(meldung: dict, ereignisse: list[dict]) -> dict | None:
    """Das Ereignis, aus dem diese Meldung entstanden ist (rein, testbar).

    Gesucht wird das jüngste Ereignis *vor* der Meldung, dessen Gerät
    zur Art passt - beim Klingeln eine Klingel, beim Alarm die
    Alarmanlage. Findet sich keines, bleibt die Zeile trotzdem stehen:
    Dass eine Meldung raus ist, ist auch ohne ihren Auslöser eine
    Auskunft.
    """
    art = str(meldung.get("category") or "")
    wann = float(meldung.get("at") or 0)
    passend = ARTEN.get(art)
    if passend is None:
        return None
    treffer = [
        eintrag
        for eintrag in ereignisse
        if float(eintrag.get("at") or 0) <= wann
        and passend(eintrag)
    ]
    if not treffer:
        return None
    return max(treffer, key=lambda eintrag: float(eintrag.get("at") or 0))


#: Woran das Ereignis zu einer Meldungsart zu erkennen ist. Bewusst nur
#: die beiden gemeldeten Fälle: Für alles Übrige wäre jede Regel
#: geraten, und eine falsche Zuordnung ist schlechter als keine.
ARTEN = {
    "doorbell": lambda e: str(e.get("kind") or "") == "binary_sensor"
    and "klingel" in f"{e.get('name', '')} {e.get('entity_id', '')}".lower(),
    "alarm": lambda e: str(e.get("kind") or "") == "alarm",
}


def main() -> None:
    token, port = token_und_port()
    if not token:
        raise SystemExit("Kein Token - weder in der Umgebung noch in der Konfiguration")

    jetzt = time.time()
    ortszeit = datetime.now().astimezone()
    versatz = ortszeit.utcoffset()
    print(
        f"Uhr des Hubs: {ortszeit:%d.%m.%Y %H:%M:%S} "
        f"({ortszeit.tzname()}, UTC{versatz and int(versatz.total_seconds()) // 3600:+d})"
    )
    print(f"Dieselbe Zeit in UTC: {datetime.now(UTC):%H:%M:%S}")
    print(
        "Stimmt die erste Zeile nicht mit der Uhr im Haus überein, ist alles\n"
        "Weitere unten um genau diesen Betrag verschoben - dann gehört TZ\n"
        "(Europe/Zurich) an den Container, bevor man weitersucht.\n"
    )

    frage = urllib.parse.urlencode({"hours": 48, "limit": 500})
    bitte = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/log?{frage}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(bitte, timeout=15) as antwort:
        ereignisse = mit_geraeten(json.load(antwort))

    meldungen = [
        row
        for row in zettel()
        if jetzt - float(row.get("at") or 0) <= 48 * 3600
    ]
    if not meldungen:
        print("In den letzten 48 Stunden hat der Hub keine Meldung verschickt.")
        return

    kopf = f"{'Verschickt':<14} {'Art':<14} {'Ereignis':<14} {'Verzug':<12} Titel"
    print(kopf)
    print("-" * len(kopf))
    for meldung in sorted(meldungen, key=lambda row: float(row.get("at") or 0)):
        ereignis = passendes_ereignis(meldung, ereignisse)
        wann = float(meldung.get("at") or 0)
        if ereignis is None:
            ereignis_zeit, verzug = "–", "–"
        else:
            ereignis_zeit = uhr(ereignis.get("at"))
            verzug = spanne(wann - float(ereignis.get("at") or 0))
        print(
            f"{uhr(wann):<14} "
            f"{str(meldung.get('category') or '–'):<14.14} "
            f"{ereignis_zeit:<14} "
            f"{verzug:<12} "
            f"{str(meldung.get('title') or ''):.40}"
        )

    print()
    print(
        "«Verschickt» ist der Moment, in dem der Hub die Meldung dem\n"
        "Push-Dienst übergeben hat - vermerkt wird sie vorher, damit auch\n"
        "eine hängengebliebene Meldung auf dem Zettel steht.\n"
        "Steht unter «Verzug» ein paar Sekunden, hat der Hub seine Arbeit\n"
        "getan, und die Stunde liegt auf dem Weg zum Telefon. Steht dort\n"
        "eine Stunde, liegt sie im Hub - dann bitte diese Ausgabe zeigen."
    )


if __name__ == "__main__":
    main()
