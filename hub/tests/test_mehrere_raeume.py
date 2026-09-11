"""Ein Gerät, das für mehrere Zimmer zählt (Punkt 539 der Werkbank).

Gewünscht im Haus: «man soll einen Sensor auch mehreren Räumen zuweisen
können». Der Fall ist der offene Wohnbereich - ein Klimafühler, und
Wohnzimmer wie Esszimmer sollen ihn zeigen.

Bis hierher gewann wortlos das zuletzt genannte Zimmer: Die Zuordnung
war ein Dict mit einem Schlüssel je Gerät. Wer den Fühler unter beiden
Räumen aufführte, bekam keinen Fehler und kein zweites Zimmer.
"""

import pytest
from fastapi.testclient import TestClient

from homepilot.api.server import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def hub_und_client(tmp_path):
    hub = Hub(
        HubConfig(
            api=ApiConfig(token="t-owner"),
            integrations=[{"integration": "demo"}],
            rooms={
                "Wohnzimmer": ["demo.light_livingroom", "demo.temp_livingroom"],
                # Derselbe Fühler ein zweites Mal - genau der Fall.
                "Esszimmer": ["demo.temp_livingroom"],
            },
            data_file=str(tmp_path / "homepilot-data.json"),
        )
    )
    app = create_app(hub)
    with TestClient(app) as client:
        yield hub, client


def test_ein_fuehler_zaehlt_fuer_beide_zimmer(hub_und_client):
    hub, _ = hub_und_client
    fuehler = hub.registry.get("demo.temp_livingroom")
    assert fuehler.rooms == ["Wohnzimmer", "Esszimmer"]
    # Der Standort bleibt das zuerst genannte - dort liegt die Kachel.
    assert fuehler.room == "Wohnzimmer"
    # Und beide Zimmer sind dem Hub bekannt.
    assert "Esszimmer" in hub.known_rooms()


def test_ein_geraet_mit_einem_zimmer_bleibt_wie_es_war(hub_und_client):
    hub, _ = hub_und_client
    licht = hub.registry.get("demo.light_livingroom")
    assert licht.room == "Wohnzimmer"
    assert licht.rooms == ["Wohnzimmer"]


def test_die_liste_steht_im_schnappschuss_fuer_die_app(hub_und_client):
    _, client = hub_und_client
    antwort = client.get("/api/entities", headers=auth("t-owner"))
    assert antwort.status_code == 200
    geraete = {eintrag["id"]: eintrag for eintrag in antwort.json()}
    assert geraete["demo.temp_livingroom"]["rooms"] == ["Wohnzimmer", "Esszimmer"]


def test_die_app_darf_mehrere_zimmer_setzen(hub_und_client):
    hub, client = hub_und_client
    antwort = client.put(
        "/api/entities/demo.light_livingroom/room",
        json={"room": "Bad", "rooms": ["Bad", "Flur"]},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200, antwort.text
    assert antwort.json()["entity"]["rooms"] == ["Bad", "Flur"]
    assert hub.registry.get("demo.light_livingroom").room == "Bad"


def test_eine_aeltere_app_loescht_die_mehrfachzuordnung_nicht_versehentlich(
    hub_und_client,
):
    """Sie schickt nur `room` - und meint dann genau dieses eine Zimmer.

    Das ist Absicht und kein Widerspruch: Wer in einer Fassung ohne
    Mehrfachwahl ein Zimmer setzt, hat eines gewählt. Geprüft wird hier,
    dass der Hub daraus eine saubere Liste macht statt die alte
    danebenstehen zu lassen.
    """
    hub, client = hub_und_client
    client.put(
        "/api/entities/demo.temp_livingroom/room",
        json={"room": "Bad"},
        headers=auth("t-owner"),
    )
    assert hub.registry.get("demo.temp_livingroom").rooms == ["Bad"]


def test_doppelte_zimmer_sind_ein_tippfehler_kein_zweites_zimmer(hub_und_client):
    hub, client = hub_und_client
    client.put(
        "/api/entities/demo.temp_livingroom/room",
        json={"rooms": ["Bad", "Bad", " Flur "]},
        headers=auth("t-owner"),
    )
    assert hub.registry.get("demo.temp_livingroom").rooms == ["Bad", "Flur"]


def test_kein_zimmer_nimmt_das_geraet_aus_allen(hub_und_client):
    hub, client = hub_und_client
    client.put(
        "/api/entities/demo.temp_livingroom/room",
        json={"room": None, "rooms": []},
        headers=auth("t-owner"),
    )
    fuehler = hub.registry.get("demo.temp_livingroom")
    assert fuehler.rooms == []
    assert fuehler.room is None


def test_die_zuordnung_ueberlebt_einen_neustart(hub_und_client, tmp_path):
    hub, client = hub_und_client
    client.put(
        "/api/entities/demo.light_livingroom/room",
        json={"rooms": ["Bad", "Flur"]},
        headers=auth("t-owner"),
    )
    gespeichert = hub.data.get("entity_rooms")
    zeile = next(e for e in gespeichert if e["entity_id"] == "demo.light_livingroom")
    assert zeile["rooms"] == ["Bad", "Flur"]
    # `room` steht mit in der Zeile, damit eine ältere Fassung des Hubs
    # die Datei noch lesen kann.
    assert zeile["room"] == "Bad"
