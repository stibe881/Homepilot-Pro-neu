"""Kinder-Ansicht: nur die eigenen Räume, gespeichert und überlebend."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config


def test_simple_rooms_roundtrip_over_the_api():
    hub = Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        h = {"Authorization": "Bearer t-stefan"}
        created = client.post(
            "/api/users",
            json={"name": "Levin", "role": "bewohner", "simple_rooms": ["Levin"]},
            headers=h,
        )
        assert created.status_code == 200
        assert created.json()["user"]["simple_rooms"] == ["Levin"]

        # Ändern und wieder aufheben.
        updated = client.put(
            "/api/users/Levin", json={"simple_rooms": ["Levin", "Wohnzimmer"]}, headers=h
        )
        assert updated.json()["user"]["simple_rooms"] == ["Levin", "Wohnzimmer"]
        cleared = client.put("/api/users/Levin", json={"simple_rooms": []}, headers=h)
        assert cleared.json()["user"]["simple_rooms"] == []

        # Persistiert wird mit: Der gespeicherte Eintrag trägt das Feld.
        client.put("/api/users/Levin", json={"simple_rooms": ["Levin"]}, headers=h)
        stored = hub.data.get("users")
        levin = next(entry for entry in stored if entry["name"] == "Levin")
        assert levin["simple_rooms"] == ["Levin"]
