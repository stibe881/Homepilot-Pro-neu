"""Eine neue Anmeldung erfährt nicht nur das Log (Punkt 626).

Jede Passwort-Anmeldung endete in log.warning(). Wer sich mit Stefans
Passwort auf einem fremden Gerät anmeldete, wurde von niemandem bemerkt -
und der Besitzer sah nicht, dass der Babysitter-Zugang gerade von einem
dritten Gerät kam.
"""

import time

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


def _abfangen(hub):
    """Alles, was der Hub schicken will, landet hier statt bei Expo."""
    gesendet: list[dict] = []

    async def fake_send(tokens, title, body, data=None, image=None, category=None):
        gesendet.append(
            {"tokens": list(tokens), "title": title, "body": body,
             "data": data or {}, "category": category}
        )
        return None

    hub.push.send = fake_send  # type: ignore[assignment]
    return gesendet


def _warten(gesendet, anzahl, sekunden=2.0):
    """Die Meldung geht im Hintergrund raus - kurz darauf warten."""
    ende = time.monotonic() + sekunden
    while len(gesendet) < anzahl and time.monotonic() < ende:
        time.sleep(0.02)
    return gesendet


def test_die_sitzung_traegt_die_adresse():
    """«iPhone von Anna» sagt, wie das Gerät heisst - ob es im WLAN stand
    oder in einem fremden Netz, sagt erst die Adresse."""
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        _anlegen(client, "Levin")
        token = _anmelden(client, "Levin", "iPhone")
        rows = client.get(
            "/api/auth/sessions", headers={"Authorization": f"Bearer {token}"}
        ).json()["sessions"]
        assert rows[0]["address"] == "testclient"




def test_eine_neue_anmeldung_erreicht_die_anderen_geraete_der_person():
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        _anlegen(client, "Levin")
        hub.push.register("tok-levin-alt", "Levin")
        hub.push.register("tok-stefan", "Stefan")
        gesendet = _abfangen(hub)

        token = _anmelden(client, "Levin", "iPhone von Anna")
        _warten(gesendet, 1)
        assert len(gesendet) == 1, gesendet
        meldung = gesendet[0]
        # An Levins altes Gerät - nicht an Stefan, es ist Levins Konto.
        assert meldung["tokens"] == ["tok-levin-alt"]
        assert meldung["category"] == "login"
        assert "iPhone von Anna" in meldung["body"]
        assert "Warst du das?" in meldung["body"]
        assert meldung["data"]["ziel"] == "bereich:account"
        # Der Knopf zeigt auf genau diese neue Sitzung.
        knopf = meldung["data"]["knoepfe"][0]
        assert knopf["label"].startswith("Nicht ich")
        assert knopf["user"] == "Levin"
        assert knopf["sitzung"] == hub.sessions.id_for(token)
        # Und der Knopf tut, was er verspricht: das Gerät ist danach draussen.
        assert client.delete(
            f"/api/auth/sessions/{knopf['sitzung']}",
            headers={"Authorization": f"Bearer {token}"},
        ).status_code == 200
        assert client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_bei_gast_und_kind_erfahren_es_auch_die_besitzer():
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        _anlegen(client, "Babysitter", role="gast")
        hub.push.register("tok-stefan", "Stefan")
        gesendet = _abfangen(hub)

        _anmelden(client, "Babysitter", "Fremdes Tablet")
        _warten(gesendet, 1)
        # Der Gast hat kein anderes Gerät - also genau eine Meldung, an
        # die Besitzer, mit dem Ziel in der Benutzerverwaltung (625).
        assert [m["tokens"] for m in gesendet] == [["tok-stefan"]]
        assert gesendet[0]["title"] == "Babysitter: neues Gerät angemeldet"
        assert gesendet[0]["data"]["ziel"] == "bereich:users"
        assert gesendet[0]["data"]["knoepfe"][0]["user"] == "Babysitter"


def test_die_bremse_meldet_sich_genau_einmal():
    """Zehn falsche Passwörter: eine Push an die Besitzer - nicht zehn,
    und nicht null."""
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        _anlegen(client, "Levin")
        hub.push.register("tok-stefan", "Stefan")
        gesendet = _abfangen(hub)
        for _ in range(12):
            client.post(
                "/api/auth/login", json={"email": "Levin", "password": "falsch1234"}
            )
        _warten(gesendet, 1)
        time.sleep(0.1)
        sperren = [m for m in gesendet if m["title"] == "Anmeldung gesperrt"]
        assert len(sperren) == 1
        assert "testclient" in sperren[0]["body"]
        assert sperren[0]["tokens"] == ["tok-stefan"]
        assert sperren[0]["category"] == "login"


def test_ohne_angemeldete_geraete_geht_nichts_hinaus():
    """Kein Telefon, kein Push - und vor allem kein Fehler beim Anmelden."""
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        _anlegen(client, "Levin")
        gesendet = _abfangen(hub)
        _anmelden(client, "Levin", "iPhone")
        time.sleep(0.1)
        assert gesendet == []
