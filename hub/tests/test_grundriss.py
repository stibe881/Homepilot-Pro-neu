"""Der Grundriss: Punkte-Prüfung, Bild-Ablage, Rechte."""

from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import grundriss
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

from .conftest import make_config

# ── Die reine Punkte-Prüfung ─────────────────────────────────────────────


def test_valid_points_pass_and_get_rounded():
    punkte = grundriss.punkte_bereinigen(
        [{"entity_id": "demo.light_livingroom", "x": 0.123456, "y": "0.5"}]
    )
    assert punkte == [{"entity_id": "demo.light_livingroom", "x": 0.1235, "y": 0.5}]


def test_points_outside_the_image_are_dropped_not_clamped():
    # Ein Punkt bei x=7 wäre auf keinem Gerät je zu sehen - und damit
    # auch nie zu korrigieren.
    roh = [
        {"entity_id": "a", "x": 7, "y": 0.5},
        {"entity_id": "b", "x": -0.1, "y": 0.5},
        {"entity_id": "c", "x": 0.5, "y": 1.0},
    ]
    assert [p["entity_id"] for p in grundriss.punkte_bereinigen(roh)] == ["c"]


def test_garbage_rows_fall_away_silently():
    roh = [
        "unfug",
        {"x": 0.5, "y": 0.5},  # ohne Gerät
        {"entity_id": "", "x": 0.5, "y": 0.5},
        {"entity_id": "a", "x": "kaputt", "y": 0.5},
        {"entity_id": "b", "x": None, "y": 0.5},
        {"entity_id": "x" * 101, "x": 0.5, "y": 0.5},
    ]
    assert grundriss.punkte_bereinigen(roh) == []
    assert grundriss.punkte_bereinigen("kein array") == []
    assert grundriss.punkte_bereinigen(None) == []


def test_the_last_point_per_device_wins():
    # Wer beim Anpassen zweimal tippt, meint die zweite Stelle.
    roh = [
        {"entity_id": "a", "x": 0.1, "y": 0.1},
        {"entity_id": "a", "x": 0.9, "y": 0.9},
    ]
    assert grundriss.punkte_bereinigen(roh) == [{"entity_id": "a", "x": 0.9, "y": 0.9}]


def test_the_point_count_is_capped():
    roh = [
        {"entity_id": f"e{i}", "x": 0.5, "y": 0.5}
        for i in range(grundriss.MAX_PUNKTE + 50)
    ]
    assert len(grundriss.punkte_bereinigen(roh)) == grundriss.MAX_PUNKTE


# ── Die Routen ───────────────────────────────────────────────────────────


def data_uri(inhalt: bytes = b"nicht wirklich ein bild", typ: str = "image/png") -> str:
    return f"data:{typ};base64,{base64.b64encode(inhalt).decode()}"


def test_without_an_image_the_state_is_honest(tmp_path):
    hub = Hub(make_config(data_file=str(tmp_path / "daten.json")))
    with TestClient(create_app(hub)) as client:
        stand = client.get("/api/grundriss").json()
        assert stand == {"bild": None, "punkte": []}
        assert client.get("/api/grundriss/bild").status_code == 404


def test_uploading_replaces_the_old_image_whatever_its_format(tmp_path):
    hub = Hub(make_config(data_file=str(tmp_path / "daten.json")))
    with TestClient(create_app(hub)) as client:
        erste = client.post(
            "/api/grundriss/bild", json={"image": data_uri(b"png-fassung")}
        ).json()
        assert erste["bild"].startswith("/api/grundriss/bild?v=")
        zweite = client.post(
            "/api/grundriss/bild",
            json={"image": data_uri(b"jpeg-fassung", "image/jpeg")},
        ).json()
        # Neues Bild, neue Adresse - und nur eine Datei auf der Platte,
        # sonst wäre das ausgelieferte Bild Zufall.
        assert zweite["bild"] != erste["bild"]
        antwort = client.get(zweite["bild"])
        assert antwort.status_code == 200
        assert antwort.content == b"jpeg-fassung"
        assert antwort.headers["content-type"] == "image/jpeg"
    assert len(list((tmp_path / "grundriss").iterdir())) == 1


def test_a_broken_upload_is_rejected_with_a_reason(tmp_path):
    hub = Hub(make_config(data_file=str(tmp_path / "daten.json")))
    with TestClient(create_app(hub)) as client:
        antwort = client.post("/api/grundriss/bild", json={"image": "kein data-uri"})
        assert antwort.status_code == 400
        assert "data-URI" in antwort.json()["detail"]


def test_deleting_the_image_keeps_the_points(tmp_path):
    # Ein neues Foto desselben Plans soll nicht alle Positionen kosten.
    hub = Hub(make_config(data_file=str(tmp_path / "daten.json")))
    with TestClient(create_app(hub)) as client:
        client.post("/api/grundriss/bild", json={"image": data_uri()})
        client.put(
            "/api/grundriss/punkte",
            json={"punkte": [{"entity_id": "demo.light_livingroom", "x": 0.3, "y": 0.7}]},
        )
        client.delete("/api/grundriss/bild")
        stand = client.get("/api/grundriss").json()
        assert stand["bild"] is None
        assert stand["punkte"] == [
            {"entity_id": "demo.light_livingroom", "x": 0.3, "y": 0.7}
        ]


def test_points_survive_a_restart(tmp_path):
    daten = str(tmp_path / "daten.json")
    erster = Hub(make_config(data_file=daten))
    with TestClient(create_app(erster)) as client:
        client.put(
            "/api/grundriss/punkte",
            json={
                "punkte": [
                    {"entity_id": "demo.light_livingroom", "x": 0.25, "y": 0.75},
                    {"entity_id": "ausserhalb", "x": 5, "y": 5},
                ]
            },
        )
    zweiter = Hub(make_config(data_file=daten))
    with TestClient(create_app(zweiter)) as client:
        punkte = client.get("/api/grundriss").json()["punkte"]
    # Der ungültige Punkt wurde nie gespeichert, der gültige blieb.
    assert punkte == [{"entity_id": "demo.light_livingroom", "x": 0.25, "y": 0.75}]


def test_guests_may_look_but_not_rearrange(tmp_path):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
                {"name": "Gast", "role": "gast", "token": "t-guest"},
            ],
            data_file=str(tmp_path / "daten.json"),
        )
    )
    gast = {"Authorization": "Bearer t-guest"}
    besitzer = {"Authorization": "Bearer t-owner"}
    with TestClient(create_app(hub)) as client:
        assert client.get("/api/grundriss", headers=gast).status_code == 200
        assert (
            client.post(
                "/api/grundriss/bild", json={"image": data_uri()}, headers=gast
            ).status_code
            == 403
        )
        assert (
            client.put(
                "/api/grundriss/punkte", json={"punkte": []}, headers=gast
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/grundriss/bild", json={"image": data_uri()}, headers=besitzer
            ).status_code
            == 200
        )
