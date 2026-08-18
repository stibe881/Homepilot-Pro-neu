from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config


def make_client(token=None) -> TestClient:
    hub = Hub(make_config(token=token))
    return TestClient(create_app(hub))


def test_list_entities_and_command():
    with make_client() as client:
        response = client.get("/api/entities")
        assert response.status_code == 200
        entities = {entity["id"]: entity for entity in response.json()}
        assert entities["demo.light_livingroom"]["state"]["state"] == "off"

        response = client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on", "data": {"brightness": 42}},
        )
        assert response.status_code == 200
        assert response.json()["entity"]["state"] == {"state": "on", "brightness": 42}


def test_unknown_entity_and_command():
    with make_client() as client:
        assert (
            client.post(
                "/api/entities/nope.nope/command", json={"command": "turn_on"}
            ).status_code
            == 404
        )
        assert (
            client.post(
                "/api/entities/demo.temp_livingroom/command",
                json={"command": "turn_on"},
            ).status_code
            == 400
        )


def test_token_auth():
    with make_client(token="geheim") as client:
        assert client.get("/api/entities").status_code == 401
        assert (
            client.get(
                "/api/entities", headers={"Authorization": "Bearer geheim"}
            ).status_code
            == 200
        )


def test_websocket_snapshot_and_command():
    with make_client(token="geheim") as client:
        with client.websocket_connect("/ws?token=geheim") as websocket:
            snapshot = websocket.receive_json()
            assert snapshot["type"] == "snapshot"
            ids = [entity["id"] for entity in snapshot["entities"]]
            assert "demo.light_livingroom" in ids

            websocket.send_json(
                {
                    "type": "command",
                    "entity_id": "demo.light_livingroom",
                    "command": "turn_on",
                }
            )
            # Es kommen result + state_changed (Reihenfolge egal).
            messages = [websocket.receive_json(), websocket.receive_json()]
            types = {message["type"] for message in messages}
            assert types == {"result", "state_changed"}
            for message in messages:
                if message["type"] == "state_changed":
                    assert message["new_state"]["state"] == "on"


def test_cors_preflight_is_allowed():
    """Ohne diese Kopfzeilen blockiert der Browser die Web-Fassung der App."""
    with make_client(token="geheim") as client:
        response = client.options(
            "/api/automations",
            headers={
                "Origin": "http://192.168.1.50:8081",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "*"


def test_cors_header_on_normal_request():
    with make_client() as client:
        response = client.get(
            "/api/entities", headers={"Origin": "http://192.168.1.50:8081"}
        )
        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers


def test_trigger_automation_runs_actions_now():
    with make_client() as client:
        created = client.post(
            "/api/automations",
            json={
                "alias": "Testlauf",
                "trigger": [{"type": "time", "at": "03:00"}],
                "condition": [],
                "action": [
                    {
                        "type": "command",
                        "entity_id": "demo.light_livingroom",
                        "command": "turn_on",
                    }
                ],
            },
        )
        assert created.status_code == 200
        automation_id = created.json()["automation"]["id"]

        # Ohne Auslöser: der Testknopf führt die Aktion sofort aus.
        run = client.post(f"/api/automations/{automation_id}/trigger")
        assert run.status_code == 200
        assert run.json()["ok"] is True

        entity = client.get("/api/entities/demo.light_livingroom").json()
        assert entity["state"]["state"] == "on"


def test_trigger_unknown_automation_is_404():
    with make_client() as client:
        assert client.post("/api/automations/nope/trigger").status_code == 404


def test_push_test_endpoint_reports_recipient_count():
    with make_client() as client:
        # Ohne registriertes Gerät geht die Nachricht an niemanden.
        response = client.post("/api/push/test")
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True
        assert body["sent"] == 0


def test_entity_meta_rename_favorite_group():
    with make_client() as client:
        # Umbenennen + als Favorit markieren.
        response = client.put(
            "/api/entities/demo.light_livingroom/meta",
            json={"name": "Stehlampe", "favorite": True, "group": "Wohnen"},
        )
        assert response.status_code == 200
        entity = response.json()["entity"]
        assert entity["name"] == "Stehlampe"
        assert entity["favorite"] is True
        assert entity["group"] == "Wohnen"

        # Teil-Update: nur Favorit lösen, Name bleibt.
        response = client.put(
            "/api/entities/demo.light_livingroom/meta",
            json={"favorite": False},
        )
        entity = response.json()["entity"]
        assert entity["favorite"] is False
        assert entity["name"] == "Stehlampe"

        # In der Gesamtliste taucht der neue Name auf.
        entities = {e["id"]: e for e in client.get("/api/entities").json()}
        assert entities["demo.light_livingroom"]["name"] == "Stehlampe"


def test_entity_meta_unknown_entity_is_404():
    with make_client() as client:
        assert (
            client.put("/api/entities/nope.nope/meta", json={"favorite": True}).status_code
            == 404
        )


def test_entities_report_last_seen_timestamp():
    with make_client() as client:
        entities = {e["id"]: e for e in client.get("/api/entities").json()}
        light = entities["demo.light_livingroom"]
        # Erreichbare Geräte tragen einen «zuletzt gesehen»-Zeitstempel.
        assert light["available"] is True
        assert isinstance(light["last_seen"], (int, float))
        assert light["last_seen"] > 0


def test_push_categories_are_per_user():
    """Die Einstellung gehört zur Person, nicht zum Haus – und liegt neben
    den Benutzern, damit auch wer in der config.yaml steht sie ändern kann,
    ohne dass der Hub die Datei anfasst."""
    with make_client() as client:
        listed = client.get("/api/push/categories")
        assert listed.status_code == 200
        keys = {entry["key"] for entry in listed.json()["categories"]}
        assert {"alarm", "battery", "appliance", "automation"} <= keys
        assert listed.json()["muted"] == []

        saved = client.put(
            "/api/push/categories", json={"muted": ["battery", "gibtsnicht"]}
        )
        assert saved.status_code == 200
        # Unbekannte Schlüssel fallen weg, statt gespeichert zu werden.
        assert saved.json()["muted"] == ["battery"]
        assert client.get("/api/push/categories").json()["muted"] == ["battery"]


def test_the_month_comparison_reads_the_recorded_days():
    """Die Zähler der Steckdosen vergessen jede Nacht alles – verglichen
    wird deshalb mit dem, was der Hub mitgeschrieben hat."""
    hub = Hub(make_config())
    hub.data.set(
        "energy_days",
        [
            {"day": "2026-07-01", "kwh": 3.0},
            {"day": "2026-07-28", "kwh": 9.0},
        ],
    )
    with TestClient(create_app(hub)) as client:
        result = client.get("/api/energy/months").json()
        # Der laufende Monat hat noch nichts, der Vormonat je nach Datum –
        # geprüft wird hier die Verdrahtung, die Rechnung steckt in
        # test_energy.py.
        assert set(result) == {
            "month",
            "last_month",
            "this_month_kwh",
            "last_month_kwh",
            "last_month_so_far_kwh",
            "days",
        }
        assert isinstance(result["days"], list)


def test_appliance_cycles_are_served_with_their_statistics():
    hub = Hub(make_config())
    hub.data.set(
        "appliance_cycles",
        [
            {"entity_id": "vzug.wama", "name": "Waschmaschine", "seconds": 3600},
            {"entity_id": "vzug.wama", "name": "Waschmaschine", "seconds": 5400},
        ],
    )
    with TestClient(create_app(hub)) as client:
        result = client.get("/api/appliances/cycles").json()
        assert result["stats"][0]["runs"] == 2
        assert result["stats"][0]["average_seconds"] == 4500
        assert len(result["cycles"]) == 2


def test_shortcuts_come_ready_to_paste():
    """Die Hürde bei Siri ist nicht das Prinzip, sondern URL, Methode, zwei
    Header und ein JSON-Rumpf – für jede Szene von Hand."""
    hub = Hub(make_config(token="geheim"))
    with TestClient(create_app(hub)) as client:
        result = client.get(
            "/api/shortcuts", headers={"Authorization": "Bearer geheim"}
        ).json()
        geraete = [item for item in result["shortcuts"] if item["kind"] == "device"]
        assert geraete, "mindestens ein schaltbares Demo-Gerät erwartet"
        eins = geraete[0]
        assert eins["method"] == "POST"
        # Das eigene Token liegt bei – ohne es wäre der Kurzbefehl nutzlos.
        assert eins["headers"]["Authorization"] == "Bearer geheim"
        assert eins["headers"]["Content-Type"] == "application/json"
        assert eins["body"]["command"] in ("turn_on", "turn_off", "open", "close")
        # Und der Name ist ein Satz, den man Siri sagen kann.
        assert "turn_on" not in eins["name"]


def test_shortcuts_only_show_what_the_user_may_see():
    hub = Hub(
        make_config(
            token=None,
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
                # Ein Gast, dessen Freigabe auf nichts passt – ein Gast ohne
                # jede Angabe sieht die Standardarten und wäre kein Beleg.
                {
                    "name": "Gast",
                    "role": "gast",
                    "token": "t-gast",
                    "allow": ["gibtsnicht.*"],
                },
            ],
        )
    )
    with TestClient(create_app(hub)) as client:
        result = client.get(
            "/api/shortcuts", headers={"Authorization": "Bearer t-gast"}
        ).json()
        assert [item for item in result["shortcuts"] if item["kind"] == "device"] == []


def test_the_update_button_stays_off_without_an_address():
    """Der Hub kann sich nicht selbst neu bauen – ohne eingerichtete
    Adresse gibt es nichts anzustossen, und das soll er sagen."""
    hub = Hub(make_config(token="geheim"))
    with TestClient(create_app(hub)) as client:
        response = client.post(
            "/api/system/update", headers={"Authorization": "Bearer geheim"}
        )
        assert response.status_code == 400
        assert "update.webhook_url" in response.json()["detail"]


def test_user_prefs_are_stored_per_user():
    """Kachel-Reihenfolgen u.ä. gehören der Person, nicht dem Gerät - jeder
    Benutzer bekommt genau seine eigenen zurück."""
    hub = Hub(
        make_config(
            token="geheim",
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t-stefan"},
                {"name": "Livia", "role": "bewohner", "token": "t-livia"},
            ],
        )
    )
    with TestClient(create_app(hub)) as client:
        stefan = {"Authorization": "Bearer t-stefan"}
        livia = {"Authorization": "Bearer t-livia"}
        assert client.get("/api/prefs", headers=stefan).json() == {"prefs": {}}

        payload = {"prefs": {"order": {"light": ["a", "b"]}}}
        assert client.put("/api/prefs", json=payload, headers=stefan).json() == {"ok": True}
        assert client.get("/api/prefs", headers=stefan).json() == payload
        # Livia sieht Stefans Reihenfolge nicht.
        assert client.get("/api/prefs", headers=livia).json() == {"prefs": {}}

        # Überschreiben ersetzt den ganzen Stand des Benutzers.
        second = {"prefs": {"order": {"light": ["b", "a"]}}}
        client.put("/api/prefs", json=second, headers=stefan)
        assert client.get("/api/prefs", headers=stefan).json() == second

        # Masslose Inhalte prallt der Hub ab, statt die Datei zu fluten.
        huge = {"prefs": {"blob": "x" * 40_000}}
        assert client.put("/api/prefs", json=huge, headers=stefan).status_code == 413


def test_update_status_is_unavailable_without_the_status_endpoint():
    """Nur update-listener.py bietet /status - ein reiner Portainer-Webhook
    (oder gar keine Adresse) kennt keinen Fortschritt. Die App soll dann
    einfach keinen Balken zeigen, statt gegen einen Fehler zu laufen."""
    hub = Hub(make_config(token="geheim"))
    with TestClient(create_app(hub)) as client:
        response = client.get(
            "/api/system/update/status", headers={"Authorization": "Bearer geheim"}
        )
        assert response.status_code == 200
        assert response.json() == {"available": False}

    hub = Hub(
        make_config(
            token="geheim",
            update={
                "webhook_url": "https://portainer.example.com/api/stacks/webhooks/xxxx"
            },
        )
    )
    with TestClient(create_app(hub)) as client:
        response = client.get(
            "/api/system/update/status", headers={"Authorization": "Bearer geheim"}
        )
        assert response.status_code == 200
        assert response.json() == {"available": False}


def test_saving_the_config_reports_what_looks_wrong(tmp_path):
    """Diese Prüfungen liefen bisher nur beim Start ins Log – wer in der App
    speicherte, sah die doppelte Adresse also nie."""
    path = tmp_path / "config.yaml"
    path.write_text("integrations:\n  - integration: demo\n", encoding="utf-8")

    hub = Hub(make_config(token="geheim", source_path=str(path)))
    with TestClient(create_app(hub)) as client:
        inhalt = (
            "integrations:\n"
            "  - integration: homematic\n"
            "    devices:\n"
            "      - address: 'ABC:3'\n"
            "        port: 2010\n"
            "      - address: 'ABC:3'\n"
            "        port: 2010\n"
            "rooms:\n"
            "  Küche:\n"
            "    - demo.gibtsnicht\n"
        )
        result = client.post(
            "/api/config/check",
            json={"content": inhalt},
            headers={"Authorization": "Bearer geheim"},
        ).json()
        assert result["ok"] is True
        assert any("2-mal" in warning for warning in result["warnings"])
        assert any("gibt es nicht" in warning for warning in result["warnings"])


def test_checking_a_broken_config_does_not_write_it(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("integrations:\n  - integration: demo\n", encoding="utf-8")

    hub = Hub(make_config(token="geheim", source_path=str(path)))
    with TestClient(create_app(hub)) as client:
        result = client.post(
            "/api/config/check",
            json={"content": "integrations: [nicht: gültig"},
            headers={"Authorization": "Bearer geheim"},
        ).json()
        assert result["ok"] is False
        assert result["error"]
        # Und die echte Datei ist unverändert.
        assert "demo" in path.read_text(encoding="utf-8")


def test_the_web_app_is_served_but_never_shadows_the_api(tmp_path):
    """Ein Mount auf «/» würde die Schnittstelle überdecken, wenn er zu
    früh käme – dann bekäme die App auf jeden Aufruf eine HTML-Seite."""
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<html>HomePilot</html>", encoding="utf-8")
    (web / "app.js").write_text("// code", encoding="utf-8")

    hub = Hub(make_config(token="geheim", web_root=str(web)))
    with TestClient(create_app(hub)) as client:
        # Die Oberfläche kommt.
        response = client.get("/")
        assert response.status_code == 200
        assert "HomePilot" in response.text
        assert client.get("/app.js").status_code == 200

        # Und die Schnittstelle funktioniert weiterhin – samt Tokenprüfung.
        assert client.get("/api/entities").status_code == 401
        assert (
            client.get(
                "/api/entities", headers={"Authorization": "Bearer geheim"}
            ).status_code
            == 200
        )


def test_without_a_web_folder_the_hub_stays_a_plain_api(tmp_path):
    hub = Hub(make_config(token="geheim", web_root=str(tmp_path / "gibtsnicht")))
    with TestClient(create_app(hub)) as client:
        # Kein Absturz, nur keine Oberfläche.
        assert client.get("/").status_code == 404
        assert client.get("/api/health").status_code == 200
