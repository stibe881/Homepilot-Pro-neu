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


def test_owner_assigns_room_to_entity(client):
    # Demo-Entität ohne Raum → per API Raum setzen → im Snapshot sichtbar.
    entities = client.get("/api/entities", headers=auth("t-owner")).json()
    target = entities[0]["id"]
    response = client.put(
        f"/api/entities/{target}/room",
        json={"room": "Büro"},
        headers=auth("t-owner"),
    )
    assert response.status_code == 200
    assert response.json()["entity"]["room"] == "Büro"
    # Und wieder lösen.
    cleared = client.put(
        f"/api/entities/{target}/room", json={"room": None}, headers=auth("t-owner")
    )
    assert cleared.json()["entity"]["room"] is None


def test_resident_may_not_assign_rooms(client):
    entities = client.get("/api/entities", headers=auth("t-resident")).json()
    target = entities[0]["id"]
    assert (
        client.put(
            f"/api/entities/{target}/room",
            json={"room": "Büro"},
            headers=auth("t-resident"),
        ).status_code
        == 403
    )


def test_adopting_a_speaker_writes_it_into_the_config(client):
    """Ein Klick in den Lautsprecher-Einstellungen soll genügen – niemand
    soll dafür YAML von Hand tippen müssen."""
    response = client.post(
        "/api/speakers/adopt",
        headers=auth("t-owner"),
        json={"name": "Terrasse", "host": "10.10.1.25"},
    )
    assert response.status_code == 200
    assert response.json()["restart_required"] is True

    content = client.config_file.read_text()
    assert "integration: google_cast" in content
    assert "host: 10.10.1.25" in content
    assert "name: Terrasse" in content
    # Der Rest der Datei steht unverändert da.
    assert "integration: demo" in content
    assert "token: t-owner" in content
    # Und sie lässt sich weiterhin laden.
    assert load_config(client.config_file) is not None


def test_adopting_twice_is_harmless(client):
    for _ in range(2):
        client.post(
            "/api/speakers/adopt",
            headers=auth("t-owner"),
            json={"name": "Terrasse", "host": "10.10.1.25"},
        )
    second = client.post(
        "/api/speakers/adopt",
        headers=auth("t-owner"),
        json={"name": "Terrasse", "host": "10.10.1.25"},
    )
    assert second.json()["already"] is True
    assert second.json()["restart_required"] is False
    assert client.config_file.read_text().count("host: 10.10.1.25") == 1


def test_a_resident_may_not_adopt_speakers(client):
    response = client.post(
        "/api/speakers/adopt",
        headers=auth("t-resident"),
        json={"name": "Terrasse", "host": "10.10.1.25"},
    )
    assert response.status_code == 403


# ── Bedienoberfläche: Gliederung und gezielte Änderungen ─────────────────


def test_the_outline_names_the_sections_and_the_values(client):
    antwort = client.get("/api/config/outline", headers=auth("t-owner"))
    assert antwort.status_code == 200
    body = antwort.json()
    schluessel = [abschnitt["key"] for abschnitt in body["sections"]]
    assert "api" in schluessel and "integrations" in schluessel
    # Dazu die gelesenen Werte – damit die App nichts von YAML wissen muss.
    assert body["data"]["api"]["port"] == 18150
    # Und der Text, auf dem beides beruht: Beide Ansichten arbeiten am
    # selben Stand, sonst überschreibt eine die andere.
    assert body["content"].startswith("api:")


def test_the_outline_survives_a_broken_file(client, tmp_path):
    client.config_file.write_text("api: {\n  kaputt\n")
    body = client.get("/api/config/outline", headers=auth("t-owner")).json()
    # Kein Absturz, keine leere Seite: Die Gliederung kommt aus dem Text.
    assert body["error"]
    assert [a["key"] for a in body["sections"]] == ["api"]


def test_editing_computes_but_does_not_save(client):
    vorher = client.get("/api/config", headers=auth("t-owner")).json()["content"]
    antwort = client.post(
        "/api/config/edit",
        json={"content": vorher, "path": ["location", "address"], "value": "Musterweg 3"},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200
    assert "address: Musterweg 3" in antwort.json()["content"]
    # Auf der Platte steht weiterhin der alte Stand – gespeichert wird
    # über den einen Weg, der prüft.
    assert "address" not in client.config_file.read_text()


def test_a_computed_change_goes_through_the_normal_save(client):
    vorher = client.get("/api/config", headers=auth("t-owner")).json()["content"]
    neu = client.post(
        "/api/config/edit",
        json={"content": vorher, "path": ["location", "latitude"], "value": 47.1445},
        headers=auth("t-owner"),
    ).json()["content"]
    gespeichert = client.put("/api/config", json={"content": neu}, headers=auth("t-owner"))
    assert gespeichert.status_code == 200
    assert "latitude: 47.1445" in client.config_file.read_text()


def test_replacing_a_block_needs_both_ends(client):
    vorher = client.get("/api/config", headers=auth("t-owner")).json()["content"]
    antwort = client.post(
        "/api/config/edit",
        json={"content": vorher, "text": "irgendwas"},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 400


def test_only_who_may_edit_the_config_sees_the_outline(client):
    assert client.get("/api/config/outline", headers=auth("t-resident")).status_code == 403
    assert (
        client.post(
            "/api/config/edit",
            json={"content": "a: 1", "path": ["a"], "value": 2},
            headers=auth("t-resident"),
        ).status_code
        == 403
    )


def test_an_edit_answers_with_a_matching_outline(client):
    """Zeilennummern stimmen nur für genau einen Text – deshalb kommen
    Text und Gliederung immer zusammen zurück."""
    vorher = client.get("/api/config/outline", headers=auth("t-owner")).json()
    antwort = client.post(
        "/api/config/edit",
        json={
            "content": vorher["content"],
            "path": ["location", "latitude"],
            "value": 47.1,
        },
        headers=auth("t-owner"),
    ).json()
    assert antwort["data"]["location"]["latitude"] == 47.1
    # Der neue Abschnitt steht in der Gliederung, und seine Zeilen
    # zeigen auf den Text, der danebensteht.
    location = [a for a in antwort["sections"] if a["key"] == "location"][0]
    ausschnitt = antwort["content"].splitlines()[location["start"] : location["end"]]
    assert any("latitude: 47.1" in zeile for zeile in ausschnitt)


def test_asking_for_the_outline_of_an_unsaved_text(client):
    """Nach dem Tippen im Textmodus muss die Übersicht neu gegliedert
    werden – sonst zeigt sie auf Zeilen, die es nicht mehr gibt."""
    antwort = client.post(
        "/api/config/edit",
        json={"content": "api:\n  port: 1\nrooms:\n  Bad: []\n"},
        headers=auth("t-owner"),
    ).json()
    assert [a["key"] for a in antwort["sections"]] == ["api", "rooms"]
    assert antwort["data"]["rooms"] == {"Bad": []}
