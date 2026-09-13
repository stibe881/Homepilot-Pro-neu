"""Der Verwalter sieht die Geräte der anderen (Punkt 625).

GET/DELETE /api/auth/sessions galten nur für den eigenen Namen. Verlor
Levin sein Telefon, konnte die Besitzerin nur den ganzen Benutzer sperren -
und «hat sich das iPad des Babysitters je abgemeldet?» beantwortete niemand.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config

OWNER = {"Authorization": "Bearer geheim"}


def _hub() -> Hub:
    return Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
        )
    )


def _anlegen(client, name, role="bewohner"):
    antwort = client.post(
        "/api/users",
        json={"name": name, "role": role, "password": "start1234",
              "features": ["licht"] if role == "gast" else []},
        headers=OWNER,
    )
    assert antwort.status_code == 200, antwort.text


def _anmelden(client, name, label):
    antwort = client.post(
        "/api/auth/login", json={"email": name, "password": "start1234", "label": label}
    )
    assert antwort.status_code == 200, antwort.text
    return antwort.json()["token"]




def test_der_verwalter_sieht_die_geraete_der_anderen_und_beendet_eines():
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        _anlegen(client, "Levin")
        iphone = _anmelden(client, "Levin", "iPhone")
        ipad = _anmelden(client, "Levin", "iPad")

        rows = client.get("/api/users/Levin/sessions", headers=OWNER).json()["sessions"]
        assert sorted(row["label"] for row in rows) == ["iPad", "iPhone"]
        # Ohne «dieses hier»: Der Verwalter fragt von seinem eigenen Gerät.
        assert not any(row["current"] for row in rows)

        verloren = next(row["id"] for row in rows if row["label"] == "iPhone")
        beendet = client.delete(f"/api/users/Levin/sessions/{verloren}", headers=OWNER)
        assert beendet.status_code == 200
        assert client.get("/api/me", headers={"Authorization": f"Bearer {iphone}"}).status_code == 401
        assert client.get("/api/me", headers={"Authorization": f"Bearer {ipad}"}).status_code == 200
        # Noch einmal: gibt es nicht mehr.
        assert client.delete(f"/api/users/Levin/sessions/{verloren}", headers=OWNER).status_code == 404


def test_die_geraeteliste_der_anderen_braucht_die_benutzerverwaltung():
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        _anlegen(client, "Levin")
        _anlegen(client, "Lina")
        levin = _anmelden(client, "Levin", "iPhone")
        lina = _anmelden(client, "Lina", "iPad")
        lina_sid = client.get("/api/users/Lina/sessions", headers=OWNER).json()["sessions"][0]["id"]

        eigen = {"Authorization": f"Bearer {levin}"}
        assert client.get("/api/users/Lina/sessions", headers=eigen).status_code == 403
        assert client.delete(f"/api/users/Lina/sessions/{lina_sid}", headers=eigen).status_code == 403
        assert client.get("/api/me", headers={"Authorization": f"Bearer {lina}"}).status_code == 200
        # Einen Namen, den es nicht gibt, gibt es auch hier nicht.
        assert client.get("/api/users/Niemand/sessions", headers=OWNER).status_code == 404
