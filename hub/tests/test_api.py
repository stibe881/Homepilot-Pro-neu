from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config


def make_client(token=None) -> TestClient:
    hub = Hub(make_config(token=token))
    return TestClient(create_app(hub))


def test_list_entities_and_command():
    with make_client() as client:
        response = client.get("/api/entities")
        assert response.status_code == 200
        entities = {entity["id"]: entity for entity in response.json()}
        assert entities["demo.light_livingroom"]["state"]["state"] == "off"

        response = client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on", "data": {"brightness": 42}},
        )
        assert response.status_code == 200
        assert response.json()["entity"]["state"] == {"state": "on", "brightness": 42}


def test_unknown_entity_and_command():
    with make_client() as client:
        assert (
            client.post(
                "/api/entities/nope.nope/command", json={"command": "turn_on"}
            ).status_code
            == 404
        )
        assert (
            client.post(
                "/api/entities/demo.temp_livingroom/command",
                json={"command": "turn_on"},
            ).status_code
            == 400
        )


def test_token_auth():
    with make_client(token="geheim") as client:
        assert client.get("/api/entities").status_code == 401
        assert (
            client.get(
                "/api/entities", headers={"Authorization": "Bearer geheim"}
            ).status_code
            == 200
        )


def test_websocket_snapshot_and_command():
    with make_client(token="geheim") as client:
        with client.websocket_connect("/ws?token=geheim") as websocket:
            snapshot = websocket.receive_json()
            assert snapshot["type"] == "snapshot"
            ids = [entity["id"] for entity in snapshot["entities"]]
            assert "demo.light_livingroom" in ids

            websocket.send_json(
                {
                    "type": "command",
                    "entity_id": "demo.light_livingroom",
                    "command": "turn_on",
                }
            )
            # Es kommen result + state_changed (Reihenfolge egal).
            messages = [websocket.receive_json(), websocket.receive_json()]
            types = {message["type"] for message in messages}
            assert types == {"result", "state_changed"}
            for message in messages:
                if message["type"] == "state_changed":
                    assert message["new_state"]["state"] == "on"
