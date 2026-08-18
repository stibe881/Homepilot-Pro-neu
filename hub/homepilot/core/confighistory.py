"""Frühere Fassungen der config.yaml aufbewahren.

Der Editor in der App prüft zwar jede Änderung, bevor sie auf die Platte
kommt – gültig heisst aber nicht richtig. Wer eine Integration
herauslöscht oder eine Adresse verstellt, merkt es unter Umständen erst
Tage später, und dann fehlt der alte Wortlaut.

Deshalb landet vor jedem Speichern eine datierte Kopie neben der Datei.
Reine Textdateien von wenigen Kilobyte – zwanzig davon fallen nirgends
auf, und sie beantworten die Frage «was stand da vorher».
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# So viele Fassungen bleiben erhalten.
KEEP = 20
PREFIX = "config-"
SUFFIX = ".yaml"


def folder(config_path: str | Path) -> Path:
    return Path(config_path).parent / "config-history"


def snapshot(config_path: str | Path, content: str | None = None) -> dict[str, Any] | None:
    """Den aktuellen Stand wegschreiben, bevor er überschrieben wird.

    ``content`` erlaubt es, den bereits gelesenen Text mitzugeben; ohne ihn
    wird die Datei gelesen. Gibt es sie noch nicht, gibt es nichts zu
    sichern – das ist kein Fehler.
    """
    source = Path(config_path)
    if content is None:
        try:
            content = source.read_text(encoding="utf-8")
        except OSError:
            return None
    target_dir = folder(source)
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y-%m-%d_%H%M%S", time.localtime())
        target = target_dir / f"{PREFIX}{stamp}{SUFFIX}"
        # Zweimal in derselben Sekunde: die frühere Fassung gewinnt nicht,
        # aber verlieren soll auch keine – Zähler anhängen.
        counter = 2
        while target.exists():
            target = target_dir / f"{PREFIX}{stamp}-{counter}{SUFFIX}"
            counter += 1
        target.write_text(content, encoding="utf-8")
        os.chmod(target, 0o600)
        prune(source)
        return {"name": target.name, "created": target.stat().st_mtime}
    except OSError as err:
        # Eine misslungene Sicherung darf das Speichern nicht verhindern.
        log.warning("Konfigurations-Fassung nicht ablegbar: %s", err)
        return None


def prune(config_path: str | Path, keep: int = KEEP) -> None:
    entries = _files(config_path)
    for stale in entries[keep:]:
        stale.unlink(missing_ok=True)


def _files(config_path: str | Path) -> list[Path]:
    target_dir = folder(config_path)
    if not target_dir.is_dir():
        return []
    try:
        return sorted(
            target_dir.glob(f"{PREFIX}*{SUFFIX}"),
            key=lambda file: file.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        return []


def versions(config_path: str | Path) -> list[dict[str, Any]]:
    """Vorhandene Fassungen, jüngste zuerst."""
    rows = []
    for file in _files(config_path):
        try:
            stat = file.stat()
        except OSError:
            continue
        rows.append({"name": file.name, "size": stat.st_size, "created": stat.st_mtime})
    return rows


def read(config_path: str | Path, name: str) -> str:
    """Eine Fassung lesen. Der Name wird geprüft, damit niemand über
    ``../`` an andere Dateien kommt."""
    if not (name.startswith(PREFIX) and name.endswith(SUFFIX)) or "/" in name or ".." in name:
        raise ValueError("Unbekannte Fassung")
    target = folder(config_path) / name
    if not target.is_file():
        raise FileNotFoundError(name)
    return target.read_text(encoding="utf-8")
