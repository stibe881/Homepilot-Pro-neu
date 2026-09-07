"""Das Bild-Archiv und das Ereignisblatt des Alarms.

Die Push-Bilder leben zehn Minuten im Speicher - wer am Morgen wissen
will, was nachts los war, braucht die abgelegten Standbilder und die
eine Route, die die Viertelstunde um ein Ereignis zusammenzieht.
"""

import time

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import bildarchiv, cliparchiv
from homepilot.core.config import load_config
from homepilot.core.hub import Hub

JPEG = b"\xff\xd8\xff\xe0" + b"x" * 32
PNG = b"\x89PNG\r\n" + b"y" * 32


def _meta(kennung: str, at: float) -> dict:
    return cliparchiv.eintrag(
        kennung, "demo.cam", "alarm", at, name="Flur", room="Flur", groesse=0
    )


def test_images_survive_roundtrip_and_bad_ids_do_not_escape(tmp_path):
    folder = tmp_path / "bildarchiv"
    kennung = cliparchiv.neue_kennung(1000.0)
    gelegt = bildarchiv.ablegen(folder, JPEG, _meta(kennung, 1000.0))
    assert gelegt is not None and gelegt["bytes"] == len(JPEG)
    assert bildarchiv.lesen(folder, kennung) == JPEG
    # PNG bekommt seine eigene Endung und wird trotzdem gefunden.
    kennung2 = cliparchiv.neue_kennung(2000.0)
    bildarchiv.ablegen(folder, PNG, _meta(kennung2, 2000.0))
    assert bildarchiv.lesen(folder, kennung2) == PNG
    # Eine Kennung aus einer URL ist sonst ein Fenster auf beliebige
    # Dateien des Hubs.
    assert bildarchiv.lesen(folder, "../../etc/passwd") is None
    assert bildarchiv.ablegen(folder, JPEG, {"id": "../../boese"}) is None

    eintraege = bildarchiv.liste(folder)
    assert [meta["id"] for meta in eintraege] == [kennung2, kennung]
    # Das Fenster liefert die Treffer chronologisch.
    fenster = bildarchiv.fenster(eintraege, 900.0, 1100.0)
    assert [meta["id"] for meta in fenster] == [kennung]


def test_old_images_are_cleared_like_clips(tmp_path):
    folder = tmp_path / "bildarchiv"
    alt = cliparchiv.neue_kennung(1000.0)
    frisch = cliparchiv.neue_kennung(2000.0)
    jetzt = time.time()
    bildarchiv.ablegen(folder, JPEG, _meta(alt, jetzt - 20 * 86400))
    bildarchiv.ablegen(folder, JPEG, _meta(frisch, jetzt))
    weg = bildarchiv.aufraeumen(folder, jetzt, 14)
    assert weg == 1
    assert [meta["id"] for meta in bildarchiv.liste(folder)] == [frisch]
    assert bildarchiv.lesen(folder, alt) is None


# ── Die Ereignisblatt-Route ──────────────────────────────────────────────

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18195 }}
integrations:
  - integration: demo
users:
  - name: Stefan
    role: besitzer
    token: t-owner
  - name: Partnerin
    role: bewohner
    token: t-resident
data_file: {data_file}
"""


@pytest.fixture
def client(tmp_path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(CONFIG.format(data_file=tmp_path / "data.json"))
    hub = Hub(load_config(config_file))
    with TestClient(create_app(hub)) as test_client:
        test_client.hub = hub
        test_client.tmp = tmp_path
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_the_event_sheet_gathers_the_quarter_hour(client):
    hub = client.hub
    jetzt = time.time()
    # Ein Alarm-Ereignis in den Verlauf legen - wie _note es täte.
    alarm = hub.integrations.get("alarm")
    alarm._history.insert(
        0, {"kind": "triggered", "text": "Alarm ausgelöst: Türe", "by": "", "at": jetzt}
    )
    # Und ein Bild ins Archiv, mitten im Fenster.
    kennung = cliparchiv.neue_kennung(jetzt)
    bildarchiv.ablegen(
        bildarchiv.ordner(hub.config.data_file), JPEG, _meta(kennung, jetzt - 60)
    )

    antwort = client.get(
        f"/api/alarm/ereignis?at={jetzt}", headers=auth("t-resident")
    )
    assert antwort.status_code == 200, antwort.text
    blatt = antwort.json()
    assert [row["kind"] for row in blatt["verlauf"]] == ["triggered"]
    assert [meta["id"] for meta in blatt["bilder"]] == [kennung]
    assert "events" in blatt and "devices" in blatt

    # Das Bild selbst kommt über die eigene Route - und eine erfundene
    # Kennung gibt 404 statt eines Blicks auf die Platte.
    bild = client.get(f"/api/alarm/bild/{kennung}", headers=auth("t-resident"))
    assert bild.status_code == 200
    assert bild.content == JPEG
    assert bild.headers["content-type"] == "image/jpeg"
    assert (
        client.get("/api/alarm/bild/kaputt", headers=auth("t-resident")).status_code
        == 404
    )
