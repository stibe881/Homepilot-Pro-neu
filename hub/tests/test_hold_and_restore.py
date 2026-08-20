"""Haltezeit am Auslöser, Sicherung zurückspielen, Durchsage-Basis."""

import json
import time

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import say
from homepilot.core.hub import Hub
from homepilot.core.persistence import DataStore

from .conftest import make_config


def test_state_trigger_with_hold_waits_and_rechecks():
    """«bleibt so für X»: Der kurze Gang zum Briefkasten löst nicht aus."""
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        created = client.post(
            "/api/automations",
            json={
                "alias": "Halten",
                "trigger": [
                    {
                        "type": "state",
                        "entity_id": "demo.light_livingroom",
                        "to": "on",
                        "for": 0.3,
                    }
                ],
                "action": [
                    {
                        "type": "command",
                        "entity_id": "demo.light_bedroom",
                        "command": "turn_on",
                    }
                ],
            },
        )
        assert created.status_code == 200

        # Kurzes Flackern: an und gleich wieder aus - darf nicht auslösen.
        client.post(
            "/api/entities/demo.light_livingroom/command", json={"command": "turn_on"}
        )
        client.post(
            "/api/entities/demo.light_livingroom/command", json={"command": "turn_off"}
        )
        time.sleep(0.6)
        bedroom = client.get("/api/entities/demo.light_bedroom").json()
        assert bedroom["state"]["state"] == "off"

        # Bleibt es an, läuft der Ablauf nach der Haltezeit.
        client.post(
            "/api/entities/demo.light_livingroom/command", json={"command": "turn_on"}
        )
        time.sleep(0.8)
        bedroom = client.get("/api/entities/demo.light_bedroom").json()
        assert bedroom["state"]["state"] == "on"


def test_restore_backup_roundtrip(tmp_path):
    store = DataStore(tmp_path / "homepilot-data.json")
    store.set("automations", [{"id": "a1", "alias": "Wichtig"}])
    made = store.backup()
    assert made is not None

    # «Versehentlich gelöscht» …
    store.set("automations", [])
    # … und zurückgespielt.
    store.restore_backup(made["name"])
    assert store.get("automations") == [{"id": "a1", "alias": "Wichtig"}]
    # Der Stand von vor dem Zurückspielen liegt als frische Sicherung da.
    assert len(store.backups()) >= 2

    # Pfad-Spielereien prallen ab.
    for evil in ("../homepilot-data.json", "etc/passwd", "homepilot-data-x.txt"):
        try:
            store.restore_backup(evil)
            raise AssertionError(f"{evil} wurde angenommen")
        except ValueError:
            pass


def test_say_remembers_the_base_address():
    hub = Hub(make_config())
    assert say.base_url(hub) is None
    say.remember_base(hub, "http://10.10.1.20:8123/")
    assert say.base_url(hub) == "http://10.10.1.20:8123"
    # Unverändert = kein erneutes Schreiben nötig, aber gleicher Wert.
    say.remember_base(hub, "http://10.10.1.20:8123")
    assert say.base_url(hub) == "http://10.10.1.20:8123"
