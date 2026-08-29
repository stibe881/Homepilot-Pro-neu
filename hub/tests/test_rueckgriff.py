"""Grosse Griffe zurücknehmen – «Alles aus» und «Gute Nacht».

Der Fall: Man drückt «Alles aus» und merkt beim Blick auf die Liste,
dass im Büro noch jemand sitzt. Zwanzig Kacheln wieder von Hand zu
finden ist keine Antwort.
"""

import time

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import rueckgriff, szenenrueckweg
from homepilot.core.hub import Hub

from .conftest import make_config


class FakeEntity:
    def __init__(self, entity_id, kind, commands, state):
        self.id = entity_id
        self.kind = kind
        self.commands = commands
        self.state = state


def test_der_stand_kommt_in_der_form_die_der_rueckweg_erwartet():
    stand = rueckgriff.geraetestand(
        [FakeEntity("demo.a", "light", ["turn_on", "turn_off"], {"state": "on"})]
    )
    assert stand == {
        "demo.a": {
            "kind": "light",
            "commands": ["turn_on", "turn_off"],
            "state": {"state": "on"},
        }
    }


def test_ein_licht_das_schon_aus_war_steht_nicht_im_rueckweg():
    """Sonst ginge beim Rückgängigmachen ein Gerät an, das den ganzen
    Abend aus war."""
    stand = rueckgriff.geraetestand(
        [
            FakeEntity("demo.an", "light", ["turn_on", "turn_off"], {"state": "on"}),
            FakeEntity("demo.aus", "light", ["turn_on", "turn_off"], {"state": "off"}),
        ]
    )
    befehle = szenenrueckweg.plane_rueckweg(
        [
            {"entity_id": "demo.an", "command": "turn_off"},
            {"entity_id": "demo.aus", "command": "turn_off"},
        ],
        stand,
    )
    assert befehle == [{"entity_id": "demo.an", "command": "turn_on"}]


def test_die_helligkeit_von_vorher_kommt_zurueck():
    stand = rueckgriff.geraetestand(
        [
            FakeEntity(
                "demo.dim",
                "light",
                ["turn_on", "turn_off", "set_brightness"],
                {"state": "on", "brightness": 40},
            )
        ]
    )
    assert szenenrueckweg.plane_rueckweg(
        [{"entity_id": "demo.dim", "command": "turn_off"}], stand
    ) == [
        {"entity_id": "demo.dim", "command": "set_brightness", "data": {"brightness": 40}}
    ]


def test_ohne_befehle_wird_kein_rueckweg_abgelegt():
    """«Alles aus» in einem Haus, in dem nichts mehr an war, hinterlässt
    nichts, was man zurücknehmen könnte."""
    assert rueckgriff.aufnehmen([], {"id": "x", "title": "Alles aus"}, 1000) == []


def test_abgelaufene_rueckwege_verschwinden():
    alt = {"id": "alt", "at": 1000.0, "commands": [{"entity_id": "a"}]}
    rows = rueckgriff.aufnehmen(
        [alt], {"id": "neu", "commands": [{"entity_id": "b"}]}, 1000 + rueckgriff.GUELTIG + 1
    )
    assert [row["id"] for row in rows] == ["neu"]
    assert rueckgriff.holen([alt], "alt", 1000 + rueckgriff.GUELTIG + 1) is None


def test_es_bleiben_hoechstens_die_letzten_paar():
    rows: list = []
    for nummer in range(rueckgriff.HOECHSTENS + 5):
        rows = rueckgriff.aufnehmen(
            rows,
            {"id": f"g{nummer}", "commands": [{"entity_id": "a"}]},
            1000 + nummer,
        )
    assert len(rows) == rueckgriff.HOECHSTENS
    assert rows[-1]["id"] == f"g{rueckgriff.HOECHSTENS + 4}"


def test_ein_gegangener_rueckweg_ist_weg():
    rows = rueckgriff.aufnehmen(
        [], {"id": "g1", "commands": [{"entity_id": "a"}]}, 1000
    )
    assert rueckgriff.entfernen(rows, "g1") == []


async def test_alles_aus_laesst_sich_ueber_den_hub_zurueckholen():
    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
            integrations=[{"integration": "demo"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        kopf = {"Authorization": "Bearer t-owner"}
        lampen = [
            entity for entity in hub.registry.all() if entity.kind == "light"
        ][:2]
        assert lampen
        for lampe in lampen:
            await hub.integrations.dispatch_command(lampe.id, "turn_on")

        # 1. Aufnehmen - vor dem Schalten, sonst ist der Stand von vorher weg.
        antwort = client.post(
            "/api/undo",
            json={"title": "Alles aus", "entity_ids": [x.id for x in lampen]},
            headers=kopf,
        )
        assert antwort.status_code == 200
        kennung = antwort.json()["undo"]["id"]
        assert antwort.json()["undo"]["count"] == len(lampen)

        # 2. Schalten - wie die App es tut, Gerät für Gerät.
        for lampe in lampen:
            await hub.integrations.dispatch_command(lampe.id, "turn_off")
        assert all(
            hub.registry.get(lampe.id).state.get("state") == "off" for lampe in lampen
        )

        # 3. Zurück.
        zurueck = client.post(f"/api/undo/{kennung}/run", headers=kopf)
        assert zurueck.status_code == 200
        assert zurueck.json()["ok"] is True
        assert all(
            hub.registry.get(lampe.id).state.get("state") == "on" for lampe in lampen
        )

        # Nur einmal: Ein zweites Mal stellte den Stand von vor dem Griff
        # über alles, was seither von Hand geschaltet wurde.
        assert client.post(f"/api/undo/{kennung}/run", headers=kopf).status_code == 404


async def test_gute_nacht_bietet_den_weg_zurueck_an():
    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
            integrations=[{"integration": "demo"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        kopf = {"Authorization": "Bearer t-owner"}
        lampen = [entity for entity in hub.registry.all() if entity.kind == "light"]
        assert lampen
        for lampe in lampen:
            await hub.integrations.dispatch_command(lampe.id, "turn_on")

        bericht = client.post("/api/goodnight/run", headers=kopf).json()
        assert bericht["lights_off"]
        kennung = bericht["undo"]["id"]
        assert client.post(f"/api/undo/{kennung}/run", headers=kopf).json()["ok"] is True
        assert any(
            hub.registry.get(lampe.id).state.get("state") == "on" for lampe in lampen
        )
        # Der Rückweg ist frisch abgelegt - abgelaufen ist er noch nicht.
        assert rueckgriff.gueltige(hub.data.get(rueckgriff.SCHLANGE), time.time()) == []
