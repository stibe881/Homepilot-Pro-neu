"""Bei Feuer nachts löst die Flucht die Einbruchmeldeanlage aus
(Punkt 615 der Werkbank).

Brandmeldeanlage und Alarmanlage kannten einander nicht: Schlug um drei
Uhr ein Rauchmelder an, während «Nacht» scharf war, weckte die
Brandanlage alle mit Durchsage und Licht - und die erste Person im Flur
löste über den Bewegungsmelder den Einbruchalarm samt Sirene aus.
"""

from __future__ import annotations

import asyncio

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import ARMED, BRAND, DISARMED, TRIGGERED
from homepilot.integrations.alarm_rules import ARMING, ENTRY, VERDACHT, brand_setzt_aus

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


def sensor(entity_id: str, klasse: str = "motion") -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.BINARY_SENSOR,
        name=entity_id,
        integration="test",
        state={"state": "off", "device_class": klasse},
    )


# ── Reine Hälfte ──────────────────────────────────────────────────────────


def test_fire_pauses_only_when_someone_is_at_home():
    for state in (ARMING, ARMED, ENTRY, VERDACHT, TRIGGERED):
        assert brand_setzt_aus(state, "nacht")
        assert brand_setzt_aus(state, "nur_erdgeschoss")
        # Bei Abwesend/Ferien bleibt der Einbruchweg offen.
        assert not brand_setzt_aus(state, "ausser_haus")
        assert not brand_setzt_aus(state, "urlaub")
    assert not brand_setzt_aus(DISARMED, "nacht")
    assert not brand_setzt_aus(BRAND, "nacht")


# ── Am lebenden Hub ───────────────────────────────────────────────────────


@pytest.fixture
def haus(tmp_path):
    async def build():
        hub = Hub(
            HubConfig(
                api=ApiConfig(),
                integrations=[{"integration": "demo"}],
                users=[OWNER],
                data_file=str(tmp_path / "daten.json"),
            )
        )
        await hub.start()
        await hub.registry.add(sensor("test.flur"))
        await hub.registry.add(sensor("test.rauch", "smoke"))
        alarm = hub.integrations.get("alarm")
        await alarm.update_config(
            {
                "settings": {
                    "exit_delay": 0,
                    "entry_delay": 0,
                    "notify_trigger": False,
                    "notify_arming": False,
                },
                "sensors": [{"entity_id": "test.flur", "modes": ["nacht", "ausser_haus"]}],
            }
        )
        # Die Brandanlage still stellen: Hier geht es um die Alarmanlage.
        brand = hub.integrations.get("brand")
        await brand.update_config(
            {"settings": {"notify": False, "announce": False, "notify_clear": False}}
        )
        return hub, alarm

    hub, alarm = asyncio.run(build())
    yield hub, alarm
    asyncio.run(hub.stop())


def test_smoke_at_night_pauses_the_alarm_and_the_escape_stays_silent(haus):
    hub, alarm = haus

    async def run():
        await alarm.arm("nacht")
        await hub.registry.update_state("test.rauch", {"state": "on"})
        await asyncio.sleep(0.05)
        assert alarm._entity.state["state"] == BRAND
        assert alarm._entity.state["mode"] == "nacht"
        assert alarm.history[0]["kind"] == "brand"
        assert "Brandalarm" in alarm.history[0]["text"]
        # Die Flucht durch den Flur: kein Einbruchalarm.
        await hub.registry.update_state("test.flur", {"state": "on"})
        await asyncio.sleep(0.05)
        assert alarm._entity.state["state"] == BRAND
        # Entwarnung: zurück in den Nachtmodus - ohne Bereitschaftsprüfung,
        # obwohl der Melder noch «on» sagt.
        await hub.registry.update_state("test.rauch", {"state": "off"})
        await asyncio.sleep(0.05)
        assert alarm._entity.state["state"] == ARMED
        assert alarm._entity.state["mode"] == "nacht"
        assert alarm.history[0]["text"].startswith("Nach Entwarnung wieder scharf (Nacht)")
        assert "noch offen: test.flur" in alarm.history[0]["text"]

    asyncio.run(run())


def test_away_keeps_watching_during_a_fire(haus):
    hub, alarm = haus

    async def run():
        await alarm.arm("ausser_haus")
        await hub.registry.update_state("test.rauch", {"state": "on"})
        await asyncio.sleep(0.05)
        # Der Einbruchweg bleibt offen: Wer das Feuer legt, schaltet
        # damit nicht die Anlage aus.
        assert alarm._entity.state["state"] == ARMED
        await hub.registry.update_state("test.flur", {"state": "on"})
        await asyncio.sleep(0.05)
        assert alarm._entity.state["state"] == TRIGGERED

    asyncio.run(run())


def test_a_running_alarm_is_cut_off_by_the_fire(haus):
    hub, alarm = haus

    async def run():
        await alarm.update_config(
            {"escalation": {"after": 60, "sirens": ["demo.light_livingroom"]}}
        )
        await alarm.arm("nacht")
        await hub.registry.update_state("test.flur", {"state": "on"})
        await asyncio.sleep(0.05)
        assert alarm._entity.state["state"] == TRIGGERED
        await hub.registry.update_state("test.rauch", {"state": "on"})
        await asyncio.sleep(0.05)
        assert alarm._entity.state["state"] == BRAND
        # Die Eskalation ist abgebrochen, nichts wartet mehr auf seine Frist.
        assert alarm._eskalation_task is None
        assert alarm._timer is None
        assert alarm._entity.state["seconds_left"] is None

    asyncio.run(run())


def test_who_disarmed_during_the_fire_stays_disarmed(haus):
    hub, alarm = haus

    async def run():
        await alarm.arm("nacht")
        await hub.registry.update_state("test.rauch", {"state": "on"})
        await asyncio.sleep(0.05)
        await alarm.disarm(by="Stefan")
        await hub.registry.update_state("test.rauch", {"state": "off"})
        await asyncio.sleep(0.05)
        assert alarm._entity.state["state"] == DISARMED

    asyncio.run(run())
