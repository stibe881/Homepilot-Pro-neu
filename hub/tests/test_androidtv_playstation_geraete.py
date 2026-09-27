"""Fernseher und Spielkonsole von der Verbindungen-Seite aus eintragen.

Der gemeldete Wunsch: Ein zweites, drittes Gerät sollte sich einrichten
lassen, ohne dass jemand die config.yaml öffnet - wie eine Cast-Box unter
api/routes/verbindungen.py. Die Routen leben stattdessen bei ihrer
Integration (api/routes/androidtv.py, api/routes/playstation.py), weil
Kopplung und Einschlaf-Timer schon dort stehen.
"""

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import load_config
from homepilot.core.hub import Hub

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18172 }}

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
        test_client.config_file = config_file
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_a_tv_can_be_added_without_touching_the_file_by_hand(client):
    antwort = client.post(
        "/api/androidtv/geraete",
        json={"name": "Beamer", "host": "10.10.1.40"},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200, antwort.text
    assert antwort.json()["restart_required"] is True
    text = client.config_file.read_text()
    assert "androidtv" in text and "10.10.1.40" in text and "Beamer" in text

    antwort = client.delete("/api/androidtv/geraete/10.10.1.40", headers=auth("t-owner"))
    assert antwort.status_code == 200
    assert "10.10.1.40" not in client.config_file.read_text()


def test_a_tv_needs_a_name_and_a_plausible_address(client):
    antwort = client.post(
        "/api/androidtv/geraete",
        json={"name": "  ", "host": "10.10.1.40"},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 400
    antwort = client.post(
        "/api/androidtv/geraete",
        json={"name": "Beamer", "host": "10.9.9.1; rm -rf"},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 400


def test_a_console_can_be_added_without_touching_the_file_by_hand(client):
    antwort = client.post(
        "/api/playstation/geraete",
        json={"name": "Wohnzimmer PS5", "host": "10.10.1.60"},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200, antwort.text
    text = client.config_file.read_text()
    assert "playstation" in text and "10.10.1.60" in text

    antwort = client.delete("/api/playstation/geraete/10.10.1.60", headers=auth("t-owner"))
    assert antwort.status_code == 200
    assert "10.10.1.60" not in client.config_file.read_text()


def test_a_resident_may_not_add_devices(client):
    antwort = client.post(
        "/api/androidtv/geraete",
        json={"name": "Beamer", "host": "10.10.1.40"},
        headers=auth("t-resident"),
    )
    assert antwort.status_code == 403
    antwort = client.post(
        "/api/playstation/geraete",
        json={"name": "PS5", "host": "10.10.1.60"},
        headers=auth("t-resident"),
    )
    assert antwort.status_code == 403
