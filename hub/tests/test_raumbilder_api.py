"""Das Raumbild über die Schnittstelle: setzen, holen, entfernen.

Der Teil, der sich nur hier prüfen lässt: die Rechte. Ein Raumbild gilt
fürs ganze Haus - setzen darf es, wer hier wohnt (edit_devices, dieselbe
Regel wie beim Namen eines Geräts), ansehen jeder, der ohnehin vor der
Kachel steht. Ein Gast tut weder das eine noch das andere.
"""

import base64

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config

BILD = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0 Foto").decode()


def haus(tmp_path):
    """Ein Hub mit Küche, Datendatei und drei Menschen."""
    return Hub(
        make_config(
            token="geheim",
            data_file=str(tmp_path / "homepilot-data.json"),
            rooms={"Küche": ["demo.light_livingroom"]},
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t-stefan"},
                {"name": "Livia", "role": "bewohner", "token": "t-livia"},
                {"name": "Besuch", "role": "gast", "token": "t-gast"},
            ],
        )
    )


def test_ein_bild_setzen_holen_und_entfernen(tmp_path):
    with TestClient(create_app(haus(tmp_path))) as client:
        stefan = {"Authorization": "Bearer t-stefan"}

        # Vorher hat kein Zimmer eines - die Kachel fällt auf ihre Farbe zurück.
        assert client.get("/api/rooms/images", headers=stefan).json() == {"images": {}}

        antwort = client.put("/api/rooms/Küche/image", json={"image": BILD}, headers=stefan)
        assert antwort.status_code == 200
        # Die Antwort bringt den neuen Stand mit: Die App muss nicht
        # gleich noch einmal fragen, nur um die Kachel zu zeichnen.
        assert "Küche" in antwort.json()["images"]

        bild = client.get("/api/rooms/Küche/image", headers=stefan)
        assert bild.status_code == 200
        assert bild.headers["content-type"] == "image/jpeg"
        assert bild.content.startswith(b"\xff\xd8")

        weg = client.delete("/api/rooms/Küche/image", headers=stefan)
        assert weg.json()["removed"] is True
        assert client.get("/api/rooms/Küche/image", headers=stefan).status_code == 404


def test_wer_hier_wohnt_darf_das_bild_setzen(tmp_path):
    """Dieselbe Regel wie beim Namen eines Geräts (edit_devices).

    Das Bild liegt neben der Datendatei und nicht in der config.yaml -
    wer hier wohnt, darf sagen, wie sein Zuhause aussieht. Ein Gast
    sieht die Kachel und sonst nichts.
    """
    with TestClient(create_app(haus(tmp_path))) as client:
        livia = {"Authorization": "Bearer t-livia"}
        gast = {"Authorization": "Bearer t-gast"}

        assert (
            client.put("/api/rooms/Küche/image", json={"image": BILD}, headers=livia).status_code
            == 200
        )
        assert (
            client.put("/api/rooms/Küche/image", json={"image": BILD}, headers=gast).status_code
            == 403
        )
        assert client.delete("/api/rooms/Küche/image", headers=gast).status_code == 403


def test_ein_zimmer_das_es_nicht_gibt_bekommt_kein_bild(tmp_path):
    """Sonst legte ein Tippfehler ein Bild an, das nie jemand sieht."""
    with TestClient(create_app(haus(tmp_path))) as client:
        stefan = {"Authorization": "Bearer t-stefan"}
        antwort = client.put("/api/rooms/Estrich/image", json={"image": BILD}, headers=stefan)
        assert antwort.status_code == 404
        assert "Estrich" in antwort.json()["detail"]


def test_die_schreibweise_des_hauses_gewinnt(tmp_path):
    """«küche» und «Küche» sind dasselbe Zimmer.

    Sonst hinge das Bild an der Schreibweise des Aufrufers, und die
    Kachel - die unter dem Namen aus der config.yaml fragt - bliebe leer.
    """
    with TestClient(create_app(haus(tmp_path))) as client:
        stefan = {"Authorization": "Bearer t-stefan"}
        client.put("/api/rooms/küche/image", json={"image": BILD}, headers=stefan)
        assert "Küche" in client.get("/api/rooms/images", headers=stefan).json()["images"]
        assert client.get("/api/rooms/Küche/image", headers=stefan).status_code == 200


def test_ein_kaputtes_bild_sagt_was_fehlt(tmp_path):
    with TestClient(create_app(haus(tmp_path))) as client:
        stefan = {"Authorization": "Bearer t-stefan"}
        antwort = client.put(
            "/api/rooms/Küche/image",
            json={"image": "https://example.com/foto.jpg"},
            headers=stefan,
        )
        assert antwort.status_code == 400
        assert "data-URI" in antwort.json()["detail"]
