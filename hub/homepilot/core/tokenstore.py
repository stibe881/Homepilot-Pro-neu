"""Die Token-Dateien der Integrationen - ein Umgang statt fünf.

Google, Ring, Overkiz, Roborock und Spotify legen je eine
``<name>-token.json`` neben die Datendatei. Jede Integration hatte sich
Pfad-Auflösung, Lesen und sicheres Schreiben selbst gebaut - fast gleich,
aber eben nur fast: mal mit chmod 600, mal ohne; mal atomar über eine
Temp-Datei, mal nicht. Hier steht der eine richtige Umgang, und die
Integrationen rufen ihn.

Alle diese Dateien stehen in der .gitignore und dürfen das Repository
nie erreichen (siehe CLAUDE.md).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def token_file(
    data_file: str | None, config: dict[str, Any] | None, name: str
) -> Path:
    """Wo die Token-Datei liegt: ``token_file`` aus dem Konfigurationsblock,
    sonst ``<name>-token.json`` neben der Datendatei."""
    if config and config.get("token_file"):
        return Path(str(config["token_file"]))
    return Path(data_file or "homepilot-data.json").parent / f"{name}-token.json"


def load(path: str | Path) -> dict[str, Any] | None:
    """Den Inhalt lesen - None, wenn die Datei fehlt oder kaputt ist.

    Kaputt heisst hier: neu anmelden. Ein harter Fehler beim Start würde
    den ganzen Hub aufhalten, wegen einer Datei, die nur eine Integration
    betrifft.
    """
    file = Path(path)
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def value(path: str | Path, key: str) -> str | None:
    """Einen einzelnen Wert lesen (etwa den refresh_token)."""
    data = load(path)
    if not data:
        return None
    wert = data.get(key)
    return str(wert) if wert else None


def save(path: str | Path, data: dict[str, Any]) -> None:
    """Sicher schreiben: atomar über eine Temp-Datei, nur für den Besitzer
    lesbar (die Datei ist ein Generalschlüssel für den jeweiligen Dienst)."""
    file = Path(path)
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(file)
