#!/usr/bin/env python3
"""Prüft, dass die beiden Compose-Dateien zueinander passen.

`docker-compose.yml` (für Docker von Hand) und
`docker-compose.portainer.yml` (für den Portainer-Stack) beschreiben
dieselben Dienste. Wer eine ändert und die andere vergisst, merkt es
erst bei der nächsten Einrichtung – Wochen später, wenn niemand mehr
weiss, was geändert wurde.

Zusammenlegen geht nicht sauber: Ein Portainer-Stack ist genau eine
Datei, und Overrides über mehrere Dateien kennt er nicht. Also die
zweitbeste Lösung – ein Abgleich, der bei jedem Push läuft (siehe
.github/workflows/pruefung.yml) und Abweichungen benennt, solange sie
eine Zeile im Diff sind.

Verglichen wird, was auseinanderlaufen kann und wehtut: die Dienste,
ihre Abbilder, Ports, Umgebungs-Schlüssel und Volume-Ziele. Bewusst
nicht die Werte der Umgebung (Portainer nutzt Stack-Variablen, von Hand
nimmt man .env) und nicht die Kommentare.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml


def lade(pfad: Path) -> dict:
    daten = yaml.safe_load(pfad.read_text(encoding="utf-8"))
    return daten.get("services") or {}


def kern(service: dict) -> dict:
    """Der vergleichbare Kern eines Dienstes (rein, testbar)."""
    umgebung = service.get("environment") or {}
    if isinstance(umgebung, list):
        schluessel = sorted(str(e).split("=", 1)[0] for e in umgebung)
    else:
        schluessel = sorted(str(k) for k in umgebung)
    def ziel(volume: str) -> str:
        # host:container[:ro] – nur das Ziel im Container zählt: Der
        # Quellpfad darf sich je Aufstellung unterscheiden (Portainer
        # nutzt absolute Pfade, von Hand nimmt man relative).
        teile = str(volume).split(":")
        return teile[1] if len(teile) >= 2 else teile[0]

    volumes = sorted(ziel(v) for v in (service.get("volumes") or []))
    return {
        "image": service.get("image"),
        "ports": sorted(str(p) for p in (service.get("ports") or [])),
        "environment_keys": schluessel,
        "volume_ziele": volumes,
        "network_mode": service.get("network_mode"),
    }


def main() -> int:
    wurzel = Path(__file__).resolve().parent.parent
    docker = lade(wurzel / "docker-compose.yml")
    portainer = lade(wurzel / "docker-compose.portainer.yml")

    fehler: list[str] = []
    if set(docker) != set(portainer):
        fehler.append(
            f"Dienste unterscheiden sich: {sorted(docker)} gegenüber {sorted(portainer)}"
        )
    for name in sorted(set(docker) & set(portainer)):
        a, b = kern(docker[name]), kern(portainer[name])
        for feld in a:
            if a[feld] != b[feld]:
                fehler.append(
                    f"{name}.{feld}: docker-compose.yml hat {a[feld]!r}, "
                    f"portainer hat {b[feld]!r}"
                )

    if fehler:
        print("Die beiden Compose-Dateien sind auseinandergelaufen:")
        for zeile in fehler:
            print(f"  - {zeile}")
        print("Beide anpassen – oder hier begründen, warum die Abweichung gewollt ist.")
        return 1
    print("Compose-Dateien passen zueinander.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
