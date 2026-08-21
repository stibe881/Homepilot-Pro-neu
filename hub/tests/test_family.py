"""Geteilte Familien-Listen: anlegen, abhaken, löschen – und Gäste bleiben draussen."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

USERS = [
    {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
    {"name": "Partnerin", "role": "bewohner", "token": "t-resident"},
    {"name": "Gast", "role": "gast", "token": "t-guest"},
]


def make_client() -> TestClient:
    hub = Hub(
        HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}], users=USERS)
    )
    return TestClient(create_app(hub))


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_family_roundtrip():
    with make_client() as client:
        # Bewohnerin legt eine Aufgabe an.
        response = client.post(
            "/api/family/tasks",
            json={"text": "Altglas wegbringen", "done": False},
            headers=auth("t-resident"),
        )
        assert response.status_code == 200
        item = response.json()
        assert item["author"] == "Partnerin"
        assert item["text"] == "Altglas wegbringen"

        # Besitzer sieht sie und hakt sie ab.
        data = client.get("/api/family", headers=auth("t-owner")).json()
        assert len(data["tasks"]) == 1
        response = client.put(
            f"/api/family/tasks/{item['id']}",
            json={"done": True},
            headers=auth("t-owner"),
        )
        assert response.status_code == 200
        assert response.json()["done"] is True
        # author bleibt unangetastet, auch wenn ihn jemand mitschickt.
        response = client.put(
            f"/api/family/tasks/{item['id']}",
            json={"author": "Hacker"},
            headers=auth("t-owner"),
        )
        assert response.json()["author"] == "Partnerin"

        # Und löscht sie wieder.
        assert (
            client.delete(
                f"/api/family/tasks/{item['id']}", headers=auth("t-owner")
            ).status_code
            == 200
        )
        data = client.get("/api/family", headers=auth("t-owner")).json()
        assert data["tasks"] == []


def test_family_blocks_guests_and_unknown_lists():
    with make_client() as client:
        assert client.get("/api/family", headers=auth("t-guest")).status_code == 403
        assert (
            client.post(
                "/api/family/tasks", json={"text": "x"}, headers=auth("t-guest")
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/family/quatsch", json={"text": "x"}, headers=auth("t-owner")
            ).status_code
            == 404
        )
        assert (
            client.delete(
                "/api/family/tasks/gibtsnicht", headers=auth("t-owner")
            ).status_code
            == 404
        )


def test_a_single_family_list_can_be_fetched():
    """Die Kopfzeile fragt jede Minute nach der Einkaufsliste.

    Ohne diesen Weg blieb nur /api/family - alles auf einmal, Rezepte und
    Dokumente eingeschlossen. Wer es einzeln versuchte, bekam «Methode
    nicht erlaubt» und in der App eine leere Liste, die aussah, als wäre
    nichts einzukaufen. Genau so war es.
    """
    with make_client() as client:
        client.post(
            "/api/family/shopping", json={"text": "Milch"}, headers=auth("t-resident")
        )
        client.post(
            "/api/family/shopping", json={"text": "Brot"}, headers=auth("t-resident")
        )

        antwort = client.get("/api/family/shopping", headers=auth("t-owner"))
        assert antwort.status_code == 200
        assert [eintrag["text"] for eintrag in antwort.json()] == ["Milch", "Brot"]

        # Eine leere Liste ist eine leere Liste, kein Fehler.
        assert client.get("/api/family/pins", headers=auth("t-owner")).json() == []
        # Erfundene Listen gibt es nicht.
        assert (
            client.get("/api/family/unfug", headers=auth("t-owner")).status_code == 404
        )
        # Und Gäste bleiben draussen, wie bei allen Familienlisten.
        assert (
            client.get("/api/family/shopping", headers=auth("t-guest")).status_code
            == 403
        )
