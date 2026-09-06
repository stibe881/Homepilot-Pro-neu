"""Die Rolle «kind» (Punkt 245 der Werkbank).

Ein Kind war bisher ein Bewohner mit fünf verstreuten Einschränkungs-
feldern - wer eines vergass, hatte ein Kind mit Systemsicht. Als eigene
Rolle ist das Vorsichtige der Ausgangszustand: schalten und Verlauf ja,
alles Verstellende nein, und die Kinder-Ansicht ist der Normalfall.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.core.users import Role, kid_rooms

from .conftest import make_config

USERS = [
    {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
    # Nur die Ansicht gepflegt - die Schranke muss trotzdem halten.
    {
        "name": "Levin",
        "role": "kind",
        "token": "t-kind",
        "simple_rooms": ["Wohnzimmer"],
    },
    # Nur die Schranke gepflegt - die Ansicht muss trotzdem kommen.
    {"name": "Lina", "role": "kind", "token": "t-kind2", "rooms": ["Wohnzimmer"]},
    # Ein Bewohner mit Kinder-Ansicht, wie es sie heute schon gibt: An
    # dem darf sich durch die neue Rolle nichts ändern.
    {
        "name": "Partnerin",
        "role": "bewohner",
        "token": "t-resident",
        "simple_rooms": ["Wohnzimmer"],
    },
]

ROOMS = {
    "Wohnzimmer": ["demo.light_livingroom"],
    "Flur": ["demo.motion_hall"],
}


def make_client() -> TestClient:
    hub = Hub(make_config(users=USERS, rooms=ROOMS))
    return TestClient(create_app(hub))


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_kid_rooms_lets_one_field_stand_in_for_the_other():
    # Für Kinder springt das jeweils andere Feld ein ...
    assert kid_rooms(Role.KID, [], ["Levin"]) == ["Levin"]
    assert kid_rooms(Role.KID, ["Levin"], ["Wohnzimmer"]) == ["Levin"]
    # ... für alle anderen Rollen ändert sich nichts.
    assert kid_rooms(Role.RESIDENT, [], ["Levin"]) == []
    assert kid_rooms(Role.RESIDENT, ["Levin"], []) == ["Levin"]


def test_a_kid_can_switch_lights_and_look_at_the_history():
    with make_client() as client:
        me = client.get("/api/me", headers=auth("t-kind")).json()
        assert me["role"] == "kind"
        assert me["capabilities"] == ["control", "view_history"]

        assert (
            client.post(
                "/api/entities/demo.light_livingroom/command",
                json={"command": "turn_on"},
                headers=auth("t-kind"),
            ).status_code
            == 200
        )
        # Ohne Datenbank antwortet der Verlauf mit 503 - entscheidend ist,
        # dass die Berechtigung davor nicht mit 403 abweist.
        assert (
            client.get(
                "/api/entities/demo.light_livingroom/history",
                headers=auth("t-kind"),
            ).status_code
            == 503
        )


def test_a_kid_manages_no_users_and_edits_no_automations():
    with make_client() as client:
        kid = auth("t-kind")
        assert client.get("/api/users", headers=kid).status_code == 403
        assert (
            client.put(
                "/api/users/Lina", json={"enabled": False}, headers=kid
            ).status_code
            == 403
        )
        assert client.get("/api/automations", headers=kid).status_code == 403
        assert (
            client.post(
                "/api/automations/pause", json={"seconds": 60}, headers=kid
            ).status_code
            == 403
        )
        assert client.get("/api/system/status", headers=kid).status_code == 403


def test_for_a_kid_the_view_is_also_the_barrier():
    """Die Kinder-Ansicht räumte den Flur bisher nur aus dem Bild, nicht
    aus der Reichweite - wer das Token kannte, schaltete weiter alles."""
    with make_client() as client:
        ids = {
            entity["id"]
            for entity in client.get("/api/entities", headers=auth("t-kind")).json()
        }
        assert "demo.light_livingroom" in ids
        assert "demo.motion_hall" not in ids
        # Und der Befehl direkt auf die bekannte Geräte-Id hält auch nicht.
        assert client.post(
            "/api/entities/demo.motion_hall/command",
            json={"command": "turn_on"},
            headers=auth("t-kind"),
        ).status_code in (403, 404)


def test_for_a_kid_the_barrier_is_also_the_view():
    """Wer nur rooms pflegt, bekommt die Kinder-Ansicht trotzdem - die App
    zeigt sie, sobald simple_rooms etwas enthält."""
    with make_client() as client:
        me = client.get("/api/me", headers=auth("t-kind2")).json()
        assert me["simple_rooms"] == ["Wohnzimmer"]


def test_a_resident_with_the_kids_view_keeps_the_whole_house():
    """Bestehende Benutzer ändern sich nicht: Beim Bewohner bleibt
    simple_rooms eine blosse Ansicht, keine Schranke."""
    with make_client() as client:
        ids = {
            entity["id"]
            for entity in client.get("/api/entities", headers=auth("t-resident")).json()
        }
        assert "demo.motion_hall" in ids


def test_the_role_switch_to_kind_works_over_the_existing_user_route():
    with make_client() as client:
        owner = auth("t-owner")
        angelegt = client.post(
            "/api/users", json={"name": "Livia", "role": "bewohner"}, headers=owner
        )
        token = angelegt.json()["user"]["token"]
        assert client.get("/api/automations", headers=auth(token)).status_code == 200

        runter = client.put(
            "/api/users/Livia", json={"role": "kind"}, headers=owner
        )
        assert runter.status_code == 200
        assert runter.json()["user"]["role"] == "kind"
        # Dasselbe Token, engere Rechte - kein Neuanlegen nötig.
        me = client.get("/api/me", headers=auth(token)).json()
        assert me["capabilities"] == ["control", "view_history"]
        assert client.get("/api/automations", headers=auth(token)).status_code == 403

        # Und wieder zurück.
        hoch = client.put(
            "/api/users/Livia", json={"role": "bewohner"}, headers=owner
        )
        assert hoch.status_code == 200
        assert client.get("/api/automations", headers=auth(token)).status_code == 200
