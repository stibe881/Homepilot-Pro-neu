"""Testmodus für neue Mitglieder (Punkt 665 der Werkbank).

Ein Befehl von einem Benutzer im Testmodus kommt an - Rückmeldung,
Zugriffsprotokoll, alles wie sonst -, erreicht aber nie die Integration.
Kein Zustand wird vorgetäuscht: Die Kachel zeigt schlicht keine Änderung.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.core.users import User, UserRegistry

from .conftest import make_config

USERS = [
    {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
    {"name": "Babysitter", "role": "gast", "token": "t-sandbox", "sandbox": True},
]

ROOMS = {"Wohnzimmer": ["demo.light_livingroom"]}


def make_client() -> TestClient:
    hub = Hub(make_config(users=USERS, rooms=ROOMS))
    return TestClient(create_app(hub))


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_update_setzt_und_hebt_den_testmodus_auf():
    registry = UserRegistry(
        [User(name="Anna", role="gast", token="t", editable=True)]
    )
    an = registry.update("Anna", sandbox=True)
    assert an.sandbox is True
    aus = registry.update("Anna", sandbox=False)
    assert aus.sandbox is False


def test_ein_befehl_im_testmodus_aendert_nichts_am_geraet():
    with make_client() as client:
        vorher = client.get(
            "/api/entities/demo.light_livingroom", headers=auth("t-sandbox")
        ).json()
        assert vorher["state"]["state"] == "off"

        antwort = client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on"},
            headers=auth("t-sandbox"),
        )
        assert antwort.status_code == 200
        körper = antwort.json()
        assert körper["ok"] is True
        assert körper["sandbox"] is True

        nachher = client.get(
            "/api/entities/demo.light_livingroom", headers=auth("t-sandbox")
        ).json()
        # Der Kern der Sache: keine Änderung, obwohl der Befehl mit 200
        # beantwortet wurde - das Gerät hat ihn nie gesehen.
        assert nachher["state"]["state"] == "off"


def test_derselbe_befehl_ohne_testmodus_schaltet_wirklich():
    with make_client() as client:
        antwort = client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on"},
            headers=auth("t-owner"),
        )
        assert antwort.status_code == 200
        assert "sandbox" not in antwort.json()

        nachher = client.get(
            "/api/entities/demo.light_livingroom", headers=auth("t-owner")
        ).json()
        assert nachher["state"]["state"] == "on"


def test_der_testmodus_steht_im_zugriffsprotokoll():
    with make_client() as client:
        client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on"},
            headers=auth("t-sandbox"),
        )
        # Jüngste zuerst (core/audit.py: entries()).
        rows = client.get("/api/system/audit", headers=auth("t-owner")).json()["entries"]
        letzte = rows[0]
        assert letzte["user"] == "Babysitter"
        assert "Testmodus" in letzte["command"]
