"""Protokollzeilen als JSON – auf Wunsch.

«Zeig mir alle Fehler der Homematic-Integration der letzten Stunde»
heisst mit Fliesstext-Logs: grep und hoffen, dass die Meldung das Wort
enthält, das man rät. Als JSON-Zeilen ist es eine jq-Abfrage:

  docker logs homepilot | jq 'select(.logger | startswith("homepilot.integrations.homematic"))'

Eingeschaltet über die Umgebung, nicht die config.yaml:

  HOMEPILOT_LOG=json

Bewusst dort, weil es eine Eigenschaft des *Betriebs* ist, nicht des
Hauses – dieselbe config.yaml soll auf dem Rechner mit lesbaren Zeilen
und im Container mit JSON laufen können. Die Vorgabe bleibt Fliesstext:
Wer `docker logs` von Hand liest, soll keine Klammerwüste sehen müssen.
"""

from __future__ import annotations

import json
import logging
import os


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        zeile = {
            "at": round(record.created, 3),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            zeile["exception"] = self.formatException(record.exc_info)
        return json.dumps(zeile, ensure_ascii=False)


def wants_json() -> bool:
    """Ob der Betrieb JSON-Zeilen verlangt (rein bis auf die Umgebung)."""
    return os.environ.get("HOMEPILOT_LOG", "").strip().lower() == "json"


def configure(verbose: bool) -> None:
    """Die Wurzel-Protokollierung einrichten – Fliesstext oder JSON."""
    level = logging.DEBUG if verbose else logging.INFO
    if wants_json():
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        logging.basicConfig(level=level, handlers=[handler])
    else:
        logging.basicConfig(
            level=level,
            format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        )
