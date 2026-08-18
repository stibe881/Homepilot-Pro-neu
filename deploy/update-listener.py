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
import logging
import os
import subprocess
import sys
import threading

# Nur auf dem Docker-Bridge-Gateway lauschen, nicht auf allen Adressen.
# Damit ist der Dienst aus den Containern erreichbar, aber nicht aus dem
# Netz – und schon gar nicht aus dem Internet.
HOST = os.environ.get("UPDATE_LISTEN_HOST", "172.17.0.1")
PORT = int(os.environ.get("UPDATE_LISTEN_PORT", "9126"))
SCRIPT = os.environ.get("UPDATE_SCRIPT", "/opt/homepilot/rebuild-hub.sh")
SECRET = os.environ.get("UPDATE_SECRET", "")

log = logging.getLogger("update-listener")

# Damit nicht zwei Bauläufe gleichzeitig starten, wenn jemand zweimal tippt.
_running = threading.Lock()


def build() -> None:
    """rebuild-hub.sh laufen lassen und das Ergebnis protokollieren."""
    if not _running.acquire(blocking=False):
        log.warning("Es läuft schon ein Bau – der zweite Aufruf wird verworfen")
        return
    try:
        log.info("Starte %s", SCRIPT)
        result = subprocess.run(
            [SCRIPT], capture_output=True, text=True, timeout=3600
        )
        if result.returncode == 0:
            log.info("Bau fertig:\n%s", result.stdout[-2000:])
        else:
            log.error(
                "Bau fehlgeschlagen (%s):\n%s\n%s",
                result.returncode,
                result.stdout[-2000:],
                result.stderr[-2000:],
            )
    except subprocess.TimeoutExpired:
        log.error("Bau abgebrochen: über eine Stunde ohne Ende")
    except Exception:
        log.exception("Bau konnte nicht gestartet werden")
    finally:
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

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/update":
            self._answer(404, "Nicht gefunden\n")
            return

        header = self.headers.get("Authorization", "")
        given = header.removeprefix("Bearer ").strip()
        # compare_digest, damit die Antwortzeit nichts über das Geheimnis
        # verrät.
        if not SECRET or not hmac.compare_digest(given, SECRET):
            log.warning("Abgelehnt: falsches oder fehlendes Geheimnis")
            self._answer(403, "Nicht erlaubt\n")
            return

        # Sofort antworten und im Hintergrund bauen: Der Bau dauert
        # Minuten, jede offene Verbindung liefe in einen Timeout.
        threading.Thread(target=build, daemon=True).start()
        self._answer(202, "Bau gestartet\n")

    def do_GET(self) -> None:  # noqa: N802
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
