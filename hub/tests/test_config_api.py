"""Konfiguration aus der App bearbeiten: lesen, validiert schreiben, Neustart."""

import pytest
from fastapi.testclient import TestClient

import homepilot.api.server as server
from homepilot.api import create_app
from homepilot.core.config import load_config
from homepilot.core.hub import Hub

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18150 }}
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


def test_owner_reads_config(client):
    response = client.get("/api/config", headers=auth("t-owner"))
    assert response.status_code == 200
    assert "integration: demo" in response.json()["content"]


def test_resident_may_not_touch_config(client):
    assert client.get("/api/config", headers=auth("t-resident")).status_code == 403
    assert (
        client.put(
            "/api/config", json={"content": "x: 1"}, headers=auth("t-resident")
        ).status_code
        == 403
    )
    assert (
        client.post("/api/system/restart", headers=auth("t-resident")).status_code == 403
    )


def test_valid_config_is_written(client):
    content = client.get("/api/config", headers=auth("t-owner")).json()["content"]
    updated = content.replace("integration: demo", "integration: demo   # geändert")
    response = client.put(
        "/api/config", json={"content": updated}, headers=auth("t-owner")
    )
    assert response.status_code == 200
    assert "# geändert" in client.config_file.read_text()


def test_broken_config_is_rejected_and_file_untouched(client):
    before = client.config_file.read_text()
    response = client.put(
        "/api/config",
        json={"content": "api: [kaputt\nusers: - x"},
        headers=auth("t-owner"),
    )
    assert response.status_code == 400
    assert client.config_file.read_text() == before
    # Auch strukturell Falsches (gültiges YAML, falscher Inhalt) wird abgewiesen.
    response = client.put(
        "/api/config",
        json={"content": "users:\n  - name: X\n    role: gast\n    token: t\n"},
        headers=auth("t-owner"),
    )
    assert response.status_code == 400
    assert "besitzer" in response.json()["detail"]


def test_restart_is_scheduled_not_executed_in_tests(client, monkeypatch):
    calls = []
    monkeypatch.setattr(server, "_exit_for_restart", lambda: calls.append(True))
    response = client.post("/api/system/restart", headers=auth("t-owner"))
    assert response.status_code == 200
    # Der Timer feuert nach 0.8s – hier zählt nur, dass der Aufruf ohne
    # echten Prozess-Exit durchläuft und die Berechtigung geprüft wurde.
