"""Eigene Alarm-Modi (Punkt 515) und der Voralarm (Punkt 516).

Drei feste Modi decken das Übliche, nicht «Nur Erdgeschoss» oder
«Gäste da». Und der erste Melder allein machte die Anlage bisher sofort
laut - jetzt kann sie erst misstrauisch werden.
"""

from __future__ import annotations

import asyncio

import pytest

from homepilot.core import alarmbericht
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import (
    ARMED,
    DISARMED,
    TRIGGERED,
    VERDACHT,
    alle_modi,
    eigene_modi_lesen,
    modus_schluessel,
    parse_after,
    parse_sensors,
)

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


def contact(entity_id: str) -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.BINARY_SENSOR,
        name=entity_id,
        integration="test",
        state={"state": "off", "device_class": "contact"},
    )


# ── Reine Hälften ─────────────────────────────────────────────────────────


def test_modus_schluessel_is_url_and_file_safe():
    assert modus_schluessel("Nur Erdgeschoss") == "nur_erdgeschoss"
    assert modus_schluessel("Gäste da!") == "gaeste_da"
    assert modus_schluessel("   ") == ""
    assert len(modus_schluessel("x" * 80)) == 24


def test_eigene_modi_lesen_drops_builtin_and_duplicate_keys():
    modi = eigene_modi_lesen(
        [
            {"label": "Nur Erdgeschoss", "icon": "home-outline"},
            {"label": "Nacht"},  # fällt mit dem eingebauten zusammen
            {"label": "Nur Erdgeschoss"},  # doppelt
            {"key": "werkstatt", "label": "Werkstatt"},
            {"label": ""},
            "quatsch",
        ]
    )
    assert [m["key"] for m in modi] == ["nur_erdgeschoss", "werkstatt"]
    assert modi[0]["icon"] == "home-outline"
    assert alle_modi({"custom_modes": modi})["werkstatt"] == "Werkstatt"
    assert list(alle_modi(None))[:3] == ["nacht", "ausser_haus", "urlaub"]


def test_sensors_and_after_accept_custom_modes_only_when_named():
    sensors = parse_sensors([{"entity_id": "a", "modes": ["nacht", "werkstatt"]}])
    assert sensors["a"]["modes"] == ["nacht"]
    sensors = parse_sensors(
        [{"entity_id": "a", "modes": ["nacht", "werkstatt"]}],
        ("nacht", "ausser_haus", "urlaub", "werkstatt"),
    )
    assert sensors["a"]["modes"] == ["nacht", "werkstatt"]
    after = parse_after({"werkstatt": {"action": "disarm"}}, modes=("nacht", "werkstatt"))
    assert after["werkstatt"]["action"] == "disarm"
    assert "urlaub" not in after


def test_verdacht_is_part_of_the_report():
    assert "verdacht" in alarmbericht.DABEI


# ── Am lebenden Hub ───────────────────────────────────────────────────────


def make_hub(tmp_path) -> Hub:
    return Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            users=[OWNER],
            data_file=str(tmp_path / "daten.json"),
        )
    )


@pytest.fixture
def alarm_hub(tmp_path):
    async def build():
        hub = make_hub(tmp_path)
        await hub.start()
        await hub.registry.add(contact("test.tuer"))
        await hub.registry.add(contact("test.fenster"))
        service = hub.integrations.get("alarm")
        await service.update_config(
            {
                "settings": {
                    "exit_delay": 0,
                    "entry_delay": 0,
                    "notify_trigger": False,
                    "custom_modes": [{"label": "Nur Erdgeschoss", "icon": "home-outline"}],
                },
                "sensors": [
                    {"entity_id": "test.tuer", "modes": ["nacht", "nur_erdgeschoss"]},
                    {"entity_id": "test.fenster", "modes": ["ausser_haus"]},
                ],
            }
        )
        return hub, service

    hub, service = asyncio.run(build())
    yield hub, service
    asyncio.run(hub.stop())


def test_a_custom_mode_arms_and_guards_its_sensors(alarm_hub):
    hub, service = alarm_hub

    async def run():
        assert await service.arm("nur_erdgeschoss") == {"ok": True, "state": ARMED}
        assert service._entity.state["mode_label"] == "Nur Erdgeschoss"
        # Das Fenster wacht in diesem Modus nicht - die Türe schon.
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)
        assert service._entity.state["state"] == ARMED
        await hub.registry.update_state("test.tuer", {"state": "on"})
        await asyncio.sleep(0)
        assert service._entity.state["state"] == TRIGGERED

    asyncio.run(run())
    modi = service.config_dict()["modes"]
    assert [m["key"] for m in modi] == ["nacht", "ausser_haus", "urlaub", "nur_erdgeschoss"]
    assert modi[-1] == {
        "key": "nur_erdgeschoss",
        "label": "Nur Erdgeschoss",
        "icon": "home-outline",
        "builtin": False,
    }


def test_removing_a_custom_mode_removes_it_from_the_sensors(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.update_config({"settings": {"custom_modes": []}})
        assert service._sensors["test.tuer"]["modes"] == ["nacht"]
        with pytest.raises(Exception, match="Unbekannter Alarm-Modus"):
            await service.arm("nur_erdgeschoss")

    asyncio.run(run())


def test_arm_command_reaches_a_custom_mode(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await hub.integrations.dispatch_command(
            service._entity.id, "arm", {"mode": "nur_erdgeschoss"}
        )
        assert service._entity.state["mode"] == "nur_erdgeschoss"

    asyncio.run(run())


def test_the_first_sensor_only_raises_suspicion(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.update_config({"settings": {"suspect_delay": 30}})
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)
        assert service._entity.state["state"] == VERDACHT
        assert service._entity.state["seconds_left"] > 0
        assert service._entity.state["next_action"] == "trigger"
        assert service.history[0]["kind"] == "verdacht"
        # Derselbe Melder noch einmal ist kein zweiter Beweis.
        await hub.registry.update_state("test.fenster", {"state": "off"})
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)
        assert service._entity.state["state"] == VERDACHT
        # Entschärfen im Verdacht: Fehlalarm ohne Sirene, und nichts kommt nach.
        await service.disarm()
        await asyncio.sleep(0.05)
        assert service._entity.state["state"] == DISARMED

    asyncio.run(run())


def test_a_second_sensor_confirms_the_suspicion_at_once(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.update_config(
            {
                "settings": {"suspect_delay": 30},
                "sensors": [
                    {"entity_id": "test.tuer", "modes": ["ausser_haus"]},
                    {"entity_id": "test.fenster", "modes": ["ausser_haus"]},
                ],
            }
        )
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)
        assert service._entity.state["state"] == VERDACHT
        await hub.registry.update_state("test.tuer", {"state": "on"})
        await asyncio.sleep(0)
        assert service._entity.state["state"] == TRIGGERED
        assert service._entity.state["last_trigger"]["entity_id"] == "test.tuer"

    asyncio.run(run())


def test_the_suspicion_becomes_an_alarm_when_the_time_is_up(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.update_config({"settings": {"suspect_delay": 0.05}})
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)
        assert service._entity.state["state"] == VERDACHT
        await asyncio.sleep(0.1)
        assert service._entity.state["state"] == TRIGGERED

    asyncio.run(run())


def test_without_suspect_delay_the_alarm_is_immediate(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)
        assert service._entity.state["state"] == TRIGGERED

    asyncio.run(run())
