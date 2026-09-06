"""Standbilder vom Alarmmoment - das Archiv fürs Ereignisblatt.

Die Bilder, die einer Alarm-Nachricht beiliegen, leben zehn Minuten im
Speicher (core/snapshots.py) - für die Nachricht genau richtig, für die
Frage «was war da eigentlich?» am nächsten Morgen zu kurz. Ein
Live-Standbild beim Öffnen des Blatts wäre schlimmer als keines: Es
zeigte das Wohnzimmer von jetzt, nicht vom Einbruch.

Also dasselbe Muster wie beim Clip-Archiv (core/cliparchiv.py), dessen
Kennungen, Metadaten und Fristen hier wiederverwendet werden: Dateien
neben der Datendatei, eine kleine JSON daneben, Aufräumen im
Wächter-Takt. Es gilt dieselbe Aufbewahrungsfrist wie für die Clips -
Bild und Mitschnitt desselben Alarms sollen gemeinsam verschwinden,
nicht einzeln.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from . import cliparchiv

log = logging.getLogger(__name__)

# Die Kennungen kommen aus cliparchiv.neue_kennung; geprüft wird gegen
# dasselbe Muster - eine Kennung aus einer URL ist sonst ein Fenster auf
# beliebige Dateien des Hubs.
KENNUNG = cliparchiv.KENNUNG


def ordner(data_file: str | None) -> Path | None:
    if not data_file:
        return None
    return Path(data_file).parent / "bildarchiv"


def _endung(daten: bytes) -> str:
    return "png" if daten.startswith(b"\x89PNG") else "jpg"


def ablegen(
    folder: Path | None, daten: bytes, meta: dict[str, Any]
) -> dict[str, Any] | None:
    """Ein Standbild samt Metadaten ins Archiv legen.

    Erst das Bild, dann die Metadaten - und still bei jedem Fehler: Das
    Archiv ist eine Zugabe zum Alarm, keine Voraussetzung.
    """
    kennung = str(meta.get("id") or "")
    if folder is None or not daten or not KENNUNG.fullmatch(kennung):
        return None
    try:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{kennung}.{_endung(daten)}").write_bytes(daten)
        eintrag = {**meta, "bytes": len(daten)}
        (folder / f"{kennung}.json").write_text(
            json.dumps(eintrag, ensure_ascii=False), encoding="utf-8"
        )
        return eintrag
    except OSError as err:
        log.warning("Bild %s liess sich nicht archivieren: %s", kennung, err)
        return None


def liste(folder: Path | None) -> list[dict[str, Any]]:
    """Alle archivierten Bilder, jüngste zuerst."""
    if folder is None or not folder.is_dir():
        return []
    eintraege: list[dict[str, Any]] = []
    try:
        for datei in folder.glob("*.json"):
            try:
                meta = json.loads(datei.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(meta, dict) and meta.get("id"):
                eintraege.append(meta)
    except OSError:
        return []
    eintraege.sort(key=lambda meta: float(meta.get("at") or 0), reverse=True)
    return eintraege


def lesen(folder: Path | None, kennung: str) -> bytes | None:
    if folder is None or not KENNUNG.fullmatch(kennung):
        return None
    for endung in ("jpg", "png"):
        datei = folder / f"{kennung}.{endung}"
        try:
            if datei.is_file():
                return datei.read_bytes()
        except OSError:
            return None
    return None


def fenster(
    eintraege: list[dict[str, Any]], von: float, bis: float
) -> list[dict[str, Any]]:
    """Die Einträge eines Zeitfensters, älteste zuerst (rein, testbar)."""
    treffer = [
        meta
        for meta in eintraege
        if isinstance(meta.get("at"), (int, float)) and von <= meta["at"] <= bis
    ]
    return sorted(treffer, key=lambda meta: float(meta["at"]))


def aufraeumen(folder: Path | None, jetzt: float, tage: int) -> int:
    """Abgelaufene Bilder entfernen - dieselbe Regel wie bei den Clips."""
    if folder is None or not folder.is_dir():
        return 0
    weg = 0
    for kennung in cliparchiv.abgelaufen(liste(folder), jetzt, tage):
        for endung in ("jpg", "png", "json"):
            try:
                (folder / f"{kennung}.{endung}").unlink(missing_ok=True)
            except OSError:
                continue
        weg += 1
    return weg


def aufraeumen_lauf(hub: Any) -> int:
    """Der Aufräumlauf für den Wächter-Takt - wie cliparchiv.aufraeumen_lauf."""
    folder = ordner(hub.config.data_file)
    tage = cliparchiv.frist_tage(hub.data.get("cliparchiv"))
    weg = aufraeumen(folder, time.time(), tage)
    if weg:
        log.info("Bild-Archiv aufgeräumt: %d Bilder älter als %d Tage", weg, tage)
    return weg
