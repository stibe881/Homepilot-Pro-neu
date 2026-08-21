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
import re
import tempfile
import time
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
    # In der App gesetzte Geräte-Metadaten: [{entity_id, name?, favorite?,
    # group?}] – für Umbenennen, Favoriten und Gruppen.
    "entity_meta": [],
    # Persönliche Oberflächen-Einstellungen: [{user, prefs}]. Der Inhalt
    # gehört der App (z.B. die Lesemarke der «Was ist neu»-Karte); der Hub
    # reicht ihn nur durch, damit jedes Gerät derselben Person dasselbe
    # zeigt.
    "user_prefs": [],
    # Wie das Haus für alle aussieht: ausgeblendete und gesperrte Geräte,
    # Kachel-Reihenfolgen, Widget-Knöpfe. Wie user_prefs, nur ohne Benutzer
    # - genau ein Eintrag [{prefs}]. Das ist der ganze Zweck: Wer etwas
    # anpasst, passt es für alle an, und ein neues Telefon findet die
    # Wohnung so vor, wie sie eingerichtet ist.
    #
    # Eine Liste mit einem Eintrag und kein blosses Objekt, weil der
    # DataStore Listen speichert - `get` gäbe von einem Objekt nur die
    # Schlüssel zurück.
    "house_prefs": [],
    # Zugriffsprotokoll: wer hat wann was geschaltet.
    "audit": [],
    # Verlauf der Ablauf-Läufe (jüngste zuerst) – überlebt den Neustart.
    "automation_runs": [],
    # Papierkorb für gelöschte Szenen und Abläufe.
    "trash": [],
    # Angemeldete Sitzungen (nur Hashwerte, siehe sessions.py).
    "sessions": [],
    # Anmelde-Adressen je Benutzer: [{name, email}]. Getrennt von den
    # Benutzern, damit auch die aus der config.yaml eine bekommen können.
    "emails": [],
    # Angemeldete Telefone für Push: [{token, user, label}]. Ohne das
    # wäre nach jedem Neustart des Hubs niemand mehr erreichbar, bis alle
    # ihre App wieder geöffnet haben - und genau dann, nach einem Update,
    # will man Nachrichten am wenigsten missen.
    "push_devices": [],
    # In der App zusammengefasste Leuchten: [{id, name, members, kind}].
    # Eine Deckenlampe mit fünf Spots ist ein Licht, nicht fünf.
    "light_groups": [],
    # Regeln für die eingebauten Wächter-Nachrichten: [{key, enabled,
    # params}] – siehe notifyrules.py. Was hier nicht steht, läuft mit
    # den Vorgaben.
    "notify_rules": [],
    # Gute-Nacht-Knopf: höchstens ein Eintrag {night_lights: [ids],
    # arm_alarm: bool}. Als Liste, weil der DataStore Listen verwaltet.
    "goodnight": [],
    # PIN fürs Entschärfen der Alarmanlage: höchstens ein Eintrag
    # {salt, hash} - die PIN selbst liegt nie im Klartext.
    "alarm_pin": [],
    # Zuletzt gesehene Hub-Adresse aus App-Anfragen: [{url}]. Damit
    # können Abläufe auch direkt nach einem Neustart durchsagen.
    "hub_base": [],
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

    def _backup_dir(self) -> Path | None:
        return self.path.parent / "backups" if self.path else None

    def backups(self) -> list[dict[str, Any]]:
        """Liste der vorhandenen Sicherungen, jüngste zuerst."""
        folder = self._backup_dir()
        if folder is None or not folder.exists():
            return []
        entries = []
        for file in folder.glob("homepilot-data-*.json"):
            try:
                stat = file.stat()
            except OSError:
                continue
            entries.append(
                {"name": file.name, "size": stat.st_size, "created": stat.st_mtime}
            )
        return sorted(entries, key=lambda entry: entry["created"], reverse=True)

    def backup(self, keep: int = 14) -> dict[str, Any] | None:
        """Schreibt eine datierte Kopie und behält die jüngsten ``keep``.

        Läuft täglich automatisch und lässt sich in der App auslösen. Ohne
        Datei-Pfad (Tests, In-Memory-Hub) passiert nichts.
        """
        folder = self._backup_dir()
        if folder is None:
            return None
        try:
            folder.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime("%Y-%m-%d_%H%M%S", time.localtime())
            target = folder / f"homepilot-data-{stamp}.json"
            # Zwei Sicherungen in derselben Sekunde (etwa die automatische
            # vor einem Zurückspielen) dürfen sich nicht überschreiben.
            counter = 2
            while target.exists():
                target = folder / f"homepilot-data-{stamp}-{counter}.json"
                counter += 1
            target.write_text(
                json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            os.chmod(target, 0o600)
            # Alte Sicherungen aufräumen – nur die jüngsten behalten.
            existing = sorted(
                folder.glob("homepilot-data-*.json"),
                key=lambda file: file.stat().st_mtime,
                reverse=True,
            )
            for stale in existing[keep:]:
                stale.unlink(missing_ok=True)
            log.info("Sicherung geschrieben: %s", target.name)
            return {"name": target.name, "created": target.stat().st_mtime}
        except OSError as err:
            log.error("Sicherung fehlgeschlagen: %s", err)
            return None

    def last_backup_age(self) -> float | None:
        """Alter der jüngsten Sicherung in Sekunden (None = gibt keine)."""
        entries = self.backups()
        if not entries:
            return None
        return max(0.0, time.time() - entries[0]["created"])

    def backup_bytes(self, name: str) -> bytes:
        """Den Inhalt einer Sicherung lesen - fürs Herunterladen.

        Der Name wird streng geprüft: Er kommt aus einer URL, und ohne
        Prüfung wäre das ein Fenster auf beliebige Dateien des Hubs.
        """
        return self._backup_file(name).read_bytes()

    def restore_backup(self, name: str) -> None:
        """Eine Sicherung zurückspielen.

        Der aktuelle Stand wird vorher selbst gesichert - ein Zurückspielen,
        das den letzten Stand vernichtet, wäre die falsche Rettungsleine.
        Danach braucht der Hub einen Neustart: Benutzer, Abläufe und Szenen
        werden beim Start aus der Datei aufgebaut.
        """
        file = self._backup_file(name)
        payload = json.loads(file.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Die Sicherung ist beschädigt (kein Objekt).")
        self.backup()
        self._data = payload
        self.save()

    def _backup_file(self, name: str) -> Path:
        folder = self._backup_dir()
        if folder is None:
            raise ValueError("Ohne Datei-Speicher gibt es keine Sicherungen.")
        if not re.fullmatch(r"homepilot-data-[A-Za-z0-9_.-]+\.json", name):
            raise ValueError(f"Unbekannte Sicherung: {name}")
        file = folder / name
        if not file.is_file():
            raise ValueError(f"Unbekannte Sicherung: {name}")
        return file
