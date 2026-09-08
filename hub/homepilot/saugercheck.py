"""Was der Hub über den Saugroboter weiss – und was davon meldebar ist.

Aufruf auf dem Docker-Host:
    docker exec homepilot-hub python -m homepilot.saugercheck

Der Anlass (Punkt 263 der Werkbank): «Die Fehlermeldungen von Roborock
kommen nicht als Push an.» Zwischen dem Sauger und der Nachricht liegen
vier Stellen, an denen es hängen kann, und ohne diese Ausgabe rät man
zwischen ihnen:

- **Die Bibliothek liefert den Fehler gar nicht.** Dann steht hier bei
  Fehler und Station nichts, obwohl die Roborock-App etwas zeigt. Genau
  das war der Fall: `roborock.py` fragte ein Feld ab, das es nie gab
  (`dock_error_status_name`), und `getattr` lieferte still None.
- **Der Hub kennt den Fehler, hat ihn aber schon gemeldet.** Dann steht
  er unter «gemeldet» - erinnert wird dann täglich zur Batterie-Stunde.
- **Die Kategorie ist abbestellt.** Steht unten.
- **Es ist gar kein Gerät da.** Dann fehlt die Zeile ganz.

Meldet Python «No module named homepilot.saugercheck», läuft noch ein
altes Abbild – dann zuerst deploy/rebuild-hub.sh und in Portainer neu
deployen.
"""

import functools
import json
import urllib.request

from .core import batterie, push
from .core.watchrules import DOCK_MELDER, sauger_probleme
from .storencheck import CONFIG, token_und_port

# docker exec ohne Terminal puffert blockweise – jede Zeile sofort raus.
print = functools.partial(print, flush=True)

DATEN = "/config/homepilot-data.json"


class _Gerät:
    """Was `sauger_probleme` von einer Entität braucht - mehr nicht.

    Die Regel läuft hier über die Antwort der API statt über die
    Registry: Dieses Werkzeug soll genau das sehen, was auch die App
    sieht, sonst prüft es eine andere Wirklichkeit als die, um die es
    geht.
    """

    def __init__(self, roh: dict) -> None:
        self.id = str(roh.get("id", "?"))
        self.label = str(roh.get("name") or self.id)
        self.kind = str(roh.get("kind") or "")
        self.state = roh.get("state") or {}


def daten() -> dict:
    try:
        with open(DATEN, encoding="utf-8") as datei:
            return json.load(datei)
    except (OSError, ValueError):
        return {}


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

    sauger = [_Gerät(g) for g in geraete if g.get("kind") == "vacuum"]
    if not sauger:
        print("Kein Saugroboter gefunden. Ist die Integration eingerichtet?")
        return

    for geraet in sauger:
        zustand = geraet.state
        dock = zustand.get("dock") if isinstance(zustand.get("dock"), dict) else {}
        print(f"── {geraet.label}  ({geraet.id})")
        print(f"   Zustand    : {zustand.get('state', '–')}  "
              f"Akku {zustand.get('battery', '–')} %  "
              f"erreichbar: {'ja' if zustand.get('state') else 'unklar'}")
        print(f"   Fehler     : {zustand.get('error') or '– (keiner gemeldet)'}")
        if dock:
            for feld in DOCK_MELDER:
                print(f"   Station {feld:<14}: {dock.get(feld) or '–'}")
            uebrig = [k for k in dock if k not in DOCK_MELDER]
            if uebrig:
                print("   Station sonst : "
                      + ", ".join(f"{k}={dock[k]}" for k in sorted(uebrig)))
        else:
            print("   Station    : meldet nichts. Bei einem Modell mit "
                  "Station heisst das: Die Felder kommen nicht an.")
        lauf = zustand.get("last_run")
        if isinstance(lauf, dict):
            # Der eigene Grund des Saugers steht als Zahl daneben und
            # wird nicht übersetzt: Was welche Zahl bedeutet, ist je
            # Modell verschieden. Wer eine Meldung der Roborock-App im
            # HomePilot vermisst («Reinigungsweg ungewöhnlich»), sieht
            # hier, was der Sauger zu genau dieser Fahrt sagt.
            print(
                f"   Letzte Fahrt: vollständig="
                f"{'ja' if lauf.get('complete') else 'nein' if lauf.get('complete') is not None else '–'}"
                f"  Grund={lauf.get('reason', '–')}"
                f"  {lauf.get('area_m2', '–')} m²"
                f"  {lauf.get('minutes', '–')} min"
            )
        else:
            print("   Letzte Fahrt: noch keine seit dem Start des Hubs "
                  "nachgelesen (kommt nach der nächsten Reinigung).")
        print()

    probleme = sauger_probleme(sauger)
    print("Was davon eine Nachricht wäre:")
    if not probleme:
        print("   nichts – alles in Ordnung.")
    for _, schluessel, text in probleme:
        print(f"   {schluessel:<38} → {text}")

    rohdaten = daten()
    gemeldet = rohdaten.get("vacuum_notified") or []
    stunde = batterie.prefs_lesen(rohdaten.get("battery_prefs"))["hour"]
    print()
    print(f"Schon gemeldet ({len(gemeldet)}), erinnert täglich um {stunde} Uhr:")
    for zeile in gemeldet:
        if isinstance(zeile, dict):
            print(f"   {zeile.get('entity_id')}")
    if not gemeldet:
        print("   nichts.")

    # Wer die Kategorie abbestellt hat, bekommt nichts - das ist die
    # letzte der vier Stellen und von aussen die unsichtbarste.
    stumm = [
        str(eintrag.get("user"))
        for eintrag in rohdaten.get("push_prefs") or []
        if isinstance(eintrag, dict) and "vacuum" in (eintrag.get("muted") or [])
    ]
    print()
    print(f"Kategorie «{push.CATEGORIES.get('vacuum', 'vacuum')}»: "
          + (f"abbestellt von {', '.join(stumm)}" if stumm else "niemand hat sie abbestellt."))


if __name__ == "__main__":
    main()
