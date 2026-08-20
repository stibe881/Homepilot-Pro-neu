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

        # «Keine Gruppe» kommt aus der App als group=null - das muss die
        # Gruppe wirklich entfernen, nicht stillschweigend nichts tun.
        response = client.put(
            "/api/entities/demo.light_livingroom/meta",
            json={"group": None},
        )
        entity = response.json()["entity"]
        assert entity["group"] is None
        # Der Name blieb dabei unangetastet.
        assert entity["name"] == "Stehlampe"


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
        assert set(result) >= {
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


def test_update_reports_when_the_listener_ignores_the_ios_switch():
    """Ein älterer update-listener kennt ?ios=1 nicht und baut still nur
    den Hub - TestFlight bliebe stumm, und niemand wüsste warum. Der Hub
    erkennt die alte Fassung an deren Antwort («Bau gestartet» ohne
    iOS-Zusatz) und sagt es der App."""
    import http.server
    import threading

    class FakeListener(http.server.BaseHTTPRequestHandler):
        answer = b"Bau gestartet\n"

        def do_POST(self):  # noqa: N802
            body = type(self).answer
            self.send_response(202)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeListener)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/update"
    auth = {"Authorization": "Bearer geheim"}
    try:
        hub = Hub(make_config(token="geheim", update={"webhook_url": url}))
        with TestClient(create_app(hub)) as client:
            # Alte Fassung + iOS-Wunsch → Warnung an die App.
            response = client.post(
                "/api/system/update", json={"ios": True}, headers=auth
            )
            assert response.json() == {"ok": True, "ios_ignored": True}
            # Ohne iOS-Wunsch gibt es nichts zu bemängeln.
            assert client.post("/api/system/update", headers=auth).json() == {
                "ok": True
            }

            # Die heutige Fassung bestätigt den iOS-Build in ihrer Antwort.
            FakeListener.answer = b"Bau gestartet (mit iOS-Build)\n"
            response = client.post(
                "/api/system/update", json={"ios": True}, headers=auth
            )
            assert response.json() == {"ok": True}
    finally:
        server.shutdown()


def test_update_asks_the_listener_what_it_can_do_before_sending_ios():
    """Neuere Fassungen des Dienstes zählen unter /status auf, was sie
    können. Fehlt dort «ios», wird gar nicht erst gebaut - ein Update, das
    den gewünschten iOS-Build stillschweigend weglässt, ist schlimmer als
    eine klare Absage."""
    import http.server
    import json as json_module
    import threading

    class VersionedListener(http.server.BaseHTTPRequestHandler):
        features = ["status", "warnings"]  # noch ohne «ios»
        expo_token = True
        posts = 0

        def do_GET(self):  # noqa: N802
            body = json_module.dumps(
                {
                    "state": "idle",
                    "features": type(self).features,
                    "expo_token": type(self).expo_token,
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):  # noqa: N802
            type(self).posts += 1
            self.send_response(202)
            self.send_header("Content-Length", "14")
            self.end_headers()
            self.wfile.write(b"Bau gestartet\n")

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), VersionedListener)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/update"
    auth = {"Authorization": "Bearer geheim"}
    try:
        hub = Hub(make_config(token="geheim", update={"webhook_url": url}))
        with TestClient(create_app(hub)) as client:
            response = client.post(
                "/api/system/update", json={"ios": True}, headers=auth
            )
            assert response.status_code == 502
            assert "restart homepilot-update" in response.json()["detail"]
            # Und zwar, ohne den Bau überhaupt anzustossen.
            assert VersionedListener.posts == 0

            # «Nur Hub» geht auch bei so einem Dienst - der Bau selbst
            # funktioniert ja.
            assert client.post("/api/system/update", headers=auth).json() == {
                "ok": True
            }
            assert VersionedListener.posts == 1

            # Meldet der Dienst «ios», wird losgeschickt.
            VersionedListener.features = ["status", "warnings", "ios"]
            assert client.post(
                "/api/system/update", json={"ios": True}, headers=auth
            ).json() == {"ok": True, "ios_ignored": True}
            assert VersionedListener.posts == 2

            # Der zweite stille Weg: Der Dienst kann iOS, aber auf dem
            # Server liegt kein Zugang zu EAS. Dann käme in TestFlight
            # nichts an, während das Update «fertig» meldet.
            VersionedListener.expo_token = False
            response = client.post(
                "/api/system/update", json={"ios": True}, headers=auth
            )
            assert response.status_code == 502
            assert "EXPO_TOKEN" in response.json()["detail"]
            assert VersionedListener.posts == 2  # nichts angestossen

            # «Nur Hub» bleibt davon unberührt - dafür braucht es kein EAS.
            assert client.post("/api/system/update", headers=auth).json() == {
                "ok": True
            }
            assert VersionedListener.posts == 3
    finally:
        server.shutdown()


def test_update_explains_the_404_of_the_oldest_listener():
    """Die ältesten Listener-Fassungen vergleichen den Pfad mitsamt Anhang:
    «/update?ios=1» passt nicht auf «/update» → 404. Ein blosses «Nicht
    gefunden» schickte die Suche in die falsche Richtung - der Hub soll
    sagen, dass es der veraltete Dienst ist und wie man ihn erneuert."""
    import http.server
    import threading

    class OldestListener(http.server.BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            # Wie vor dem iOS-Schalter: kein partition("?") - der Anhang
            # bleibt im Pfad kleben und führt zu 404.
            if self.path.rstrip("/") != "/update":
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Nicht gefunden\n")
                return
            self.send_response(202)
            self.end_headers()
            self.wfile.write(b"Bau gestartet\n")

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), OldestListener)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/update"
    auth = {"Authorization": "Bearer geheim"}
    try:
        hub = Hub(make_config(token="geheim", update={"webhook_url": url}))
        with TestClient(create_app(hub)) as client:
            response = client.post(
                "/api/system/update", json={"ios": True}, headers=auth
            )
            assert response.status_code == 502
            assert "restart homepilot-update" in response.json()["detail"]
            # Ohne iOS-Wunsch funktioniert dieselbe alte Fassung weiterhin.
            assert client.post("/api/system/update", headers=auth).json() == {
                "ok": True
            }
    finally:
        server.shutdown()


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


def test_config_history_keeps_the_previous_version(tmp_path):
    """Gültig heisst nicht richtig - vor jedem Speichern wird die bisherige
    Fassung weggelegt, damit der alte Wortlaut nicht verloren geht."""
    path = tmp_path / "config.yaml"
    path.write_text("integrations:\n  - integration: demo\n", encoding="utf-8")

    hub = Hub(make_config(token="geheim", source_path=str(path)))
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer geheim"}
        assert client.get("/api/config/history", headers=headers).json() == {"versions": []}

        client.put(
            "/api/config",
            json={
                "content": "integrations:\n  - integration: demo\n"
                "rooms:\n  Küche: [demo.light_livingroom]\n"
            },
            headers=headers,
        )
        versions = client.get("/api/config/history", headers=headers).json()["versions"]
        assert len(versions) == 1

        name = versions[0]["name"]
        old = client.get(f"/api/config/history/{name}", headers=headers).json()
        assert "rooms" not in old["content"]

        # Zurückholen läuft durch dieselbe Prüfung und sichert seinerseits.
        result = client.post(f"/api/config/history/{name}/restore", headers=headers).json()
        assert result["ok"] and result["restored"] == name
        assert "rooms" not in path.read_text(encoding="utf-8")
        assert len(client.get("/api/config/history", headers=headers).json()["versions"]) == 2

        # Pfad-Tricks prallen ab.
        assert client.get("/api/config/history/..%2Fconfig.yaml", headers=headers).status_code == 404


def test_system_log_returns_recent_warnings():
    """Die App soll «warum ist nichts passiert» beantworten können, ohne
    dass jemand per SSH ins Container-Log steigt."""
    import logging

    hub = Hub(make_config(token="geheim"))
    with TestClient(create_app(hub)) as client:
        logging.getLogger("homepilot.test").warning("Storen fahren nicht: Gateway weg")
        entries = client.get(
            "/api/system/log", headers={"Authorization": "Bearer geheim"}
        ).json()["entries"]
        assert any("Gateway weg" in entry["message"] for entry in entries)
        # Info-Meldungen bleiben draussen - sonst ersäuft die Ansicht.
        logging.getLogger("homepilot.test").info("nur eine Notiz")
        assert not any("nur eine Notiz" in entry["message"] for entry in entries)


def _pass_hub():
    return Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
        )
    )


def test_one_time_pass_works_exactly_once():
    """Der Zettel für den Paketboten: genau ein Gerät, ein Befehl, ein
    Gebrauch - und danach zerreisst er sich selbst."""
    hub = _pass_hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        created = client.post(
            "/api/passes",
            json={"entity_id": "demo.light_livingroom", "command": "turn_on", "minutes": 5},
            headers=headers,
        )
        assert created.status_code == 200
        token = created.json()["pass"]["token"]

        # Ohne jede Anmeldung einlösbar - die Adresse ist das Geheimnis.
        assert client.get(f"/einmal/{token}").status_code == 200
        assert (
            client.get("/api/entities/demo.light_livingroom", headers=headers)
            .json()["state"]["state"]
            == "on"
        )
        # Ein zweites Mal geht nicht.
        assert client.get(f"/einmal/{token}").status_code == 410
        # Erfundene Adressen ebensowenig.
        assert client.get("/einmal/ausgedacht").status_code == 410


def test_one_time_pass_can_open_two_doors():
    """Im Mehrfamilienhaus braucht ein Paket beides: Haus- und Wohnungstüre.

    Zwei getrennte Links wären hier nicht sicherer, nur unbrauchbar - der
    Bote bekäme zwei Adressen und müsste im Treppenhaus raten.
    """
    hub = _pass_hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        created = client.post(
            "/api/passes",
            json={
                "targets": [
                    {"entity_id": "demo.light_livingroom", "command": "turn_on"},
                    {"entity_id": "demo.switch_coffee", "command": "turn_on"},
                ],
                "minutes": 5,
            },
            headers=headers,
        )
        assert created.status_code == 200
        entry = created.json()["pass"]
        assert [target["entity_id"] for target in entry["targets"]] == [
            "demo.light_livingroom",
            "demo.switch_coffee",
        ]

        answer = client.get(f"/einmal/{entry['token']}")
        assert answer.status_code == 200
        for entity_id in ("demo.light_livingroom", "demo.switch_coffee"):
            assert (
                client.get(f"/api/entities/{entity_id}", headers=headers)
                .json()["state"]["state"]
                == "on"
            )
        # Auch ein Link über zwei Türen gilt nur einmal.
        assert client.get(f"/einmal/{entry['token']}").status_code == 410


def test_a_pass_is_only_issued_if_every_door_checks_out():
    """Sonst stünde der Bote im Haus und käme nicht weiter."""
    hub = _pass_hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        response = client.post(
            "/api/passes",
            json={
                "targets": [
                    {"entity_id": "demo.light_livingroom", "command": "turn_on"},
                    {"entity_id": "demo.temp_livingroom", "command": "unlatch"},
                ]
            },
            headers=headers,
        )
        assert response.status_code == 400
        # Nichts ausgestellt, und das Licht ist auch nicht angegangen.
        assert client.get("/api/passes", headers=headers).json()["passes"] == []


def test_a_pass_can_be_planned_for_a_window():
    """Nicht jeder Zugang ist «der Bote steht jetzt da».

    Die Reinigung kommt Donnerstag von 9 bis 12 - dafür braucht es einen
    Link, der vorher wertlos ist und danach von selbst verfällt.
    """
    from datetime import datetime, timedelta

    hub = _pass_hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        beginn = datetime.now().astimezone() + timedelta(hours=2)
        ende = beginn + timedelta(hours=3)
        created = client.post(
            "/api/passes",
            json={
                "entity_id": "demo.light_livingroom",
                "command": "turn_on",
                "starts": beginn.isoformat(),
                "ends": ende.isoformat(),
            },
            headers=headers,
        )
        assert created.status_code == 200
        entry = created.json()["pass"]
        assert entry["pending"] is True

        # Vor dem Beginn wertlos - und zwar mit derselben Auskunft wie ein
        # erfundener Link, damit niemand lernt, dass Warten sich lohnt.
        früh = client.get(f"/einmal/{entry['token']}")
        assert früh.status_code == 410
        assert früh.text == client.get("/einmal/ausgedacht").text
        assert (
            client.get("/api/entities/demo.light_livingroom", headers=headers)
            .json()["state"]["state"]
            != "on"
        )


def test_a_planned_pass_refuses_nonsense_windows():
    from datetime import datetime, timedelta

    hub = _pass_hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        jetzt = datetime.now().astimezone()

        def versuch(starts, ends):
            return client.post(
                "/api/passes",
                json={
                    "entity_id": "demo.light_livingroom",
                    "command": "turn_on",
                    "starts": starts.isoformat(),
                    "ends": ends.isoformat(),
                },
                headers=headers,
            )

        # Ende vor Beginn.
        assert versuch(jetzt + timedelta(hours=3), jetzt + timedelta(hours=1)).status_code == 400
        # Komplett in der Vergangenheit.
        assert versuch(jetzt - timedelta(days=2), jetzt - timedelta(days=1)).status_code == 400
        # Länger als erlaubt - ein vergessener Jahres-Link ist kein Zugang,
        # sondern ein Loch.
        zu_lang = versuch(jetzt, jetzt + timedelta(days=90))
        assert zu_lang.status_code == 400
        assert "30 Tage" in zu_lang.json()["detail"]
        # Unlesbarer Zeitpunkt.
        assert (
            client.post(
                "/api/passes",
                json={
                    "entity_id": "demo.light_livingroom",
                    "command": "turn_on",
                    "starts": "irgendwann",
                    "ends": jetzt.isoformat(),
                },
                headers=headers,
            ).status_code
            == 400
        )
        assert client.get("/api/passes", headers=headers).json()["passes"] == []


def test_one_time_pass_refuses_unknown_command():
    hub = _pass_hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        response = client.post(
            "/api/passes",
            json={"entity_id": "demo.temp_livingroom", "command": "unlatch"},
            headers=headers,
        )
        assert response.status_code == 400


def test_rotating_a_token_locks_out_the_old_one():
    hub = Hub(make_config(token="geheim"))
    with TestClient(create_app(hub)) as client:
        owner = {"Authorization": "Bearer geheim"}
        client.post(
            "/api/users",
            json={"name": "Gast", "role": "gast", "token": "t-gast"},
            headers=owner,
        )
        assert client.get("/api/entities", headers={"Authorization": "Bearer t-gast"}).status_code == 200

        rotated = client.post("/api/users/Gast/token", headers=owner)
        assert rotated.status_code == 200
        neu = rotated.json()["token"]
        assert neu != "t-gast"

        # Das alte Token ist sofort wertlos, das neue gilt.
        assert client.get("/api/entities", headers={"Authorization": "Bearer t-gast"}).status_code == 401
        assert client.get("/api/entities", headers={"Authorization": f"Bearer {neu}"}).status_code == 200


def test_audit_records_who_switched_what():
    hub = Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on"},
            headers=headers,
        )
        entries = client.get("/api/system/audit", headers=headers).json()["entries"]
        assert entries[0]["user"] == "Stefan"
        assert entries[0]["command"] == "turn_on"
        assert entries[0]["entity_id"] == "demo.light_livingroom"
        # Eine Lampe braucht keine Adresse - nur Schloss und Alarm.
        assert "address" not in entries[0]


def test_web_app_cache_headers(tmp_path):
    """Die Homescreen-Fassung hielt die index.html im Cache und zeigte
    wochenlang das alte Bundle - neue Funktionen «fehlten» im Web. Die
    HTML-Datei muss deshalb bei jedem Öffnen nachgefragt werden, die
    gehashten Bundles dürfen dafür ewig liegen bleiben."""
    (tmp_path / "index.html").write_text("<html></html>")
    bundles = tmp_path / "_expo" / "static" / "js"
    bundles.mkdir(parents=True)
    (bundles / "bundle-abc123.js").write_text("// js")

    hub = Hub(make_config(web_root=str(tmp_path)))
    with TestClient(create_app(hub)) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert page.headers["cache-control"] == "no-cache"

        bundle = client.get("/_expo/static/js/bundle-abc123.js")
        assert bundle.status_code == 200
        assert "immutable" in bundle.headers["cache-control"]


def test_the_glance_stays_small_and_says_what_is_open():
    """Fürs Widget: Es fragt alle Viertelstunde an und läuft auf einem
    Telefon, das gerade nichts anderes tut. Was es nicht braucht, soll es
    nicht übertragen - deshalb eine eigene, winzige Antwort statt der
    ganzen Geräteliste."""
    hub = Hub(make_config(token="geheim", integrations=[{"integration": "demo"}]))
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer geheim"}
        antwort = client.get("/api/glance", headers=headers)
        assert antwort.status_code == 200
        daten = antwort.json()
        # Genau diese Schlüssel, nicht mehr.
        assert set(daten) == {
            "doors_open",
            "lights_on",
            "next_event",
            "alarm",
            "at",
        }
        assert isinstance(daten["doors_open"], list)
        assert isinstance(daten["lights_on"], int)

        # Brennt ein Licht, zählt es mit.
        client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on"},
            headers=headers,
        )
        assert client.get("/api/glance", headers=headers).json()["lights_on"] >= 1


def test_the_glance_needs_a_token():
    """Was offen steht und wann der nächste Termin ist, geht niemanden an,
    der das Token nicht hat."""
    hub = Hub(make_config(token="geheim", integrations=[{"integration": "demo"}]))
    with TestClient(create_app(hub)) as client:
        assert client.get("/api/glance").status_code in (401, 403)
