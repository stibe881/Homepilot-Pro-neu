"""Kamera-Clips, die bleiben: das Archiv mit Aufbewahrungsfrist.

Punkt 256 der Werkbank. Der Alarm-Mitschnitt (streams.record_clip) lebte
bisher nur im Schnappschuss-Speicher und war nach zehn Minuten weg -
genau dann, wenn man ihn der Polizei zeigen wollte, war er also schon
gelöscht. Hier landet er als Datei und bleibt, bis die Frist abläuft.

**Warum als Dateien und nicht in der homepilot-data.json.** Wie bei den
Raumbildern (core/raumbilder.py): Die Datendatei wird bei jeder Änderung
ganz geschrieben; ein paar Megabyte Video darin machten aus jedem
``set()`` einen Kraftakt. Die Clips liegen deshalb daneben, im Ordner
``cliparchiv`` - und damit auch ausserhalb des Repos (.gitignore deckt
das Datenverzeichnis).

**Warum eine Frist statt einer Grösse.** Die Frage an ein Alarmarchiv
ist «was war letzte Woche?», nicht «wie voll ist die Platte?». 14 Tage
als Vorgabe: lang genug, um nach den Ferien nachzusehen, kurz genug,
dass kein Bewegungsprofil des Hauses entsteht.

Je Clip liegt eine kleine JSON-Datei daneben (Kamera, Zeitpunkt, Anlass,
Raum): Die Metadaten müssen lesbar sein, ohne das Video anzufassen -
die Liste in der App zeigt zwanzig Einträge, spielt aber keinen davon.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Vorgabe der Aufbewahrung in Tagen - siehe Modulkopf.
FRIST_TAGE = 14
# Obergrenzen für die einstellbare Frist: Unter einem Tag wäre das Archiv
# keins, über einem Jahr ein Datenberg, den niemand je anschaut.
FRIST_MIN = 1
FRIST_MAX = 365

# Kennungen, die dieses Modul selbst vergibt. Die Routen prüfen dagegen,
# denn die Kennung kommt aus einer URL - ohne Prüfung wäre sie ein
# Fenster auf beliebige Dateien des Hubs.
KENNUNG = re.compile(r"[0-9]{8}-[0-9]{6}-[0-9a-f]{8}")


def ordner(data_file: str | None) -> Path | None:
    """Wo die Clips liegen: neben der Datendatei.

    Ohne Datendatei (Tests, Demo im Speicher) auch kein Archiv - dieselbe
    Bauart wie bei den Raumbildern und dem Sprachvorrat.
    """
    if not data_file:
        return None
    return Path(data_file).parent / "cliparchiv"


def frist_tage(rows: list[dict[str, Any]] | None) -> int:
    """Die eingestellte Aufbewahrung in Tagen (rein, testbar).

    Gespeichert als höchstens ein Eintrag [{retention_days}] im
    Datenspeicher; Unsinn fällt auf die Vorgabe zurück statt das Archiv
    stillschweigend sofort oder nie zu leeren.
    """
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        roh = row.get("retention_days")
        if not isinstance(roh, (int, float, str)):
            continue
        try:
            tage = int(roh)
        except ValueError:
            continue
        return max(FRIST_MIN, min(FRIST_MAX, tage))
    return FRIST_TAGE


def neue_kennung(jetzt: float | None = None) -> str:
    """Eine Kennung für einen neuen Clip.

    Der Zeitpunkt steht vorne, damit die Dateien im Ordner chronologisch
    sortieren; der Zufallsteil dahinter, damit zwei Alarme in derselben
    Sekunde einander nicht überschreiben.
    """
    moment = time.time() if jetzt is None else jetzt
    stempel = time.strftime("%Y%m%d-%H%M%S", time.localtime(moment))
    return f"{stempel}-{secrets.token_hex(4)}"


def eintrag(
    kennung: str,
    camera: str,
    anlass: str,
    jetzt: float,
    name: str | None = None,
    room: str | None = None,
    integration: str | None = None,
    groesse: int = 0,
) -> dict[str, Any]:
    """Die Metadaten zu einem Clip bauen (rein, testbar).

    Raum und Integration der Kamera reisen mit, obwohl sie sich aus der
    Kennung ergeben würden - aber nur, solange es die Kamera noch gibt.
    Ein Clip überlebt sein Gerät, und die Sichtbarkeitsprüfung
    (User.may_see) braucht beides auch dann noch.
    """
    return {
        "id": kennung,
        "camera": camera,
        "name": name or camera,
        "room": room,
        "integration": integration or camera.partition(".")[0],
        "anlass": anlass,
        "at": jetzt,
        "bytes": int(groesse),
    }


def abgelaufen(
    eintraege: list[dict[str, Any]], jetzt: float, tage: int
) -> list[str]:
    """Welche Clips die Frist hinter sich haben (rein, testbar).

    Ein Eintrag ohne lesbaren Zeitpunkt gilt als abgelaufen: Er ist
    kaputt, und ein Archiv, das Kaputtes ewig behält, räumt nie auf.
    """
    grenze = jetzt - max(1, int(tage)) * 86400
    weg: list[str] = []
    for meta in eintraege:
        wann = meta.get("at")
        if not isinstance(wann, (int, float)) or wann < grenze:
            kennung = str(meta.get("id") or "")
            if kennung:
                weg.append(kennung)
    return weg


def ablegen(folder: Path, data: bytes, meta: dict[str, Any]) -> dict[str, Any] | None:
    """Einen Clip samt Metadaten ins Archiv legen.

    Erst das Video, dann die Metadaten: Die Liste liest nur die
    JSON-Dateien - bricht es dazwischen ab, liegt schlimmstenfalls ein
    Video ohne Eintrag herum (der Aufräumlauf nimmt es mit), aber nie
    ein Eintrag, dessen Video fehlt.

    Still bei jedem Fehler: Das Archiv ist eine Zugabe zum Alarm, keine
    Voraussetzung - eine volle Platte darf keinen Alarm aufhalten.
    """
    kennung = str(meta.get("id") or "")
    if not KENNUNG.fullmatch(kennung):
        return None
    try:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{kennung}.mp4").write_bytes(data)
        (folder / f"{kennung}.json").write_text(
            json.dumps({**meta, "bytes": len(data)}, ensure_ascii=False),
            encoding="utf-8",
        )
        return {**meta, "bytes": len(data)}
    except OSError as err:
        log.warning("Clip %s liess sich nicht archivieren: %s", kennung, err)
        return None


def liste(folder: Path | None) -> list[dict[str, Any]]:
    """Alle archivierten Clips, jüngste zuerst."""
    if folder is None or not folder.is_dir():
        return []
    eintraege: list[dict[str, Any]] = []
    for datei in folder.glob("*.json"):
        try:
            meta = json.loads(datei.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(meta, dict) and meta.get("id"):
            eintraege.append(meta)
    eintraege.sort(key=lambda meta: meta.get("at") or 0, reverse=True)
    return eintraege


def metadaten(folder: Path | None, kennung: str) -> dict[str, Any] | None:
    """Die Metadaten eines einzelnen Clips - None, wenn es ihn nicht gibt."""
    if folder is None or not KENNUNG.fullmatch(kennung):
        return None
    try:
        meta = json.loads((folder / f"{kennung}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return meta if isinstance(meta, dict) else None


def lesen(folder: Path | None, kennung: str) -> bytes | None:
    """Das Video zu einer Kennung - None, wenn es (nicht mehr) da ist."""
    if folder is None or not KENNUNG.fullmatch(kennung):
        return None
    try:
        return (folder / f"{kennung}.mp4").read_bytes()
    except OSError:
        return None


def loeschen(folder: Path | None, kennung: str) -> bool:
    """Einen Clip samt Metadaten entfernen. True, wenn es einen gab."""
    if folder is None or not KENNUNG.fullmatch(kennung):
        return False
    weg = False
    for suffix in (".mp4", ".json"):
        try:
            (folder / f"{kennung}{suffix}").unlink()
            weg = True
        except FileNotFoundError:
            continue
        except OSError as err:
            log.warning("Clip-Datei %s%s liess sich nicht löschen: %s", kennung, suffix, err)
    return weg


def aufraeumen(folder: Path | None, jetzt: float, tage: int) -> int:
    """Abgelaufene Clips entfernen. Gibt zurück, wie viele weggingen.

    Nimmt auch Videos ohne Metadaten mit (halb geschriebene Ablage, von
    Hand gelöschte JSON): Ein Archiv, in dem herrenlose Dateien liegen
    bleiben, füllt die Platte, ohne dass es je jemand in einer Liste sieht.
    """
    if folder is None or not folder.is_dir():
        return 0
    weg = 0
    for kennung in abgelaufen(liste(folder), jetzt, tage):
        weg += 1 if loeschen(folder, kennung) else 0
    try:
        bekannt = {datei.stem for datei in folder.glob("*.json")}
        grenze = jetzt - max(1, int(tage)) * 86400
        for datei in folder.glob("*.mp4"):
            if datei.stem in bekannt:
                continue
            try:
                if datei.stat().st_mtime < grenze:
                    datei.unlink(missing_ok=True)
                    weg += 1
            except OSError:
                continue
    except OSError:
        pass
    return weg


def aufraeumen_lauf(hub: Any) -> int:
    """Der Aufräumlauf für den Wächter-Takt - alles an einer Stelle.

    Bewusst ein einziger Aufruf ohne eigene Schleife: Der Wächter läuft
    ohnehin im Minutentakt (core/watchdog.py), und ein Verzeichnis mit
    einer Handvoll Dateien zu lesen kostet nichts. Ein eigener Zeitplan
    wäre nur eine zweite Uhr, die jemand warten müsste.
    """
    folder = ordner(hub.config.data_file)
    tage = frist_tage(hub.data.get("cliparchiv"))
    weg = aufraeumen(folder, time.time(), tage)
    if weg:
        log.info("Clip-Archiv aufgeräumt: %d Clips älter als %d Tage", weg, tage)
    return weg
