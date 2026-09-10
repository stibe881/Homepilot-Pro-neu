#!/usr/bin/env python3
"""Nimmt den Update-Knopf der App entgegen und baut auf dem Host.

Das fehlende Zwischenstück: Der Hub läuft in einem Container und hat weder
das Repository noch Docker zur Hand – und soll das auch nicht haben. Ein
Dienst, der den Docker-Socket sieht, ist faktisch root auf dem Host; das
gehört nicht in eine Hausautomation, die nebenbei Webseiten aus dem
Internet abruft.

Stattdessen dieser kleine Dienst *neben* dem Container: Er hört auf genau
einen Aufruf, startet ``rebuild-hub.sh`` und antwortet sofort. Das Bauen
dauert Minuten – wer darauf wartet, läuft in jeden Timeout.

Damit der Update-Knopf in der App einen echten Fortschrittsbalken zeigen
kann, statt nur "läuft" zu sagen, liest dieser Dienst die Ausgabe von
rebuild-hub.sh live mit und merkt sich, in welcher Phase der Bau gerade
steckt (``GET /status``) – dieselben Zeilen, die auch im journalctl
stehen, nur strukturiert statt als Text.

Ohne Fremdbibliotheken, damit auf dem Host nichts zu installieren ist.

── Einrichtung ──────────────────────────────────────────────────────────

In /opt/homepilot/github-credentials.env ergänzen (dieselbe Datei, die
rebuild-hub.sh schon liest):

    UPDATE_SECRET=$(openssl rand -base64 32)

Dann diese Datei nach /opt/homepilot/update-listener.py kopieren und den
Dienst einrichten – siehe deploy/portainer.md.

In der config.yaml des Hubs:

    update:
      webhook_url: http://172.17.0.1:9126/update
      token: "dasselbe UPDATE_SECRET"

172.17.0.1 ist der Host aus Sicht des Containers (das Docker-Bridge-Gateway).
"""

from __future__ import annotations

import datetime
import hmac
import http.server
import json
import logging
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# Nur auf dem Docker-Bridge-Gateway lauschen, nicht auf allen Adressen.
# Damit ist der Dienst aus den Containern erreichbar, aber nicht aus dem
# Netz – und schon gar nicht aus dem Internet.
HOST = os.environ.get("UPDATE_LISTEN_HOST", "172.17.0.1")
PORT = int(os.environ.get("UPDATE_LISTEN_PORT", "9126"))
SCRIPT = os.environ.get("UPDATE_SCRIPT", "/opt/homepilot/rebuild-hub.sh")
SECRET = os.environ.get("UPDATE_SECRET", "")

# Ein Bau, der über eine Stunde ohne Ende läuft, ist hängengeblieben statt
# nur langsam – dann lieber abbrechen, als für immer "läuft" zu zeigen.
WATCHDOG_SECONDS = 3600

# Was diese Fassung kann. Der Hub fragt das ab, bevor er einen Knopf
# schickt, den ältere Fassungen nicht kennen: Dann steht in der App, dass
# der Dienst auf dem Server zu alt ist – statt eines nackten „404 Nicht
# gefunden", das in die falsche Richtung zeigt. Neue Fähigkeiten kommen
# hier dazu, damit die App sie ankündigen kann, bevor sie ins Leere läuft.
FEATURES = ["status", "warnings", "ios", "last_run", "abort", "preview"]

#: Woraus gebaut wird - für die Vorschau «was bringt ein Update».
REPO = os.environ.get("UPDATE_REPO", "stibe881/Homepilot-Pro-neu")

# Wohin der Ausgang des letzten Laufs geschrieben wird. Der Status oben
# lebt im Arbeitsspeicher und ist nach jedem Neustart des Dienstes weg -
# und der Dienst startet sich nach einem Update selbst neu. Wer danach in
# die App schaut, sah bisher «nichts los» und hielt einen
# fehlgeschlagenen Lauf für einen gelungenen.
STATUS_FILE = os.environ.get(
    "UPDATE_STATUS_FILE", "/opt/homepilot/update-status.json"
)

# Dieselbe Datei, aus der rebuild-hub.sh seine Zugangsdaten liest.
CREDENTIALS_FILE = os.environ.get(
    "UPDATE_CREDENTIALS", "/opt/homepilot/github-credentials.env"
)


def has_expo_token() -> bool:
    """Liegt ein EXPO_TOKEN bereit? Nur ja/nein, nie der Wert selbst.

    Ohne ihn baut rebuild-hub.sh den Hub, überspringt aber den iOS-Build –
    das Update sieht danach aus wie geglückt, und in TestFlight kommt
    nichts an. Genau diese Auskunft fehlte dem Hub, um vorher zu warnen.

    Nachgesehen wird an beiden Stellen, an denen auch das Bau-Skript
    sucht: in der eigenen Umgebung und in der Zugangsdatei. Sonst hiesse
    es «fehlt», sobald jemand den Token einträgt, ohne diesen Dienst neu
    zu starten – obwohl der Bau ihn längst fände.
    """
    if os.environ.get("EXPO_TOKEN", "").strip():
        return True
    try:
        with open(CREDENTIALS_FILE, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                name, _, value = line.strip().partition("=")
                if name.strip() == "EXPO_TOKEN" and value.strip().strip("\"'"):
                    return True
    except OSError:
        pass
    return False


log = logging.getLogger("update-listener")


def zugangswerte_lesen(pfad: str) -> dict[str, str]:
    """Die Zugangsdatei als Wörterbuch (rein genug - liest nur).

    Dieselbe Datei, aus der auch rebuild-hub.sh liest. Anführungszeichen
    und Wagenrückläufe werden abgestreift - wer die Datei einmal unter
    Windows bearbeitet hat, hat CRLF drin, und «Token\\r» ist bei GitHub
    keiner.
    """
    werte: dict[str, str] = {}
    try:
        with open(pfad, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                name, _, value = line.strip().partition("=")
                if name.strip():
                    werte[name.strip()] = value.strip().strip("\"'").rstrip("\r")
    except OSError:
        pass
    return werte


def betreffzeilen(commits: Any) -> list[str]:
    """Die Betreffzeilen aus GitHubs Commit-Listen (rein, testbar).

    Nimmt beides an: die Liste aus /compare (älteste zuerst) wie die aus
    /commits (neueste zuerst) - die Reihenfolge richtet der Aufrufer.

    Zusammenführungen fallen heraus: «Merge remote-tracking branch …»
    sagt niemandem, was das Update bringt - es ist Buchhaltung des
    Zweige-Abgleichs (deploy/zweige.py), keine Änderung. Erkannt an den
    zwei Eltern; wo GitHub keine mitschickt, am Betreff.
    """
    zeilen: list[str] = []
    for commit in commits or []:
        if not isinstance(commit, dict):
            continue
        eltern = commit.get("parents")
        if isinstance(eltern, list) and len(eltern) > 1:
            continue
        message = ((commit.get("commit") or {}).get("message")) or ""
        betreff = str(message).splitlines()[0].strip() if message else ""
        if not betreff or betreff.startswith("Merge "):
            continue
        zeilen.append(betreff)
    return zeilen


def zweig_sauber(name: str) -> str:
    """Ein Zweigname, wie er in eine Adresse darf (rein, testbar).

    Der Hub schickt ihn mit - er stammt aus dem eigenen Abbild, aber
    geprüft wird trotzdem: Was von aussen kommt, gehört nie ungeprüft in
    eine URL. Erlaubt ist, was Git für Zweige zulässt und GitHub im Pfad
    verträgt.
    """
    text = str(name or "").strip()
    if not text or len(text) > 200 or ".." in text or text.startswith("/"):
        return ""
    erlaubt = set(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._/-"
    )
    return text if all(zeichen in erlaubt for zeichen in text) else ""


def vereinigt(listen: Any) -> list[dict]:
    """Mehrere Commit-Listen zu einer, ohne Doppel, neueste zuerst
    (rein, testbar).

    Gebraucht, weil ein Bau aus mehreren Zweigen entsteht: Dieselbe
    Änderung kann auf zweien liegen, und zweimal dieselbe Zeile im
    Dialog liest sich wie zwei Änderungen. Sortiert wird nach dem
    Zeitpunkt des Commits - ohne ihn gäbe es keine Reihenfolge, die
    über Zweiggrenzen hinweg etwas bedeutet.
    """
    nach_schluessel: dict[str, dict] = {}
    for liste in listen or []:
        for commit in liste or []:
            if not isinstance(commit, dict):
                continue
            inneres = commit.get("commit") or {}
            betreff = str(inneres.get("message") or "").splitlines()[:1]
            schluessel = str(commit.get("sha") or "") or (betreff[0] if betreff else "")
            if not schluessel:
                continue
            nach_schluessel.setdefault(schluessel, commit)

    def zeitpunkt(commit: dict) -> str:
        inneres = commit.get("commit") or {}
        for feld in ("committer", "author"):
            wert = (inneres.get(feld) or {}).get("date")
            if wert:
                return str(wert)
        return ""

    return sorted(nach_schluessel.values(), key=zeitpunkt, reverse=True)


def _github(pfad: str, token: str) -> Any:
    request = urllib.request.Request(
        f"https://api.github.com{pfad}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "homepilot-update-listener",
        },
    )
    with urllib.request.urlopen(request, timeout=10) as antwort:
        return json.load(antwort)


#: Die letzte Vorschau, kurz gemerkt: Wer den Update-Dialog zweimal
#: öffnet, soll GitHub nicht zweimal in der Minute fragen.
_vorschau_cache: tuple[float, str, dict] | None = None


def bauzeit_sauber(gebaut: str) -> str:
    """Die Bauzeit als Zeitpunkt, den GitHub annimmt (rein, testbar).

    Sie wandert in eine URL, also wird sie geprüft und nicht bloss
    weitergereicht: Nur ein ISO-Zeitpunkt kommt durch, alles andere wird
    zu ''. Der Hub schickt sie aus HOMEPILOT_BUILD_TIME, und das ist ein
    Wert aus dem Abbild - aber Prüfen kostet nichts, und eine Zeichenkette
    aus der Ferne gehört nie ungeprüft in eine Adresse.
    """
    text = str(gebaut or "").strip()
    if not text:
        return ""
    versuch = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        zeit = datetime.datetime.fromisoformat(versuch)
    except ValueError:
        return ""
    if zeit.tzinfo is None:
        zeit = zeit.replace(tzinfo=datetime.timezone.utc)
    return zeit.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _basis_zur_bauzeit(branch: str, gebaut: str, token: str) -> str:
    """Welcher Commit stand auf dem Zweig, als das Abbild gebaut wurde?

    Der Umweg, der die Auskunft überhaupt erst verlässlich macht. Der
    laufende Stand ist eine örtliche Zusammenführung (HOMEPILOT_MERGE_ALL);
    GitHub kennt ihn nicht und beantwortet «was kam seither dazu?» mit
    404. Die Bauzeit dagegen kennt der Hub immer - sie steht als
    HOMEPILOT_BUILD_TIME in jedem Abbild -, und der jüngste Commit vor
    ihr ist genau der Stand, aus dem gebaut wurde.

    Das ist mit Absicht der zweite Weg. Der erste ist der Commit, den das
    Bau-Skript selbst festhält (GIT_BASE → HOMEPILOT_BASE_COMMIT); er ist
    genauer, weil er nicht an der Uhr hängt. Nur greift er erst, wenn das
    Skript sich aufgefrischt hat - und dieser Weg hier greift sofort,
    weil dieser Dienst nach jedem Lauf neu startet.
    """
    zeit = bauzeit_sauber(gebaut)
    if not zeit:
        return ""
    pfad = (
        f"/repos/{REPO}/commits?sha={urllib.parse.quote(branch)}"
        f"&until={urllib.parse.quote(zeit)}&per_page=1"
    )
    payload = _github(pfad, token)
    if isinstance(payload, list) and payload and isinstance(payload[0], dict):
        return str(payload[0].get("sha") or "")
    return ""


def _uebrige_zweige(basis: str, branch: str, token: str) -> list[list]:
    """Was auf den anderen Zweigen liegt - und beim nächsten Bau mitkäme.

    Der Grund, warum es diese Funktion überhaupt gibt: Der Bau nimmt
    **alle** Zweige des Repos herein (HOMEPILOT_MERGE_ALL, Vorgabe an),
    verglichen wurde aber nur gegen einen. Wer auf einem Arbeitszweig
    eincheckt und noch nicht nach main gestossen hat, dessen Arbeit
    brächte das nächste Update sehr wohl mit - der Dialog sagte
    trotzdem «Auf dem Server liegt nichts Neues». Ein falscher
    Freibrief, und genau die Sorte Fehler, vor der die CLAUDE.md warnt:
    «Teuer ist der Zweig, der still zurückfällt.»

    Eine Seite Zweige genügt (GitHub gibt bis zu 100); mehr hat dieses
    Repo nie, und wer sie hätte, sähe die Lücke am Vergleich selbst.
    """
    payload = _github(f"/repos/{REPO}/branches?per_page=100", token)
    listen: list[list] = []
    for eintrag in payload if isinstance(payload, list) else []:
        if not isinstance(eintrag, dict):
            continue
        name = zweig_sauber(str(eintrag.get("name") or ""))
        if not name or name == branch:
            continue
        try:
            teil = _github(f"/repos/{REPO}/compare/{basis}...{name}", token)
        except urllib.error.HTTPError as err:
            # Ein einzelner Zweig, den GitHub nicht vergleichen kann,
            # darf die übrige Auskunft nicht mitnehmen.
            if err.code != 404:
                raise
            continue
        listen.append(teil.get("commits") or [])
    return listen


def vorschau(ab: str, gebaut: str = "", zweig: str = "") -> dict[str, Any]:
    """Was ein Update jetzt brächte: Betreffzeilen seit dem Stand ``ab``.

    Der Hub kennt sein Git nicht, und das Bau-Skript klont erst beim
    Bauen - die Frage «was käme?» kann vorher nur dieser Dienst
    beantworten, mit den GitHub-Zugängen, die ohnehin auf dem Host
    liegen.

    Kennt GitHub ``ab`` nicht (eine örtliche Zusammenführung), wird über
    die Bauzeit nachgeschlagen, was damals auf dem Zweig stand. Erst wenn
    auch das nicht geht, kommen ersatzweise die jüngsten Betreffzeilen
    des Zweigs, als ``exact: false`` gekennzeichnet - und die App zeigt
    sie dann bewusst nicht als Liste, weil eine Liste, die im Zweifel
    schon Ausgeliefertes nennt, schlimmer ist als keine.
    """
    global _vorschau_cache
    jetzt = time.time()
    schluessel = f"{ab}|{gebaut}|{zweig}"
    if (
        _vorschau_cache
        and _vorschau_cache[1] == schluessel
        and jetzt - _vorschau_cache[0] < 60
    ):
        return _vorschau_cache[2]

    werte = zugangswerte_lesen(CREDENTIALS_FILE)
    token = os.environ.get("GITHUB_TOKEN", "").strip() or werte.get("GITHUB_TOKEN", "")
    # Zuerst der Zweig, den der Hub mitschickt - er steht im Abbild und
    # ist damit der, aus dem wirklich gebaut wurde. Hier auf dem Host
    # ihn ein zweites Mal zu erraten ging schief, sobald jemand
    # HOMEPILOT_BRANCH in die Zugangsdatei schrieb, ohne den Dienst neu
    # zu starten: Dann baute das Skript main und verglichen wurde gegen
    # etwas anderes.
    branch = (
        zweig_sauber(zweig)
        or os.environ.get("HOMEPILOT_BRANCH", "").strip()
        or werte.get("HOMEPILOT_BRANCH", "")
        or "main"
    )
    # Nimmt der Bau die übrigen Zweige mit herein? Dann muss die Vorschau
    # sie auch ansehen (siehe _uebrige_zweige).
    merge_all = (
        os.environ.get("HOMEPILOT_MERGE_ALL", "").strip()
        or werte.get("HOMEPILOT_MERGE_ALL", "")
        or "1"
    ) == "1"
    if not token:
        return {"error": "Auf dem Host liegt kein GITHUB_TOKEN"}

    def vergleiche(von: str) -> dict[str, Any]:
        payload = _github(f"/repos/{REPO}/compare/{von}...{branch}", token)
        listen: list[list] = [payload.get("commits") or []]
        genau = True
        if merge_all:
            try:
                listen.extend(_uebrige_zweige(von, branch, token))
            except Exception:
                # Konnten wir die übrigen Zweige nicht ansehen, dürfen
                # wir auch nicht «genau» behaupten - und schon gar nicht
                # «nichts Neues». Lieber die halbe Auskunft, ehrlich
                # gekennzeichnet, als ein Freibrief, den niemand prüfen
                # kann.
                genau = False
        # `vereinigt` sortiert neueste zuerst - so, wie es die App zeigt.
        return {
            "commits": betreffzeilen(vereinigt(listen)),
            "exact": genau,
            "branch": branch,
        }

    daten: dict[str, Any]
    # Zwei Anläufe, in dieser Reihenfolge: der Commit, den das Bau-Skript
    # festgehalten hat, sonst der Umweg über die Bauzeit.
    for kandidat, ueber_zeit in ((ab, False), ("", True)):
        try:
            von = kandidat
            if ueber_zeit:
                von = _basis_zur_bauzeit(branch, gebaut, token)
            if not von or von == "unbekannt":
                continue
            daten = vergleiche(von)
            _vorschau_cache = (jetzt, schluessel, daten)
            return daten
        except urllib.error.HTTPError as err:
            if err.code != 404:
                raise
            # 404: Diesen Stand kennt GitHub nicht - der nächste Anlauf.

    payload = _github(f"/repos/{REPO}/commits?sha={branch}&per_page=10", token)
    daten = {"commits": betreffzeilen(payload), "exact": False, "branch": branch}
    _vorschau_cache = (jetzt, schluessel, daten)
    return daten

# Damit nicht zwei Bauläufe gleichzeitig starten, wenn jemand zweimal tippt.
_running = threading.Lock()

# Der laufende Bau-Prozess - damit POST /abort ihn beenden kann. Er wird
# als eigene Prozessgruppe gestartet (start_new_session): rebuild-hub.sh
# ruft docker build und expo auf, und ein Kill auf das Skript allein
# liesse die Kinder weiterbauen.
_proc_lock = threading.Lock()
_proc: subprocess.Popen | None = None
# Auf Wunsch abgebrochen? Unterscheidet den gewollten Abbruch vom echten
# Fehler - in der App soll «abgebrochen» nicht rot wie «gescheitert»
# aussehen.
_abbruch = False

# Ab diesen Phasen ist der Portainer-Webhook schon ausgelöst; das
# Ausrollen läuft dann auf Portainers Seite und lässt sich von hier aus
# nicht mehr zurückholen.
ZU_SPAET = ("deploy", "deploy_wait", "manual", "done")


def abbruch_moeglich(state, stage) -> tuple[bool, str]:
    """Verhindert ein Abbruch jetzt noch das Ausrollen? (rein, testbar)

    Der Sinn des Knopfs ist «es soll nichts ins Haus übertragen werden».
    Vor dem Webhook stimmt das: Der alte Container läuft unangetastet
    weiter, ein abgebrochener Bau ist ein Nicht-Ereignis. Danach ist es
    eine leere Geste - Portainer arbeitet unabhängig weiter, und so zu
    tun, als sei abgebrochen worden, wäre gelogen.
    """
    if state != "running":
        return False, "Es läuft gerade kein Bau."
    if stage in ZU_SPAET:
        return False, (
            "Zu spät: Das Ausrollen ist schon angestossen - "
            "Portainer arbeitet unabhängig weiter."
        )
    return True, ""


def _bau_beenden(proc: subprocess.Popen) -> None:
    """Den Bau samt Kindern beenden (docker build, expo, eas).

    Erst die ganze Prozessgruppe, dann - falls das Skript ohne eigene
    Gruppe läuft (alte Popen-Aufrufe) - wenigstens das Skript selbst.
    """
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass

# Die einzelnen Zeilen, an denen rebuild-hub.sh erkennen lässt, in welcher
# Phase es gerade steckt (siehe dessen echo-Zeilen). Reihenfolge ist die
# der Ausführung, nicht wichtig für die Erkennung selbst.
_STAGE_MARKERS = (
    ("Hole den neuesten Code", "clone"),
    ("Baue die Web-Fassung der App", "web"),
    ("Baue das Abbild neu", "build"),
    ("alte Schichten aufgeräumt", "built"),
    ("Stosse den iOS-Build an", "ios"),
    # Der Android-Build folgt direkt auf den iOS-Build und gehört zur
    # selben Phase - die App zeigt «App-Builds an EAS übergeben».
    ("Stosse den Android-Build an", "ios"),
    ("Löse den Portainer-Webhook aus", "deploy"),
    ("Warte auf den Wechsel", "deploy_wait"),
    ("Jetzt in Portainer", "manual"),
)

_status_lock = threading.Lock()
# state: idle | running | ok | error
_status = {
    "state": "idle",
    "stage": None,
    "message": None,
    # Die Zeilen nach einer Fehlermeldung: rebuild-hub.sh schreibt dort
    # die Ursache und was zu tun ist. Ohne dieses Feld landete davon
    # nichts in der App - man sah nur, DASS es schiefging.
    "detail": None,
    # ⚠-Zeilen des Bau-Skripts: Dinge, die schiefgingen, ohne den Bau zu
    # stoppen - etwa ein fehlgeschlagener Web-Bau, bei dem die alte
    # Fassung online bleibt. Bisher standen sie nur im Journal, und in
    # der App sah danach alles nach Erfolg aus.
    "warnings": [],
    # Auf Wunsch abgebrochen statt gescheitert - die App zeigt das als
    # Hinweis, nicht als Fehler.
    "aborted": False,
    "started_at": None,
    "updated_at": None,
}

# So viele Folgezeilen einer Fehlermeldung werden mitgenommen. Genug für
# die Ursache samt Abhilfe, zu wenig, um eine Bauausgabe durchzureichen.
#
# Waren einmal 12, und der Deckel fiel ausgerechnet auf die Zeile mit der
# Abhilfe: Beim gemeldeten «Portainer hat den Container nicht gewechselt»
# endete die Meldung in der App mitten im Satz - «Von Hand: Portainer →
# Stacks → homepilot →», und wie es dort weitergeht, stand nirgends.
# Seither zählt die Meldung mehr Zeilen (Portainers eigenes Protokoll
# kommt neu dazu), und der Deckel liegt so, dass die letzte Zeile
# hineinpasst.
DETAIL_LINES = 24

# Dasselbe für eine Warnung. Ihre Abhilfe steht in den eingerückten
# Zeilen darunter - etwa die Schritte im Apple-Portal, ohne die kein
# iOS-Build startet. Ohne sie sähe man nur «liess sich nicht anstossen»
# und müsste die Anleitung per SSH im Journal suchen.
WARN_LINES = 8

# Läuft gerade eine Warnung, deren eingerückte Folgezeilen noch zu ihr
# gehören? Wird von der ersten nicht eingerückten Zeile beendet.
_warn_open = False


def letzter_lauf_lesen(pfad: str) -> dict | None:
    """Den Ausgang des letzten Laufs von der Platte holen (rein, testbar).

    Alles, was schiefgehen kann - Datei fehlt, halb geschrieben, von Hand
    verbogen -, endet hier als None. Ein kaputtes Gedächtnis darf den
    Dienst nicht am Starten hindern.
    """
    try:
        with open(pfad, encoding="utf-8") as datei:
            wert = json.load(datei)
    except Exception:
        return None
    return wert if isinstance(wert, dict) else None


def letzter_lauf_schreiben(pfad: str, stand: dict) -> bool:
    """Den Ausgang festhalten. True, wenn es geklappt hat.

    Erst daneben schreiben, dann umbenennen: Wer währenddessen liest,
    bekommt entweder den alten oder den neuen Stand, nie einen halben.
    """
    try:
        with open(f"{pfad}.neu", "w", encoding="utf-8") as datei:
            json.dump(stand, datei)
        os.replace(f"{pfad}.neu", pfad)
        return True
    except Exception:
        log.warning("Der letzte Lauf liess sich nicht nach %s schreiben", pfad)
        return False


#: Der Ausgang des letzten Laufs - über Neustarts des Dienstes hinweg.
_letzter_lauf: dict | None = letzter_lauf_lesen(STATUS_FILE)


def _set_status(**fields) -> None:
    with _status_lock:
        _status.update(fields)
        _status["updated_at"] = time.time()


def eigene_meldung(line: str, zeichen: str) -> bool:
    """Stammt diese Zeile vom Bau-Skript selbst? (rein, testbar)

    Das Zeichen allein genügt nicht. Durch dieselbe Ausgabe laufen die
    Werkzeuge, die das Skript aufruft, und die schreiben auch Warnzeichen:
    `eas build` meldet «⚠️ Detected that your app uses Expo Go for
    development» - ein Satz über die App-Entwicklung, der in der App als
    Hinweis zum Update stand, wo er nichts zu suchen hat.

    Unterscheiden lassen sie sich am Leerzeichen: rebuild-hub.sh schreibt
    «⚠ Text», das Emoji-Warnzeichen fremder Werkzeuge trägt dagegen ein
    unsichtbares Zusatzzeichen (U+FE0F) direkt hinter dem Dreieck. Genau
    das blieb übrig, als die Meldung vom Warnzeichen befreit wurde - der
    Hinweis in der App begann mit einem Rest, den niemand tippen kann.
    """
    return line.startswith(f"{zeichen} ")


def _handle_line(line: str) -> None:
    """Eine Ausgabezeile des Bau-Skripts einordnen (nicht rein – schreibt
    in den geteilten Status, aber ohne Seiteneffekte sonst)."""
    global _warn_open
    if eigene_meldung(line, "✗"):
        _warn_open = False
        _set_status(state="error", message=line[1:].strip(), detail=None)
        return
    if eigene_meldung(line, "⚠"):
        _warn_open = True
        with _status_lock:
            _status["warnings"] = [*_status["warnings"], line[1:].strip()]
            _status["updated_at"] = time.time()
        return
    if _warn_open and line.startswith("  ") and line.strip():
        # Eingerückt und direkt unter der Warnung: Das ist ihre Begründung
        # oder die Abhilfe, nicht die nächste Meldung.
        with _status_lock:
            letzte = _status["warnings"][-1] if _status["warnings"] else None
            if letzte is not None and letzte.count("\n") < WARN_LINES:
                _status["warnings"] = [
                    *_status["warnings"][:-1],
                    letzte + "\n" + line.strip(),
                ]
                _status["updated_at"] = time.time()
        return
    _warn_open = False
    if eigene_meldung(line, "✓") and (
        "frischen Abbild" in line or "neuesten Stand" in line
    ):
        _set_status(state="ok", stage="done", message=line[1:].strip())
        return
    for marker, stage in _STAGE_MARKERS:
        if marker in line:
            _set_status(stage=stage, message=line.lstrip("→").strip())
            return
    with _status_lock:
        if _status["state"] == "running":
            # Kein erkanntes Stichwort – trotzdem als letzte Zeile zeigen,
            # damit sichtbar bleibt, dass sich etwas tut (docker build).
            _status["message"] = line
            _status["updated_at"] = time.time()
        elif _status["state"] == "error":
            # Nach einem ✗ folgen die Zeilen, die erklären, woran es lag
            # und was zu tun ist. Die gehören zur Meldung, nicht in den
            # Papierkorb – genau sie fehlten bisher in der App, und ohne
            # sie sieht man nur, dass etwas schiefging.
            gathered = (_status["detail"] or "").splitlines()
            if len(gathered) < DETAIL_LINES:
                gathered.append(line.strip())
                _status["detail"] = "\n".join(gathered)
                _status["updated_at"] = time.time()


def build(ios: bool = False) -> None:
    """rebuild-hub.sh laufen lassen, Ausgabe live in den Status spiegeln.

    Die Sperre hält bereits der Aufrufer (siehe do_POST) – so erfährt der,
    ob überhaupt gebaut wird, und kann es beantworten. Früher wurde sie
    hier geholt: Der zweite Aufruf bekam dann trotzdem «Bau gestartet» zu
    hören, während er in Wahrheit im Papierkorb landete. Wer während der
    Wartezeit auf Portainer noch einmal auf Update drückte, sah eine
    Bestätigung und bekam nichts – dreimal hintereinander.
    """
    global _warn_open, _abbruch, _proc
    _warn_open = False
    _abbruch = False
    _set_status(
        state="running",
        stage="clone",
        message=None,
        warnings=[],
        aborted=False,
        started_at=time.time(),
    )

    timed_out = False
    proc: subprocess.Popen | None = None
    watchdog: threading.Timer | None = None
    returncode = -1
    try:
        log.info("Starte %s", SCRIPT)
        env = dict(os.environ)
        if ios:
            env["HOMEPILOT_IOS_BUILD"] = "1"
        proc = subprocess.Popen(
            [SCRIPT],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
            # Eigene Prozessgruppe: Abbruch und Wächter sollen auch die
            # Kinder treffen (docker build, expo) - nicht nur das Skript.
            start_new_session=True,
        )
        with _proc_lock:
            _proc = proc

        def _give_up() -> None:
            nonlocal timed_out
            timed_out = True
            if proc is not None:
                _bau_beenden(proc)

        watchdog = threading.Timer(WATCHDOG_SECONDS, _give_up)
        watchdog.start()

        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip("\n")
            if not line:
                continue
            log.info(line)
            _handle_line(line)
        returncode = proc.wait()
    except Exception as err:
        _set_status(state="error", message=str(err))
        log.exception("Bau konnte nicht gestartet werden")
        return
    finally:
        if watchdog is not None:
            watchdog.cancel()
        with _proc_lock:
            _proc = None
        # Immer freigeben, auf jedem Weg hier hinaus. Bliebe die Sperre
        # nach einem Fehler liegen, lehnte der Dienst jedes weitere Update
        # ab, bis ihn jemand neu startet - und niemand wüsste, warum.
        _running.release()

    with _status_lock:
        if _abbruch:
            # Gewollt, kein Schaden: Der alte Container läuft unangetastet
            # weiter. `aborted` lässt die App das als Hinweis zeigen statt
            # rot wie ein gescheitertes Update; für ältere App-Stände
            # bleibt es ein gewöhnlicher error-Ausgang.
            _status["state"] = "error"
            _status["aborted"] = True
            _status["message"] = "Auf Wunsch abgebrochen - der alte Stand läuft weiter."
            _status["detail"] = None
        elif timed_out:
            _status["state"] = "error"
            _status["message"] = "Abgebrochen: über eine Stunde ohne Ende"
        elif _status["state"] == "running":
            # Durchgelaufen, ohne dass eine der bekannten Endzeilen kam –
            # bei Erfolg dennoch als fertig zählen, sonst bliebe die App
            # für immer bei "läuft".
            if returncode == 0:
                _status["state"] = "ok"
                _status["stage"] = _status["stage"] or "done"
            else:
                _status["state"] = "error"
                _status["message"] = _status["message"] or f"Beendet mit Code {returncode}"
        _status["updated_at"] = time.time()

    # Festhalten, bevor der Dienst sich gleich selbst neu startet - sonst
    # ist dieser Lauf spurlos weg, und in der App steht wieder «nichts los».
    global _letzter_lauf
    with _status_lock:
        _letzter_lauf = {
            "state": _status["state"],
            "stage": _status["stage"],
            "message": _status["message"],
            "detail": _status["detail"],
            "warnings": list(_status["warnings"]),
            "aborted": bool(_status.get("aborted")),
            "started_at": _status["started_at"],
            "finished_at": time.time(),
            "ios": ios,
        }
    letzter_lauf_schreiben(STATUS_FILE, _letzter_lauf)

    if timed_out or returncode != 0:
        log.error("Bau fehlgeschlagen (Code %s)", returncode)
    else:
        log.info("Bau fertig")


class Handler(http.server.BaseHTTPRequestHandler):
    # Der Standard schreibt jede Anfrage nach stderr, mit Zeitstempel im
    # Apache-Format – neben journalctl wäre das doppelt.
    def log_message(self, *_args) -> None:
        pass

    def _answer(self, code: int, text: str) -> None:
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        given = header.removeprefix("Bearer ").strip()
        # compare_digest, damit die Antwortzeit nichts über das Geheimnis
        # verrät.
        return bool(SECRET) and hmac.compare_digest(given, SECRET)

    # do_POST und do_GET heissen so, weil BaseHTTPRequestHandler danach
    # sucht - nicht nach unserer Namenskonvention.
    def do_POST(self) -> None:
        path, _, query = self.path.partition("?")
        if path.rstrip("/") == "/abort":
            self._abort()
            return
        if path.rstrip("/") != "/update":
            self._answer(404, "Nicht gefunden\n")
            return
        if not self._authorized():
            log.warning("Abgelehnt: falsches oder fehlendes Geheimnis")
            self._answer(403, "Nicht erlaubt\n")
            return

        # ios=1: Nach dem Hub-Bau zusätzlich den iOS-Build auf den
        # EAS-Servern anstossen. Kommt vom Update-Knopf der App, wenn dort
        # «mit iOS-Build» gewählt wurde - nie von selbst, ein
        # App-Store-Build ist kein Nebeneffekt.
        ios = "ios=1" in query

        # Läuft schon einer, ist das keine Kleinigkeit zum Verschweigen:
        # Der neue Wunsch (etwa «diesmal mit iOS-Build») geht dabei
        # verloren, und wer nur eine Bestätigung sieht, wartet auf etwas,
        # das nie kommt.
        if not _running.acquire(blocking=False):
            log.warning("Abgelehnt: es läuft bereits ein Bau")
            self._answer(
                409,
                "Es läuft bereits ein Bau. Der Wunsch wurde NICHT "
                "übernommen - bitte warten, bis der laufende fertig ist, "
                "und danach erneut auslösen.\n",
            )
            return

        # Sofort antworten und im Hintergrund bauen: Der Bau dauert
        # Minuten, jede offene Verbindung liefe in einen Timeout. Die
        # Sperre gibt der Bau selbst wieder frei.
        threading.Thread(target=build, kwargs={"ios": ios}, daemon=True).start()
        self._answer(202, "Bau gestartet (mit iOS-Build)\n" if ios else "Bau gestartet\n")

    def _abort(self) -> None:
        """POST /abort: den laufenden Bau beenden, bevor ausgerollt wird.

        Vor dem Portainer-Webhook ist das folgenlos - der alte Container
        läuft weiter, das halbe Abbild räumt der nächste Lauf weg. Danach
        wird abgelehnt statt so zu tun (siehe abbruch_moeglich).
        """
        global _abbruch
        if not self._authorized():
            log.warning("Abbruch abgelehnt: falsches oder fehlendes Geheimnis")
            self._answer(403, "Nicht erlaubt\n")
            return
        with _status_lock:
            state, stage = _status["state"], _status["stage"]
        moeglich, grund = abbruch_moeglich(state, stage)
        if not moeglich:
            log.warning("Abbruch abgelehnt: %s", grund)
            self._answer(409, grund + "\n")
            return
        with _proc_lock:
            proc = _proc
        if proc is None:
            # Zwischen Statusblick und Zugriff fertig geworden.
            self._answer(409, "Es läuft gerade kein Bau.\n")
            return
        _abbruch = True
        log.warning("Bau wird auf Wunsch abgebrochen (Phase: %s)", stage)
        _bau_beenden(proc)
        self._answer(
            202, "Abgebrochen - es wird nichts ausgerollt, der alte Stand läuft weiter.\n"
        )

    def do_GET(self) -> None:
        pfad, _, query = self.path.partition("?")
        if pfad.rstrip("/") == "/vorschau":
            # Derselbe Schutz wie /status: Commit-Betreffzeilen eines
            # privaten Repos gehen nicht ohne das geteilte Geheimnis raus.
            if not self._authorized():
                self._answer(403, "Nicht erlaubt\n")
                return
            felder = urllib.parse.parse_qs(query)
            ab = (felder.get("ab") or [""])[0]
            gebaut = (felder.get("gebaut") or [""])[0]
            zweig = (felder.get("zweig") or [""])[0]
            try:
                daten = vorschau(ab, gebaut, zweig)
            except Exception as err:
                # GitHub nicht erreichbar, Token abgelaufen - der Grund
                # steht im Journal, die App fällt auf ihren alten Text
                # zurück statt eine kaputte Liste zu zeigen.
                log.warning("Vorschau fehlgeschlagen: %s", err)
                daten = {"error": str(err)}
            body = json.dumps(daten).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.rstrip("/") == "/status":
            # Derselbe Schutz wie /update: Der Stand eines Baus (welcher
            # Commit, welche Fehlermeldung) ist nichts, was ohne das
            # geteilte Geheimnis herausgehen soll.
            if not self._authorized():
                self._answer(403, "Nicht erlaubt\n")
                return
            with _status_lock:
                body = json.dumps(
                    {
                        **_status,
                        "last_run": _letzter_lauf,
                        "features": FEATURES,
                        "expo_token": has_expo_token(),
                    }
                ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        # Für einen Blick von Hand, ob der Dienst überhaupt läuft – und
        # mit welcher Fassung. Ohne Geheimnis erreichbar, weil eine Liste
        # von Fähigkeiten nichts verrät, was nicht ohnehin im Repository
        # steht; genau dafür ist sie da: nachsehen können, ohne erst das
        # Geheimnis herauszusuchen.
        self._answer(
            200,
            f"update-listener läuft (kann: {', '.join(FEATURES)}; "
            f"EXPO_TOKEN: {'da' if has_expo_token() else 'fehlt'})\n",
        )


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    if not SECRET:
        log.error(
            "UPDATE_SECRET ist nicht gesetzt – ohne Geheimnis würde dieser "
            "Dienst für jeden bauen, der ihn erreicht. Abbruch."
        )
        return 1
    if not os.access(SCRIPT, os.X_OK):
        log.error("%s ist nicht ausführbar", SCRIPT)
        return 1

    try:
        server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as err:
        # Der Fall, der die längste Suche kostet: Es horcht schon etwas auf
        # dem Port – meist ein von Hand gestarteter Listener von früher.
        # Dann startet dieser Dienst nie durch, und die App redet weiter
        # mit dem alten Prozess. Ohne diese Zeile stünde im Journal nur
        # «Address already in use».
        log.error(
            "%s:%s lässt sich nicht belegen (%s). Läuft dort noch ein "
            "anderer Listener? Nachsehen mit: ss -lptn 'sport = :%s' - "
            "diesen Prozess beenden und den Dienst erneut starten.",
            HOST,
            PORT,
            err,
            PORT,
        )
        return 1
    log.info(
        "Warte auf %s:%s (Skript: %s, kann: %s)",
        HOST,
        PORT,
        SCRIPT,
        ", ".join(FEATURES),
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
