"""Was in der App angelegt wird, überlebt hier einen Neustart.

Bewusst eine JSON-Datei neben der Konfiguration und nicht Supabase: Der Hub
läuft absichtlich auch ohne Datenbank, und Benutzer und Automationen sind
genau das, was dann trotzdem erhalten bleiben muss.

Klare Trennung: Was in der ``config.yaml`` steht, gehört der Konfiguration
und ist in der App nur lesbar. Was in der App entsteht, liegt hier und ist
dort auch änderbar. Damit gibt es nie die Frage, wer wen überschreibt.
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import tarfile
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
    # Welche Storen die Wächter anfassen dürfen: höchstens ein Eintrag
    # {storm: [ids], heat: [ids]}. Leere Liste heisst alle Storen -
    # siehe core/storenwaechter.py.
    "cover_guard": [],
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
    # Gutscheine der Familie (Punkt 264 der Werkbank): [{id, author,
    # created, shop, title, unit, total, left, number, pin, expires,
    # category, shared, url, image_url, transactions, notes}] - siehe
    # core/gutscheine.py. Bewusst *nicht* in SECRETS, obwohl Nummer und
    # PIN darin stehen: Der Export ist die Sicherung, die die Familie
    # für sich selbst macht, und ein Gutschein, der mit dem Hub
    # verlorengeht, ist verlorenes Geld. Was hingegen die anderen im
    # Haus sehen, regelt «shared» je Eintrag - in den Routen, nicht hier.
    "family_vouchers": [],
    # Erinnerungsstufen der Gutscheine: höchstens ein Eintrag
    # {first_days, second_days} - siehe gutscheine.PREFS_KEY. Als Liste,
    # weil der DataStore Listen verwaltet.
    "voucher_prefs": [],
    # Der Anrufbeantworter des Hauses (Punkt 259 der Werkbank): höchstens
    # ein Eintrag {wer, zone, speakers, volume, typ, at} - siehe
    # heimgruss.py. Der Ton selbst liegt als Datei daneben, nicht hier:
    # Zwei Megabyte Opus gehören nicht in eine JSON-Datei, die bei jedem
    # Schreiben ganz auf die Platte geht.
    "heimgruss": [],
    # Schon gemeldete Sauger-Probleme (Punkt 263 der Werkbank). Gleiche
    # Zeilenform wie die Batterien, damit dieselben reinen Funktionen
    # rechnen: {entity_id: «gerät:quelle:wert», at, until}.
    "vacuum_notified": [],
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


# ── Was neben der Datendatei liegt und mit in die Sicherung gehört ─────────
#
# Punkt 593 der Werkbank: Gesichert wurde nur die homepilot-data.json.
# Der Hub besteht aber aus einem Dutzend Dateien daneben - Gutschein-PDFs,
# Rezept-, Personen- und Raumbilder, der Grundriss, der Anrufbeantworter,
# die Token-Dateien von Google, Spotify, Ring und Roborock, die
# config.yaml samt secrets.env und ihrer Geschichte. Nach einem
# Plattenschaden zeigten Gutscheine ins Leere, und vier Dienste wollten
# neu angemeldet werden.
#
# Eine Erlaubnisliste, keine Sperrliste - mit Absicht: Ohne data_file in
# der config.yaml liegt die Datendatei neben ihr, und in der Entwicklung
# ist das der Quellordner mit dem ganzen Baum. «Alles ausser …» hätte den
# in die Sicherung gepackt. Wer einen neuen Ordner neben die Daten legt,
# trägt ihn hier ein; ein Test (test_sicherung_tar.py) hält die Liste
# gegen die Module, die solche Ordner anlegen.
BEILAGEN_ORDNER: tuple[str, ...] = (
    "gutscheindateien",
    "gutscheinbilder",
    "rezeptbilder",
    "personenbilder",
    "raumbilder",
    "grundriss",
    "config-history",
)
BEILAGEN_DATEIEN: tuple[str, ...] = (
    "geraete-verlauf.json",
    "heimgruss.ton",
    "config.yaml",
    "secrets.env",
)
#: Token-Dateien der Integrationen (core/tokenstore.py, Spotify).
BEILAGEN_MUSTER: tuple[str, ...] = ("*-token.json",)
#: Bewusst nicht dabei: backups/ (die Sicherung selbst), cliparchiv/ und
#: bildarchiv/ (Alarm-Mitschnitte mit eigener Frist, gross), say-cache/
#: (Zwischenspeicher), matter/ (hat sein eigenes Tar, Punkt 53) und
#: log-uebergabe.json (der Log-Ring des letzten Laufs).

#: So heisst die Datendatei im Archiv - fest, damit restore_backup sie
#: findet, egal wie die Datei auf der Platte heisst.
ARCHIV_DATENDATEI = "homepilot-data.json"

#: Wie eine Sicherung heissen darf. Der Name kommt aus einer URL oder
#: einem Upload - ohne Prüfung wäre das ein Fenster auf beliebige Dateien.
SICHERUNGSNAME = r"homepilot-data-[A-Za-z0-9_.-]+\.(?:json|tar\.gz)"


def beilagen(data_dir: Path | None, config_dir: Path | None = None) -> list[tuple[Path, str]]:
    """Welche Dateien neben der Datendatei in die Sicherung gehören - als
    (Pfad, Name im Archiv). Rein bis aufs Lesen des Verzeichnisses.

    Die Konfiguration kommt aus ihrem eigenen Ordner, wenn er ein anderer
    ist; im Archiv liegt trotzdem alles flach nebeneinander, so wie es im
    Container auch liegt (/config). Beim Zurückspielen landet sie wieder
    dort, wo sie herkam.
    """
    gefunden: list[tuple[Path, str]] = []
    gesehen: set[str] = set()

    def aufnehmen(datei: Path, arcname: str) -> None:
        if arcname in gesehen or not datei.is_file():
            return
        gesehen.add(arcname)
        gefunden.append((datei, arcname))

    def ordner_aufnehmen(wurzel: Path, name: str) -> None:
        ordner = wurzel / name
        if not ordner.is_dir():
            return
        for datei in sorted(ordner.rglob("*")):
            if datei.is_file():
                aufnehmen(datei, str(datei.relative_to(wurzel)).replace(os.sep, "/"))

    for wurzel in (data_dir, config_dir):
        if wurzel is None:
            continue
        for name in BEILAGEN_ORDNER:
            ordner_aufnehmen(wurzel, name)
        for name in BEILAGEN_DATEIEN:
            aufnehmen(wurzel / name, name)
        for muster in BEILAGEN_MUSTER:
            for datei in sorted(wurzel.glob(muster)):
                aufnehmen(datei, datei.name)
    return gefunden


def archivname_erlaubt(name: str) -> bool:
    """Darf ein Eintrag aus einem Archiv auf die Platte? (rein, testbar)

    Das Archiv kann hochgeladen worden sein - also ist jeder Name darin
    Eingabe. Erlaubt ist genau, was `beilagen` hineinlegt: ein Name aus
    der Liste oder ein Pfad in einen der Ordner, ohne «..», ohne
    führenden Schrägstrich.
    """
    if not name or name.startswith("/") or "\\" in name:
        return False
    teile = name.split("/")
    if any(teil in ("", ".", "..") for teil in teile):
        return False
    if len(teile) == 1:
        return name in BEILAGEN_DATEIEN or any(
            Path(name).match(muster) for muster in BEILAGEN_MUSTER
        )
    return teile[0] in BEILAGEN_ORDNER


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
        # Wo config.yaml und secrets.env liegen, wenn nicht neben den
        # Daten - der Hub setzt es beim Start (Punkt 593).
        self.config_dir: Path | None = None
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

    def umfang(self) -> list[dict[str, Any]]:
        """Wie gross jede Sammlung ist (Punkt 426 der Werkbank).

        Abläufe, Verlauf, Familienlisten, Clip-Verweise und das
        Zugriffsprotokoll liegen in einer Datei, die bei jedem Schreiben
        ganz gelesen und ganz geschrieben wird. Die Platten-Warnung
        meldet, wenn es zu spät ist; was fehlte, ist die Zahl davor -
        welche Sammlung wie viele Zeilen hat und wie viel davon Bytes
        sind.

        Grösste zuerst: Wer hier nachsieht, sucht die eine Sammlung, die
        aus dem Ruder läuft, nicht die vierzig, die es nicht tun.

        Die Bytes je Sammlung werden einzeln gerechnet und nicht aus der
        Dateigrösse verteilt: Eine Liste mit tausend kurzen Zeilen und
        eine mit zehn langen sehen an der Zeilenzahl gleich harmlos aus,
        und genau die zweite ist das Problem.
        """
        zeilen = []
        for key, wert in self._data.items():
            try:
                bytes_ = len(json.dumps(wert, ensure_ascii=False).encode("utf-8"))
            except (TypeError, ValueError):
                # Eine Sammlung, die sich nicht schreiben lässt, ist ein
                # eigener Befund - aber keiner, der diese Übersicht
                # aufhalten darf.
                bytes_ = 0
            zeilen.append(
                {
                    "key": key,
                    "zeilen": len(wert) if isinstance(wert, list) else 1,
                    "bytes": bytes_,
                    # Was nie in einen Export darf, ist hier gekennzeichnet -
                    # sonst wundert sich jemand, warum «audit» gross ist
                    # und in seiner Exportdatei fehlt.
                    "geheim": key in SECRETS,
                }
            )
        return sorted(zeilen, key=lambda zeile: -int(zeile["bytes"]))

    def datei_bytes(self) -> int:
        """Wie gross die Datendatei auf der Platte ist - 0, wenn es sie
        noch nicht gibt (der allererste Start)."""
        try:
            return self.path.stat().st_size if self.path else 0
        except OSError:
            return 0

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
        for file in self._backup_files(folder):
            try:
                stat = file.stat()
            except OSError:
                continue
            entries.append(
                {"name": file.name, "size": stat.st_size, "created": stat.st_mtime}
            )
        return sorted(entries, key=lambda entry: entry["created"], reverse=True)

    @staticmethod
    def _backup_files(folder: Path) -> list[Path]:
        """Alle Sicherungen im Ordner - die alten Einzeldateien und die
        Archive seit Punkt 593 gemeinsam, damit die Frist für beide gilt."""
        return [*folder.glob("homepilot-data-*.json"), *folder.glob("homepilot-data-*.tar.gz")]

    def backup(self, keep: int = 14) -> dict[str, Any] | None:
        """Schreibt eine datierte Sicherung und behält die jüngsten ``keep``.

        Läuft täglich automatisch und lässt sich in der App auslösen. Ohne
        Datei-Pfad (Tests, In-Memory-Hub) passiert nichts.

        Seit Punkt 593 ein Tar-Archiv: die Datendatei plus alles, was
        `beilagen` neben ihr findet. Dieselbe Frist wie bisher, und die
        alten Einzeldateien zählen beim Aufräumen mit.
        """
        folder = self._backup_dir()
        if folder is None or self.path is None:
            return None
        try:
            folder.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime("%Y-%m-%d_%H%M%S", time.localtime())
            target = folder / f"homepilot-data-{stamp}.tar.gz"
            # Zwei Sicherungen in derselben Sekunde (etwa die automatische
            # vor einem Zurückspielen) dürfen sich nicht überschreiben.
            counter = 2
            while target.exists():
                target = folder / f"homepilot-data-{stamp}-{counter}.tar.gz"
                counter += 1
            self._tar_schreiben(target)
            os.chmod(target, 0o600)
            # Alte Sicherungen aufräumen – nur die jüngsten behalten.
            existing = sorted(
                self._backup_files(folder),
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

    def _tar_schreiben(self, target: Path) -> None:
        """Das Archiv: zuerst die Datendatei aus dem Speicher, dann die
        Beilagen von der Platte. Über eine temporäre Datei, damit eine
        halb geschriebene Sicherung nie wie eine ganze aussieht."""
        assert self.path is not None
        rohdaten = json.dumps(self._data, ensure_ascii=False, indent=2).encode("utf-8")
        temporary = target.with_name(target.name + ".tmp")
        with tarfile.open(temporary, mode="w:gz") as archiv:
            info = tarfile.TarInfo(ARCHIV_DATENDATEI)
            info.size = len(rohdaten)
            info.mtime = int(time.time())
            info.mode = 0o600
            archiv.addfile(info, io.BytesIO(rohdaten))
            for datei, arcname in beilagen(self.path.parent, self.config_dir):
                try:
                    archiv.add(datei, arcname=arcname, recursive=False)
                except OSError as err:
                    # Eine Beilage, die gerade nicht lesbar ist, darf die
                    # Sicherung der Daten nicht verhindern.
                    log.warning("Sicherung: %s übersprungen (%s)", arcname, err)
        os.replace(temporary, target)

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

    def restore_backup(self, name: str) -> dict[str, Any]:
        """Eine Sicherung zurückspielen - liefert, was dabei ankam.

        Der aktuelle Stand wird vorher selbst gesichert - ein Zurückspielen,
        das den letzten Stand vernichtet, wäre die falsche Rettungsleine.
        Danach braucht der Hub einen Neustart: Benutzer, Abläufe und Szenen
        werden beim Start aus der Datei aufgebaut.

        Beide Formen werden gelesen: die Einzeldatei von vor Punkt 593 und
        das Archiv seither. Aus dem Archiv kommen auch die Beilagen
        zurück - Bilder, Dateien, Token, Konfiguration -, und zwar nur
        an die Orte, die `archivname_erlaubt` zulässt: Das Archiv kann
        hochgeladen worden sein.
        """
        file = self._backup_file(name)
        if file.name.endswith(".tar.gz"):
            payload, beilagen_liste = self._tar_lesen(file)
        else:
            payload = json.loads(file.read_text(encoding="utf-8"))
            beilagen_liste = []
        if not isinstance(payload, dict):
            raise ValueError("Die Sicherung ist beschädigt (kein Objekt).")
        self.backup()
        self._data = payload
        # Direkt schreiben, nicht über save(): Das sammelt innerhalb der
        # Sammelsekunde nur vor, und der Neustart folgt in unter einer
        # Sekunde - ob der Flush davor noch feuerte, war Zufall (Punkt
        # 590 der Werkbank).
        self._write()
        zurueck = 0
        if beilagen_liste and self.path is not None:
            with tarfile.open(file, mode="r:gz") as archiv:
                for eintrag in beilagen_liste:
                    quelle = archiv.extractfile(eintrag)
                    if quelle is None:
                        continue
                    ziel = self._beilage_ziel(eintrag.name)
                    ziel.parent.mkdir(parents=True, exist_ok=True)
                    temporary = ziel.with_name(ziel.name + ".tmp")
                    with open(temporary, "wb") as handle:
                        handle.write(quelle.read())
                    os.replace(temporary, ziel)
                    os.chmod(ziel, 0o600)
                    zurueck += 1
        return {"name": name, "beilagen": zurueck}

    def _beilage_ziel(self, arcname: str) -> Path:
        """Wohin eine Beilage aus dem Archiv gehört: die Konfiguration in
        ihren Ordner, alles andere neben die Daten."""
        assert self.path is not None
        erster = arcname.split("/", 1)[0]
        konfiguration = erster in ("config.yaml", "secrets.env", "config-history")
        wurzel = self.config_dir if (konfiguration and self.config_dir) else self.path.parent
        return wurzel / arcname

    @staticmethod
    def _tar_lesen(file: Path) -> tuple[Any, list[tarfile.TarInfo]]:
        """Die Datendatei und die zulässigen Beilagen eines Archivs."""
        try:
            with tarfile.open(file, mode="r:gz") as archiv:
                mitglieder = archiv.getmembers()
                daten = next(
                    (m for m in mitglieder if m.name == ARCHIV_DATENDATEI and m.isfile()),
                    None,
                )
                if daten is None:
                    raise ValueError(
                        f"Die Sicherung enthält keine {ARCHIV_DATENDATEI}."
                    )
                quelle = archiv.extractfile(daten)
                payload = json.loads((quelle.read() if quelle else b"").decode("utf-8"))
        except tarfile.TarError as err:
            raise ValueError(f"Die Sicherung ist kein lesbares Archiv: {err}") from err
        erlaubt = [
            m for m in mitglieder if m.isfile() and archivname_erlaubt(m.name)
        ]
        return payload, erlaubt

    def backup_ablegen(self, name: str, payload: bytes) -> dict[str, Any]:
        """Eine von aussen kommende Sicherung in den Ordner legen (Punkt 593).

        Für die hochgeladene Datei aus der App und die Kopie aus dem
        Bucket. Geprüft wird vor dem Ablegen: der Name (er ist Eingabe)
        und ob der Inhalt überhaupt eine Sicherung ist - sonst läge im
        Ordner etwas, das beim Zurückspielen erst scheitert. Ein Name,
        den es schon gibt, wird nicht überschrieben.
        """
        folder = self._backup_dir()
        if folder is None:
            raise ValueError("Ohne Datei-Speicher gibt es keine Sicherungen.")
        if not re.fullmatch(SICHERUNGSNAME, name):
            raise ValueError(f"Kein Sicherungsname: {name}")
        if name.endswith(".tar.gz"):
            try:
                with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archiv:
                    if not any(m.name == ARCHIV_DATENDATEI for m in archiv.getmembers()):
                        raise ValueError(
                            f"Das Archiv enthält keine {ARCHIV_DATENDATEI}."
                        )
            except tarfile.TarError as err:
                raise ValueError(f"Kein lesbares Archiv: {err}") from err
        else:
            try:
                inhalt = json.loads(payload.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as err:
                raise ValueError(f"Keine lesbare Sicherung: {err}") from err
            if not isinstance(inhalt, dict) or "users" not in inhalt:
                raise ValueError("Die Datei sieht nicht wie eine Sicherung aus.")
        folder.mkdir(parents=True, exist_ok=True)
        stamm, endung = (
            (name[: -len(".tar.gz")], ".tar.gz")
            if name.endswith(".tar.gz")
            else (name[: -len(".json")], ".json")
        )
        target = folder / name
        counter = 2
        while target.exists():
            target = folder / f"{stamm}-{counter}{endung}"
            counter += 1
        target.write_bytes(payload)
        os.chmod(target, 0o600)
        log.info("Sicherung abgelegt: %s (%d KB)", target.name, len(payload) // 1000)
        return {"name": target.name, "created": target.stat().st_mtime, "size": len(payload)}

    def _backup_file(self, name: str) -> Path:
        folder = self._backup_dir()
        if folder is None:
            raise ValueError("Ohne Datei-Speicher gibt es keine Sicherungen.")
        if not re.fullmatch(SICHERUNGSNAME, name):
            raise ValueError(f"Unbekannte Sicherung: {name}")
        file = folder / name
        if not file.is_file():
            raise ValueError(f"Unbekannte Sicherung: {name}")
        return file
