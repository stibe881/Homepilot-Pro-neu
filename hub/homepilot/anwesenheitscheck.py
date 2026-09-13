"""Warum hat die Anlage erst um 16:51 scharf geschaltet?

Aufruf auf dem Docker-Host:
    docker exec homepilot-hub python -m homepilot.anwesenheitscheck

Der Anlass (Punkt 636 der Werkbank): «Diese Meldungen sind um 16:51
gekommen. Es ist aber seit ca. 13:00 niemand mehr zuhause.» Beides kann
stimmen, und genau darum ist die Frage ohne diese Ausgabe nicht zu
beantworten. Die Anlage rechnet nicht, wann jemand gegangen *ist*,
sondern wann sein Telefon es gemeldet hat - und sie wartet auf den
Letzten:

- **Ein Telefon hat den Weggang nie gemeldet.** Dann steht die Person
  stundenlang auf «zuhause», und «niemand mehr da» wird erst wahr, wenn
  sie sich das nächste Mal überhaupt meldet. Das ist der häufige Fall,
  und man sieht ihn unten daran, dass eine Person als Letzte ging, die
  in Wahrheit als Erste gegangen ist.
- **Die Meldung kam, aber spät.** Ein Kurzbefehl läuft, wenn iOS ihn
  laufen lässt; ohne Netz am Zonenrand fällt der POST aus und wird nicht
  wiederholt.
- **Der Nachlauf.** Nach «alle weg» wartet die Kopplung noch zehn
  Minuten (core/alarmanwesenheit.py, NACHLAUF_SEKUNDEN) - die stehen
  unten als eigene Zeile, damit man sie nicht für eine Verzögerung hält.

Meldet Python «No module named homepilot.anwesenheitscheck», läuft noch
ein altes Abbild - dann zuerst deploy/rebuild-hub.sh und in Portainer
neu deployen.
"""

import functools
import json
import time
import urllib.request
from datetime import datetime

from .core import alarmanwesenheit
from .storencheck import DATEN, token_und_port

# docker exec ohne Terminal puffert blockweise - jede Zeile sofort raus.
print = functools.partial(print, flush=True)

#: So weit zurück wird der Verlauf gezeigt. Ein Tag deckt den gefragten
#: Fall ab («heute Mittag gegangen, am Abend gemeldet») und bleibt kurz
#: genug, dass man die Zeilen wirklich liest.
STUNDEN = 24


def uhr(wann: object) -> str:
    """Ein Zeitstempel als Ortszeit «Sa 16:41:07» (rein, testbar)."""
    try:
        return datetime.fromtimestamp(float(wann)).strftime("%a %H:%M:%S")  # type: ignore[arg-type]
    except (TypeError, ValueError, OSError):
        return "?"


def alter(sekunden: float | None) -> str:
    """«vor 12 min», «vor 3 Std 51 min» (rein, testbar)."""
    if sekunden is None:
        return "–"
    rest = max(0, round(sekunden))
    if rest < 90:
        return f"vor {rest} s"
    if rest < 5400:
        return f"vor {rest // 60} min"
    return f"vor {rest // 3600} Std {(rest % 3600) // 60} min"


def daten() -> dict:
    try:
        with open(DATEN, encoding="utf-8") as datei:
            return json.load(datei)
    except (OSError, ValueError):
        return {}


def hole(port: str, token: str, pfad: str) -> dict:
    bitte = urllib.request.Request(
        f"http://127.0.0.1:{port}{pfad}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(bitte, timeout=15) as antwort:
        return json.load(antwort)


def main() -> None:
    token, port = token_und_port()
    if not token:
        raise SystemExit("Kein Token - weder in der Umgebung noch in der Konfiguration")

    jetzt = time.time()
    ortszeit = datetime.now().astimezone()
    print(f"Uhr des Hubs: {ortszeit:%d.%m.%Y %H:%M:%S} ({ortszeit.tzname()})")
    print()

    try:
        leute = (hole(port, token, "/api/presence/diagnose") or {}).get("people") or []
    except Exception as err:  # noqa: BLE001 - die Ursache gehört in die Ausgabe
        raise SystemExit(f"Die Anwesenheit war nicht zu lesen: {err}") from err

    if not leute:
        print("Keine Person eingerichtet - dann kann auch nichts «alle weg» werden.")
        return

    kopf = f"{'Person':<14} {'Zustand':<10} {'Quelle':<10} {'Letzte Meldung':<16} {'Alter':<18} Akku"
    print(kopf)
    print("-" * len(kopf))
    for zeile in leute:
        gehoert = zeile.get("last_seen") or zeile.get("changed_at")
        akku = zeile.get("battery")
        print(
            f"{str(zeile.get('person') or zeile.get('zone') or '?'):<14.14} "
            f"{str(zeile.get('combined') or zeile.get('state') or '–'):<10.10} "
            f"{str(zeile.get('combined_source') or zeile.get('source') or '–'):<10.10} "
            f"{uhr(gehoert):<16} "
            f"{alter(jetzt - float(gehoert)) if gehoert else '–':<18} "
            f"{akku if akku is not None else '–'}"
        )
    print()
    for zeile in leute:
        satz = str(zeile.get("text") or "").strip()
        if satz:
            print(f"  {str(zeile.get('person') or '?')}: {satz}")
    print()

    ablage = daten()
    verlauf = [
        row
        for row in (ablage.get("presence_history") or [])
        if isinstance(row, dict) and jetzt - float(row.get("at") or 0) <= STUNDEN * 3600
    ]
    print(f"Kommen und Gehen der letzten {STUNDEN} Stunden:")
    if not verlauf:
        print("   nichts gemeldet - und genau das ist dann die Antwort.")
    for row in sorted(verlauf, key=lambda row: float(row.get("at") or 0)):
        ort = row.get("place") or ""
        print(
            f"   {uhr(row.get('at')):<16} {str(row.get('person') or '?'):<14.14} "
            f"→ {str(row.get('state') or '?')}"
            + (f"  ({ort})" if ort and ort != row.get("state") else "")
        )
    print()

    # Die Rechnung, um die es geht.
    weg_seit, letzter = alarmanwesenheit.letzter_weggang(
        ablage.get("presence_history")
    )
    alarm = (ablage.get("alarm") or [{}])[0] or {}
    einstellungen = alarm.get("settings") or {}
    stufe = alarmanwesenheit.stufe_lesen(einstellungen.get("presence_arm"))
    nachlauf = alarmanwesenheit.NACHLAUF_SEKUNDEN

    print("Was die Alarmanlage daraus macht:")
    print(f"   Kopplung «scharf»  : {stufe}")
    print(f"   Kopplung «unscharf»: "
          f"{alarmanwesenheit.stufe_lesen(einstellungen.get('presence_disarm'))}")
    print(f"   Nachlauf           : {int(nachlauf // 60)} min nach «alle weg»")
    if weg_seit is None:
        print("   Alle weg           : nein - jemand wird noch als zuhause geführt.")
    else:
        print(f"   Alle weg seit      : {uhr(weg_seit)}  "
              f"(zuletzt ging: {letzter})")
        print(f"   Frühestens scharf  : {uhr(weg_seit + nachlauf)}")
    print()

    scharf = [
        row
        for row in (alarm.get("history") or [])
        if isinstance(row, dict)
        and jetzt - float(row.get("at") or 0) <= STUNDEN * 3600
    ]
    print(f"Was die Anlage in den letzten {STUNDEN} Stunden tat:")
    if not scharf:
        print("   nichts.")
    for row in sorted(scharf, key=lambda row: float(row.get("at") or 0)):
        print(
            f"   {uhr(row.get('at')):<16} {str(row.get('kind') or '?'):<12.12} "
            f"{str(row.get('text') or ''):<40.40} "
            f"{('durch ' + str(row['by'])) if row.get('by') else ''}"
        )
    print()
    print(
        "Zu lesen ist das von unten nach oben: Schaltete die Anlage «durch\n"
        "Anwesenheit» genau zehn Minuten nach «alle weg», hat die Kopplung\n"
        "getan, was sie soll - und die Frage ist, warum die letzte Meldung\n"
        "so spät kam. Steht dort eine Person, die längst aus dem Haus war,\n"
        "ist ihr Weggang nie gemeldet worden: iOS-Kurzbefehl «Verlassen»\n"
        "prüfen (docs/geofence.md), oder in der App unter Anwesenheit\n"
        "einmal «Jetzt melden» drücken."
    )


if __name__ == "__main__":
    main()
