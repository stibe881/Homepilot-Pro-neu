"""Die Prüfwerkzeuge aus der App aufrufen (Punkt 344).

Fünf kleine Programme (``homepilot.storencheck``, ``livecheck``,
``tvcheck``, ``saugercheck``, ``pushcheck``) und seit Punkt 491 eines,
das alle fünf ruft (``hauscheck``), beantworten seit Längerem
schon «warum zeigt das Gateway eine alte Stellung», «warum braucht das
Live-Bild so lange» und ähnliche Fragen aus der Werkbank-Tabelle - aber
nur, wer eine Kommandozeile *im Container* hat (``docker exec
homepilot-hub python -m homepilot.pushcheck``). Für alle anderen war die
Auskunft da, aber unerreichbar.

Diese Route baut die Werkzeuge nicht um. Jedes liest schon heute Token
und Host aus derselben Konfiguration, mit der der Hub selbst läuft
(``/config/config.yaml``, ``/config/homepilot-data.json`` -
``token_und_port()`` in ``storencheck.py``), und spricht den eigenen
Hub über HTTP an wie jeder andere Client. Ein zweiter, In-Prozess-Pfad
mit eigenem Datenzugriff wäre eine zweite Fassung derselben Logik, die
über kurz oder lang von der ersten abweicht. Stattdessen startet die
Route dasselbe Programm noch einmal, als Unterprozess im selben
Container - genau das, was ``docker exec`` auch tut, nur von innen -,
und reicht dessen Textausgabe unverändert weiter. Wer das Werkzeug vom
Terminal aus kennt, sieht in der App wortwörtlich dasselbe.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from typing import Any

from fastapi import FastAPI, HTTPException, Request

from ...core.users import Capability
from ..context import ApiContext

log = logging.getLogger(__name__)

#: Werkzeug → (Satz für die App, erlaubte zusätzliche Flags).
#:
#: Eine Allowlist statt freier Flags: Die App soll «--funk» und «--kalt»
#: anfragen können (dieselben Sonderläufe, die die Werkbank-Tabelle
#: nennt), aber nicht irgendeinen Text an einen Unterprozess reichen, den
#: der Hub selbst startet.
WERKZEUGE: dict[str, dict[str, Any]] = {
    # Zuerst das eine, das alle fragt (Punkt 491 der Werkbank): Wer im
    # Haus steht und *weiss*, woran es liegt, greift zum richtigen der
    # fünf. Wer es nicht weiss - und das ist der Normalfall, sonst würde
    # man nicht prüfen -, braucht dieses hier.
    "hauscheck": {
        "satz": "Alles auf einmal prüfen und sagen, was auffällt.",
        "flags": {"lang": "--lang"},
    },
    "storencheck": {
        "satz": "Storen und Kontakte: was der Hub meint, was das Gateway roh meldet.",
        "flags": {"funk": "--funk"},
    },
    "livecheck": {
        "satz": "Warum ein Kamera-Livebild lange braucht.",
        "flags": {"kalt": "--kalt"},
    },
    "tvcheck": {
        "satz": "Warum eine Fernseher-Karte auf dem Sperrbildschirm liegen bleibt.",
        "flags": {},
    },
    "saugercheck": {
        "satz": "Warum eine Sauger-Meldung nicht als Push ankommt.",
        "flags": {},
    },
    "pushcheck": {
        "satz": "Ob eine Push-Meldung zu spät kam oder erst das Ereignis.",
        "flags": {},
    },
}

#: Grosszügig, aber nicht endlos: livecheck --kalt wartet auf einen
#: kalten Kamerastart und ist damit das langsamste der fünf Werkzeuge.
ZEITLIMIT = 120.0


def register(app: FastAPI, ctx: ApiContext) -> None:
    require = ctx.require

    @app.get("/api/diagnose")
    async def diagnose_liste(request: Request) -> dict[str, Any]:
        """Welche Werkzeuge es gibt, mit ihrem Satz und ihren Sonderläufen."""
        require(request, Capability.EDIT_CONFIG)
        return {
            "werkzeuge": [
                {"key": key, "satz": eintrag["satz"], "flags": list(eintrag["flags"])}
                for key, eintrag in WERKZEUGE.items()
            ]
        }

    @app.get("/api/diagnose/ablage")
    async def diagnose_ablage(request: Request) -> dict[str, Any]:
        """Wie gross die Datendatei ist - und welche Sammlung sie füllt.

        Punkt 426 der Werkbank: Abläufe, Verlauf, Familienlisten und das
        Zugriffsprotokoll liegen in *einer* Datei, die bei jedem
        Schreiben ganz gelesen und ganz geschrieben wird. Die
        Platten-Warnung meldet, wenn es zu spät ist; hier steht die Zahl
        davor.

        Steht vor der Werkzeug-Route, sonst hielte die diese Adresse für
        ein Werkzeug namens «ablage».
        """
        require(request, Capability.EDIT_CONFIG)
        zeilen = ctx.hub.data.umfang()
        return {
            "datei_bytes": ctx.hub.data.datei_bytes(),
            "sammlungen": zeilen,
            # Die Summe der Sammlungen liegt unter der Dateigrösse (JSON
            # braucht Klammern und Namen) - beides steht da, damit
            # niemand die Differenz für einen Fehler hält.
            "summe_bytes": sum(int(zeile["bytes"]) for zeile in zeilen),
        }

    @app.get("/api/diagnose/{werkzeug}")
    async def diagnose_lauf(werkzeug: str, request: Request, flag: str = "") -> dict[str, Any]:
        """Das Werkzeug laufen lassen und seine Textausgabe zurückgeben.

        Besitzer-Ebene (``edit_config``, dieselbe wie für Update und
        Neustart): Die Ausgabe nennt Token-Stände und rohe Gerätezustände
        - eine Auskunft für alle im Haus wäre hier zu viel.
        """
        require(request, Capability.EDIT_CONFIG)
        eintrag = WERKZEUGE.get(werkzeug)
        if eintrag is None:
            raise HTTPException(status_code=404, detail=f"Unbekanntes Werkzeug: {werkzeug}")
        befehl = [sys.executable, "-m", f"homepilot.{werkzeug}"]
        if flag:
            zusatz = eintrag["flags"].get(flag)
            if zusatz is None:
                moeglich = ", ".join(sorted(eintrag["flags"])) or "keine"
                raise HTTPException(
                    status_code=400,
                    detail=f"«{flag}» kennt {werkzeug} nicht - möglich: {moeglich}.",
                )
            befehl.append(zusatz)
        try:
            prozess = await asyncio.create_subprocess_exec(
                *befehl,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except OSError as err:
            raise HTTPException(
                status_code=500, detail=f"{werkzeug} liess sich nicht starten: {err}"
            ) from err
        try:
            ausgabe, _ = await asyncio.wait_for(prozess.communicate(), timeout=ZEITLIMIT)
        except TimeoutError:
            prozess.kill()
            raise HTTPException(
                status_code=504,
                detail=f"{werkzeug} antwortete nicht innert {int(ZEITLIMIT)} Sekunden.",
            ) from None
        text = ausgabe.decode("utf-8", errors="replace")
        if prozess.returncode != 0:
            log.warning("%s endete mit Code %s", werkzeug, prozess.returncode)
        return {"text": text, "exit_code": prozess.returncode}
