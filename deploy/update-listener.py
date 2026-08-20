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

import hmac
import http.server
import json
import logging
import os
import subprocess
import sys
import threading
import time

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

log = logging.getLogger("update-listener")

# Damit nicht zwei Bauläufe gleichzeitig starten, wenn jemand zweimal tippt.
_running = threading.Lock()

# Die einzelnen Zeilen, an denen rebuild-hub.sh erkennen lässt, in welcher
# Phase es gerade steckt (siehe dessen echo-Zeilen). Reihenfolge ist die
# der Ausführung, nicht wichtig für die Erkennung selbst.
_STAGE_MARKERS = (
    ("Hole den neuesten Code", "clone"),
    ("Baue die Web-Fassung der App", "web"),
    ("Baue das Abbild neu", "build"),
    ("alte Schichten aufgeräumt", "built"),
    ("Stosse den iOS-Build an", "ios"),
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
    "started_at": None,
    "updated_at": None,
}

# So viele Folgezeilen einer Fehlermeldung werden mitgenommen. Genug für
# die Ursache samt Abhilfe, zu wenig, um eine Bauausgabe durchzureichen.
DETAIL_LINES = 12


def _set_status(**fields) -> None:
    with _status_lock:
        _status.update(fields)
        _status["updated_at"] = time.time()


def _handle_line(line: str) -> None:
    """Eine Ausgabezeile des Bau-Skripts einordnen (nicht rein – schreibt
    in den geteilten Status, aber ohne Seiteneffekte sonst)."""
    if line.startswith("✗"):
        _set_status(state="error", message=line.lstrip("✗").strip(), detail=None)
        return
    if line.startswith("⚠"):
        with _status_lock:
            _status["warnings"] = [*_status["warnings"], line.lstrip("⚠").strip()]
            _status["updated_at"] = time.time()
        return
    if line.startswith("✓") and "frischen Abbild" in line:
        _set_status(state="ok", stage="done", message=line.lstrip("✓").strip())
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
    """rebuild-hub.sh laufen lassen, Ausgabe live in den Status spiegeln."""
    if not _running.acquire(blocking=False):
        log.warning("Es läuft schon ein Bau – der zweite Aufruf wird verworfen")
        return
    _set_status(
        state="running",
        stage="clone",
        message=None,
        warnings=[],
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
        )

        def _give_up() -> None:
            nonlocal timed_out
            timed_out = True
            if proc is not None:
                proc.kill()

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
        _running.release()
        return
    finally:
        if watchdog is not None:
            watchdog.cancel()

    with _status_lock:
        if timed_out:
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

    if timed_out or returncode != 0:
        log.error("Bau fehlgeschlagen (Code %s)", returncode)
    else:
        log.info("Bau fertig")
    _running.release()


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

    def do_POST(self) -> None:  # noqa: N802
        path, _, query = self.path.partition("?")
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

        # Sofort antworten und im Hintergrund bauen: Der Bau dauert
        # Minuten, jede offene Verbindung liefe in einen Timeout.
        threading.Thread(target=build, kwargs={"ios": ios}, daemon=True).start()
        self._answer(202, "Bau gestartet (mit iOS-Build)\n" if ios else "Bau gestartet\n")

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/status":
            # Derselbe Schutz wie /update: Der Stand eines Baus (welcher
            # Commit, welche Fehlermeldung) ist nichts, was ohne das
            # geteilte Geheimnis herausgehen soll.
            if not self._authorized():
                self._answer(403, "Nicht erlaubt\n")
                return
            with _status_lock:
                body = json.dumps(_status).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        # Für einen Blick von Hand, ob der Dienst überhaupt läuft.
        self._answer(200, "update-listener läuft\n")


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

    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    log.info("Warte auf %s:%s (Skript: %s)", HOST, PORT, SCRIPT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
