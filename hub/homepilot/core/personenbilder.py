"""Ein Foto je Person – für «Wer ist da» auf dem Wandpanel und am Telefon.

Punkt 415 der Werkbank: Die Anwesenheitsliste zeigte bisher ein Symbol
(«person» oder «person-outline») und einen Namen. Ein Gesicht erkennt man
schneller als einen Namen liest, besonders von der anderen Seite der
Küche aus.

Dieselbe Mechanik wie bei den Raumbildern (``core/raumbilder.py``) - nur
mit dem Namen einer Person statt eines Zimmers als Schlüssel, und einem
eigenen Ordner, damit ein Zimmer und eine Person mit demselben Namen sich
nicht dasselbe Bild teilen («Küche» als Zimmer, «Küche» als Katzenname).
Das eigentliche Rechnen - Hashen, Entpacken, Schreiben, Aufräumen - macht
weiter ``raumbilder``: Es kennt den Unterschied zu einer Person nicht,
weil es keinen gibt. Nur der Ordner ist ein anderer.
"""

from __future__ import annotations

from pathlib import Path

from .raumbilder import (  # noqa: F401
    MAX_BYTES,
    TYPEN,
    BildFehler,
    aufraeumen,
    dateiname,
    entpacke,
    loeschen,
    pfad,
    schreiben,
    stand,
)


def ordner(data_file: str | None) -> Path | None:
    """Wo die Personenbilder liegen. Ohne Datendatei (Tests, Demo) auch kein Ort."""
    if not data_file:
        return None
    return Path(data_file).parent / "personenbilder"
