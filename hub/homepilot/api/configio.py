"""config.yaml lesen und sicher schreiben.

Geteilt von den System-Routen (Editor in der App) und den
Lautsprecher-Routen (die eine gefundene Box in die Datei eintragen).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from ..core import config_edit, confighistory
from ..core.config import ConfigError, load_config
from ..core.hub import Hub
from ..core.users import parse_users

log = logging.getLogger(__name__)


def config_path(hub: Hub) -> str:
    path = hub.config.source_path
    if not path:
        raise HTTPException(
            status_code=503, detail="Der Hub wurde ohne Konfigurationsdatei gestartet"
        )
    return path



def save_config(hub: Hub, content: str) -> dict[str, Any]:
    path = Path(config_path(hub))
    temp = path.with_suffix(".tmp")
    try:
        temp.write_text(content, encoding="utf-8")
        candidate = load_config(temp)  # wirft ConfigError bei YAML-/Strukturfehlern
        # Auch die Benutzer-Regeln prüfen: Eine Konfiguration ohne
        # Besitzer würde den Editor selbst aussperren.
        parse_users(candidate.users, candidate.api.token)
    except ConfigError as err:
        temp.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(err)) from err
    except OSError as err:
        raise HTTPException(status_code=500, detail=f"Schreiben fehlgeschlagen: {err}") from err
    # Vorherige Fassung wegsichern, bevor sie überschrieben wird -
    # gültig heisst nicht richtig, und der alte Wortlaut ist dann weg.
    confighistory.snapshot(path)
    temp.replace(path)
    log.info("Konfiguration über die App gespeichert (%s)", path)
    # Diese Prüfungen liefen bisher nur beim Start ins Log – wer in der
    # App speicherte, sah eine doppelte Geräteadresse also erst nach dem
    # Neustart, wenn überhaupt. Sie brechen nichts ab: Eine Warnung ist
    # eine Warnung, kein Fehler.
    known = {entity.id for entity in hub.registry.all()}
    warnings = [
        *config_edit.duplicate_devices(candidate.integrations),
        *config_edit.unused_rooms(candidate.rooms, known),
    ]
    return {"ok": True, "restart_required": True, "warnings": warnings}

