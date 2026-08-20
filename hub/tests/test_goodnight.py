"""Gute Nacht: Lichter aus ausser Nachtlichter, Bericht statt Abschliessen."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.goodnight import lights_to_off, unlocked_locks
from homepilot.core.hub import Hub

from .conftest import make_config


class _E:
    def __init__(self, id, kind, state, combined_into=None, name=None):
        self.id, self.kind, self.state = id, kind, state
        self.combined_into = combined_into
        self.name = name or id


def test_lights_to_off_spares_night_lights_and_members():
    entities = [
        _E("hue.decke", "light", {"state": "on"}),
        _E("hue.nachtlicht", "light", {"state": "on"}),
        _E("hue.aus", "light", {"state": "off"}),
        # Spot in einer Leuchte: die Leuchte bekommt den Befehl selbst.
        _E("hue.spot", "light", {"state": "on"}, combined_into="group.lampe"),
        # Steckdose: dahinter kann die Tiefkühltruhe hängen.
        _E("shelly.truhe", "switch", {"state": "on"}),
    ]
    off = lights_to_off(entities, ["hue.nachtlicht"])
    assert [entity.id for entity in off] == ["hue.decke"]


def test_unlocked_locks_are_reported():
    entities = [
        _E("nuki.haustuer", "lock", {"state": "unlocked"}),
        _E("nuki.keller", "lock", {"state": "locked"}),
    ]
    assert [entity.id for entity in unlocked_locks(entities)] == ["nuki.haustuer"]


def test_goodnight_over_the_api():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        # Ein Licht brennt, eines ist Nachtlicht.
        for entity_id in ("demo.light_livingroom", "demo.light_bedroom"):
            client.post(
                f"/api/entities/{entity_id}/command", json={"command": "turn_on"}
            )
        saved = client.put(
            "/api/goodnight",
            json={"night_lights": ["demo.light_bedroom"], "arm_alarm": False},
        )
        assert saved.status_code == 200
        assert saved.json()["night_lights"] == ["demo.light_bedroom"]

        result = client.post("/api/goodnight/run").json()
        assert "Wohnzimmerlampe" in " ".join(result["lights_off"]) or result["lights_off"]
        # Das Nachtlicht brennt weiter.
        bedroom = client.get("/api/entities/demo.light_bedroom").json()
        assert bedroom["state"]["state"] == "on"
        livingroom = client.get("/api/entities/demo.light_livingroom").json()
        assert livingroom["state"]["state"] == "off"
        assert result["alarm"] is None
