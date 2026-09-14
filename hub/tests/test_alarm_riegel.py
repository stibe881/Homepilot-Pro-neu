"""Die Anlage schaltet scharf, obwohl die Haustür nicht abgeschlossen ist
(Punkt 614 der Werkbank).

Die Bereitschaftsprüfung kannte nur «offen» und «blind»; beim Schloss
zählte nur der Türsensor. Eine zugezogene, aber unverschlossene Nuki-Türe
ging ohne Wort durch - bei «Abwesend» war das Haus dann geschützt wie
ohne Schloss.
"""

from __future__ import annotations

import asyncio

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.errors import HomePilotError
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import ARMED
from homepilot.integrations.alarm_rules import abwesend, unverschlossen

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


def lock(entity_id: str, state: str, door: str | None = None) -> Entity:
    zustand = {"state": state}
    if door:
        zustand["door"] = door
    return Entity(
        id=entity_id,
        kind=EntityKind.LOCK,
        name="Haustüre",
        integration="test",
        state=zustand,
        commands=["lock", "unlock"],
    )


# ── Reine Hälften ─────────────────────────────────────────────────────────


def test_abwesend_are_the_modes_without_anyone_at_home():
    assert abwesend("ausser_haus") and abwesend("urlaub")
    assert not abwesend("nacht")
    # Eigene Modi («Nur Erdgeschoss», «Gäste da») heissen: Es ist jemand da.
    assert not abwesend("nur_erdgeschoss")
    assert not abwesend(None)


def test_unverschlossen_finds_the_unlocked_door_but_not_for_a_zone():
    zu = lock("nuki.zu", "locked", door="closed")
    auf = lock("nuki.auf", "unlocked", door="closed")
    assert [e.id for e in unverschlossen([zu, auf])] == ["nuki.auf"]
    # «Nur die Garage»: Ein Schloss hat keine Zone, und wer einen Teil
    # des Hauses scharf schaltet, ist selbst noch drin.
    assert unverschlossen([zu, auf], zone="Garage") == []


# ── Am lebenden Hub ───────────────────────────────────────────────────────


@pytest.fixture
def alarm_hub(tmp_path):
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
        # Türe zugezogen (Türsensor «closed»), aber nicht abgeschlossen.
        await hub.registry.add(lock("test.haustuer", "unlocked", door="closed"))
        service = hub.integrations.get("alarm")
        await service.update_config(
            {
                "settings": {"exit_delay": 0, "notify_trigger": False, "notify_arming": False},
                "sensors": [{"entity_id": "test.haustuer", "modes": ["ausser_haus", "nacht"]}],
            }
        )
        return hub, service

    hub, service = asyncio.run(build())
    yield hub, service
    asyncio.run(hub.stop())


def test_away_refuses_with_the_unlocked_door_as_third_answer(alarm_hub):
    hub, service = alarm_hub

    async def run():
        result = await service.arm("ausser_haus")
        assert result["ok"] is False
        assert result["reason"] == "unverschlossen"
        # Der Türsensor ist zu - «offen» ist die Türe nicht.
        assert result["open"] == []
        assert result["unlocked"] == [{"entity_id": "test.haustuer", "label": "Haustüre"}]
        assert service._entity.state["state"] == "unscharf"
        # Trotzdem scharf bleibt möglich - wie bei einem offenen Fenster.
        assert (await service.arm("ausser_haus", force=True))["ok"] is True
        assert service._entity.state["state"] == ARMED
        assert "nicht abgeschlossen: Haustüre" in service.history[0]["text"]

    asyncio.run(run())


def test_an_open_window_still_comes_first(alarm_hub):
    hub, service = alarm_hub

    async def run():
        fenster = Entity(
            id="test.fenster",
            kind=EntityKind.BINARY_SENSOR,
            name="Fenster",
            integration="test",
            state={"state": "on", "device_class": "contact"},
        )
        await hub.registry.add(fenster)
        await service.update_config(
            {"sensors": [{"entity_id": "test.fenster", "modes": ["ausser_haus"]}]}
        )
        result = await service.arm("ausser_haus")
        assert result["reason"] == "offen"
        # Die Türe steht trotzdem dabei - die App zeigt beides.
        assert [z["label"] for z in result["unlocked"]] == ["Haustüre"]

    asyncio.run(run())


def test_night_arms_anyway_and_only_mentions_the_door(alarm_hub):
    hub, service = alarm_hub

    async def run():
        # Nachts geht man nochmals raus: kein Veto, nur ein Hinweis.
        result = await service.arm("nacht")
        assert result["ok"] is True
        assert [z["label"] for z in result["unlocked"]] == ["Haustüre"]
        assert service._entity.state["state"] == ARMED
        assert service.history[0]["text"] == "Nacht scharf geschaltet – nicht abgeschlossen: Haustüre"

    asyncio.run(run())


def test_a_locked_door_answers_as_before(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await hub.registry.update_state("test.haustuer", {"state": "locked"})
        assert await service.arm("ausser_haus") == {"ok": True, "state": ARMED}

    asyncio.run(run())


def test_the_command_names_the_door(alarm_hub):
    hub, service = alarm_hub

    async def run():
        with pytest.raises(HomePilotError, match="nicht abgeschlossen: Haustüre"):
            await hub.integrations.dispatch_command(service._entity.id, "arm_away", {})

    asyncio.run(run())
