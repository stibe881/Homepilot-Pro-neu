"""Ein Ablauf mit Kategorie «Push» steht im Profil unter «Push».

Der Fall dahinter: Alle Nachrichten aus selbst gebauten Abläufen liefen
unter der einen Zeile «Nachricht aus einem Ablauf». Wer die Gefriertruhe
nicht mehr gemeldet haben wollte, schaltete damit auch «Jemand weint im
Kinderzimmer» ab.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config

MELDER = {
    "alias": "Gefriertruhe zu warm",
    "category": "Push",
    "trigger": {"entity_id": "demo.temp_livingroom", "above": 8},
    "action": {"type": "notify", "title": "Gefriertruhe zu warm"},
}
STILL = {
    "alias": "Licht bei Bewegung",
    "trigger": {"entity_id": "demo.motion_hall", "to": "on"},
    "action": {"entity_id": "demo.light_livingroom", "command": "turn_on"},
}


def _client(**kwargs) -> TestClient:
    return TestClient(create_app(Hub(make_config(automations=[MELDER, STILL], **kwargs))))


def test_der_ablauf_steht_unter_seiner_kategorie():
    with _client() as client:
        antwort = client.get("/api/push/categories").json()
        zeile = next(
            eintrag
            for eintrag in antwort["categories"]
            if eintrag["label"] == "Gefriertruhe zu warm"
        )
        assert zeile["group"] == "Push"
        assert zeile["key"].startswith("automation:")
        # «Push» steht als Gruppe zur Verfügung, hinten angehängt.
        assert "Push" in antwort["groups"]
        # Der stille Ablauf bringt keinen Schalter mit.
        assert not any(
            eintrag["label"] == "Licht bei Bewegung" for eintrag in antwort["categories"]
        )


def test_der_schalter_laesst_sich_setzen_und_bleibt():
    with _client() as client:
        zeile = next(
            eintrag
            for eintrag in client.get("/api/push/categories").json()["categories"]
            if eintrag["label"] == "Gefriertruhe zu warm"
        )
        gesetzt = client.put("/api/push/categories", json={"muted": [zeile["key"]]})
        assert gesetzt.json()["muted"] == [zeile["key"]]
        assert client.get("/api/push/categories").json()["muted"] == [zeile["key"]]


def test_abbestellt_heisst_keine_nachricht_aus_diesem_ablauf():
    hub = Hub(
        make_config(
            automations=[MELDER, STILL],
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
        )
    )
    kopf = {"Authorization": "Bearer t-owner"}
    with TestClient(create_app(hub)) as client:
        zeile = next(
            eintrag
            for eintrag in client.get("/api/push/categories", headers=kopf).json()[
                "categories"
            ]
            if eintrag["label"] == "Gefriertruhe zu warm"
        )
        client.put("/api/push/categories", json={"muted": [zeile["key"]]}, headers=kopf)

        hub.push.register("ExponentPushToken[a]", "Stefan")
        # Genau die Prüfung, die auch der Ablauf beim Melden macht.
        assert hub.push.recipients(hub.users.users, "all", zeile["key"]) == []
        assert hub.push.recipients(hub.users.users, "all", "automation:andere") != []


def test_die_alte_sammelabbestellung_wird_beim_start_aufgeteilt():
    # Wer «Nachricht aus einem Ablauf» abbestellt hatte, meinte alle -
    # und soll sie danach einzeln wieder einschalten können, statt
    # stillschweigend wieder alles zu bekommen.
    hub = Hub(
        make_config(
            automations=[MELDER, STILL],
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
        )
    )
    hub.data.set("push_prefs", [{"user": "Stefan", "muted": ["automation", "battery"]}])
    with TestClient(create_app(hub)) as client:
        muted = client.get(
            "/api/push/categories", headers={"Authorization": "Bearer t-owner"}
        ).json()["muted"]
    assert "battery" in muted
    assert "automation" not in muted
    assert any(key.startswith("automation:") for key in muted)
