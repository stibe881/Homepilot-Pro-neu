"""Dringlichkeit je Kategorie, Empfängergruppen und die eigene «Später»-Zeit.

Drei Dinge, die vorher fest im Code standen: LEISE entschied allein,
was warten darf; ein Ziel war «alle», eine Rolle oder ein Name; und
«Später» hiess immer eine halbe Stunde.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from homepilot.api.server import create_app
from homepilot.core import push, spaeter
from homepilot.core.config import load_config
from homepilot.core.hub import Hub
from homepilot.core.push import PushService
from homepilot.core.users import Role

# ── Stufen ────────────────────────────────────────────────────────────────


def test_stufen_lesen_keeps_only_real_changes():
    rows = [
        {"category": "battery", "stufe": "dringend"},
        {"category": "alarm", "stufe": "dringend"},  # ist der Standard
        {"category": "alarm", "stufe": "sehr"},  # keine Stufe
        {"category": "gibtesnicht", "stufe": "leise"},
        "quatsch",
    ]
    assert push.stufen_lesen(rows) == {"battery": "dringend"}


def test_stufen_setzen_back_to_default_drops_the_row():
    rows = push.stufen_setzen(None, "battery", "dringend")
    assert rows == [{"category": "battery", "stufe": "dringend"}]
    rows = push.stufen_setzen(rows, "alarm", "leise")
    assert {"category": "alarm", "stufe": "leise"} in rows
    rows = push.stufen_setzen(rows, "battery", "leise")
    assert all(row["category"] != "battery" for row in rows)


def test_dringlichkeit_follows_the_changed_level():
    stufen = {"battery": "dringend", "alarm": "leise"}
    assert push.dringlichkeit("battery", stufen)["priority"] == "high"
    assert push.dringlichkeit("alarm", stufen)["priority"] == "normal"
    # Unverändertes bleibt, wie es eingebaut ist.
    assert push.dringlichkeit("doorbell", stufen)["priority"] == "high"


def test_kritisch_needs_apples_permission():
    stufen = {"leak": "kritisch"}
    ohne = push.dringlichkeit("leak", stufen, kritisch_erlaubt=False)
    assert ohne["interruptionLevel"] == "time-sensitive"
    assert "sound" not in ohne
    mit = push.dringlichkeit("leak", stufen, kritisch_erlaubt=True)
    assert mit["interruptionLevel"] == "critical"
    assert mit["sound"]["critical"] is True


# ── Gruppen ───────────────────────────────────────────────────────────────


class Benutzer:
    def __init__(self, name: str, role: str = Role.RESIDENT) -> None:
        self.name = name
        self.role = role


def test_gruppen_lesen_drops_empty_groups_and_doubles():
    rows = [
        {"name": "Eltern", "members": ["Stefan", "Livia", "Stefan"]},
        {"name": "Leer", "members": []},
        {"name": "", "members": ["Stefan"]},
        {"name": "Kinder", "members": [3, " Levin "]},
    ]
    assert push.gruppen_lesen(rows) == {"Eltern": ["Stefan", "Livia"], "Kinder": ["Levin"]}
    assert push.gruppe_aus("gruppe:Eltern") == "Eltern"
    assert push.gruppe_aus("Stefan") is None
    assert push.gruppe_aus("gruppe:") is None


def test_recipients_resolve_a_group():
    service = PushService()
    for name in ("Stefan", "Livia", "Levin"):
        service.register(f"ExponentPushToken[{name}]", name)
    service.gruppen = {"Eltern": ["Stefan", "Livia"]}
    users = [Benutzer("Stefan"), Benutzer("Livia"), Benutzer("Levin", Role.KID)]
    tokens = service.recipients(users, "gruppe:Eltern", "tasks")
    assert sorted(tokens) == ["ExponentPushToken[Livia]", "ExponentPushToken[Stefan]"]
    # Eine unbekannte Gruppe erreicht niemanden - und fällt nicht auf «alle» zurück.
    assert service.recipients(users, "gruppe:Niemand", "tasks") == []
    # Wer abbestellt hat, bleibt auch in der Gruppe draussen.
    service.muted = {"Livia": {"tasks"}}
    assert service.recipients(users, "gruppe:Eltern", "tasks") == ["ExponentPushToken[Stefan]"]


# ── Später ────────────────────────────────────────────────────────────────


def test_eigene_minuten_defaults_to_half_an_hour():
    assert spaeter.eigene_minuten(None) == 30
    assert spaeter.eigene_minuten({"user": "Stefan"}) == 30
    assert spaeter.eigene_minuten({"snooze_minutes": 120}) == 120
    assert spaeter.eigene_minuten({"snooze_minutes": "bald"}) == 30
    assert spaeter.eigene_minuten({"snooze_minutes": 99999}) == spaeter.MAX_MINUTEN


# ── Die Routen ────────────────────────────────────────────────────────────

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18198 }}
integrations:
  - integration: demo
users:
  - name: Stefan
    role: besitzer
    token: t-owner
  - name: Livia
    role: bewohner
    token: t-resident
  - name: Gast
    role: gast
    token: t-guest
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


def test_the_level_route_changes_the_house_setting(client):
    antwort = client.put(
        "/api/push/stufe", json={"category": "battery", "stufe": "dringend"}, headers=kopf("t-owner")
    )
    assert antwort.status_code == 200, antwort.text
    assert antwort.json()["stufe"] == "dringend"
    assert client.hub.push.stufen == {"battery": "dringend"}
    zeilen = client.get("/api/push/categories", headers=kopf("t-resident")).json()
    batterie = next(z for z in zeilen["categories"] if z["key"] == "battery")
    assert batterie["dringend"] is True
    assert batterie["stufe"] == "dringend"
    assert batterie["stufe_standard"] == "leise"
    assert zeilen["darf_stufen"] is False
    assert zeilen["critical_alerts"] is False
    # Bewohner dürfen die Hausstufe nicht ändern; Unsinn wird abgewiesen.
    assert (
        client.put(
            "/api/push/stufe", json={"category": "battery", "stufe": "leise"}, headers=kopf("t-resident")
        ).status_code
        == 403
    )
    assert (
        client.put(
            "/api/push/stufe", json={"category": "battery", "stufe": "laut"}, headers=kopf("t-owner")
        ).status_code
        == 400
    )


def test_groups_route_keeps_only_known_members(client):
    antwort = client.put(
        "/api/push/gruppen",
        json={"groups": [{"name": "Eltern", "members": ["Stefan", "Livia", "Niemand"]}]},
        headers=kopf("t-owner"),
    )
    assert antwort.status_code == 200, antwort.text
    assert antwort.json()["groups"] == [{"name": "Eltern", "members": ["Stefan", "Livia"]}]
    assert client.hub.push.gruppen == {"Eltern": ["Stefan", "Livia"]}
    ziele = client.get("/api/push/targets", headers=kopf("t-resident")).json()
    assert ziele["groups"] == ["Eltern"]
    assert client.get("/api/push/gruppen", headers=kopf("t-guest")).status_code == 403


def test_snooze_uses_the_personal_minutes(client):
    gesetzt = client.put(
        "/api/push/categories", json={"muted": [], "snooze_minutes": 60}, headers=kopf("t-owner")
    )
    assert gesetzt.status_code == 200, gesetzt.text
    assert gesetzt.json()["snooze_minutes"] == 60
    assert (
        client.get("/api/push/categories", headers=kopf("t-owner")).json()["snooze_minutes"] == 60
    )
    antwort = client.post(
        "/api/push/snooze", json={"title": "Fenster offen", "category": "open"}, headers=kopf("t-owner")
    )
    assert antwort.json()["minutes"] == 60
    # Wer eine Zahl mitschickt, bekommt sie - und Ruhezeit und
    # Stillgestelltes überleben das Abbestellen.
    client.put("/api/push/ruhe", json={"enabled": True, "from": 22, "to": 7}, headers=kopf("t-owner"))
    client.put("/api/push/categories", json={"muted": ["battery"]}, headers=kopf("t-owner"))
    zeilen = client.get("/api/push/categories", headers=kopf("t-owner")).json()
    assert zeilen["ruhe"]["enabled"] is True
    assert zeilen["snooze_minutes"] == 60
    assert zeilen["muted"] == ["battery"]
