"""Was in der App angelegt wird, überlebt hier einen Neustart.

Bewusst eine JSON-Datei neben der Konfiguration und nicht Supabase: Der Hub
läuft absichtlich auch ohne Datenbank, und Benutzer und Automationen sind
genau das, was dann trotzdem erhalten bleiben muss.

Klare Trennung: Was in der ``config.yaml`` steht, gehört der Konfiguration
und ist in der App nur lesbar. Was in der App entsteht, liegt hier und ist
dort auch änderbar. Damit gibt es nie die Frage, wer wen überschreibt.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

EMPTY: dict[str, Any] = {
    "users": [],
    "automations": [],
    "scenes": [],
    # In der App gesetzte Raumzuordnungen: [{entity_id, room}]. Sie haben
    # Vorrang vor der config.yaml.
    "entity_rooms": [],
}


class DataStore:
    def __init__(self, path: str | Path | None) -> None:
        # Ohne Pfad läuft alles nur im Speicher – so legen Tests und
        # programmatisch gebaute Hubs keine Dateien nebenher an.
        self.path = Path(path) if path else None
        self._data: dict[str, Any] = dict(EMPTY)

    def load(self) -> dict[str, Any]:
        if self.path is None or not self.path.exists():
            return self._data
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as err:
            # Eine kaputte Datei darf den Hub nicht am Starten hindern.
            log.warning("Gespeicherte Daten in %s unlesbar: %s", self.path, err)
            return self._data
        self._data = {**EMPTY, **raw}
        log.info(
            "Gespeicherte Daten geladen: %d Benutzer, %d Automationen",
            len(self._data["users"]),
            len(self._data["automations"]),
        )
        return self._data

    def get(self, key: str) -> list[dict[str, Any]]:
        return list(self._data.get(key, []))

    def set(self, key: str, items: list[dict[str, Any]]) -> None:
        self._data[key] = list(items)
        self.save()

    def save(self) -> None:
        """Schreibt über eine temporäre Datei.

        Bei einem Stromausfall mitten im Schreiben bliebe sonst eine halbe
        Datei zurück – und der Hub käme ohne Benutzer wieder hoch.
        """
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=self.path.parent,
                prefix=self.path.name,
                suffix=".tmp",
                delete=False,
            ) as handle:
                json.dump(self._data, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
                temporary = handle.name
            os.replace(temporary, self.path)
            # Tokens stehen hier drin – niemand sonst muss sie lesen können.
            os.chmod(self.path, 0o600)
        except OSError as err:
            log.error("Konnte %s nicht speichern: %s", self.path, err)
