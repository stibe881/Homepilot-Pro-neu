"""Initialpasswort beim Anlegen - und der Zwang, es zu wechseln.

Der Fall: «Man soll beim Erstellen ein Initialpasswort für den Benutzer
geben können, das der Benutzer beim Anmelden zurücksetzen muss.» Ein
Passwort, das der Verwalter kennt, ist ein geteilter Schlüssel - erst
der erzwungene Wechsel macht daraus einen eigenen.
"""

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import load_config
from homepilot.core.hub import Hub
from homepilot.core.persistence import strip_users

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18191 }}
integrations:
  - integration: demo
users:
  - name: Stefan
    role: besitzer
    token: t-owner
data_file: {data_file}
"""


@pytest.fixture
def client(tmp_path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(CONFIG.format(data_file=tmp_path / "data.json"))
    hub = Hub(load_config(config_file))
    with TestClient(create_app(hub)) as test_client:
        test_client.hub = hub
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def anlegen(client, passwort="initial-123"):
    return client.post(
        "/api/users",
        json={"name": "Maja", "role": "bewohner", "password": passwort},
        headers=auth("t-owner"),
    )


def test_anlegen_mit_initialpasswort_und_anmelden(client):
    antwort = anlegen(client)
    assert antwort.status_code == 200
    # Nie der Wert, nur die Tatsache.
    assert antwort.json()["user"]["password_set"] is True
    assert antwort.json()["user"]["must_change_password"] is True

    # Ohne Supabase-Block steht die Passwort-Anmeldung trotzdem offen.
    assert client.get("/api/auth/config").json()["password_login"] is True

    login = client.post(
        "/api/auth/login",
        json={"email": "Maja", "password": "initial-123", "label": "Majas iPhone"},
    )
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True
    # Die Sitzung trägt: Damit kommt Maja herein.
    token = login.json()["token"]
    assert client.get("/api/family", headers=auth(token)).status_code == 200


def test_falsches_passwort_gibt_nichts_heraus(client):
    anlegen(client)
    login = client.post(
        "/api/auth/login", json={"email": "Maja", "password": "daneben-123"}
    )
    assert login.status_code == 401
    # Ein unbekannter Name bekommt dieselbe Auskunft - Namen lassen sich
    # nicht durchprobieren.
    fremd = client.post(
        "/api/auth/login", json={"email": "Niemand", "password": "daneben-123"}
    )
    assert fremd.status_code == 401
    assert fremd.json()["detail"] == login.json()["detail"]


def test_der_wechsel_loescht_die_pflicht(client):
    anlegen(client)
    token = client.post(
        "/api/auth/login", json={"email": "Maja", "password": "initial-123"}
    ).json()["token"]

    # Mit falschem alten Passwort geht nichts - die Sitzung allein
    # reicht nicht.
    kaputt = client.post(
        "/api/auth/passwort-wechsel",
        json={"old": "daneben-123", "new": "mein-eigenes-9"},
        headers=auth(token),
    )
    assert kaputt.status_code == 403

    gut = client.post(
        "/api/auth/passwort-wechsel",
        json={"old": "initial-123", "new": "mein-eigenes-9"},
        headers=auth(token),
    )
    assert gut.status_code == 200

    # Das alte gilt nicht mehr, das neue schon - und die Pflicht ist weg.
    assert (
        client.post(
            "/api/auth/login", json={"email": "Maja", "password": "initial-123"}
        ).status_code
        == 401
    )
    login = client.post(
        "/api/auth/login", json={"email": "Maja", "password": "mein-eigenes-9"}
    )
    assert login.status_code == 200
    assert login.json()["must_change_password"] is False


def test_der_verwalter_setzt_zurueck_und_die_pflicht_kommt_wieder(client):
    anlegen(client)
    antwort = client.put(
        "/api/users/Maja",
        json={"password": "vergessen-11"},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200
    login = client.post(
        "/api/auth/login", json={"email": "Maja", "password": "vergessen-11"}
    )
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True


def test_kurze_passwoerter_werden_abgewiesen(client):
    antwort = anlegen(client, passwort="kurz")
    assert antwort.status_code == 400
    # Und der Benutzer wurde dabei nicht halb angelegt.
    assert anlegen(client).status_code == 200


def test_der_abdruck_verlaesst_keinen_export(client):
    anlegen(client)
    gespeichert = client.hub.data.get("users")
    assert gespeichert and gespeichert[0]["passwort"].get("hash")
    sauber = strip_users(gespeichert)
    assert "passwort" not in sauber[0]


def test_das_passwort_ueberlebt_den_neustart(client, tmp_path):
    anlegen(client)
    client.hub.data.flush()
    hub2 = Hub(load_config(tmp_path / "config.yaml"))
    with TestClient(create_app(hub2)) as client2:
        login = client2.post(
            "/api/auth/login", json={"email": "Maja", "password": "initial-123"}
        )
        assert login.status_code == 200
        assert login.json()["must_change_password"] is True
