"""Die neuen Familien- und Ortungs-Routen – gegen den echten Server.

Reine Rechenfunktionen prüft test_familienlisten.py; hier geht es um
das, was nur im Zusammenspiel schiefgehen kann: Papierkorb und Liste,
Bild und Adresse, Zonen und Diagnose.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

USERS = [
    {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
    {"name": "Gast", "role": "gast", "token": "t-guest"},
]

# 1×1 Pixel als PNG – klein genug für einen Test, echt genug für den Decoder.
WINZIG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM"
    "IQAAAABJRU5ErkJggg=="
)


def make_client(tmp_path=None, integrations=None) -> TestClient:
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=integrations or [{"integration": "demo"}],
            users=USERS,
            location={"latitude": 47.1445, "longitude": 8.0675, "address": "Musterweg 3"},
            data_file=str(tmp_path / "hub.json") if tmp_path else None,
        )
    )
    return TestClient(create_app(hub))


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_deleting_a_task_puts_it_in_the_bin_and_it_comes_back():
    with make_client() as client:
        item = client.post(
            "/api/family/tasks", json={"text": "Altglas"}, headers=auth("t-owner")
        ).json()
        client.delete(f"/api/family/tasks/{item['id']}", headers=auth("t-owner"))
        assert client.get("/api/family/tasks", headers=auth("t-owner")).json() == []

        korb = client.get("/api/family-trash", headers=auth("t-owner")).json()
        assert korb["items"][0]["name"] == "Altglas"

        client.post(
            f"/api/family-trash/tasks/{item['id']}/restore", headers=auth("t-owner")
        )
        zurueck = client.get("/api/family/tasks", headers=auth("t-owner")).json()
        assert [row["text"] for row in zurueck] == ["Altglas"]
        # Und nicht zweimal, wenn jemand zweimal tippt.
        client.post(
            f"/api/family-trash/tasks/{item['id']}/restore", headers=auth("t-owner")
        )
        assert len(client.get("/api/family/tasks", headers=auth("t-owner")).json()) == 1


def test_checking_something_off_records_when():
    with make_client() as client:
        item = client.post(
            "/api/family/shopping", json={"text": "Milch"}, headers=auth("t-owner")
        ).json()
        assert "done_at" not in item
        abgehakt = client.put(
            f"/api/family/shopping/{item['id']}",
            json={"done": True},
            headers=auth("t-owner"),
        ).json()
        # Ohne diesen Zeitpunkt kann Erledigtes nicht von selbst gehen.
        assert abgehakt["done_at"]
        # Und wieder aufgemacht ist er weg, nicht bloss alt.
        wieder = client.put(
            f"/api/family/shopping/{item['id']}",
            json={"done": False},
            headers=auth("t-owner"),
        ).json()
        assert "done_at" not in wieder


def test_a_recipe_photo_lands_next_to_the_data(tmp_path):
    with make_client(tmp_path) as client:
        rezept = client.post(
            "/api/family/recipes",
            json={"text": "Lasagne", "image_url": WINZIG},
            headers=auth("t-owner"),
        ).json()
        # Statt des base64-Klotzes steht jetzt eine Adresse im Datensatz.
        assert rezept["image_url"].startswith(f"/api/recipes/{rezept['id']}/bild?v=")
        bild = client.get(rezept["image_url"], headers=auth("t-owner"))
        assert bild.status_code == 200
        assert bild.content.startswith(b"\x89PNG")
        # Mit Fingerabdruck in der Adresse darf der Browser sie behalten.
        assert "immutable" in bild.headers["cache-control"]


def test_a_recipe_id_from_the_url_cannot_escape_the_folder(tmp_path):
    with make_client(tmp_path) as client:
        antwort = client.get("/api/recipes/..%2F..%2Fetc/bild", headers=auth("t-owner"))
        assert antwort.status_code == 404


def test_the_house_address_comes_from_the_configuration():
    with make_client() as client:
        antwort = client.get("/api/haus/adresse", headers=auth("t-owner")).json()
        assert antwort["address"] == "Musterweg 3"


def test_the_family_book_is_html_that_stands_on_its_own():
    with make_client() as client:
        client.post(
            "/api/family/contacts",
            json={"text": "Kinderärztin", "phone": "041 111 22 33"},
            headers=auth("t-owner"),
        )
        antwort = client.get("/api/family-book", headers=auth("t-owner"))
        assert antwort.status_code == 200
        assert "text/html" in antwort.headers["content-type"]
        assert "Kinderärztin" in antwort.text


def test_shopping_suggestions_need_a_rhythm():
    with make_client() as client:
        for _ in range(3):
            item = client.post(
                "/api/family/shopping", json={"text": "Milch"}, headers=auth("t-owner")
            ).json()
            client.delete(f"/api/family/shopping/{item['id']}", headers=auth("t-owner"))
        # Alles am selben Tag: Daraus lässt sich kein Abstand ableiten.
        assert client.get("/api/shopping/due", headers=auth("t-owner")).json()["items"] == []


def test_zones_need_the_integration():
    with make_client() as client:
        assert client.get("/api/presence/zones", headers=auth("t-owner")).status_code == 503


def test_without_the_integration_the_users_still_stand_there():
    """Eine leere Anwesenheitsliste sähe aus wie «niemand da».

    Die Liste steht für die Benutzer des Hubs. Fehlt die Ortung, ist die
    Antwort «Stefan meldet sich nicht» – das nennt auch gleich, was zu
    tun ist. Ein leerer Block sagte dagegen nichts."""
    with make_client() as client:
        leute = client.get("/api/presence", headers=auth("t-owner")).json()["people"]
        assert [p["name"] for p in leute] == ["Stefan"]
        assert leute[0]["state"] == "unknown"
        # Und er sagt, dass es nicht an der Person liegt, sondern an der
        # fehlenden Einrichtung.
        assert leute[0]["configured"] is False


def test_the_presence_list_shows_users_not_zones():
    """Wer «wer ist da?» fragt, meint die Leute, die hier wohnen – nicht
    die Einträge, die jemand einmal in die config.yaml geschrieben hat."""
    integrations = [
        {
            "integration": "geofence",
            "zones": [
                {"id": "stefan", "name": "Stefan"},
                # Diese Zone gehört zu keinem Benutzer.
                {"id": "putzfrau", "name": "Putzfrau"},
            ],
        }
    ]
    with make_client(integrations=integrations) as client:
        leute = client.get("/api/presence", headers=auth("t-owner")).json()["people"]
        assert [p["name"] for p in leute] == ["Stefan"]
        assert leute[0]["zone"] == "stefan"
        assert leute[0]["configured"] is True


def test_a_guest_is_never_in_the_presence_list():
    """Für Gäste ist die Ortung aus – dann gehören sie auch nicht in die
    Liste, die zeigt, wer wo ist."""
    with make_client() as client:
        leute = client.get("/api/presence", headers=auth("t-owner")).json()["people"]
        assert "Gast" not in [p["name"] for p in leute]


def test_the_hub_hands_out_its_places():
    integrations = [
        {"integration": "geofence", "zones": [{"id": "stefan", "name": "Stefan"}]}
    ]
    with make_client(integrations=integrations) as client:
        antwort = client.get("/api/presence/zones", headers=auth("t-owner")).json()
        # Ohne eigene Orte entstehen sie aus dem Hausstandort.
        assert [ort["id"] for ort in antwort["places"]] == ["home", "quartier"]
        assert antwort["zones"] == ["stefan"]


def test_a_report_names_the_place_and_the_battery():
    integrations = [
        {"integration": "geofence", "zones": [{"id": "stefan", "name": "Stefan"}]}
    ]
    with make_client(integrations=integrations) as client:
        antwort = client.post(
            "/api/presence/geofence",
            json={"event": "enter", "zone": "stefan", "place": "quartier", "battery": 12},
            headers=auth("t-owner"),
        ).json()
        assert antwort["state"] == "quartier"

        # Der engste Ort gewinnt, sobald man wirklich da ist.
        antwort = client.post(
            "/api/presence/geofence",
            json={"event": "enter", "zone": "stefan", "place": "home"},
            headers=auth("t-owner"),
        ).json()
        assert antwort["state"] == "home"

        leute = client.get("/api/presence", headers=auth("t-owner")).json()["people"]
        assert leute[0]["state"] == "home"
        assert leute[0]["battery"] == 12

        zeilen = client.get("/api/presence/diagnose", headers=auth("t-owner")).json()
        assert zeilen["people"][0]["silent"] is False


def test_guests_stay_out_of_the_bin():
    with make_client() as client:
        assert client.get("/api/family-trash", headers=auth("t-guest")).status_code == 403
