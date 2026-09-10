"""Das Personenbild über die Schnittstelle: setzen, holen, entfernen.

Der Teil, der sich nur hier prüfen lässt: die Rechte. Anders als beim
Raumbild (edit_devices, gilt fürs ganze Haus) ist ein Personenbild
selbst gehörig - jeder darf seines setzen, nur für eine fremde Person
braucht es MANAGE_USERS (Punkt 415).
"""

import base64

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config

BILD = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0 Foto").decode()


def haus(tmp_path):
    """Ein Hub mit Datendatei und drei Menschen."""
    return Hub(
        make_config(
            token="geheim",
            data_file=str(tmp_path / "homepilot-data.json"),
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

        assert client.get("/api/persons/images", headers=stefan).json() == {"images": {}}

        antwort = client.put(
            "/api/persons/Stefan/image", json={"image": BILD}, headers=stefan
        )
        assert antwort.status_code == 200
        assert "Stefan" in antwort.json()["images"]

        bild = client.get("/api/persons/Stefan/image", headers=stefan)
        assert bild.status_code == 200
        assert bild.headers["content-type"] == "image/jpeg"
        assert bild.content.startswith(b"\xff\xd8")

        weg = client.delete("/api/persons/Stefan/image", headers=stefan)
        assert weg.json()["removed"] is True
        assert client.get("/api/persons/Stefan/image", headers=stefan).status_code == 404


def test_jeder_darf_sein_eigenes_bild_setzen(tmp_path):
    with TestClient(create_app(haus(tmp_path))) as client:
        livia = {"Authorization": "Bearer t-livia"}
        assert (
            client.put(
                "/api/persons/Livia/image", json={"image": BILD}, headers=livia
            ).status_code
            == 200
        )


def test_eine_fremde_person_braucht_manage_users(tmp_path):
    with TestClient(create_app(haus(tmp_path))) as client:
        livia = {"Authorization": "Bearer t-livia"}
        stefan = {"Authorization": "Bearer t-stefan"}

        # Livia darf nicht Stefans Bild setzen oder entfernen …
        assert (
            client.put(
                "/api/persons/Stefan/image", json={"image": BILD}, headers=livia
            ).status_code
            == 403
        )
        client.put("/api/persons/Stefan/image", json={"image": BILD}, headers=stefan)
        assert client.delete("/api/persons/Stefan/image", headers=livia).status_code == 403

        # … aber jeder Angemeldete darf es ansehen.
        assert client.get("/api/persons/Stefan/image", headers=livia).status_code == 200


def test_eine_unbekannte_person_bekommt_kein_bild(tmp_path):
    with TestClient(create_app(haus(tmp_path))) as client:
        stefan = {"Authorization": "Bearer t-stefan"}
        antwort = client.put(
            "/api/persons/Erfunden/image", json={"image": BILD}, headers=stefan
        )
        assert antwort.status_code == 404
        assert "Erfunden" in antwort.json()["detail"]


def test_ein_kaputtes_bild_sagt_was_fehlt(tmp_path):
    with TestClient(create_app(haus(tmp_path))) as client:
        stefan = {"Authorization": "Bearer t-stefan"}
        antwort = client.put(
            "/api/persons/Stefan/image",
            json={"image": "https://example.com/foto.jpg"},
            headers=stefan,
        )
        assert antwort.status_code == 400
        assert "data-URI" in antwort.json()["detail"]
