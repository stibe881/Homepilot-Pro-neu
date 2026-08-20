"""PIN fürs Entschärfen: gilt überall, mit Drossel, nie im Klartext."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import hash_pin, valid_pin

from .conftest import make_config


def test_pin_is_hashed_and_verified():
    entry = {"salt": "abc", "hash": hash_pin("1234", "abc")}
    assert valid_pin(entry, "1234") is True
    assert valid_pin(entry, "9999") is False
    assert valid_pin({}, "1234") is False


def _hub():
    return Hub(
        make_config(
            token="geheim",
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t-stefan"},
                {"name": "Livia", "role": "bewohner", "token": "t-livia"},
            ],
            integrations=[{"integration": "demo"}, {"integration": "alarm"}],
        )
    )


def test_disarm_needs_the_pin_once_set():
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        stefan = {"Authorization": "Bearer t-stefan"}
        livia = {"Authorization": "Bearer t-livia"}

        # PIN setzen darf nur, wer Benutzer verwaltet.
        assert (
            client.put("/api/alarm/pin", json={"pin": "2580"}, headers=livia).status_code
            == 403
        )
        assert (
            client.put("/api/alarm/pin", json={"pin": "12"}, headers=stefan).status_code
            == 400
        )
        assert (
            client.put("/api/alarm/pin", json={"pin": "2580"}, headers=stefan).status_code
            == 200
        )
        # Die PIN liegt nie im Klartext auf der Platte.
        stored = hub.data.get("alarm_pin")
        assert stored and "2580" not in str(stored)

        # Scharf schalten geht ohne PIN …
        armed = client.post(
            "/api/alarm/arm", json={"mode": "ausser_haus", "force": True}, headers=stefan
        )
        assert armed.status_code == 200

        # … Entschärfen nicht mehr.
        wrong = client.post("/api/alarm/disarm", json={"pin": "1111"}, headers=livia)
        assert wrong.status_code == 403
        assert "Falsche PIN" in wrong.json()["detail"]
        missing = client.post("/api/alarm/disarm", json={}, headers=livia)
        assert missing.status_code == 403

        ok = client.post("/api/alarm/disarm", json={"pin": "2580"}, headers=livia)
        assert ok.status_code == 200

        # Auch der generische Gerätebefehl kennt keine Hintertür.
        client.post(
            "/api/alarm/arm", json={"mode": "ausser_haus", "force": True}, headers=stefan
        )
        blocked = client.post(
            "/api/entities/alarm.anlage/command",
            json={"command": "disarm"},
            headers=livia,
        )
        # Der generische Befehlsweg meldet Integrationsfehler als 500 mit
        # lesbarem Text - entscheidend ist: nicht entschärft.
        assert blocked.status_code >= 400
        assert "PIN" in blocked.json()["detail"]
        via_command = client.post(
            "/api/entities/alarm.anlage/command",
            json={"command": "disarm", "data": {"pin": "2580"}},
            headers=livia,
        )
        assert via_command.status_code == 200

        # PIN entfernen: Entschärfen geht wieder ohne.
        client.put("/api/alarm/pin", json={"pin": ""}, headers=stefan)
        client.post(
            "/api/alarm/arm", json={"mode": "ausser_haus", "force": True}, headers=stefan
        )
        assert (
            client.post("/api/alarm/disarm", json={}, headers=stefan).status_code == 200
        )
