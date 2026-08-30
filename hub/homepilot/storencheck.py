"""Was der Hub über jede Store weiss – und woher er es weiss.

Aufruf auf dem Docker-Host:
    docker exec homepilot-hub python -m homepilot.storencheck

Der Anlass: «Alle Storen sind zu, die App zeigt sie offen.» Dahinter
können zwei ganz verschiedene Dinge stecken, und ohne diese Ausgabe rät
man zwischen ihnen:

- Der Hub weiss es richtig, und die App zeigt es falsch. Dann steht hier
  ``pos=0`` und ``geschlossen``, und der Fehler sitzt in der App (oder
  auf dem Telefon läuft ein alter Build).
- Der Hub weiss es selbst nicht. Dann steht hier ``angenommen=ja`` oder
  gar nichts – eine Somfy-RTS-Store funkt nur in eine Richtung und
  meldet ihre Stellung nie zurück.

Meldet Python «No module named homepilot.storencheck», läuft noch ein
altes Abbild – dann zuerst deploy/rebuild-hub.sh und in Portainer neu
deployen.
"""

import functools
import json
import os
import re
import urllib.request

# docker exec ohne Terminal puffert blockweise – jede Zeile sofort raus.
print = functools.partial(print, flush=True)

CONFIG = "/config/config.yaml"


def token_und_port() -> tuple[str, str]:
    """Zugang aus der Umgebung, sonst aus der Konfiguration.

    Die Umgebung zuerst, weil der livecheck es genauso hält; die Datei
    als Rückfall, damit der Aufruf ohne Vorbereitung klappt.
    """
    token = os.environ.get("TOKEN_STEFAN") or os.environ.get("HOMEPILOT_TOKEN") or ""
    port = "8123"
    try:
        with open(CONFIG, encoding="utf-8") as datei:
            roh = datei.read()
    except OSError:
        return token, port
    if not token:
        treffer = re.search(r"token:\s*([^\s#]+)", roh)
        if treffer:
            token = treffer.group(1).strip("'\"")
    treffer = re.search(r"port:\s*(\d+)", roh)
    if treffer:
        port = treffer.group(1)
    return token, port


def ja_nein(wert: object) -> str:
    if wert is True:
        return "ja"
    if wert is False or wert is None:
        return "nein"
    return str(wert)


def main() -> None:
    token, port = token_und_port()
    if not token:
        raise SystemExit(f"Kein Token – weder in der Umgebung noch in {CONFIG}")

    bitte = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/entities",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(bitte, timeout=15) as antwort:
        geraete = json.load(antwort)

    storen = [g for g in geraete if g.get("kind") == "cover"]
    if not storen:
        print("Keine Store gefunden.")
        return

    kopf = f"{'Kennung':<36} {'Name':<20} {'Zustand':<10} {'Pos':>4}  {'angenommen':<11} Lamellen"
    print(kopf)
    print("-" * len(kopf))
    for geraet in sorted(storen, key=lambda g: str(g.get("id", ""))):
        zustand = geraet.get("state") or {}
        position = zustand.get("position")
        print(
            f"{str(geraet.get('id', '?')):<36} "
            f"{str(geraet.get('name', '')):<20.20} "
            f"{str(zustand.get('state', '–')):<10} "
            f"{('–' if position is None else position):>4}  "
            f"{ja_nein(zustand.get('angenommen')):<11} "
            f"{zustand.get('tilt', '–')}"
        )

    print()
    ohne = [g for g in storen if (g.get("state") or {}).get("position") is None]
    angenommen = [g for g in storen if (g.get("state") or {}).get("angenommen") is True]
    print(f"{len(storen)} Storen, {len(ohne)} ohne Stellung, {len(angenommen)} nur angenommen.")
    if ohne:
        print(
            "Ohne Stellung heisst: Das Gerät meldet nichts zurück (Somfy RTS "
            "funkt nur in eine Richtung). Die App darf daraus kein «offen» machen."
        )


if __name__ == "__main__":
    main()
