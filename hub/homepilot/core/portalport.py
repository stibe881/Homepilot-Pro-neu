"""Ein zweiter Zugang, der nur den Weg zeigt.

UniFi lässt beim «External Portal Server» ausschliesslich eine
IPv4-Adresse zu - kein «:8123». Der Controller schickt einen Gast, der
sich gerade verbindet, also auf **Port 80** des Hubs. Dort steht nichts,
das Anmeldefenster bleibt leer, und niemand sieht warum: Im Log des Hubs
taucht nicht einmal eine Anfrage auf, denn sie kommt gar nie bei ihm an.

Hier steht deshalb ein Umleiter: Er nimmt auf Port 80 entgegen, was der
Controller schickt, und schickt den Browser mit derselben Adresse auf
den echten Port weiter - Pfad und Abfrage unverändert, denn genau darin
steht die MAC des Gastgeräts (`?id=…`).

**Was er bewusst nicht ist:** ein zweiter Zugang zum Hub. Er beantwortet
keine einzige Anfrage inhaltlich, er kennt weder Token noch Daten. Wer
über Port 80 etwas anderes sucht, bekommt dieselbe Umleitung wie alle -
und landet beim gewöhnlichen Zugang, der wie immer Anmeldung verlangt.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def weiterleitung(host_kopf: str, pfad: str, abfrage: str, ziel_port: int) -> str:
    """Wohin der Browser geschickt wird (rein, testbar).

    Der Host kommt aus der Anfrage, nicht aus der Konfiguration: Der Hub
    weiss nicht, unter welcher seiner Adressen ihn der Controller nennt,
    und eine geratene wäre für den Gast womöglich unerreichbar. Ein schon
    angehängter Port fliegt weg - sonst entstünde «10.10.1.13:80:8123».
    """
    host = (host_kopf or "").split(",")[0].strip()
    # Nur der Teil vor dem Port; IPv6 in eckigen Klammern bleibt heil.
    if host.startswith("["):
        klammer = host.find("]")
        host = host[: klammer + 1] if klammer > 0 else host
    elif ":" in host:
        host = host.split(":", 1)[0]
    ziel = f"http://{host}:{ziel_port}{pfad}"
    return f"{ziel}?{abfrage}" if abfrage else ziel


def umleiter(ziel_port: int):
    """Die winzige ASGI-Anwendung, die auf dem Portal-Port antwortet.

    Von Hand geschrieben statt mit FastAPI: Sie soll nichts können ausser
    umleiten. Was hier nicht steht, kann auch nicht versehentlich etwas
    ausliefern.
    """

    async def app(scope, receive, send) -> None:
        if scope["type"] != "http":
            return
        ziel = weiterleitung(
            _kopf(scope, b"host"),
            scope.get("path", "/"),
            scope.get("query_string", b"").decode("latin-1"),
            ziel_port,
        )
        await send(
            {
                "type": "http.response.start",
                "status": 302,
                "headers": [
                    (b"location", ziel.encode("latin-1")),
                    (b"cache-control", b"no-store"),
                    (b"content-length", b"0"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": b""})

    return app


def _kopf(scope, name: bytes) -> str:
    for schluessel, wert in scope.get("headers", []):
        if schluessel == name:
            return wert.decode("latin-1")
    return ""


def starten(host: str, port: int, ziel_port: int) -> None:
    """Den Umleiter in einem eigenen Faden starten - oder es lassen.

    Ein eigener Faden, weil uvicorn.run() blockiert und der Hub selbst
    noch starten muss. Und mit Netz: Port 80 gehört unter Linux root,
    der Hub läuft im Container aber als gewöhnlicher Benutzer. Scheitert
    das Binden, ist das kein Grund, das Haus nicht zu starten - es steht
    im Log, mit den beiden Wegen, die es lösen.
    """
    import threading

    import uvicorn

    def lauf() -> None:
        try:
            uvicorn.Server(
                uvicorn.Config(
                    umleiter(ziel_port), host=host, port=port, log_level="warning"
                )
            ).run()
        except PermissionError:
            log.warning(
                "Port %s bleibt zu: Der Hub darf ihn nicht belegen (unter 1024 "
                "gehören Ports root). Entweder auf dem Docker-Host einmal "
                "'net.ipv4.ip_unprivileged_port_start=%s' setzen "
                "(/etc/sysctl.d/) oder dem Container NET_BIND_SERVICE geben. "
                "Ohne ihn bleibt das Anmeldefenster des Gäste-WLANs leer.",
                port,
                port,
            )
        except OSError as err:
            log.warning(
                "Port %s bleibt zu (%s) - belegt ihn schon etwas anderes? "
                "Ohne ihn bleibt das Anmeldefenster des Gäste-WLANs leer.",
                port,
                err,
            )

    threading.Thread(target=lauf, name="portalport", daemon=True).start()
    log.info("Umleiter für das Gäste-Anmeldefenster auf Port %s", port)
