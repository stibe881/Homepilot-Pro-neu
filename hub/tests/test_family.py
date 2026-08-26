"""Geteilte Familien-Listen: anlegen, abhaken, löschen – und Gäste bleiben draussen."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

USERS = [
    {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
    {"name": "Partnerin", "role": "bewohner", "token": "t-resident"},
    {"name": "Gast", "role": "gast", "token": "t-guest"},
]


def make_client() -> TestClient:
    hub = Hub(
        HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}], users=USERS)
    )
    return TestClient(create_app(hub))


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_family_roundtrip():
    with make_client() as client:
        # Bewohnerin legt eine Aufgabe an.
        response = client.post(
            "/api/family/tasks",
            json={"text": "Altglas wegbringen", "done": False},
            headers=auth("t-resident"),
        )
        assert response.status_code == 200
        item = response.json()
        assert item["author"] == "Partnerin"
        assert item["text"] == "Altglas wegbringen"

        # Besitzer sieht sie und hakt sie ab.
        data = client.get("/api/family", headers=auth("t-owner")).json()
        assert len(data["tasks"]) == 1
        response = client.put(
            f"/api/family/tasks/{item['id']}",
            json={"done": True},
            headers=auth("t-owner"),
        )
        assert response.status_code == 200
        assert response.json()["done"] is True
        # author bleibt unangetastet, auch wenn ihn jemand mitschickt.
        response = client.put(
            f"/api/family/tasks/{item['id']}",
            json={"author": "Hacker"},
            headers=auth("t-owner"),
        )
        assert response.json()["author"] == "Partnerin"

        # Und löscht sie wieder.
        assert (
            client.delete(
                f"/api/family/tasks/{item['id']}", headers=auth("t-owner")
            ).status_code
            == 200
        )
        data = client.get("/api/family", headers=auth("t-owner")).json()
        assert data["tasks"] == []


def test_family_blocks_guests_and_unknown_lists():
    with make_client() as client:
        assert client.get("/api/family", headers=auth("t-guest")).status_code == 403
        assert (
            client.post(
                "/api/family/tasks", json={"text": "x"}, headers=auth("t-guest")
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/family/quatsch", json={"text": "x"}, headers=auth("t-owner")
            ).status_code
            == 404
        )
        assert (
            client.delete(
                "/api/family/tasks/gibtsnicht", headers=auth("t-owner")
            ).status_code
            == 404
        )


def test_a_single_family_list_can_be_fetched():
    """Die Kopfzeile fragt jede Minute nach der Einkaufsliste.

    Ohne diesen Weg blieb nur /api/family - alles auf einmal, Rezepte und
    Dokumente eingeschlossen. Wer es einzeln versuchte, bekam «Methode
    nicht erlaubt» und in der App eine leere Liste, die aussah, als wäre
    nichts einzukaufen. Genau so war es.
    """
    with make_client() as client:
        client.post(
            "/api/family/shopping", json={"text": "Milch"}, headers=auth("t-resident")
        )
        client.post(
            "/api/family/shopping", json={"text": "Brot"}, headers=auth("t-resident")
        )

        antwort = client.get("/api/family/shopping", headers=auth("t-owner"))
        assert antwort.status_code == 200
        assert [eintrag["text"] for eintrag in antwort.json()] == ["Milch", "Brot"]

        # Eine leere Liste ist eine leere Liste, kein Fehler.
        assert client.get("/api/family/pins", headers=auth("t-owner")).json() == []
        # Erfundene Listen gibt es nicht.
        assert (
            client.get("/api/family/unfug", headers=auth("t-owner")).status_code == 404
        )
        # Und Gäste bleiben draussen, wie bei allen Familienlisten.
        assert (
            client.get("/api/family/shopping", headers=auth("t-guest")).status_code
            == 403
        )


# ── Gedächtnis der Einkaufsliste ───────────────────────────────────────────


def test_remember_keeps_the_latest_spelling_in_front():
    from homepilot.core.shopping import remember

    known: list = []
    for text in ["Milch", "Brot", "Rüebli"]:
        known = remember(known, text)
    assert known == ["Rüebli", "Brot", "Milch"]

    # Derselbe Posten in anderer Schreibweise verdoppelt nicht, sondern
    # rückt nach vorn - und behält die zuletzt getippte Fassung.
    known = remember(known, "milch")
    assert known == ["milch", "Rüebli", "Brot"]

    # Leeres merkt sich niemand.
    assert remember(known, "   ") == known
    # Und die Liste wächst nicht unbegrenzt.
    voll = remember([f"Posten {i}" for i in range(300)], "Neu", limit=5)
    assert len(voll) == 5 and voll[0] == "Neu"


def test_suggestions_prefer_what_starts_with_the_query():
    from homepilot.core.shopping import suggestions

    known = ["Salami", "Milch", "Mineralwasser", "Brot"]
    # «mi» meint eher Milch als Salami - Anfang schlägt Enthalten.
    assert suggestions(known, "mi") == ["Milch", "Mineralwasser", "Salami"]
    # Ohne Eingabe die zuletzt benutzten: Eingekauft wird meistens dasselbe.
    assert suggestions(known, "") == known
    assert suggestions(known, "xyz") == []
    assert suggestions(known, "mi", limit=1) == ["Milch"]


def test_added_articles_are_remembered_for_next_time():
    """Was einmal auf der Liste stand, wird beim nächsten Mal vorgeschlagen.

    Auch dann noch, wenn der Eintrag längst abgehakt und entfernt ist -
    genau dafür gibt es das eigene Gedächtnis.
    """
    with make_client() as client:
        created = client.post(
            "/api/family/shopping",
            json={"text": "Milch", "category": "Milchprodukte"},
            headers=auth("t-resident"),
        )
        assert created.status_code == 200
        client.post(
            "/api/family/shopping", json={"text": "Rüebli"}, headers=auth("t-owner")
        )

        known = client.get("/api/shopping/known", headers=auth("t-owner")).json()
        assert known == ["Rüebli", "Milch"]
        treffer = client.get(
            "/api/shopping/known", params={"q": "mil"}, headers=auth("t-owner")
        ).json()
        assert treffer == ["Milch"]

        # Eintrag wieder weg - der Vorschlag bleibt.
        client.delete(
            f"/api/family/shopping/{created.json()['id']}", headers=auth("t-owner")
        )
        assert "Milch" in client.get(
            "/api/shopping/known", headers=auth("t-owner")
        ).json()


def test_other_family_lists_do_not_fill_the_shopping_memory():
    """Eine Aufgabe ist kein Einkaufsartikel."""
    with make_client() as client:
        client.post(
            "/api/family/tasks",
            json={"text": "Steuererklärung"},
            headers=auth("t-owner"),
        )
        assert client.get("/api/shopping/known", headers=auth("t-owner")).json() == []


def test_a_change_reaches_open_apps_over_the_websocket():
    """Statt Minutentakt-Abfrage: Wer die Liste offen hat, bekommt einen
    Fingerzeig - und Gäste ohne Familien-Bereich bekommen keinen."""
    with make_client() as client:
        with client.websocket_connect("/ws?token=t-owner") as app:
            assert app.receive_json()["type"] == "snapshot"

            client.post(
                "/api/family/shopping",
                json={"text": "Milch", "done": False},
                headers=auth("t-resident"),
            )

            message = app.receive_json()
            while message["type"] not in ("family_changed",):
                message = app.receive_json()
            assert message["collection"] == "shopping"

        # Der Gast (ohne Familien-Bereich) bekommt den Fingerzeig nicht -
        # nach dem Eintrag kommt bei ihm nur die Antwort auf sein Ping.
        with client.websocket_connect("/ws?token=t-guest") as gast:
            assert gast.receive_json()["type"] == "snapshot"
            client.post(
                "/api/family/shopping",
                json={"text": "Brot", "done": False},
                headers=auth("t-resident"),
            )
            gast.send_json({"type": "ping"})
            assert gast.receive_json()["type"] == "pong"


def test_children_can_be_listed_without_giving_them_an_account():
    """Wer im Ämtli-Plan steht, braucht keinen Anmeldenamen.

    Die Namen für Aufgaben, Ämtli und Punkte kamen aus /api/users. Ein
    fünfjähriges Kind bekommt aber kein Konto mit Token - es soll trotzdem
    in der Reihe stehen. Dafür gibt es die Liste «members».
    """
    with make_client() as client:
        kind = client.post(
            "/api/family/members",
            json={"text": "Livia", "role": "kind"},
            headers=auth("t-owner"),
        )
        assert kind.status_code == 200
        assert kind.json()["text"] == "Livia"

        # Sie steht in der Gesamtübersicht und lässt sich einem Ämtli
        # zuteilen - genau wie jemand mit Zugang.
        data = client.get("/api/family", headers=auth("t-resident")).json()
        assert [row["text"] for row in data["members"]] == ["Livia"]
        amtli = client.post(
            "/api/family/chores",
            json={"text": "Abfall", "member": "Livia"},
            headers=auth("t-owner"),
        )
        assert amtli.json()["member"] == "Livia"

        # Und sie lässt sich wieder entfernen, wenn sie auszieht.
        client.delete(f"/api/family/members/{kind.json()['id']}", headers=auth("t-owner"))
        assert client.get("/api/family/members", headers=auth("t-owner")).json() == []
