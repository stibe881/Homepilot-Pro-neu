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


def test_cors_preflight_is_allowed():
    """Ohne diese Kopfzeilen blockiert der Browser die Web-Fassung der App."""
    with make_client(token="geheim") as client:
        response = client.options(
            "/api/automations",
            headers={
                "Origin": "http://192.168.1.50:8081",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "*"


def test_cors_header_on_normal_request():
    with make_client() as client:
        response = client.get(
            "/api/entities", headers={"Origin": "http://192.168.1.50:8081"}
        )
        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers


def test_trigger_automation_runs_actions_now():
    with make_client() as client:
        created = client.post(
            "/api/automations",
            json={
                "alias": "Testlauf",
                "trigger": [{"type": "time", "at": "03:00"}],
                "condition": [],
                "action": [
                    {
                        "type": "command",
                        "entity_id": "demo.light_livingroom",
                        "command": "turn_on",
                    }
                ],
            },
        )
        assert created.status_code == 200
        automation_id = created.json()["automation"]["id"]

        # Ohne Auslöser: der Testknopf führt die Aktion sofort aus.
        run = client.post(f"/api/automations/{automation_id}/trigger")
        assert run.status_code == 200
        assert run.json()["ok"] is True

        entity = client.get("/api/entities/demo.light_livingroom").json()
        assert entity["state"]["state"] == "on"


def test_trigger_unknown_automation_is_404():
    with make_client() as client:
        assert client.post("/api/automations/nope/trigger").status_code == 404


def test_push_test_endpoint_reports_recipient_count():
    with make_client() as client:
        # Ohne registriertes Gerät geht die Nachricht an niemanden.
        response = client.post("/api/push/test")
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True
        assert body["sent"] == 0


def test_entity_meta_rename_favorite_group():
    with make_client() as client:
        # Umbenennen + als Favorit markieren.
        response = client.put(
            "/api/entities/demo.light_livingroom/meta",
            json={"name": "Stehlampe", "favorite": True, "group": "Wohnen"},
        )
        assert response.status_code == 200
        entity = response.json()["entity"]
        assert entity["name"] == "Stehlampe"
        assert entity["favorite"] is True
        assert entity["group"] == "Wohnen"

        # Teil-Update: nur Favorit lösen, Name bleibt.
        response = client.put(
            "/api/entities/demo.light_livingroom/meta",
            json={"favorite": False},
        )
        entity = response.json()["entity"]
        assert entity["favorite"] is False
        assert entity["name"] == "Stehlampe"

        # In der Gesamtliste taucht der neue Name auf.
        entities = {e["id"]: e for e in client.get("/api/entities").json()}
        assert entities["demo.light_livingroom"]["name"] == "Stehlampe"


def test_entity_meta_unknown_entity_is_404():
    with make_client() as client:
        assert (
            client.put("/api/entities/nope.nope/meta", json={"favorite": True}).status_code
            == 404
        )


def test_entities_report_last_seen_timestamp():
    with make_client() as client:
        entities = {e["id"]: e for e in client.get("/api/entities").json()}
        light = entities["demo.light_livingroom"]
        # Erreichbare Geräte tragen einen «zuletzt gesehen»-Zeitstempel.
        assert light["available"] is True
        assert isinstance(light["last_seen"], (int, float))
        assert light["last_seen"] > 0
