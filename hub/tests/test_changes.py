"""«Was ist neu»: die Liste muss dort gesucht werden, wo sie liegt.

Der Fall dahinter: deploy/rebuild-hub.sh legt die Betreffzeilen als
``homepilot/changes.txt`` ab, gelesen wurde aber ``homepilot/api/changes.txt``
– ein Verzeichnis daneben. Und weil eine fehlende Datei bewusst nur eine
leere Liste ergibt (besser keine Karte als eine erfundene), blieb das
Fenster im Haus wortlos leer, statt sich zu beschweren.
"""

from pathlib import Path

from fastapi.testclient import TestClient

import homepilot
from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config

# Genau der Ort, an den das Bau-Skript schreibt – die Zeile hier ist die
# Klammer zwischen Skript und Hub.
CHANGES = Path(homepilot.__file__).resolve().parent / "changes.txt"


def make_client() -> TestClient:
    return TestClient(create_app(Hub(make_config())))


def test_die_liste_wird_dort_gelesen_wo_das_bauskript_sie_ablegt(monkeypatch):
    vorher = CHANGES.read_text(encoding="utf-8") if CHANGES.exists() else None
    CHANGES.write_text("Erste Änderung\n\nZweite Änderung\n", encoding="utf-8")
    monkeypatch.setenv("HOMEPILOT_COMMIT", "abc1234")
    try:
        with make_client() as client:
            body = client.get("/api/system/changes").json()
        assert body["commit"] == "abc1234"
        assert body["changes"] == ["Erste Änderung", "Zweite Änderung"]
    finally:
        if vorher is None:
            CHANGES.unlink()
        else:
            CHANGES.write_text(vorher, encoding="utf-8")


def test_ohne_datei_bleibt_die_liste_leer_statt_zu_scheitern():
    vorher = CHANGES.read_text(encoding="utf-8") if CHANGES.exists() else None
    if CHANGES.exists():
        CHANGES.unlink()
    try:
        with make_client() as client:
            body = client.get("/api/system/changes").json()
        assert body["changes"] == []
    finally:
        if vorher is not None:
            CHANGES.write_text(vorher, encoding="utf-8")
