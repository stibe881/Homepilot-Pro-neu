"""Konsolenzeit: wer was darf, und dass die Tür zum Wächter führt."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub

USERS = [
    {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
    {"name": "Maja", "role": "kind", "token": "t-maja"},
    {"name": "Noah", "role": "kind", "token": "t-noah"},
    {"name": "Gast", "role": "gast", "token": "t-guest"},
]
PS5 = "playstation.wohnzimmer"
PLAN = {
    "aktiv": True,
    "konsolen": [PS5],
    # Jeden Tag den ganzen Tag: Der Test hängt nicht an der Uhr.
    "tage": [{"an": True, "von": 0, "bis": 1440, "minuten": 60}] * 7,
    "monat": 1200,
}


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def make_client() -> TestClient:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}], users=USERS))
    # Die Konsole direkt in die Ablage legen: Der Test braucht kein Gerät,
    # nur einen Eintrag, den der Wächter finden kann.
    hub.registry._entities[PS5] = Entity(
        id=PS5, kind=EntityKind.MEDIA_PLAYER, name="PS5", integration="playstation",
        state={"state": "on"}, commands=["turn_off"],
    )
    return TestClient(create_app(hub))


def einrichten(client: TestClient) -> None:
    for kind in ("Maja", "Noah"):
        antwort = client.put(f"/api/konsolenzeit/{kind}/plan", json=PLAN, headers=auth("t-owner"))
        assert antwort.status_code == 200, antwort.text


def test_a_child_cannot_change_a_plan():
    with make_client() as client:
        antwort = client.put("/api/konsolenzeit/Maja/plan", json=PLAN, headers=auth("t-maja"))
        assert antwort.status_code == 403


def test_a_child_cannot_give_itself_time_or_free_days():
    with make_client() as client:
        einrichten(client)
        for pfad, body in (("geben", {"minuten": 30}), ("frei", {"an": True}), ("sperre", {"an": False})):
            antwort = client.post(f"/api/konsolenzeit/Maja/{pfad}", json=body, headers=auth("t-maja"))
            assert antwort.status_code == 403, pfad


def test_a_child_sees_only_itself():
    with make_client() as client:
        einrichten(client)
        eigene = client.get("/api/konsolenzeit", headers=auth("t-maja")).json()
        assert [k["kind"] for k in eigene["kinder"]] == ["Maja"]
        alle = client.get("/api/konsolenzeit", headers=auth("t-owner")).json()
        assert sorted(k["kind"] for k in alle["kinder"]) == ["Maja", "Noah"]
        assert client.get("/api/konsolenzeit/Noah", headers=auth("t-maja")).status_code == 403


def test_a_guest_has_no_access_at_all():
    with make_client() as client:
        assert client.get("/api/konsolenzeit", headers=auth("t-guest")).status_code == 403


def test_a_child_signs_in_for_itself_but_not_for_a_sibling():
    with make_client() as client:
        einrichten(client)
        eigene = client.post("/api/konsolenzeit/Maja/spielen", json={"konsole": PS5}, headers=auth("t-maja"))
        assert eigene.status_code == 200
        assert eigene.json()["sitzung"]["konsole"] == PS5
        fremd = client.post("/api/konsolenzeit/Noah/spielen", json={"konsole": PS5}, headers=auth("t-maja"))
        assert fremd.status_code == 403
        stopp = client.post("/api/konsolenzeit/Maja/stopp", headers=auth("t-maja"))
        assert stopp.json()["sitzung"] is None


def test_a_grown_up_can_sign_a_child_in_and_give_time():
    with make_client() as client:
        einrichten(client)
        antwort = client.post("/api/konsolenzeit/Noah/spielen", json={"konsole": PS5}, headers=auth("t-owner"))
        assert antwort.status_code == 200
        geben = client.post("/api/konsolenzeit/Noah/geben", json={"minuten": 15}, headers=auth("t-owner"))
        assert geben.json()["heute"]["bonus"] == 15
        assert geben.json()["rest_s"] == 75 * 60


def test_refusals_come_back_as_a_readable_message_not_a_crash():
    with make_client() as client:
        einrichten(client)
        client.post("/api/konsolenzeit/Maja/sperre", json={"an": True}, headers=auth("t-owner"))
        antwort = client.post("/api/konsolenzeit/Maja/spielen", json={"konsole": PS5}, headers=auth("t-maja"))
        assert antwort.status_code == 400
        assert "gesperrt" in antwort.json()["detail"]


def test_the_unknown_console_policy_accepts_only_known_choices():
    with make_client() as client:
        gut = client.put("/api/konsolenzeit/einstellungen", json={"unbekannt": "sperren"}, headers=auth("t-owner"))
        assert gut.status_code == 200
        schlecht = client.put("/api/konsolenzeit/einstellungen", json={"unbekannt": "vielleicht"}, headers=auth("t-owner"))
        assert schlecht.status_code == 400
