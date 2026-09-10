"""Die Prüfwerkzeuge aus der App aufrufen (Punkt 344).

Fünf kleine Programme (``homepilot.storencheck``, ``livecheck``,
``tvcheck``, ``saugercheck``, ``pushcheck``) beantworten seit Längerem
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
