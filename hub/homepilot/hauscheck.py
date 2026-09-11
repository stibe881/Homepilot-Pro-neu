"""Ein Werkzeug statt fünf: prüf alles und sag, was auffällt.

Aufruf auf dem Docker-Host:
    docker exec homepilot-hub python -m homepilot.hauscheck

Punkt 491 der Werkbank. Es gibt fünf kleine Programme - ``storencheck``,
``livecheck``, ``tvcheck``, ``saugercheck``, ``pushcheck`` -, jedes mit
eigener Ausgabe und jedes einzeln aufzurufen. Wer im Haus steht und
*weiss*, woran es liegt, greift zum richtigen. Wer es nicht weiss - und
das ist der Normalfall, sonst würde man nicht prüfen -, braucht eines:
«prüf alles und sag mir, was auffällt».

Das hier baut die fünf nicht um. Es ruft sie der Reihe nach auf, genau
so, wie man es von Hand täte, und fasst zusammen. Zwei Entscheidungen
dahinter:

- **Die volle Ausgabe bleibt erreichbar.** Zusammengefasst wird für den
  ersten Blick; mit ``--lang`` steht alles da. Eine Zusammenfassung, die
  das Original ersetzt, wäre eine zweite Fassung derselben Auskunft -
  und genau die weicht irgendwann ab.
- **Was auffällt, entscheidet ein Wort und keine Bewertung.** Die
  Werkzeuge schreiben ihre Befunde in eigene Sätze; hier wird nur nach
  den Wörtern gesucht, an denen ein Mensch hängen bleibt. Ein
  Prüfprogramm, das selbst urteilt, ist eines, dem man nicht mehr
  glaubt, wenn es einmal danebenlag.

Meldet Python «No module named homepilot.hauscheck», läuft noch ein
altes Abbild - dann zuerst deploy/rebuild-hub.sh und in Portainer neu
deployen.
"""

from __future__ import annotations

import subprocess
import sys
from typing import Any

#: Die Werkzeuge in der Reihenfolge, in der man sie fragen würde.
#:
#: Erst das Haus (Storen, Push), dann die Geräte (TV, Sauger), zuletzt
#: das Langsamste: ``livecheck`` wartet auf einen Kamerastart und braucht
#: allein länger als die anderen vier zusammen.
WERKZEUGE: tuple[tuple[str, str], ...] = (
    ("storencheck", "Storen und Kontakte"),
    ("pushcheck", "Push-Meldungen und die Uhr"),
    ("tvcheck", "Fernseher-Karte"),
    ("saugercheck", "Saugroboter"),
    ("livecheck", "Kamera-Livebild"),
)

#: Woran ein Mensch beim Lesen hängen bleibt.
#:
#: Kleingeschrieben und als Wortteile gesucht: Die Werkzeuge schreiben
#: ihre Sätze frei, und eine Liste ganzer Sätze wäre nach der ersten
#: Umformulierung tot. Was hier steht, sind die Wörter, die in keiner
#: guten Ausgabe vorkommen.
AUFFAELLIG: tuple[str, ...] = (
    "fehler",
    "fehlgeschlagen",
    "nicht erreichbar",
    "keine antwort",
    "antwortet nicht",
    "veraltet",
    "abgelaufen",
    "leer",
    "kein token",
    "nicht konfiguriert",
    "warnung",
    "schief",
    "unbekannt",
)

#: So lange darf eines der Werkzeuge brauchen. Dieselbe Frist wie in der
#: Diagnose-Route (api/routes/diagnose.py) - livecheck ist das langsamste.
ZEITLIMIT = 120.0


def auffaellige_zeilen(text: str, woerter: tuple[str, ...] = AUFFAELLIG) -> list[str]:
    """Die Zeilen, an denen ein Mensch hängen bleibt (rein, testbar).

    Ohne Doppelte und in der Reihenfolge, in der sie standen: Wer die
    Zusammenfassung liest, soll sie in der vollen Ausgabe wiederfinden,
    ohne zu suchen.
    """
    gesehen: set[str] = set()
    raus: list[str] = []
    for zeile in (text or "").splitlines():
        sauber = zeile.strip()
        if not sauber or sauber in gesehen:
            continue
        tief = sauber.lower()
        if any(wort in tief for wort in woerter):
            gesehen.add(sauber)
            raus.append(sauber)
    return raus


def zusammenfassung(ergebnisse: list[dict[str, Any]]) -> list[str]:
    """Die Zeilen, die am Schluss stehen (rein, testbar).

    Je Werkzeug eine Zeile: sein Name, und was daran auffiel. Nichts
    Auffälliges ist auch eine Auskunft - «unauffällig» heisst, dass das
    Werkzeug lief und nichts fand, und das ist etwas anderes als eine
    Lücke.
    """
    zeilen: list[str] = []
    for eintrag in ergebnisse:
        name = str(eintrag.get("name") or eintrag.get("key") or "?")
        if eintrag.get("fehlt"):
            zeilen.append(f"  {name}: lief nicht ({eintrag['fehlt']})")
            continue
        treffer = eintrag.get("auffaellig") or []
        if not treffer:
            zeilen.append(f"  {name}: unauffällig")
            continue
        zeilen.append(f"  {name}: {len(treffer)} Zeile(n) zum Ansehen")
        for zeile in treffer[:3]:
            zeilen.append(f"      {zeile}")
    return zeilen


def _lauf(key: str) -> dict[str, Any]:
    try:
        fertig = subprocess.run(
            [sys.executable, "-m", f"homepilot.{key}"],
            capture_output=True,
            text=True,
            timeout=ZEITLIMIT,
        )
    except subprocess.TimeoutExpired:
        return {"key": key, "fehlt": f"nach {int(ZEITLIMIT)} s abgebrochen", "text": ""}
    except Exception as err:  # pragma: no cover - hängt an der Umgebung
        return {"key": key, "fehlt": str(err), "text": ""}
    text = (fertig.stdout or "") + (fertig.stderr or "")
    if fertig.returncode != 0 and not text.strip():
        return {"key": key, "fehlt": f"Rückgabewert {fertig.returncode}", "text": text}
    return {"key": key, "text": text, "auffaellig": auffaellige_zeilen(text)}


def main() -> None:
    lang = "--lang" in sys.argv[1:]
    print("HomePilot: Rundum-Prüfung\n")
    ergebnisse: list[dict[str, Any]] = []
    for key, name in WERKZEUGE:
        print(f"— {name} ({key}) …", flush=True)
        eintrag = _lauf(key)
        eintrag["name"] = name
        ergebnisse.append(eintrag)
        if lang:
            print(eintrag.get("text") or "  (keine Ausgabe)")
    print("\nWas auffällt:")
    for zeile in zusammenfassung(ergebnisse):
        print(zeile)
    if not lang:
        print(
            "\nDie volle Ausgabe eines Werkzeugs: "
            "docker exec homepilot-hub python -m homepilot.<name>"
            " - oder hier alles mit --lang."
        )
    # Ein Rückgabewert, an dem sich etwas festmachen lässt: Wer das aus
    # einem Skript aufruft, will nicht die Ausgabe lesen müssen.
    problematisch = any(
        eintrag.get("fehlt") or eintrag.get("auffaellig") for eintrag in ergebnisse
    )
    sys.exit(1 if problematisch else 0)


if __name__ == "__main__":
    main()
