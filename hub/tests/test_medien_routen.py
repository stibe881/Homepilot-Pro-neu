"""Die Musik-Routen: Nachtruhe, Dämpfen, Einblenden, Umziehen.

Lautstärke, Play und Pause sind Gerätebefehle und laufen über die
Gerätesteuerung; hier steht nur, was sich damit nicht ausdrücken lässt.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config


def make_client() -> TestClient:
    return TestClient(create_app(Hub(make_config())))


def test_nachtruhe_ist_aus_bis_jemand_sie_einschaltet():
    """Ein Deckel, den niemand bestellt hat, ist aus Sicht des
    Bedienenden ein Defekt."""
    with make_client() as client:
        antwort = client.get("/api/media/settings")
        assert antwort.status_code == 200
        daten = antwort.json()
        assert daten["night"]["on"] is False
        assert daten["cap_now"] is None
        # Gedämpft wird dagegen von Anfang an: Musik, die das Klingeln
        # übertönt, ist genau der Fall, für den es das Dämpfen gibt.
        assert daten["duck"] is True


def test_nachtruhe_setzen_und_lesen():
    with make_client() as client:
        antwort = client.put(
            "/api/media/settings",
            json={"on": True, "start": "23:00", "end": "06:30", "max": 25},
        )
        assert antwort.status_code == 200
        nacht = antwort.json()["night"]
        assert nacht == {"on": True, "from": "23:00", "to": "06:30", "max": 25}
        assert client.get("/api/media/settings").json()["night"] == nacht


def test_nachtruhe_lehnt_unsinn_lesbar_ab():
    with make_client() as client:
        antwort = client.put("/api/media/settings", json={"on": True, "start": "abends"})
        assert antwort.status_code == 400
        assert "HH:MM" in antwort.json()["detail"]


def test_daempfen_laesst_sich_abschalten():
    with make_client() as client:
        assert client.put("/api/media/settings", json={"duck": False}).json()["duck"] is False
        assert client.get("/api/media/settings").json()["duck"] is False


def test_einblenden_auf_eine_unbekannte_box():
    with make_client() as client:
        antwort = client.post("/api/media/gibt.es.nicht/fade", json={"volume": 30})
        assert antwort.status_code == 404


def test_verschieben_erklaert_warum_es_nicht_geht():
    """Eine Box, auf die jemand direkt castet, kann der Hub nicht
    umziehen - und sagt das, statt still nichts zu tun."""
    with make_client() as client:
        antwort = client.post(
            "/api/media/demo.speaker_kitchen/move", json={"to": "Wohnzimmer"}
        )
        assert antwort.status_code in (400, 404)
