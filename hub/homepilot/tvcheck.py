"""Warum liegt diese Fernseher-Karte noch auf dem Sperrbildschirm?

Aufruf auf dem Docker-Host:
    docker exec homepilot-hub python -m homepilot.tvcheck

Der Anlass, zweimal gemeldet: «Der Fernseher ist aus, die
Live-Aktivität ist immer noch da.» Dahinter stecken drei ganz
verschiedene Dinge, und ohne diese Ausgabe rät man zwischen ihnen:

- Der Hub *will* die Karte noch. Dann steht hier ``Karte: ja``, und
  darunter steht, woran es liegt: ein Zuspieler, der seine Sitzung im
  Standby weiterhält (Zattoo), ein Gerät, das der Hub nicht mehr
  erreicht, oder ein Steuerkreuz-Zwilling, der nicht gefunden wird.
- Der Hub will sie nicht mehr, kann sie aber nicht beenden - ihm fehlt
  das Aktivitäts-Token des Telefons. Dann steht die Zeile unter
  «Liegende Karten» mit ``Token: -``; sie geht weg, sobald die App
  einmal geöffnet wird (core/livekarten.py, ende_offen).
- Der Hub weiss von keiner Karte mehr. Dann liegt auf dem Telefon eine
  Leiche aus einer früheren Fassung - App öffnen räumt sie ab.

Meldet Python «No module named homepilot.tvcheck», läuft noch ein altes
Abbild - dann zuerst deploy/rebuild-hub.sh und in Portainer neu
deployen.
"""

import functools
import json
import urllib.request
from types import SimpleNamespace

from .core.livekarten import KARTEN_KEY, erreichbar, geisterbild, karten_tv, sind_zwillinge
from .storencheck import DATEN, ja_nein, token_und_port

# docker exec ohne Terminal puffert blockweise - jede Zeile sofort raus.
print = functools.partial(print, flush=True)


def als_entity(roh: dict) -> SimpleNamespace:
    """Die JSON-Zeile so formen, wie die reinen Funktionen sie erwarten.

    Sie lesen ``entity.state``, ``entity.commands`` und ``entity.label`` -
    die API schickt ``name``. Ein SimpleNamespace genügt; die Funktionen
    greifen nirgends auf die echte Klasse zu (deshalb sind sie testbar).
    """
    return SimpleNamespace(
        id=str(roh.get("id") or ""),
        kind=str(roh.get("kind") or ""),
        label=str(roh.get("name") or ""),
        state=roh.get("state") or {},
        commands=roh.get("commands") or [],
        room=roh.get("room"),
        available=bool(roh.get("available", True)),
    )


def liegende_karten() -> list[dict]:
    """Was der Hub für laufend hält (live_cards aus der Datendatei).

    Gelesen und nie ausgegeben wird das Token selbst - hier zählt nur,
    ob eines da ist. Ohne Token kann der Hub eine Karte nicht beenden,
    und genau das ist der zweite Fall oben.
    """
    try:
        with open(DATEN, encoding="utf-8") as datei:
            daten = json.load(datei)
    except (OSError, ValueError):
        return []
    return [row for row in (daten.get(KARTEN_KEY) or []) if isinstance(row, dict)]


def main() -> None:
    token, port = token_und_port()
    if not token:
        raise SystemExit("Kein Token - weder in der Umgebung noch in der Konfiguration")

    bitte = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/entities",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(bitte, timeout=15) as antwort:
        geraete = [als_entity(roh) for roh in json.load(antwort)]

    schirme = [
        entity
        for entity in geraete
        if entity.kind == "media_player" and entity.state.get("has_screen")
    ]
    if not schirme:
        print("Kein Gerät mit Bildschirm gefunden.")
        return

    gewollt = {karte["art"].split(":", 1)[1] for karte in karten_tv(geraete)}

    kopf = (
        f"{'Kennung':<34} {'Name':<20} {'Zustand':<9} {'App':<14} "
        f"{'erreichbar':<10} {'Kreuz':<6} {'Geist':<6} Karte"
    )
    print(kopf)
    print("-" * len(kopf))
    for entity in sorted(schirme, key=lambda e: e.id):
        kreuze = [
            kandidat.id
            for kandidat in geraete
            if kandidat is not entity
            and kandidat.kind == "media_player"
            and "dpad_up" in kandidat.commands
            and sind_zwillinge(entity, kandidat)
        ]
        print(
            f"{entity.id:<34.34} {entity.label:<20.20} "
            f"{str(entity.state.get('state') or '–'):<9.9} "
            f"{str(entity.state.get('app') or '–'):<14.14} "
            f"{ja_nein(erreichbar(entity)):<10} "
            f"{(','.join(kreuze) or '–'):<6.6} "
            f"{ja_nein(geisterbild(entity, geraete)):<6} "
            f"{ja_nein(entity.id in gewollt)}"
        )

    print()
    print("Liegende Karten laut Hub (live_cards):")
    karten = [row for row in liegende_karten() if str(row.get("art", "")).startswith("tv:")]
    if not karten:
        print("  keine")
    for row in karten:
        print(
            f"  {row.get('art')} · {row.get('user')} · "
            f"Token: {len(row.get('activity_tokens') or []) or '-'}"
            f"{' · Ende offen' if row.get('ende_offen') else ''}"
        )

    print()
    print(
        "«Karte: ja» heisst: Der Hub will sie. «Geist: ja» heisst: Der\n"
        "Zuspieler behauptet den Fernsehabend allein, der Zwilling\n"
        "widerspricht - dann liegt keine Karte. Steht unter «Kreuz» ein\n"
        "«–», findet der Hub den Steuerkreuz-Zwilling nicht; dann fehlt\n"
        "ihm der Widerspruch, und nur der Zustand des Zuspielers zählt."
    )


if __name__ == "__main__":
    main()
