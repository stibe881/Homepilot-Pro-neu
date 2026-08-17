"""Szenen aus der App anlegen, ändern, löschen – mit denselben Regeln wie
bei den Abläufen: nur der Besitzer, und Konfig-Szenen gehören der Datei."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

USERS = [
    {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
    {"name": "Partnerin", "role": "bewohner", "token": "t-resident"},
]

CONFIG_SCENE = {
    "id": "kino",
    "name": "Kino",
    "actions": [{"entity_id": "demo.light_livingroom", "command": "turn_on"}],
}


def make_client() -> TestClient:
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            users=USERS,
            scenes=[CONFIG_SCENE],
        )
    )
    return TestClient(create_app(hub))


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


NEW_SCENE = {
    "name": "Feierabend",
    "icon": "wine-outline",
    "actions": [{"entity_id": "demo.light_livingroom", "command": "turn_on"}],
}


def test_owner_creates_updates_and_deletes_a_scene():
    with make_client() as client:
        created = client.post("/api/scenes", json=NEW_SCENE, headers=auth("t-owner"))
        assert created.status_code == 200
        scene_id = created.json()["scene"]["id"]

        scenes = client.get("/api/scenes", headers=auth("t-owner")).json()
        mine = next(scene for scene in scenes if scene["id"] == scene_id)
        assert mine["name"] == "Feierabend"
        assert mine["editable"] is True

        # Die neue Szene lässt sich sofort auslösen.
        activated = client.post(
            f"/api/scenes/{scene_id}/activate", headers=auth("t-owner")
        )
        assert activated.status_code == 200
        assert activated.json()["failed"] == []

        assert (
            client.put(
                f"/api/scenes/{scene_id}",
                json={**NEW_SCENE, "name": "Guten Abend"},
                headers=auth("t-owner"),
            ).status_code
            == 200
        )
        scenes = client.get("/api/scenes", headers=auth("t-owner")).json()
        assert any(scene["name"] == "Guten Abend" for scene in scenes)

        assert (
            client.delete(f"/api/scenes/{scene_id}", headers=auth("t-owner")).status_code
            == 200
        )
        scenes = client.get("/api/scenes", headers=auth("t-owner")).json()
        assert not any(scene["id"] == scene_id for scene in scenes)


def test_resident_may_not_edit_scenes():
    with make_client() as client:
        assert (
            client.post("/api/scenes", json=NEW_SCENE, headers=auth("t-resident")).status_code
            == 403
        )


def test_config_scenes_are_not_editable_via_api():
    with make_client() as client:
        scenes = client.get("/api/scenes", headers=auth("t-owner")).json()
        assert scenes[0]["editable"] is False
        assert (
            client.put(
                "/api/scenes/kino", json=NEW_SCENE, headers=auth("t-owner")
            ).status_code
            == 404
        )
        assert client.delete("/api/scenes/kino", headers=auth("t-owner")).status_code == 404


def test_scene_without_actions_is_rejected():
    with make_client() as client:
        assert (
            client.post(
                "/api/scenes",
                json={"name": "Leer", "actions": []},
                headers=auth("t-owner"),
            ).status_code
            == 400
        )


def test_scene_on_start_flag_roundtrip():
    with make_client() as client:
        created = client.post(
            "/api/scenes",
            json={**NEW_SCENE, "on_start": True},
            headers=auth("t-owner"),
        )
        assert created.status_code == 200
        scene_id = created.json()["scene"]["id"]
        scenes = client.get("/api/scenes", headers=auth("t-owner")).json()
        entry = next(scene for scene in scenes if scene["id"] == scene_id)
        assert entry["on_start"] is True

        # Beim Bearbeiten lässt sich das Flag auch wieder wegnehmen.
        response = client.put(
            f"/api/scenes/{scene_id}",
            json={**NEW_SCENE, "on_start": False},
            headers=auth("t-owner"),
        )
        assert response.status_code == 200
        scenes = client.get("/api/scenes", headers=auth("t-owner")).json()
        entry = next(scene for scene in scenes if scene["id"] == scene_id)
        assert entry["on_start"] is False


def test_scenes_and_automations_keep_their_category():
    """Kategorien werden frei benannt – wer einen neuen Namen tippt, hat ihn
    damit angelegt. Eine Liste erlaubter Namen gäbe es sonst zu pflegen,
    und eine Kategorie ohne Einträge braucht niemand."""
    with make_client() as client:
        scene = client.post(
            "/api/scenes",
            headers=auth("t-owner"),
            json={
                "name": "Kino",
                "actions": [{"entity_id": "demo.light_livingroom", "command": "turn_off"}],
                "category": "Wohnzimmer",
            },
        )
        assert scene.status_code == 200
        scene_id = scene.json()["scene"]["id"]
        stored = next(
            entry for entry in client.get("/api/scenes", headers=auth("t-owner")).json()
            if entry["id"] == scene_id
        )
        assert stored["category"] == "Wohnzimmer"

        automation = client.post(
            "/api/automations",
            headers=auth("t-owner"),
            json={
                "alias": "Licht am Abend",
                "trigger": [{"type": "sun", "event": "sunset"}],
                "action": [{"entity_id": "demo.light_livingroom", "command": "turn_on"}],
                "category": "Abend",
            },
        )
        assert automation.status_code == 200
        listed = client.get("/api/automations", headers=auth("t-owner")).json()["automations"]
        assert any(entry.get("category") == "Abend" for entry in listed)


def test_without_a_category_nothing_is_invented():
    with make_client() as client:
        client.post(
            "/api/scenes",
            headers=auth("t-owner"),
            json={
                "name": "Ohne",
                "actions": [{"entity_id": "demo.light_livingroom", "command": "turn_off"}],
            },
        )
        scenes = client.get("/api/scenes", headers=auth("t-owner")).json()
        assert all(entry["category"] is None for entry in scenes)
