"""PIN fürs Entschärfen: mit Drossel, nie im Klartext.

Sie gilt für alles, was jemand *antippt* - App, Wandtablet, Szene,
Karte. Nicht für Abläufe: Die haben keine Tastatur, und die Anlage blieb
deshalb bei jeder Heimkehr scharf. Warum das kein Loch in der PIN ist,
steht in alarm_rules.ohne_pin_erlaubt().
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import DISARMED, hash_pin, valid_pin

from .conftest import make_config


def test_pin_is_hashed_and_verified():
    entry = {"salt": "abc", "hash": hash_pin("1234", "abc")}
    assert valid_pin(entry, "1234") is True
    assert valid_pin(entry, "9999") is False
    assert valid_pin({}, "1234") is False


def _hub():
    return Hub(
        make_config(
            token="geheim",
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t-stefan"},
                {"name": "Livia", "role": "bewohner", "token": "t-livia"},
            ],
            integrations=[{"integration": "demo"}, {"integration": "alarm"}],
        )
    )


def test_disarm_needs_the_pin_once_set():
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        stefan = {"Authorization": "Bearer t-stefan"}
        livia = {"Authorization": "Bearer t-livia"}

        # PIN setzen darf nur, wer Benutzer verwaltet.
        assert (
            client.put("/api/alarm/pin", json={"pin": "2580"}, headers=livia).status_code
            == 403
        )
        assert (
            client.put("/api/alarm/pin", json={"pin": "12"}, headers=stefan).status_code
            == 400
        )
        assert (
            client.put("/api/alarm/pin", json={"pin": "2580"}, headers=stefan).status_code
            == 200
        )
        # Die PIN liegt nie im Klartext auf der Platte.
        stored = hub.data.get("alarm_pin")
        assert stored and "2580" not in str(stored)

        # Scharf schalten geht ohne PIN …
        armed = client.post(
            "/api/alarm/arm", json={"mode": "ausser_haus", "force": True}, headers=stefan
        )
        assert armed.status_code == 200

        # … Entschärfen nicht mehr.
        wrong = client.post("/api/alarm/disarm", json={"pin": "1111"}, headers=livia)
        assert wrong.status_code == 403
        assert "Falsche PIN" in wrong.json()["detail"]
        missing = client.post("/api/alarm/disarm", json={}, headers=livia)
        assert missing.status_code == 403

        ok = client.post("/api/alarm/disarm", json={"pin": "2580"}, headers=livia)
        assert ok.status_code == 200

        # Auch der generische Gerätebefehl kennt keine Hintertür.
        client.post(
            "/api/alarm/arm", json={"mode": "ausser_haus", "force": True}, headers=stefan
        )
        blocked = client.post(
            "/api/entities/alarm.anlage/command",
            json={"command": "disarm"},
            headers=livia,
        )
        # Der generische Befehlsweg meldet Integrationsfehler als 500 mit
        # lesbarem Text - entscheidend ist: nicht entschärft.
        assert blocked.status_code >= 400
        assert "PIN" in blocked.json()["detail"]
        via_command = client.post(
            "/api/entities/alarm.anlage/command",
            json={"command": "disarm", "data": {"pin": "2580"}},
            headers=livia,
        )
        assert via_command.status_code == 200

        # PIN entfernen: Entschärfen geht wieder ohne.
        client.put("/api/alarm/pin", json={"pin": ""}, headers=stefan)
        client.post(
            "/api/alarm/arm", json={"mode": "ausser_haus", "force": True}, headers=stefan
        )
        assert (
            client.post("/api/alarm/disarm", json={}, headers=stefan).status_code == 200
        )


# ── Abläufe haben keine Tastatur ─────────────────────────────────────────
#
# Der Anlass: Die Anlage schaltete sich bei der Heimkehr nicht mehr ab.
# Der Ablauf war unverändert - nur war inzwischen eine PIN gesetzt, und
# die galt für alles. Er scheiterte bei jeder Ankunft still.


def test_only_automations_may_skip_the_pin():
    from homepilot.integrations.alarm_rules import ohne_pin_erlaubt

    assert ohne_pin_erlaubt({"kind": "automation", "label": "Nach Hause"}, {})
    # Eine Szene tippt jemand an, der davor steht - genau der Fall, für
    # den es die PIN gibt.
    assert not ohne_pin_erlaubt({"kind": "scene", "label": "Kino"}, {})
    assert not ohne_pin_erlaubt({"kind": "user", "label": "Stefan"}, {})
    assert not ohne_pin_erlaubt({"kind": "device", "label": "Gerät"}, {})
    assert not ohne_pin_erlaubt(None, {})


def test_the_strict_setting_closes_it_again():
    """Wie stark die Bedingung eines Ablaufs ist, weiss nur, wer ihn
    geschrieben hat - ein Wandtaster ist etwas anderes als die Ortung."""
    from homepilot.integrations.alarm_rules import ohne_pin_erlaubt

    quelle = {"kind": "automation", "label": "Nach Hause"}
    assert not ohne_pin_erlaubt(quelle, {"automation_disarm": False})
    assert ohne_pin_erlaubt(quelle, {"automation_disarm": True})


def test_the_history_names_who_switched():
    from homepilot.integrations.alarm_rules import quellen_name

    assert quellen_name({"kind": "automation", "label": "Nach Hause"}) == "Ablauf «Nach Hause»"
    assert quellen_name({"kind": "scene", "label": "Kino"}) == "Szene «Kino»"
    assert quellen_name({"kind": "user", "label": "Stefan"}) == "Stefan"
    assert quellen_name({"kind": "device"}) == ""
    assert quellen_name("Unsinn") == ""


async def _mit_pin(hub, pin="2580"):
    """Anlage scharf, PIN gesetzt - der Zustand, in dem es scheiterte."""
    anlage = hub.integrations.get("alarm")
    anlage.set_pin(pin)
    await anlage.arm("ausser_haus", force=True)
    return anlage


async def test_an_automation_disarms_although_a_pin_is_set():
    from homepilot.core.automation import Automation

    hub = _hub()
    await hub.start()
    try:
        anlage = await _mit_pin(hub)
        hub.automations.automations.append(
            Automation(
                id="heim",
                alias="Nach Hause",
                triggers=[],
                conditions=[],
                actions=[
                    {
                        "type": "command",
                        "entity_id": "alarm.anlage",
                        "command": "disarm",
                    }
                ],
            )
        )

        assert await hub.automations.trigger_now("heim") is True
        assert anlage._state == DISARMED
        # Und im Verlauf steht, wer geschaltet hat.
        assert anlage.history[0]["by"] == "Ablauf «Nach Hause»"
    finally:
        await hub.stop()


async def test_the_strict_setting_stops_the_automation_again():
    from homepilot.core.automation import Automation

    hub = _hub()
    await hub.start()
    try:
        anlage = await _mit_pin(hub)
        await anlage.update_config({"settings": {"automation_disarm": False}})
        hub.automations.automations.append(
            Automation(
                id="heim",
                alias="Nach Hause",
                triggers=[],
                conditions=[],
                actions=[
                    {
                        "type": "command",
                        "entity_id": "alarm.anlage",
                        "command": "disarm",
                    }
                ],
            )
        )

        await hub.automations.trigger_now("heim")
        # Noch in der Ausgangsverzögerung - Hauptsache, nicht unscharf.
        assert anlage._state != DISARMED
    finally:
        await hub.stop()
