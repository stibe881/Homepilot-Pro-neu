"""Testmodus für neue Push-Kategorien (Punkt 712 der Werkbank).

Eine neue Kategorie ging beim ersten Lauf gleich ans ganze Haus - mit
ihren Knöpfen, ihrer Dringlichkeit, allem, was noch niemand
ausprobiert hat. Im Testmodus geht sie stattdessen erst an die Person,
die ihn eingeschaltet hat.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from homepilot.api.server import create_app
from homepilot.core import push
from homepilot.core.config import load_config
from homepilot.core.hub import Hub
from homepilot.core.push import PushService
from homepilot.core.users import Role

# ── Reine Hälfte ────────────────────────────────────────────────────────


def test_test_lesen_keeps_only_known_categories_with_a_user():
    rows = [
        {"category": "battery", "user": "Stefan"},
        {"category": "alarm", "user": ""},  # kein Benutzername
        {"category": "gibtesnicht", "user": "Stefan"},
        "quatsch",
    ]
    assert push.test_lesen(rows) == {"battery": "Stefan"}


def test_test_setzen_toggles_the_row():
    rows = push.test_setzen(None, "battery", "Stefan")
    assert rows == [{"category": "battery", "user": "Stefan"}]
    rows = push.test_setzen(rows, "alarm", "Livia")
    assert {"category": "alarm", "user": "Livia"} in rows
    rows = push.test_setzen(rows, "battery", "")
    assert all(row["category"] != "battery" for row in rows)


class Benutzer:
    def __init__(self, name: str, role: str = Role.RESIDENT) -> None:
        self.name = name
        self.role = role


def test_recipients_only_reach_the_tester_while_in_test_mode():
    service = PushService()
    for name in ("Stefan", "Livia"):
        service.register(f"ExponentPushToken[{name}]", name)
    users = [Benutzer("Stefan"), Benutzer("Livia")]
    # Ohne Testmodus geht «all» an beide.
    assert sorted(service.recipients(users, "all", "tasks")) == [
        "ExponentPushToken[Livia]",
        "ExponentPushToken[Stefan]",
    ]
    service.test_kategorien = {"tasks": "Stefan"}
    # Im Testmodus nur an Stefan - «all» hin oder her.
    assert service.recipients(users, "all", "tasks") == ["ExponentPushToken[Stefan]"]
    # Und selbst eine ausdrückliche Anfrage an Livia geht ins Leere.
    assert service.recipients(users, "Livia", "tasks") == []
    # Eine andere Kategorie ist vom Testmodus unberührt.
    assert sorted(service.recipients(users, "all", "battery")) == [
        "ExponentPushToken[Livia]",
        "ExponentPushToken[Stefan]",
    ]


# ── Die Route ─────────────────────────────────────────────────────────────

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18199 }}
integrations:
  - integration: demo
users:
  - name: Stefan
    role: besitzer
    token: t-owner
  - name: Livia
    role: bewohner
    token: t-resident
data_file: {data_file}
"""


@pytest.fixture
def client(tmp_path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(CONFIG.format(data_file=tmp_path / "data.json"))
    hub = Hub(load_config(config_file))
    with TestClient(create_app(hub)) as test_client:
        test_client.hub = hub
        yield test_client


def kopf(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_the_testmodus_route_binds_the_calling_user(client):
    antwort = client.put(
        "/api/push/testmodus", json={"category": "tasks", "an": True}, headers=kopf("t-owner")
    )
    assert antwort.status_code == 200, antwort.text
    assert antwort.json()["testmodus_fuer"] == "Stefan"
    assert client.hub.push.test_kategorien == {"tasks": "Stefan"}

    zeilen = client.get("/api/push/categories", headers=kopf("t-resident")).json()
    posten = next(z for z in zeilen["categories"] if z["key"] == "tasks")
    assert posten["testmodus_fuer"] == "Stefan"

    # Livia (Bewohnerin ohne Editier-Recht) darf den Testmodus nicht
    # ändern; eine unbekannte Kategorie wird abgewiesen.
    assert (
        client.put(
            "/api/push/testmodus", json={"category": "tasks", "an": False}, headers=kopf("t-resident")
        ).status_code
        == 403
    )
    assert (
        client.put(
            "/api/push/testmodus", json={"category": "gibtesnicht", "an": True}, headers=kopf("t-owner")
        ).status_code
        == 404
    )

    # Ausschalten gibt die Kategorie wieder für alle frei.
    aus = client.put(
        "/api/push/testmodus", json={"category": "tasks", "an": False}, headers=kopf("t-owner")
    )
    assert aus.json()["testmodus_fuer"] is None
    assert client.hub.push.test_kategorien == {}
