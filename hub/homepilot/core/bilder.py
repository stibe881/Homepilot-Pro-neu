"""Bilder aus der App neben die Daten legen statt hinein.

Elf Rezepte mit Fotos sind gut ein Megabyte, und alle liegen in
`hub.data` – bei jedem Öffnen der Familienseite geht das komplett über
die Leitung, jedes Mal neu. Bei fünfzig Rezepten wird das spürbar, und
zwar genau dort, wo man es am wenigsten will: beim Kochen mit
schwachem WLAN in der Küche.

Deshalb: Das Bild kommt als data-URI herein, wird einmal auf die Platte
geschrieben und danach unter einer eigenen Adresse ausgeliefert. Der
Browser und das Telefon dürfen es zwischenspeichern – der Dateiname
trägt einen Fingerabdruck, ein neues Bild ist also eine neue Adresse
und kein veralteter Cache.

Hier steht nur das Rechnen; wer schreibt und ausliefert, ist
api/routes/family.py.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import re
from typing import Any

# Was wir annehmen. Bewusst kurz: Alles, was die App aufnimmt, wird
# vorher zu JPEG verkleinert; PNG kommt aus dem Netz-Import.
TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

# Obergrenze je Bild. Ein verkleinertes Foto sind ein paar hundert
# Kilobyte; vier Megabyte lassen Luft und verhindern, dass ein Fehlgriff
# die Datenpartition füllt.
MAX_BYTES = 4 * 1024 * 1024

DATA_URI = re.compile(r"^data:([\w/+.-]+);base64,(.*)$", re.S)
# Kennungen kommen aus der URL – ohne Prüfung wäre das ein Fenster auf
# beliebige Dateien des Hubs.
SAFE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


def decode_data_uri(value: Any) -> tuple[bytes, str] | None:
    """«data:image/jpeg;base64,…» → (Bytes, Endung) (rein, testbar).

    None bei allem anderen – auch bei einer schon fertigen Adresse. So
    lässt sich dieselbe Funktion bei jedem Speichern aufrufen, ohne
    vorher zu unterscheiden.
    """
    text = str(value or "")
    treffer = DATA_URI.match(text.strip())
    if not treffer:
        return None
    endung = TYPES.get(treffer.group(1).lower())
    if endung is None:
        return None
    try:
        roh = base64.b64decode(treffer.group(2), validate=False)
    except (binascii.Error, ValueError):
        return None
    if not roh or len(roh) > MAX_BYTES:
        return None
    return roh, endung


def fingerprint(payload: bytes) -> str:
    """Kurzer Fingerabdruck fürs Zwischenspeichern (rein, testbar)."""
    return hashlib.sha256(payload).hexdigest()[:12]


def safe_id(value: Any) -> str | None:
    """Eine Kennung, die als Dateiname taugen darf (rein, testbar)."""
    text = str(value or "").strip()
    return text if SAFE_ID.fullmatch(text) else None


def media_type(name: str) -> str:
    """Aus der Dateiendung den Typ (rein, testbar)."""
    endung = name.rsplit(".", 1)[-1].lower()
    for typ, kurz in TYPES.items():
        if kurz == endung and typ != "image/jpg":
            return typ
    return "application/octet-stream"
