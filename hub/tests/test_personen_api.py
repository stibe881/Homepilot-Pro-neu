"""Die Seite «Familie und Freunde» von aussen: Liste und Schalter."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import personen
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

TOKEN = "probe-token"


def make_hub() -> Hub:
    return Hub(
        HubConfig(
            api=ApiConfig(token=TOKEN),
            integrations=[
                {
                    "integration": "geofence",
                    "zones": [
                        {"id": "stefan", "name": "Stefan"},
                        # Kein Hub-Benutzer, nur ein Telefon - so kommen
                        # die Kinder über Life360 herein.
                        {"id": "maja", "name": "Maja"},
                    ],
                }
            ],
            automations=[],
            users=[
                {"name": "Stefan", "role": "besitzer", "token": TOKEN},
                # Ein Gast gehört nicht in die Familienliste.
                {"name": "Besuch", "role": "gast", "token": "gast-token"},
            ],
        )
    )


def kopf() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def test_the_list_holds_household_and_tracked_people():
    with TestClient(create_app(make_hub())) as client:
        antwort = client.get("/api/personen", headers=kopf())
        assert antwort.status_code == 200
        daten = antwort.json()
        namen = [p["name"] for p in daten["people"]]
        # Der Haushalt zuerst, danach die, die der Hub nur sieht.
        assert namen == ["Stefan", "Maja"]
        assert "Besuch" not in namen
        # Die Beschriftungen kommen mit, damit sie nicht ein zweites Mal
        # in der App stehen.
        assert daten["meldungen"]["battery"] == "Telefon fast leer"

        stefan, maja = daten["people"]
        assert stefan["household"] is True
        assert maja["household"] is False
        # Die Frage, wegen der man die Seite öffnet.
        assert stefan["where"] == "unbekannt"
        assert stefan["meldungen"] == personen.STANDARD


def test_a_switch_survives_and_comes_back_in_the_list():
    with TestClient(create_app(make_hub())) as client:
        antwort = client.post(
            "/api/personen/maja/meldungen",
            headers=kopf(),
            json={"key": "arrive", "enabled": True},
        )
        assert antwort.status_code == 200
        assert antwort.json()["meldungen"]["arrive"] is True

        daten = client.get("/api/personen", headers=kopf()).json()
        maja = next(p for p in daten["people"] if p["name"] == "Maja")
        assert maja["meldungen"]["arrive"] is True
        # Und nur bei ihr.
        stefan = next(p for p in daten["people"] if p["name"] == "Stefan")
        assert stefan["meldungen"]["arrive"] is False


def test_nonsense_is_refused_instead_of_quietly_stored():
    with TestClient(create_app(make_hub())) as client:
        # Ein Mensch ohne Ortung hat nichts, worüber zu melden wäre.
        antwort = client.post(
            "/api/personen/gibtsnicht/meldungen",
            headers=kopf(),
            json={"key": "arrive", "enabled": True},
        )
        assert antwort.status_code == 404
        # Und ein Tippfehler soll keine Meldung anlegen, die nie kommt.
        antwort = client.post(
            "/api/personen/stefan/meldungen",
            headers=kopf(),
            json={"key": "gibtsnicht", "enabled": True},
        )
        assert antwort.status_code == 400


def test_where_someone_is_follows_the_location():
    """Der fertige Satzteil kommt vom Hub, nicht aus der App: «bei
    Tanners Home» hängt daran, welche Orte Life360 mitgeschickt hat."""
    with TestClient(create_app(make_hub())) as client:
        client.post(
            "/api/presence/geofence",
            headers=kopf(),
            json={"zone": "maja", "event": "enter"},
        )
        daten = client.get("/api/personen", headers=kopf()).json()
        maja = next(p for p in daten["people"] if p["name"] == "Maja")
        assert maja["where"] == "zuhause"

        client.post(
            "/api/presence/geofence",
            headers=kopf(),
            json={"zone": "maja", "event": "leave"},
        )
        daten = client.get("/api/personen", headers=kopf()).json()
        maja = next(p for p in daten["people"] if p["name"] == "Maja")
        assert maja["where"] == "unterwegs"
