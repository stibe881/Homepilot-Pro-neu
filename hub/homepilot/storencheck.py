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

Die Ausgabe hat zwei Hälften: oben, was der Hub meint (über seine
eigene API gelesen), darunter, was das Gateway roh herausgibt - und was
sich daran ändert, wenn man es ausdrücklich nachlesen lässt. Die zweite
Hälfte entscheidet zwischen «der Wert ist alt» und «der Wert ist falsch
gerechnet»; ohne sie rät man.

Meldet Python «No module named homepilot.storencheck», läuft noch ein
altes Abbild – dann zuerst deploy/rebuild-hub.sh und in Portainer neu
deployen.
"""

import asyncio
import functools
import json
import os
import time
import urllib.request

from .core.config import load_config

# docker exec ohne Terminal puffert blockweise – jede Zeile sofort raus.
print = functools.partial(print, flush=True)

CONFIG = "/config/config.yaml"
DATEN = "/config/homepilot-data.json"


def token_und_port() -> tuple[str, str]:
    """Zugang aus der Umgebung, sonst aus der Konfiguration.

    Gelesen wird mit `load_config` und nicht mit einem eigenen Muster:
    In der `config.yaml` steht ein halbes Dutzend `token:` – für Overkiz,
    für Ring, fürs Update. Ein `re.search` nimmt das erste und trifft
    damit fast sicher das falsche; der erste Versuch endete genau so in
    einem 401. Der Leser des Hubs weiss, welches gemeint ist.
    """
    token = os.environ.get("TOKEN_STEFAN") or os.environ.get("HOMEPILOT_TOKEN") or ""
    port = "8123"
    try:
        config = load_config(CONFIG)
    except Exception:
        # Ohne Konfiguration bleibt es bei Umgebung und Standardport.
        return token or gespeichertes_token(), port
    if not token and config.api.token:
        token = str(config.api.token)
    # Wer keinen festen Zugang in der Konfiguration hat, hat trotzdem
    # Benutzer - die legt die App an, und ihre Token stehen in der
    # Datendatei.
    return token or gespeichertes_token(), str(config.api.port)


def gespeichertes_token() -> str:
    """Das Token irgendeines eingerichteten Benutzers - oder nichts.

    Nur zum Lesen und nur von innen: Der Aufruf läuft im Container, und
    die Datei liegt ohnehin daneben. Ausgegeben wird das Token nie.
    """
    try:
        with open(DATEN, encoding="utf-8") as datei:
            daten = json.load(datei)
    except (OSError, ValueError):
        return ""
    for eintrag in daten.get("users") or []:
        marke = str(eintrag.get("token") or "")
        if marke:
            return marke
    return ""


def ja_nein(wert: object) -> str:
    if wert is True:
        return "ja"
    if wert is False or wert is None:
        return "nein"
    return str(wert)


def vor_wie_lange(wann: object) -> str:
    """«vor 3 min», «vor 5 Std» - oder «?» (rein, testbar).

    Das Alter einer liegenden Karte beantwortet die Frage, ob der Takt
    sie überhaupt anfasst: Eine Zeile, die seit Stunden unverändert
    dasteht, obwohl der Hub die Karte nicht mehr will, heisst, dass die
    Runde gar nicht bis zum Abgleich kommt.
    """
    try:
        alter = time.time() - float(wann)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "?"
    if alter < 90:
        return f"vor {int(alter)} s"
    if alter < 5400:
        return f"vor {int(alter / 60)} min"
    return f"vor {int(alter / 3600)} Std"


def gateway_teil(geraete_nachlesen: bool = False) -> None:
    """Den rohen Gateway-Bericht anhängen - wenn Overkiz eingerichtet ist.

    Die Tabelle oben sagt, was der Hub *meint*. Sie sagt nicht, woher er
    es hat: Hinter «Pos 0» kann ein `core:ClosureState` von 100 stehen,
    ein uralter Zwischenspeicher-Wert oder eine RTS-Store, die nie
    zurückmeldet. Deshalb steht hier darunter, was das Gateway selbst
    herausgibt - und was sich ändert, wenn man es ausdrücklich nachlesen
    lässt. Erst beide Hälften zusammen sagen, wer falsch liegt.
    """
    try:
        from .integrations.overkiz import gateway_bericht
    except Exception as err:  # pyoverkiz fehlt, kein Overkiz im Haus
        print(f"(Gateway-Teil übersprungen: {err})")
        return
    print()
    print("Was das Gateway selbst meldet (eigene Sitzung, roh):")
    try:
        zeilen = asyncio.run(gateway_bericht(CONFIG, geraete_nachlesen))
    except Exception as err:
        print(f"  nicht abrufbar: {err}")
        return
    for zeile in zeilen:
        print(zeile)


def main(geraete_nachlesen: bool = False) -> None:
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

    kopf = (
        f"{'Kennung':<36} {'Name':<20} {'Zustand':<10} {'Pos':>4}  "
        f"{'angenommen':<11} {'Lamellen':<9} zuletzt"
    )
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
            f"{str(zustand.get('tilt', '–')):<9} "
            f"{vor_wie_lange(geraet.get('last_seen'))}"
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
    print()
    print(
        "«zuletzt» sagt, wie alt die Zeile ist; der Takt fragt jede Minute.\n"
        "Stimmt eine Stellung nicht, entscheidet der Teil darunter, woran es\n"
        "liegt - er fragt das Gateway direkt:\n"
        "  · Das Gateway meldet dasselbe Falsche → das Gerät hat sich noch\n"
        "    nicht gemeldet; niemand weiss es besser, auch die TaHoma-App nicht.\n"
        "  · Das Gateway meldet es richtig → der Hub hinkt hinterher, und die\n"
        "    Frage ist der Ereigniskanal oder der Takt (ABFRAGE_INTERVALL).\n"
        "  · Der rohe Wert passt nicht zu dem, was oben steht → dann gehört\n"
        "    cover_state() angesehen."
    )
    gateway_teil(geraete_nachlesen)


if __name__ == "__main__":
    import argparse

    _parser = argparse.ArgumentParser(description=__doc__)
    _parser.add_argument(
        "--funk",
        action="store_true",
        help=(
            "jede Store zusätzlich einzeln über Funk fragen, wo sie steht "
            "(advancedRefresh) - bewegt nichts, löst aber Funkverkehr aus"
        ),
    )
    main(_parser.parse_args().funk)
