"""Ein Foto je Zimmer – für die Kacheln auf der Seite «Räume».

Die Raumkachel war eine Geräteliste: Name, Zustandszeile, bis zu sechs
Zeilen mit Schaltknopf. Vollständig und darum dicht - und man erkannte den
Raum erst, wenn man den Namen gelesen hatte. Mit einem Bild erkennt man
ihn davor.

**Warum als Datei und nicht in der homepilot-data.json.** Die Datendatei
wird bei jeder Änderung ganz geschrieben und bei jedem Start ganz
gelesen; ein halbes Dutzend Fotos darin machten aus einem Vorgang von
Millisekunden einen von Sekunden. Die Bilder liegen deshalb daneben, im
Ordner ``raumbilder`` - wie der Sprachvorrat (core/say.py) und die Token
der Integrationen.

**Warum der Dateiname ein Hash ist.** «Küche», «Büro/Werkstatt», ein
Zimmer mit Emoji im Namen - alles davon ist ein gültiger Raumname und
keins ein gültiger Dateiname. Der Hash geht dem aus dem Weg und bleibt
über Umbenennungen hinweg berechenbar. Wer ein Zimmer umbenennt, verliert
sein Bild; das ist die Stelle, an der man es ohnehin neu wählen würde.

**Was hier nicht steht: die Rechte.** Ein Raumbild gilt fürs ganze Haus,
und die Route verlangt dafür `edit_config` (siehe api/routes/raeume.py) -
dieselbe Fähigkeit wie fürs Umbenennen eines Geräts.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)

# Was die App schicken darf. JPEG ist der Normalfall (so kommt es aus der
# Kamera), PNG für Schnappschüsse, WebP für alles, was ein neueres
# Telefon von sich aus so ablegt.
TYPEN: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

# Obergrenze für ein einzelnes Bild. Die App verkleinert vorher auf 1200
# Punkte Breite - das sind 200 bis 400 KB. Zwei Megabyte lassen Luft für
# ein Telefon, dessen Verkleinern gescheitert ist, und sind immer noch
# weit von dem entfernt, was einen Hub ins Schwitzen brächte.
MAX_BYTES = 2_000_000

_DATA_URI = re.compile(r"^data:(?P<typ>[-\w.+/]+);base64,(?P<daten>.*)$", re.DOTALL)


class BildFehler(ValueError):
    """Was mit dem geschickten Bild nicht stimmt - im Klartext für die App."""


def ordner(data_file: str | None) -> Path | None:
    """Wo die Bilder liegen. Ohne Datendatei (Tests, Demo) auch kein Ort."""
    if not data_file:
        return None
    return Path(data_file).parent / "raumbilder"


def dateiname(room: str, suffix: str) -> str:
    """Der Dateiname zu einem Raum (rein, testbar).

    Ein Hash und keine Umschrift: «Büro/Werkstatt» wäre sonst ein Pfad,
    und ein Zimmer, das nur aus Emoji besteht, hätte gar keinen Namen.
    Gross- und Kleinschreibung zählt nicht mit - «Küche» und «küche» sind
    für den Menschen dasselbe Zimmer.
    """
    key = hashlib.sha256(room.strip().casefold().encode("utf-8")).hexdigest()[:16]
    return f"{key}{suffix}"


def entpacke(data_uri: str) -> tuple[bytes, str]:
    """Aus «data:image/jpeg;base64,…» werden Bytes und Endung (rein, testbar).

    Alle Fehler kommen als BildFehler mit einem Satz, den die App zeigen
    kann. Ein «400 Bad Request» ohne Begründung schickt sonst jemanden auf
    die Suche nach einem Fehler in seinem Telefon, obwohl bloss das Bild
    zu gross war.
    """
    treffer = _DATA_URI.match((data_uri or "").strip())
    if not treffer:
        raise BildFehler(
            "Das Bild muss als data-URI kommen, etwa «data:image/jpeg;base64,…»."
        )
    typ = treffer.group("typ").lower()
    if typ not in TYPEN:
        raise BildFehler(
            f"Bildformat '{typ}' wird nicht unterstützt - "
            f"möglich sind {', '.join(sorted(TYPEN))}."
        )
    try:
        daten = base64.b64decode(treffer.group("daten"), validate=True)
    except (binascii.Error, ValueError) as err:
        raise BildFehler("Das Bild liess sich nicht entschlüsseln.") from err
    if not daten:
        raise BildFehler("Das Bild ist leer.")
    if len(daten) > MAX_BYTES:
        raise BildFehler(
            f"Das Bild ist {len(daten) // 1000} KB gross - erlaubt sind "
            f"{MAX_BYTES // 1000} KB. Die App verkleinert normalerweise vorher."
        )
    return daten, TYPEN[typ]


def pfad(folder: Path, room: str) -> Path | None:
    """Die Datei dieses Raums, wenn es sie gibt.

    Sucht über alle erlaubten Endungen: Wer erst ein PNG und später ein
    JPEG wählt, soll nicht beide behalten.
    """
    for suffix in TYPEN.values():
        kandidat = folder / dateiname(room, suffix)
        if kandidat.is_file():
            return kandidat
    return None


def stand(folder: Path | None, raeume: list[str]) -> dict[str, int]:
    """Welcher Raum ein Bild hat, und von wann (Unix-Sekunden).

    Die Zeit reist mit, weil die App sie an die Bildadresse hängt: Ohne
    sie zeigte ein Telefon nach dem Wechseln wochenlang das alte Foto aus
    seinem Zwischenspeicher.
    """
    if folder is None or not folder.is_dir():
        return {}
    gefunden: dict[str, int] = {}
    for room in raeume:
        datei = pfad(folder, room)
        if datei is not None:
            try:
                gefunden[room] = int(datei.stat().st_mtime)
            except OSError:
                continue
    return gefunden


def schreiben(folder: Path, room: str, daten: bytes, suffix: str) -> None:
    """Das Bild ablegen - und die alte Fassung mitnehmen.

    Erst schreiben, dann die anderen Endungen wegräumen: Bricht es
    dazwischen ab, steht lieber ein Bild zu viel da als keines.
    """
    folder.mkdir(parents=True, exist_ok=True)
    ziel = folder / dateiname(room, suffix)
    ziel.write_bytes(daten)
    for andere in TYPEN.values():
        if andere == suffix:
            continue
        _still_weg(folder / dateiname(room, andere))


def loeschen(folder: Path | None, room: str) -> bool:
    """Das Bild eines Raums entfernen. True, wenn es eines gab."""
    if folder is None:
        return False
    weg = False
    for suffix in TYPEN.values():
        weg = _still_weg(folder / dateiname(room, suffix)) or weg
    return weg


def aufraeumen(folder: Path | None, raeume: list[str]) -> int:
    """Bilder zu Räumen, die es nicht mehr gibt, wegwerfen.

    Ein umbenanntes oder gelöschtes Zimmer liesse sonst sein Foto für
    immer liegen, und niemand sähe je nach. Gibt zurück, wie viele
    weggingen.
    """
    if folder is None or not folder.is_dir():
        return 0
    erlaubt = {
        dateiname(room, suffix) for room in raeume for suffix in TYPEN.values()
    }
    weg = 0
    for datei in folder.iterdir():
        if datei.is_file() and datei.name not in erlaubt:
            weg += 1 if _still_weg(datei) else 0
    return weg


def _still_weg(datei: Path) -> bool:
    """Löschen, ohne aufzufallen: Ein Bild ist eine Zugabe, kein Zustand."""
    try:
        datei.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError:
        log.warning("Raumbild %s liess sich nicht entfernen", datei.name)
        return False
