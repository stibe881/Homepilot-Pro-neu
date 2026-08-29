"""Rechte werden im Hub durchgesetzt, nicht erst in der App."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

USERS = [
    {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
    {"name": "Partnerin", "role": "bewohner", "token": "t-resident"},
    {"name": "Gast", "role": "gast", "token": "t-guest"},
]

SCENE = {
    "id": "kino",
    "name": "Kino",
    "actions": [{"entity_id": "demo.light_livingroom", "command": "turn_on"}],
}

GEHEIM = {
    "id": "geheim",
    "name": "Nur intern",
    "actions": [{"entity_id": "demo.motion_hall", "command": "turn_on"}],
}


def make_client() -> TestClient:
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            users=USERS,
            scenes=[SCENE, GEHEIM],
        )
    )
    return TestClient(create_app(hub))


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_unknown_token_is_rejected():
    with make_client() as client:
        assert client.get("/api/entities", headers=auth("falsch")).status_code == 401
        assert client.get("/api/entities").status_code == 401


def test_me_reports_role_and_capabilities():
    with make_client() as client:
        me = client.get("/api/me", headers=auth("t-resident")).json()
        assert me["name"] == "Partnerin"
        assert me["role"] == "bewohner"
        assert "control" in me["capabilities"]
        assert "manage_users" not in me["capabilities"]


def test_guest_sees_only_lights_and_switches():
    with make_client() as client:
        ids = {
            entity["id"]
            for entity in client.get("/api/entities", headers=auth("t-guest")).json()
        }
        assert "demo.light_livingroom" in ids
        assert "demo.switch_coffee" in ids
        # Bewegungsmelder und Sensoren gehen den Gast nichts an.
        assert "demo.motion_hall" not in ids
        assert "demo.temp_livingroom" not in ids

        alle = {
            entity["id"]
            for entity in client.get("/api/entities", headers=auth("t-owner")).json()
        }
        assert "demo.motion_hall" in alle


def test_guest_cannot_control_hidden_entity():
    with make_client() as client:
        response = client.post(
            "/api/entities/demo.motion_hall/command",
            json={"command": "turn_on"},
            headers=auth("t-guest"),
        )
        assert response.status_code == 404
        # Für freigegebene Geräte klappt es weiterhin.
        assert (
            client.post(
                "/api/entities/demo.light_livingroom/command",
                json={"command": "turn_on"},
                headers=auth("t-guest"),
            ).status_code
            == 200
        )


def test_system_status_needs_permission():
    with make_client() as client:
        assert client.get("/api/system/status", headers=auth("t-guest")).status_code == 403
        status = client.get("/api/system/status", headers=auth("t-owner")).json()
        assert status["entities"] > 0
        assert any(item["name"] == "demo" and item["ok"] for item in status["integrations"])


def test_only_owner_manages_users():
    with make_client() as client:
        assert client.get("/api/users", headers=auth("t-resident")).status_code == 403
        users = client.get("/api/users", headers=auth("t-owner")).json()
        assert {user["name"] for user in users} == {"Stefan", "Partnerin", "Gast"}
        # Tokens anderer Benutzer werden nie ausgeliefert.
        assert all("token" not in user for user in users)


def test_create_and_delete_user():
    with make_client() as client:
        created = client.post(
            "/api/users",
            json={"name": "Ferienwohnung", "role": "gast"},
            headers=auth("t-owner"),
        )
        assert created.status_code == 200
        # Genau einmal – damit man es überhaupt eintragen kann.
        token = created.json()["user"]["token"]
        assert len(token) > 20

        assert client.get("/api/me", headers=auth(token)).json()["role"] == "gast"
        assert (
            client.delete("/api/users/Ferienwohnung", headers=auth("t-owner")).status_code
            == 200
        )
        assert client.get("/api/me", headers=auth(token)).status_code == 401


def test_owner_cannot_delete_themselves():
    with make_client() as client:
        assert client.delete("/api/users/Stefan", headers=auth("t-owner")).status_code == 400


def test_scene_visibility_for_guests():
    with make_client() as client:
        scenes = client.get("/api/scenes", headers=auth("t-guest")).json()
        assert [scene["id"] for scene in scenes] == ["kino"]

        # Eine Szene, die verborgene Geräte anfasst, bleibt gesperrt.
        assert (
            client.post("/api/scenes/geheim/activate", headers=auth("t-guest")).status_code
            == 403
        )
        assert (
            client.post("/api/scenes/kino/activate", headers=auth("t-guest")).status_code
            == 200
        )


def test_scene_activation_switches_devices():
    with make_client() as client:
        client.post("/api/scenes/kino/activate", headers=auth("t-owner"))
        entity = client.get(
            "/api/entities/demo.light_livingroom", headers=auth("t-owner")
        ).json()
        assert entity["state"]["state"] == "on"


def test_pause_automations_requires_permission():
    with make_client() as client:
        assert (
            client.post(
                "/api/automations/pause", json={"seconds": 60}, headers=auth("t-guest")
            ).status_code
            == 403
        )
        response = client.post(
            "/api/automations/pause", json={"seconds": 60}, headers=auth("t-resident")
        )
        assert response.status_code == 200
        assert response.json()["paused_until"] is not None

        listing = client.get("/api/automations", headers=auth("t-owner")).json()
        assert listing["paused_until"] is not None


def test_push_registration():
    with make_client() as client:
        response = client.post(
            "/api/push/register",
            json={"token": "ExponentPushToken[abc]", "label": "iPhone"},
            headers=auth("t-resident"),
        )
        assert response.status_code == 200
        assert response.json()["device"]["user"] == "Partnerin"


def test_websocket_filters_events_for_guests():
    with make_client() as client:
        with client.websocket_connect("/ws?token=t-guest") as websocket:
            snapshot = websocket.receive_json()
            ids = {entity["id"] for entity in snapshot["entities"]}
            assert "demo.motion_hall" not in ids
            assert snapshot["user"]["role"] == "gast"

            # Ein verborgenes Gerät zu schalten wird abgelehnt, mit Begründung.
            websocket.send_json(
                {"type": "command", "entity_id": "demo.motion_hall", "command": "turn_on"}
            )
            result = websocket.receive_json()
            assert result["type"] == "result"
            assert result["ok"] is False
            assert "Berechtigung" in result["error"]


def test_websocket_reports_source_of_change():
    with make_client() as client:
        with client.websocket_connect("/ws?token=t-owner") as websocket:
            websocket.receive_json()  # snapshot
            websocket.send_json(
                {
                    "type": "command",
                    "entity_id": "demo.light_livingroom",
                    "command": "turn_on",
                }
            )
            messages = [websocket.receive_json(), websocket.receive_json()]
            changed = next(m for m in messages if m["type"] == "state_changed")
            assert changed["source"] == {"kind": "user", "label": "Stefan"}


def test_snapshot_carries_capabilities():
    """Ohne die Berechtigungen im Snapshot baut die App ihre Navigation falsch."""
    with make_client() as client:
        with client.websocket_connect("/ws?token=t-owner") as websocket:
            snapshot = websocket.receive_json()
            assert "view_system" in snapshot["user"]["capabilities"]
        with client.websocket_connect("/ws?token=t-guest") as websocket:
            snapshot = websocket.receive_json()
            assert snapshot["user"]["capabilities"] == ["control"]


def test_wer_sich_umbenennt_bleibt_angemeldet():
    """Der Fall aus dem Betrieb: «Ich habe meinen Namen von Stefan in
    stibe geändert – seitdem habe ich keinen Zugriff mehr.»

    Die Sitzung merkt sich, zu wem ein Token gehört, und das war der Name.
    Nach dem Umbenennen zeigte sie auf einen Benutzer, den es nicht mehr
    gab: «Ungültiges Token» auf allen Geräten gleichzeitig - auch auf dem,
    an dem gerade jemand den neuen Namen eingetippt hatte.
    """
    hub = Hub(
        HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}], users=USERS)
    )
    with TestClient(create_app(hub)) as client:
        angelegt = client.post(
            "/api/users",
            headers=auth("t-owner"),
            json={"name": "Bine", "role": "bewohner"},
        )
        assert angelegt.status_code == 200
        # Eine Sitzung wie nach der Anmeldung mit E-Mail und Passwort.
        sitzung = auth(hub.sessions.create("Bine", "iPhone", email="bine@example.ch"))
        assert client.get("/api/me", headers=sitzung).json()["name"] == "Bine"

        umbenannt = client.put(
            "/api/users/self", headers=sitzung, json={"name": "Sabine"}
        )
        assert umbenannt.status_code == 200

        # Dieselbe Sitzung, neuer Name - kein Abmelden dazwischen.
        weiter = client.get("/api/me", headers=sitzung)
        assert weiter.status_code == 200
        assert weiter.json()["name"] == "Sabine"
        assert hub.sessions.user_for(sitzung["Authorization"].split()[1]) == "Sabine"


def test_die_ortungszone_zieht_beim_umbenennen_mit():
    """«Stefan» und «Stibe» standen als zwei Menschen in der Anwesenheit.

    Die Zone heisst nach dem Vornamen und entsteht aus der Benutzerliste.
    Nach einer Umbenennung gab es also eine neue - und die alte behielt,
    was eingestellt war: welche Meldungen rausgehen, der letzte
    Aufenthalt, seit wann er gilt.
    """
    from homepilot.core import personen

    hub = Hub(
        HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}], users=USERS)
    )
    with TestClient(create_app(hub)) as client:
        angelegt = client.post(
            "/api/users",
            headers=auth("t-owner"),
            json={"name": "Bine", "role": "bewohner"},
        )
        token = angelegt.json()["user"]["token"]
        hub.data.set(
            personen.LADE, [{"zone": "bine", "meldungen": {"arrive": True}}]
        )
        hub.data.set("presence_last", [{"zone": "bine", "state": "home"}])
        hub.data.set(
            "presence_history", [{"person": "bine", "state": "home", "at": 100.0}]
        )

        client.put("/api/users/self", headers=auth(token), json={"name": "Sabine"})

        assert personen.fuer(hub.data.get(personen.LADE), "sabine")["arrive"] is True
        assert [row["zone"] for row in hub.data.get("presence_last")] == ["sabine"]
        assert [row["person"] for row in hub.data.get("presence_history")] == ["sabine"]
        # Und unter dem alten Vornamen steht nichts mehr.
        assert personen.fuer(hub.data.get(personen.LADE), "bine")["arrive"] is False


def test_wer_sich_umbenennt_heisst_auch_in_der_verwaltung_so():
    """Der Profilname ist der Benutzername - eine Änderung im eigenen
    Profil steht sofort in der Benutzerverwaltung. Benutzer aus der
    config.yaml bekommen stattdessen den Hinweis auf die Datei, und
    Gäste benennt, wer sie eingeladen hat."""
    with make_client() as client:
        angelegt = client.post(
            "/api/users",
            headers=auth("t-owner"),
            json={"name": "Bine", "role": "bewohner"},
        )
        token = angelegt.json()["user"]["token"]

        umbenannt = client.put(
            "/api/users/self", headers=auth(token), json={"name": "Sabine"}
        )
        assert umbenannt.status_code == 200
        assert umbenannt.json()["user"]["name"] == "Sabine"
        # Dasselbe Token, derselbe Mensch - nur der Name ist neu.
        me = client.get("/api/me", headers=auth(token)).json()
        assert me["name"] == "Sabine"
        namen = [
            u["name"] for u in client.get("/api/users", headers=auth("t-owner")).json()
        ]
        assert "Sabine" in namen and "Bine" not in namen

        # Aus der config.yaml: Die Datei ist die Wahrheit.
        antwort = client.put(
            "/api/users/self", headers=auth("t-resident"), json={"name": "Neu"}
        )
        assert antwort.status_code == 409
        assert "config.yaml" in antwort.json()["detail"]

        # Gäste bleiben draussen.
        assert (
            client.put(
                "/api/users/self", headers=auth("t-guest"), json={"name": "X"}
            ).status_code
            == 403
        )


def test_der_besitzer_verteilt_rollen():
    """«Der Besitzer soll Benutzern Rollen bearbeiten können.»

    Bisher stand die Rolle beim Anlegen fest: Wer einen Mitbewohner
    versehentlich als Gast angelegt hatte, musste ihn löschen und neu
    einladen - samt neuem Token auf jedem Gerät.
    """
    hub = Hub(
        HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}], users=USERS)
    )
    with TestClient(create_app(hub)) as client:
        angelegt = client.post(
            "/api/users", headers=auth("t-owner"), json={"name": "Livia", "role": "gast"}
        )
        token = angelegt.json()["user"]["token"]
        # Als Gast sieht sie die Abläufe nicht.
        assert client.get("/api/automations", headers=auth(token)).status_code == 403

        hoch = client.put(
            "/api/users/Livia", headers=auth("t-owner"), json={"role": "bewohner"}
        )
        assert hoch.status_code == 200
        assert hoch.json()["user"]["role"] == "bewohner"
        # Dasselbe Token, neue Rechte - kein Neuanlegen, kein neuer QR-Code.
        assert client.get("/api/automations", headers=auth(token)).status_code == 200
        assert "pause_automations" in client.get("/api/me", headers=auth(token)).json()[
            "capabilities"
        ]

        # Und wieder zurück.
        runter = client.put(
            "/api/users/Livia", headers=auth("t-owner"), json={"role": "gast"}
        )
        assert runter.json()["user"]["role"] == "gast"
        assert client.get("/api/automations", headers=auth(token)).status_code == 403


def test_rollen_verteilt_nur_der_besitzer():
    hub = Hub(
        HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}], users=USERS)
    )
    with TestClient(create_app(hub)) as client:
        client.post(
            "/api/users", headers=auth("t-owner"), json={"name": "Livia", "role": "gast"}
        )
        # Die Mitbewohnerin darf das nicht - sonst machte sich jeder zum
        # Besitzer, der einen Namen kennt.
        antwort = client.put(
            "/api/users/Livia", headers=auth("t-resident"), json={"role": "besitzer"}
        )
        assert antwort.status_code == 403


def test_die_eigene_rolle_bleibt_wo_sie_ist():
    """Sonst steht man vor der eigenen Benutzerverwaltung und kommt nicht
    mehr hinein."""
    hub = Hub(
        HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}], users=USERS)
    )
    with TestClient(create_app(hub)) as client:
        angelegt = client.post(
            "/api/users",
            headers=auth("t-owner"),
            json={"name": "Zweiter", "role": "besitzer"},
        )
        token = angelegt.json()["user"]["token"]
        antwort = client.put(
            "/api/users/Zweiter", headers=auth(token), json={"role": "bewohner"}
        )
        assert antwort.status_code == 400
        assert "selbst" in antwort.json()["detail"]


def test_der_letzte_besitzer_bleibt_besitzer():
    """Ein Haus ohne Besitzer verwaltet niemand mehr - zurück käme man nur
    über die config.yaml auf dem Rechner im Keller."""
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            # Nur ein Besitzer, und der ist aus der App - also änderbar.
            users=[],
        )
    )
    from homepilot.core.users import User as HubUser

    hub.users.add(
        HubUser(name="Stibe", role="besitzer", token="t-stibe", editable=True)
    )
    with TestClient(create_app(hub)) as client:
        besitzer = auth("t-stibe")
        client.post(
            "/api/users", headers=besitzer, json={"name": "Livia", "role": "bewohner"}
        )
        # Livia stuft den einzigen Besitzer zurück? Nein.
        antwort = client.put(
            "/api/users/Stibe", headers=besitzer, json={"role": "bewohner"}
        )
        assert antwort.status_code in (400, 409)

        # Mit einem zweiten Besitzer geht es - und zwar von diesem aus.
        client.put("/api/users/Livia", headers=besitzer, json={"role": "besitzer"})
        livia = auth(hub.users.by_name("Livia").token)
        assert (
            client.put(
                "/api/users/Stibe", headers=livia, json={"role": "bewohner"}
            ).status_code
            == 200
        )
        assert hub.users.by_name("Stibe").role == "bewohner"
