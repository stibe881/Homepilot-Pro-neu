"""Sprechen Hub und App noch dieselbe Sprache? - Punkt 233 der Werkbank.

app/src/api/types.ts beschreibt die Hub-Antworten, aber der Hub wusste
nichts davon: Wer im Hub ein Feld umbenannte, merkte es erst, wenn in der
App eine Kachel leer blieb. Dieser Test hält dagegen die Schlüsselmengen
der wichtigsten Antworten fest - gemessen an ECHTEN Antworten aus dem
Demo-Setup, nicht am OpenAPI-Baum, denn ohne response_model (und hier hat
keine Route eines) stünde dort nur ein leeres Schema. Begründung und
Routenwahl: tests/vertrag_erneuern.py.

Läuft ohne Netz in Sekunden. Wird er rot, gibt es genau zwei ehrliche
Auswege - und «die Erwartung lockern» ist keiner davon:

  1. Das Feld war ein Versehen: im Hub wiederherstellen.
  2. Die Änderung ist gewollt: app/src/api/types.ts (und die betroffenen
     Aufrufer in der App) nachführen und den Vertrag neu schreiben mit
         cd hub && python3 -m tests.vertrag_erneuern

Geprüft wird nur «kein festgehaltenes Feld verschwindet». Neue Felder
sind erlaubt, ohne dass der Test meckert - die App ignoriert Unbekanntes.
Sie wandern beim nächsten bewussten Neuschreiben in den Vertrag.
"""

import json

from .vertrag_erneuern import ROUTEN, VERTRAG_DATEI, erhebe

NACHFUEHREN = (
    "Ist die Änderung gewollt, gehören app/src/api/types.ts und die\n"
    "Erwartungsdatei nachgeführt: cd hub && python3 -m tests.vertrag_erneuern"
)


def test_hub_antworten_erfuellen_den_vertrag_der_app():
    erwartet = json.loads(VERTRAG_DATEI.read_text(encoding="utf-8"))
    gemessen = erhebe()

    fehler = []
    for route, pflichtfelder in sorted(erwartet.items()):
        if route not in gemessen:
            # Passiert nur, wenn jemand die Route aus ROUTEN streicht,
            # ohne den Vertrag neu zu schreiben.
            fehler.append(f"{route}: steht im Vertrag, wird aber nicht mehr gemessen")
            continue
        fehlend = sorted(set(pflichtfelder) - set(gemessen[route]))
        if fehlend:
            fehler.append(f"{route}: Feld(er) verschwunden: {', '.join(fehlend)}")

    assert not fehler, (
        "Der Hub bricht den Vertrag mit der App:\n  "
        + "\n  ".join(fehler)
        + "\n"
        + NACHFUEHREN
    )


def test_vertragsdatei_kennt_alle_gemessenen_routen():
    """Wer ROUTEN erweitert, muss den Vertrag neu schreiben - sonst prüfte
    die neue Route stumm gegen nichts."""
    erwartet = json.loads(VERTRAG_DATEI.read_text(encoding="utf-8"))
    neu = sorted(schluessel for schluessel, _ in ROUTEN if schluessel not in erwartet)
    assert not neu, (
        "Diese Routen werden gemessen, stehen aber nicht im Vertrag: "
        + ", ".join(neu)
        + "\n"
        + NACHFUEHREN
    )
