"""Was in der App entsteht, muss einen Neustart überleben."""

import json

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.persistence import DataStore

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


def make_config(data_file):
    return HubConfig(
        api=ApiConfig(),
        integrations=[{"integration": "demo"}],
        users=[OWNER],
        data_file=str(data_file),
    )


def auth(token="t-owner"):
    return {"Authorization": f"Bearer {token}"}


def test_datastore_writes_atomically(tmp_path):
    path = tmp_path / "daten.json"
    store = DataStore(path)
    store.set("users", [{"name": "Gast", "token": "g"}])

    assert json.loads(path.read_text())["users"][0]["name"] == "Gast"
    # Keine halben Dateien liegen lassen.
    assert list(tmp_path.glob("*.tmp")) == []
    # Tokens stehen darin – niemand sonst soll sie lesen.
    assert oct(path.stat().st_mode)[-3:] == "600"


def test_broken_file_does_not_stop_the_hub(tmp_path):
    path = tmp_path / "kaputt.json"
    path.write_text("{kein json", encoding="utf-8")
    assert DataStore(path).load()["users"] == []


def test_created_user_survives_a_restart(tmp_path):
    data_file = tmp_path / "daten.json"

    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        created = client.post(
            "/api/users", json={"name": "Ferienwohnung", "role": "gast"}, headers=auth()
        )
        token = created.json()["user"]["token"]
        assert created.json()["user"]["editable"] is True

    # Neuer Hub, dieselbe Datei – der Zugang muss weiterhin gelten.
    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        me = client.get("/api/me", headers=auth(token))
        assert me.status_code == 200
        assert me.json()["role"] == "gast"


def test_config_users_stay_read_only(tmp_path):
    with TestClient(create_app(Hub(make_config(tmp_path / "d.json")))) as client:
        response = client.delete("/api/users/Stefan", headers=auth())
        # Sich selbst löschen ist ohnehin gesperrt; entscheidend ist,
        # dass Konfigurationsbenutzer nicht in der Datei landen.
        assert response.status_code == 400
        assert client.get("/api/users", headers=auth()).json()[0]["editable"] is False


def test_automation_can_be_created_changed_and_deleted(tmp_path):
    data_file = tmp_path / "daten.json"
    neu = {
        "alias": "Abendlicht",
        "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
        "action": [{"type": "command", "entity_id": "demo.light_bedroom",
                    "command": "turn_on"}],
    }

    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        created = client.post("/api/automations", json=neu, headers=auth())
        assert created.status_code == 200
        automation_id = created.json()["automation"]["id"]

        listing = client.get("/api/automations", headers=auth()).json()["automations"]
        entry = next(item for item in listing if item["id"] == automation_id)
        assert entry["alias"] == "Abendlicht"
        assert entry["editable"] is True

        # Ändern
        assert (
            client.put(
                f"/api/automations/{automation_id}",
                json={**neu, "alias": "Abendlicht neu"},
                headers=auth(),
            ).status_code
            == 200
        )

    # Nach dem Neustart noch da – und wirksam.
    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        listing = client.get("/api/automations", headers=auth()).json()["automations"]
        assert any(item["alias"] == "Abendlicht neu" for item in listing)

        client.post(
            "/api/entities/demo.motion_hall/command",
            json={"command": "turn_on"},
            headers=auth(),
        )
        entity = client.get(
            "/api/entities/demo.light_bedroom", headers=auth()
        ).json()
        assert entity["state"]["state"] == "on"

        assert (
            client.delete(f"/api/automations/{automation_id}", headers=auth()).status_code
            == 200
        )


def test_config_automations_cannot_be_edited(tmp_path):
    config = make_config(tmp_path / "d.json")
    config.automations = [{"id": "aus_config", "alias": "Fest", "trigger": [], "action": []}]
    with TestClient(create_app(Hub(config))) as client:
        assert (
            client.delete("/api/automations/aus_config", headers=auth()).status_code == 404
        )
        listing = client.get("/api/automations", headers=auth()).json()["automations"]
        assert listing[0]["editable"] is False


def test_backup_writes_dated_copy_and_prunes(tmp_path):
    path = tmp_path / "daten.json"
    store = DataStore(path)
    store.set("users", [{"name": "A", "token": "x"}])

    result = store.backup(keep=2)
    assert result is not None
    backups = store.backups()
    assert len(backups) == 1
    # Inhalt der Sicherung entspricht den Daten.
    saved = json.loads((tmp_path / "backups" / backups[0]["name"]).read_text("utf-8"))
    assert saved["users"][0]["name"] == "A"

    # Mehr als «keep» Sicherungen werden auf die jüngsten gestutzt.
    for _ in range(4):
        store.backup(keep=2)
    assert len(store.backups()) <= 2


def test_backup_endpoint_lists_and_creates(tmp_path):
    with TestClient(create_app(Hub(make_config(tmp_path / "daten.json")))) as client:
        # Der Start legt bereits eine automatische Sicherung an.
        listed = client.get("/api/system/backups", headers=auth())
        assert listed.status_code == 200

        made = client.post("/api/system/backup", headers=auth())
        assert made.status_code == 200
        assert made.json()["ok"] is True
        assert len(made.json()["backups"]) >= 1


def test_due_task_reminder_pushes_once_per_day(tmp_path):
    import asyncio

    hub = Hub(make_config(tmp_path / "daten.json"))
    hub.data.load()
    hub.data.set("family_tasks", [{"id": "1", "text": "Zimmer", "due": "2000-01-01"}])

    sent: list[dict] = []

    async def fake_send(tokens, title, body, data=None):
        sent.append({"title": title, "body": body})
        return len(tokens)

    hub.push.send = fake_send  # type: ignore[assignment]

    asyncio.run(hub._remind_due_tasks())
    assert len(sent) == 1
    assert "1 offen" in sent[0]["body"]

    # Zweiter Aufruf am selben Tag erinnert nicht erneut.
    asyncio.run(hub._remind_due_tasks())
    assert len(sent) == 1


def test_favorite_survives_a_restart_and_reaches_every_device(tmp_path):
    """Der Stern gehört dem Haus, nicht dem Telefon.

    Er lag einmal im Speicher der App - also nur auf dem Gerät, auf dem
    jemand ihn gesetzt hatte, und nach einer Neuinstallation war er weg.
    Jetzt steht er beim Gerät auf dem Hub; jede App, die die Liste holt,
    sieht ihn. Das ist die ganze Zusage, und dieser Test hält sie fest.
    """
    data_file = tmp_path / "daten.json"

    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        response = client.put(
            "/api/entities/demo.light_livingroom/meta",
            json={"favorite": True},
            headers=auth(),
        )
        assert response.status_code == 200

    # Neuer Hub, dieselbe Datei - und eine App, die nichts von vorher weiss.
    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        entities = {e["id"]: e for e in client.get("/api/entities", headers=auth()).json()}
        assert entities["demo.light_livingroom"]["favorite"] is True
        # Und nur dieses eine - ein Stern färbt nicht auf die Nachbarn ab.
        assert [e["id"] for e in entities.values() if e["favorite"]] == [
            "demo.light_livingroom"
        ]

    # Wieder gelöst, bleibt gelöst.
    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        client.put(
            "/api/entities/demo.light_livingroom/meta",
            json={"favorite": False},
            headers=auth(),
        )
    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        entities = {e["id"]: e for e in client.get("/api/entities", headers=auth()).json()}
        assert entities["demo.light_livingroom"]["favorite"] is False


def test_house_prefs_are_shared_and_survive_a_restart(tmp_path):
    """Was jemand anpasst, gilt für alle - und bleibt.

    Der Unterschied zu /api/prefs ist der ganze Zweck: Dort liegt je
    Benutzer, was nur ihn angeht; hier liegt einmal, wie das Haus
    aussieht. Ein zweites Telefon soll die Wohnung so vorfinden, wie sie
    eingerichtet ist - nicht leer.
    """
    data_file = tmp_path / "daten.json"

    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        angelegt = client.post(
            "/api/users", json={"name": "Livia", "role": "bewohner"}, headers=auth()
        )
        livia_token = angelegt.json()["user"]["token"]
        response = client.put(
            "/api/houseprefs",
            json={"prefs": {"hidden": ["demo.temp_livingroom"], "locked": []}},
            headers=auth(),
        )
        assert response.status_code == 200

    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        # Dieselbe Antwort für jede angemeldete Person.
        for token in ("t-owner", livia_token):
            prefs = client.get("/api/houseprefs", headers=auth(token)).json()["prefs"]
            assert prefs["hidden"] == ["demo.temp_livingroom"]

        # Und wer schalten darf, darf auch anpassen - sonst müsste für
        # jede ausgeblendete Kachel die Besitzerin herhalten.
        response = client.put(
            "/api/houseprefs",
            json={"prefs": {"hidden": [], "locked": ["demo.light_livingroom"]}},
            headers=auth(livia_token),
        )
        assert response.status_code == 200
        prefs = client.get("/api/houseprefs", headers=auth()).json()["prefs"]
        assert prefs["locked"] == ["demo.light_livingroom"]


def test_house_prefs_stay_out_of_the_personal_ones(tmp_path):
    """Zwei Ablagen, die sich nicht ins Gehege kommen."""
    data_file = tmp_path / "daten.json"
    with TestClient(create_app(Hub(make_config(data_file)))) as client:
        client.put("/api/houseprefs", json={"prefs": {"hidden": ["a"]}}, headers=auth())
        client.put("/api/prefs", json={"prefs": {"seenChanges": "abc"}}, headers=auth())

        assert client.get("/api/houseprefs", headers=auth()).json()["prefs"] == {
            "hidden": ["a"]
        }
        assert client.get("/api/prefs", headers=auth()).json()["prefs"] == {
            "seenChanges": "abc"
        }


def test_house_prefs_have_an_upper_bound(tmp_path):
    """Eine Ablage für Listen von Kennungen, nicht für Beliebiges."""
    with TestClient(create_app(Hub(make_config(tmp_path / "d.json")))) as client:
        riesig = {"order": {"devices": ["x" * 1000 for _ in range(200)]}}
        response = client.put("/api/houseprefs", json={"prefs": riesig}, headers=auth())
        assert response.status_code == 413


def test_the_hub_token_is_no_person(tmp_path):
    """Das api.token ist ein Zugang, kein Mensch.

    Es stand in der Benutzerverwaltung zwischen den anderen - liess sich
    aber weder anlegen noch ändern noch löschen, weil es aus der
    Konfiguration kommt. Eine Zeile, die nur Fragen aufwarf. Der Zugang
    selbst bleibt: Skripte und das Wandpanel kommen damit weiterhin
    herein, und im Protokoll steht der Name auch weiterhin.
    """
    from homepilot.core.config import ApiConfig, HubConfig

    config = HubConfig(
        api=ApiConfig(token="t-hub"),
        integrations=[{"integration": "demo"}],
        users=[OWNER],
        data_file=str(tmp_path / "daten.json"),
    )
    with TestClient(create_app(Hub(config))) as client:
        namen = [entry["name"] for entry in client.get("/api/users", headers=auth()).json()]
        assert namen == ["Stefan"]

        # Aber hereinkommen tut er weiterhin, und zwar als Besitzer.
        me = client.get("/api/me", headers={"Authorization": "Bearer t-hub"})
        assert me.status_code == 200
        assert me.json()["role"] == "besitzer"
