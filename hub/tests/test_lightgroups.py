"""Mehrere Lampen als eine Leuchte.

Der Fall: Eine Deckenlampe besteht aus fünf Spots, und die Bridge meldet
fünf Lichter. Der Gewinn entsteht erst dadurch, dass die Spots danach
verschwinden – sonst steht bloss eine Kachel mehr da und die Zählung ist
doppelt.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.integrations.group import combined_state, merged_commands, slug

from .conftest import make_config


class FakeMember:
    """Ein Mitglied, so viel davon wie combined_state braucht."""

    def __init__(self, state, commands=(), available=True):
        self.state = state
        self.commands = list(commands)
        self.available = available


def test_slug_stays_stable():
    """Die Kennung steht später in Szenen und Abläufen - sie darf sich
    nicht ändern, nur weil jemand den Namen anders schreibt."""
    assert slug("Deckenlampe Wohnzimmer") == "deckenlampe_wohnzimmer"
    assert slug("  Spot-Reihe #2 ") == "spot_reihe_2"
    assert slug("---") == "leuchte"


def test_one_lit_spot_means_the_lamp_is_on():
    """Das ist die Frage, die man beim Hereinkommen stellt."""
    members = [
        FakeMember({"state": "off"}),
        FakeMember({"state": "on"}),
        FakeMember({"state": "off"}),
    ]
    shaped = combined_state(members, True)
    assert shaped["state"] == "on"
    assert shaped["members"] == 3
    assert shaped["members_on"] == 1

    assert combined_state([FakeMember({"state": "off"})], True)["state"] == "off"


def test_brightness_averages_only_the_lit_spots():
    """Ein ausgeschalteter Spot mit gespeicherten 0 % zöge den Wert sonst
    nach unten, und die Anzeige wäre falsch."""
    members = [
        FakeMember({"state": "on", "brightness": 80}),
        FakeMember({"state": "on", "brightness": 60}),
        FakeMember({"state": "off", "brightness": 0}),
    ]
    assert combined_state(members, True)["brightness"] == 70
    # Ohne eingeschaltetes Mitglied gibt es keine Helligkeit zu zeigen.
    assert "brightness" not in combined_state([FakeMember({"state": "off"})], True)


def test_a_lamp_can_do_what_any_of_its_spots_can():
    """Bewusst die Vereinigung: Hat ein Spot Farbe und ein anderer nur
    Weiss, soll die Farbe trotzdem bedienbar sein."""
    members = [
        FakeMember({}, ["turn_on", "turn_off", "set_brightness"]),
        FakeMember({}, ["turn_on", "turn_off", "set_color"]),
    ]
    can = merged_commands(members, True)
    assert "set_brightness" in can and "set_color" in can
    # Schalten geht immer, auch wenn gerade kein Mitglied erreichbar ist.
    assert merged_commands([None], True)[:3] == ["turn_on", "turn_off", "toggle"]
    # Ein Schalter bekommt keine Lichtbefehle angedichtet.
    assert "set_color" not in merged_commands(members, False)


def _hub():
    return Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
            integrations=[{"integration": "demo"}, {"integration": "group"}],
        )
    )


def test_members_disappear_from_the_normal_views():
    """Ohne das wäre nichts gewonnen - es stünde nur eine Kachel mehr da."""
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        created = client.post(
            "/api/lightgroups",
            json={
                "name": "Deckenlampe Wohnzimmer",
                "members": ["demo.light_livingroom", "demo.light_bedroom"],
            },
            headers=headers,
        )
        assert created.status_code == 200
        assert created.json()["id"] == "group.deckenlampe_wohnzimmer"

        entities = {e["id"]: e for e in client.get("/api/entities", headers=headers).json()}
        # Die Leuchte gibt es …
        assert "group.deckenlampe_wohnzimmer" in entities
        # … und die Spots tragen jetzt, wozu sie gehören.
        for member in ("demo.light_livingroom", "demo.light_bedroom"):
            assert entities[member]["combined_into"] == "group.deckenlampe_wohnzimmer"

        # Schalten der Leuchte schaltet beide Spots.
        geschaltet = client.post(
            "/api/entities/group.deckenlampe_wohnzimmer/command",
            json={"command": "turn_on"},
            headers=headers,
        )
        assert geschaltet.status_code == 200
        for member in ("demo.light_livingroom", "demo.light_bedroom"):
            assert (
                client.get(f"/api/entities/{member}", headers=headers).json()["state"]["state"]
                == "on"
            )


def test_a_spot_belongs_to_one_lamp_only():
    """Sonst wäre unklar, welche Leuchte ihn schaltet."""
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        client.post(
            "/api/lightgroups",
            json={"name": "Decke", "members": ["demo.light_livingroom", "demo.light_bedroom"]},
            headers=headers,
        )
        doppelt = client.post(
            "/api/lightgroups",
            json={"name": "Andere", "members": ["demo.light_livingroom", "demo.switch_coffee"]},
            headers=headers,
        )
        assert doppelt.status_code == 409

        # Eine Leuchte mit nur einem Mitglied fasst nichts zusammen.
        assert (
            client.post(
                "/api/lightgroups",
                json={"name": "Einzeln", "members": ["demo.switch_coffee"]},
                headers=headers,
            ).status_code
            == 400
        )


def test_dissolving_a_lamp_gives_the_spots_back():
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        client.post(
            "/api/lightgroups",
            json={"name": "Decke", "members": ["demo.light_livingroom", "demo.light_bedroom"]},
            headers=headers,
        )
        assert client.delete("/api/lightgroups/group.decke", headers=headers).status_code == 200

        entities = {e["id"]: e for e in client.get("/api/entities", headers=headers).json()}
        assert "group.decke" not in entities
        for member in ("demo.light_livingroom", "demo.light_bedroom"):
            assert entities[member]["combined_into"] is None
