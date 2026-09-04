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
    # Läden für die Einkaufsliste: [{id, name, categories, zone}]. Die
    # Reihenfolge der Gänge gehört zum Laden, nicht zur Liste - im einen
    # kommt zuerst das Gemüse, im anderen die Getränke.
    "family_shops": [],
    # Zugriffsprotokoll: wer hat wann was geschaltet.
    "audit": [],
    # Verlauf der Ablauf-Läufe (jüngste zuerst) – überlebt den Neustart.
    "automation_runs": [],
    # Papierkorb für gelöschte Szenen und Abläufe.
    "trash": [],
    # Frühere Fassungen bearbeiteter Szenen und Abläufe (editversions.py) -
    # das Gegenstück zum Papierkorb fürs Überschreiben.
    "edit_versions": [],
    # Stundenstände des Stromzählers der letzten zwei Tage (energy.py) -
    # beantwortet «wann?», die Tageswerte nur «wie viel?».
    "energy_hours": [],
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
    # Kommen und Gehen der letzten Woche: [{person, state, place, at}],
    # jüngste zuerst. Beantwortet «seit wann weg» und «wann angekommen».
    # Bewusst begrenzt (presence.trim_history): Alles darüber hinaus wäre
    # ein Bewegungsprofil der Familie in einer Datei, die in die
    # Sicherung wandert.
    "presence_history": [],
    # Wann welcher Posten auf der Einkaufsliste stand: [{name, label,
    # at}]. Daraus entsteht der Rhythmus («Milch sonst alle 7 Tage»),
    # den die App als Vorschlag zeigt. Ein halbes Jahr, dann verfällt es.
    "shopping_log": [],
    # Eigene Ablauf-Vorlagen und ausgeblendete eingebaute: [{id, label,
    # icon, draft, hidden}] - siehe vorlagen.py. Der Entwurf gehört der
    # App; der Hub reicht ihn unverändert durch.
    "automation_templates": [],
    # Quittierte Widersprüche: [{key, by, at}] - siehe konflikte.py. Eine
    # geprüfte Zeile («ja, der eine schaltet ein, der andere später aus»)
    # verschwindet damit aus der Liste, statt die eine Zeile zu
    # verdecken, die wirklich falsch ist.
    "conflict_acks": [],
    # Papierkorb der Familienlisten: [{collection, at, by, name, item}].
    # Eigener Korb, nicht der von Szenen und Abläufen: Dort sucht
    # niemand nach einem gelöschten Rezept.
    "family_trash": [],
}


# Was einen Export nie verlassen darf.
#
# Nicht dasselbe wie «was eine Sicherung enthält»: Die Sicherung ist die
# Datei selbst und gehört auf eine Platte im Haus. Ein Export landet auf
# einem Telefon, in einer Mail, in einer Cloud - dorthin gehören weder
# Anmelde-Token noch offene Sitzungen noch das Zugriffsprotokoll.
#
# Bewusst eine Sperrliste und keine Erlaubnisliste: Wer künftig einen
# Schlüssel hinzufügt, soll ihn hier eintragen müssen, statt dass er
# stillschweigend mitgeht. Neue harmlose Listen erscheinen sofort im
# Export, neue heikle fallen auf.
SECRETS = frozenset(
    {
        "sessions",
        "push_devices",
        "audit",
        "alarm_pin",
        "hub_base",
        "emails",
        # Wer wann wo war, gehört niemandem ausser dem Haus - erst recht
        # nicht einer Datei, die in einer Mail landet.
        "presence_history",
    }
)


def strip_users(users: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Benutzer ohne alles, womit man sich anmelden könnte (rein, testbar).

    Wer im Haushalt lebt und was er darf, gehört zum eigenen Datenbestand
    und in den Export. Sein Token nicht: Damit wäre der Export ein
    Generalschlüssel, und ein Export liegt irgendwann in einer Mail.
    """
    sauber = []
    for user in users:
        ohne = {
            key: value
            for key, value in user.items()
            if key
            not in {"token", "password", "hash", "salt", "pin", "area_lock", "passwort"}
        }
        sauber.append(ohne)
    return sauber


## So lange nach einem Schreibvorgang werden weitere nur vorgemerkt.
#
# Der Wächter schreibt in einer Runde gern drei Listen nacheinander
# (Energie-Tage, Energie-Stunden, Ablauf-Verlauf) - und jede davon schrieb
# bisher die ganze Datei samt fsync neu. Eine Sekunde Sammelzeit macht
# daraus einen Schreibvorgang; verlieren kann ein harter Absturz damit
# höchstens diese eine Sekunde. Der geordnete Halt ruft flush().
FLUSH_DELAY = 1.0


class DataStore:
    def __init__(self, path: str | Path | None) -> None:
        # Ohne Pfad läuft alles nur im Speicher – so legen Tests und
        # programmatisch gebaute Hubs keine Dateien nebenher an.
        self.path = Path(path) if path else None
        self._data: dict[str, Any] = dict(EMPTY)
        self._dirty = False
        self._last_write = 0.0

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
        """Speichern - gesammelt statt bei jedem Aufruf.

        Der erste Aufruf schreibt sofort; was innerhalb von ``FLUSH_DELAY``
        danach kommt, wird nur vorgemerkt und von ``flush()`` nachgeholt
        (der Hub ruft es im Takt und beim Halt). So wird aus einem Schwall
        von drei ``set()`` ein einziger Schreibvorgang mit fsync.
        """
        if self.path is None:
            return
        self._dirty = True
        if time.monotonic() - self._last_write < FLUSH_DELAY:
            return
        self._write()

    def flush(self) -> None:
        """Vorgemerktes jetzt schreiben - beim Halt und im Takt des Hubs."""
        if self._dirty and self.path is not None:
            self._write()

    def _write(self) -> None:
        """Schreibt über eine temporäre Datei.

        Bei einem Stromausfall mitten im Schreiben bliebe sonst eine halbe
        Datei zurück – und der Hub käme ohne Benutzer wieder hoch.
        """
        if self.path is None:
            return
        self._dirty = False
        self._last_write = time.monotonic()
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

    def snapshot(self) -> dict[str, Any]:
        """Der ganze Datenbestand als Kopie – lesend, nicht änderbar.

        Für alles, was mehrere Listen auf einmal braucht (das
        Familienbuch etwa). Eine Kopie, damit ein Leser nicht
        versehentlich am Speicher des Hubs schreibt.
        """
        return dict(self._data)

    def family_book(self, stamp: str) -> Path | None:
        """Die Familiendaten als lesbare Seite neben die Sicherungen legen.

        Der Unterschied zur Sicherung ist nicht die Technik, sondern wer
        sie öffnen kann: Eine Sicherung braucht einen HomePilot, diese
        Seite braucht einen Browser. Genau dafür ist sie da - für den
        Tag, an dem es den Hub nicht mehr gibt und trotzdem noch jemand
        die Nummer der Kinderärztin sucht.

        Einmal im Monat genügt: Kontakte und Rezepte ändern sich in
        Wochen, nicht in Stunden.
        """
        from . import familienbuch

        folder = self._backup_dir()
        if folder is None:
            return None
        try:
            folder.mkdir(parents=True, exist_ok=True)
            ziel = folder / f"familienbuch-{stamp}.html"
            ziel.write_text(familienbuch.render(self._data, stamp), encoding="utf-8")
            os.chmod(ziel, 0o600)
            return ziel
        except OSError as err:
            log.warning("Familienbuch konnte nicht geschrieben werden: %s", err)
            return None

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

    def export(self) -> dict[str, Any]:
        """Der eigene Datenbestand als lesbare Struktur.

        Für den Knopf «alles als Datei»: Abläufe, Szenen, Familienlisten,
        Räume, Läden - was jemand über die Jahre eingerichtet hat, ohne
        dass er dafür an den Rechner muss. Es ist zugleich die Sicherung,
        die jeder versteht.

        Was fehlt, steht in `SECRETS` und im Kommentar dort.
        """
        daten = {
            key: value
            for key, value in self._data.items()
            if key not in SECRETS
        }
        daten["users"] = strip_users(daten.get("users", []))
        return daten

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
