"""Warum der Grill nicht antwortet - Schritt für Schritt.

Aufruf auf dem Docker-Host:
    docker exec homepilot-hub python -m homepilot.grillcheck

Der Anlass: «Die Pit-Boss-Integration funktioniert nicht. Der Smoker ist
eingeschaltet und läuft.» Unter *Ausfälle* stand «noch ausgefallen» und
sonst nichts - und damit ist die Frage «woran liegt es?» unbeantwortbar.
Zwischen dem Grill und der Kachel liegen vier Stellen, an denen es
hängen kann:

- **Die Konfiguration.** Falsches Modell, vertippte Adresse, fehlende
  ``grill_id``. Steht hier gleich zuoberst, so wie der Hub sie liest.
- **Der Weg.** Lokal braucht der Grill einen eingeschalteten
  HTTP-Server auf der Steuerplatine; ältere haben gar keinen. Über die
  Wolke braucht es den Hersteller-Dienst. Dieses Werkzeug klopft beides
  einzeln ab und sagt, was zurückkommt.
- **Die Bauart.** ``PitBoss.start()`` löst erst das Modell auf und baut
  dann die Verbindung. Scheitert es am Modell, ist es ein Fehler in der
  config.yaml; scheitert es an der Verbindung, steht die Bauart
  trotzdem - und man sieht es hier an der Zeile «Bauart».
- **Der Zustand.** Kommt einer, steht er hier roh daneben. Genau daran
  sieht man, ob der Hub etwas anderes liest, als die Pit-Boss-App
  anzeigt.

Und weil die Live-Karte auf dem Sperrbildschirm an denselben Werten
hängt (core/livekarten.py, karten_grill), sagt die letzte Zeile gleich
mit, ob sie erscheinen würde: Sie braucht «läuft», eine erreichbare
Kachel und ein Temperaturziel.

Meldet Python «No module named homepilot.grillcheck», läuft noch ein
altes Abbild - dann zuerst deploy/rebuild-hub.sh und in Portainer neu
deployen.
"""

from __future__ import annotations

import asyncio
import functools
import json
from typing import Any

from .core import liveaktivitaet
from .core.config import load_config
from .core.livekarten import START_KEY
from .integrations.pitboss import fehlergrund, grill_entries, grill_state
from .storencheck import CONFIG, DATEN

# docker exec ohne Terminal puffert blockweise - jede Zeile sofort raus.
print = functools.partial(print, flush=True)


def eintraege() -> list[dict[str, Any]]:
    """Die Grills aus der Konfiguration - so, wie der Hub sie liest."""
    config = load_config(CONFIG)
    for roh in config.integrations:
        if str(roh.get("integration") or "") == "pitboss":
            return grill_entries(roh)
    return []


def kartenlage(zustand: dict[str, Any], erreichbar: bool) -> str:
    """Würde die Live-Karte erscheinen? (rein, testbar)

    Dieselben drei Bedingungen wie in core/livekarten.py (karten_grill).
    Hier noch einmal als Satz, weil «warum sehe ich keine Live-Karte?»
    die zweite Hälfte derselben Frage ist - und die Antwort meist
    dieselbe: Die Kachel gilt als nicht erreichbar.
    """
    fehlt = []
    if not erreichbar:
        fehlt.append("die Kachel gilt als nicht erreichbar")
    if zustand.get("state") != "running":
        fehlt.append(f"der Zustand ist «{zustand.get('state')}» statt «running»")
    if zustand.get("target") is None:
        fehlt.append("es ist kein Temperaturziel gesetzt")
    if not fehlt:
        return "Live-Karte: erscheint (läuft, erreichbar, Ziel gesetzt)."
    return "Live-Karte: erscheint nicht - " + "; ".join(fehlt) + "."


async def pruefe(eintrag: dict[str, Any]) -> None:
    print(f"\n── {eintrag['name']} ──")
    weg = (
        f"lokal über {eintrag['host']}"
        if eintrag["host"]
        else f"über die Wolke (grill_id {str(eintrag['grill_id'])[:8]}…)"
    )
    print(f"  Weg:    {weg}")
    print(f"  Modell: {eintrag['model']}")
    print(f"  Kennung: {eintrag['id']}")

    try:
        from pytboss import HttpConnection, PitBoss, WebSocketConnection
    except ImportError as err:
        print(f"  ✗ Das Paket 'pytboss' fehlt im Abbild: {err}")
        return

    connection = (
        HttpConnection(eintrag["host"])
        if eintrag["host"]
        else WebSocketConnection(eintrag["grill_id"])
    )
    try:
        boss = PitBoss(connection, eintrag["model"], password=eintrag["password"])
    except Exception as err:
        print(f"  ✗ Liess sich nicht anlegen: {err}")
        return

    try:
        await boss.start()
        print("  ✓ Verbindung aufgebaut.")
    except Exception as err:
        # Dieselbe Unterscheidung wie beim Start des Hubs: vor der
        # Verbindung gescheitert heisst am Modell.
        if not hasattr(boss, "spec"):
            print(f"  ✗ Modell '{eintrag['model']}' unbekannt: {err}")
            print("    Bekannte Modelle listet")
            print("    'python -m homepilot.integrations.pitboss --modelle'.")
            return
        print(f"  ✗ {fehlergrund(err, weg)}")

    bauart = getattr(boss, "spec", None)
    print(f"  Bauart: {getattr(bauart, 'name', '—') if bauart else '—'}")

    try:
        roh = await boss.get_state()
    except Exception as err:
        print(f"  ✗ Kein Zustand: {fehlergrund(err, weg)}")
        print("    Das ist genau die Zeile, die unter «Ausfälle» fehlte.")
        return

    if not isinstance(roh, dict):
        print(f"  ✗ Zustand in unerwarteter Form: {type(roh).__name__}")
        return

    zustand = grill_state(roh)
    print("  ✓ Zustand gelesen:")
    print(f"    {json.dumps(zustand, ensure_ascii=False, sort_keys=True)}")
    print("  Roh von der Platine:")
    print(f"    {json.dumps(roh, ensure_ascii=False, sort_keys=True)[:600]}")
    print(f"  {kartenlage(zustand, True)}")

    try:
        await boss.stop()
    except Exception:
        # Aufräumen ist eine Höflichkeit, kein Prüfschritt.
        pass


def live_voraussetzungen() -> None:
    """Was es ausser dem Grill noch braucht, damit eine Karte erscheint.

    Die Karte selbst gibt es längst (core/livekarten.py, karten_grill) -
    sie hängt aber an drei Dingen, die nichts mit dem Grill zu tun
    haben. Ohne diese Zeilen sucht man den Fehler beim Grill, während er
    im Telefon oder in der config.yaml sitzt.
    """
    print("\n── Live-Karten allgemein ──")
    try:
        config = load_config(CONFIG)
    except Exception as err:
        print(f"  ✗ Konfiguration nicht lesbar: {err}")
        return
    if config.apns:
        print("  ✓ apns-Block steht in der config.yaml.")
    else:
        print("  ✗ Kein apns-Block - ohne ihn bleibt **jede** Live-Karte aus.")

    try:
        with open(DATEN, encoding="utf-8") as datei:
            daten = json.load(datei)
    except (OSError, ValueError) as err:
        print(f"  ? Datendatei nicht lesbar ({err}) - Telefone ungeprüft.")
        return

    start = [row for row in (daten.get(START_KEY) or []) if isinstance(row, dict)]
    gesperrt = liveaktivitaet.abgeschaltet(daten.get("user_prefs") or [])
    bereit = sorted(
        {
            str(row.get("user") or "")
            for row in start
            if str(row.get("user") or "") not in gesperrt
        }
    )
    if bereit:
        print(f"  ✓ Telefone bereit für Live-Karten: {', '.join(bereit)}")
    else:
        print("  ✗ Kein Telefon meldet ein Start-Token.")
        print("    Das Telefon meldet es beim Öffnen der App - und nur aus")
        print("    einem Build, der das Modul wirklich enthält (CLAUDE.md,")
        print("    runtimeVersion).")
    if gesperrt:
        print(f"  · Abgeschaltet im Profil: {', '.join(sorted(gesperrt))}")


async def main_async() -> None:
    try:
        grills = eintraege()
    except Exception as err:
        raise SystemExit(f"Konfiguration nicht lesbar: {err}") from err
    if not grills:
        print("In der config.yaml steht keine 'pitboss'-Integration.")
    else:
        print(f"{len(grills)} Grill(s) in der Konfiguration.")
        for eintrag in grills:
            await pruefe(eintrag)
    live_voraussetzungen()


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
