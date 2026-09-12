"""Woher der Portainer-Stack seine Dateien nimmt.

Diese Prüfung steht für einen Fehlschlag, der eine ganze Auslieferung
gekostet hat: In `docker-compose.portainer.yml` stand für die
`mosquitto.conf` ein Repo-Pfad (`./deploy/mosquitto.conf`). Von Hand
stimmt der - man ruft Compose ja im Klon auf. Im Portainer-Stack liegt
der Klon aber dort, wo Portainer ihn hinlegt (`/data/compose/<n>`), und
die Datei war nicht dabei. Docker legt einen fehlenden Quellpfad
wortlos als leeres *Verzeichnis* an und versucht dann, es über die
Datei aus dem Abbild zu legen:

    Are you trying to mount a directory onto a file (or vice-versa)?

Der ganze Stack startet dann nicht - nicht nur der Broker. Deshalb gilt
für die Portainer-Fassung, was in ihrem eigenen Kopf steht: Alles, was
Konfiguration oder Daten ist, kommt aus `/opt/homepilot`.
"""

from __future__ import annotations

from pathlib import Path

import yaml

WURZEL = Path(__file__).resolve().parents[2]
PORTAINER = WURZEL / "docker-compose.portainer.yml"


def _quellen(pfad: Path) -> list[tuple[str, str]]:
    """Je Dienst der Quellpfad jedes Bind-Mounts (rein, testbar)."""
    dienste = yaml.safe_load(pfad.read_text(encoding="utf-8"))["services"]
    gefunden: list[tuple[str, str]] = []
    for name, dienst in dienste.items():
        for volume in dienst.get("volumes") or []:
            quelle = str(volume).split(":")[0]
            gefunden.append((name, quelle))
    return gefunden


def test_der_portainer_stack_holt_nichts_aus_dem_klon():
    """Kein relativer Quellpfad - der Klon liegt woanders."""
    relativ = [
        f"{dienst}: {quelle}"
        for dienst, quelle in _quellen(PORTAINER)
        if quelle.startswith(".")
    ]
    assert not relativ, (
        "Quellpfade aus dem Repo-Ordner: "
        + ", ".join(relativ)
        + " - im Portainer-Stack gibt es den nicht am erwarteten Ort. "
        "Absolut unter /opt/homepilot eintragen."
    )


def test_was_der_portainer_stack_einhaengt_liegt_beim_hub():
    """...und zwar unter /opt/homepilot, damit es ins Backup wandert.

    Docker-Volumes und Systempfade (`/etc/localtime`, `/var/run/...`)
    sind ausgenommen: Die gehören nicht dem Haus.
    """
    fremd = [
        f"{dienst}: {quelle}"
        for dienst, quelle in _quellen(PORTAINER)
        if quelle.startswith("/")
        and not quelle.startswith("/opt/homepilot")
        and not quelle.startswith(("/etc/", "/var/", "/dev/", "/sys/", "/run/"))
    ]
    assert not fremd, "Liegt ausserhalb von /opt/homepilot: " + ", ".join(fremd)
