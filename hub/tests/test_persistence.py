"""Was in der App entsteht, muss einen Neustart überleben."""

import json

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.persistence import DataStore

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


def make_config(data_file):
    return HubConfig(
        api=ApiConfig(),
        integrations=[{"integration": "demo"}],
        users=[OWNER],
        data_file=str(data_file),
    )


def auth(token="t-owner"):
    return {"Authorization": f"Bearer {token}"}


def test_datastore_writes_atomically(tmp_path):
    path = tmp_path / "daten.json"
    store = DataStore(path)
    store.set("users", [{"name": "Gast", "token": "g"}])

    assert json.loads(path.read_text())["users"][0]["name"] == "Gast"
    # Keine halben Dateien liegen lassen.
    assert list(tmp_path.glob("*.tmp")) == []
    # Tokens stehen darin – niemand sonst soll sie lesen.
    assert oct(path.stat().st_mode)[-3:] == "600"


def test_broken_file_does_not_stop_the_hub(tmp_path):
    path = tmp_path / "kaputt.json"
    path.write_text("{kein json", encoding="utf-8")
    assert DataStore(path).load()["users"] == []


def test_created_user_survives_a_restart(tmp_path):
    data_file = tmp_path / "daten.json"

    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        created = client.post(
            "/api/users", json={"name": "Ferienwohnung", "role": "gast"}, headers=auth()
        )
        token = created.json()["user"]["token"]
        assert created.json()["user"]["editable"] is True

    # Neuer Hub, dieselbe Datei – der Zugang muss weiterhin gelten.
    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        me = client.get("/api/me", headers=auth(token))
        assert me.status_code == 200
        assert me.json()["role"] == "gast"


def test_config_users_stay_read_only(tmp_path):
    with TestClient(create_app(Hub(make_config(tmp_path / "d.json")))) as client:
        response = client.delete("/api/users/Stefan", headers=auth())
        # Sich selbst löschen ist ohnehin gesperrt; entscheidend ist,
        # dass Konfigurationsbenutzer nicht in der Datei landen.
        assert response.status_code == 400
        assert client.get("/api/users", headers=auth()).json()[0]["editable"] is False


def test_automation_can_be_created_changed_and_deleted(tmp_path):
    data_file = tmp_path / "daten.json"
    neu = {
        "alias": "Abendlicht",
        "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
        "action": [{"type": "command", "entity_id": "demo.light_bedroom",
                    "command": "turn_on"}],
    }

    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        created = client.post("/api/automations", json=neu, headers=auth())
        assert created.status_code == 200
        automation_id = created.json()["automation"]["id"]

        listing = client.get("/api/automations", headers=auth()).json()["automations"]
        entry = next(item for item in listing if item["id"] == automation_id)
        assert entry["alias"] == "Abendlicht"
        assert entry["editable"] is True

        # Ändern
        assert (
            client.put(
                f"/api/automations/{automation_id}",
                json={**neu, "alias": "Abendlicht neu"},
                headers=auth(),
            ).status_code
            == 200
        )

    # Nach dem Neustart noch da – und wirksam.
    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        listing = client.get("/api/automations", headers=auth()).json()["automations"]
        assert any(item["alias"] == "Abendlicht neu" for item in listing)

        client.post(
            "/api/entities/demo.motion_hall/command",
            json={"command": "turn_on"},
            headers=auth(),
        )
        entity = client.get(
            "/api/entities/demo.light_bedroom", headers=auth()
        ).json()
        assert entity["state"]["state"] == "on"

        assert (
            client.delete(f"/api/automations/{automation_id}", headers=auth()).status_code
            == 200
        )


def test_config_automations_cannot_be_edited(tmp_path):
    config = make_config(tmp_path / "d.json")
    config.automations = [{"id": "aus_config", "alias": "Fest", "trigger": [], "action": []}]
    with TestClient(create_app(Hub(config))) as client:
        assert (
            client.delete("/api/automations/aus_config", headers=auth()).status_code == 404
        )
        listing = client.get("/api/automations", headers=auth()).json()["automations"]
        assert listing[0]["editable"] is False
