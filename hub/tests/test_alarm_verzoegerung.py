"""Wochentagsabhängige Ein- und Ausgangsverzögerung (Punkt 722 der Werkbank).

Der Fall: Eine feste Ausgangsverzögerung passt für den Werktag mit dem
hektischen Aufbruch um Viertel vor acht - am Wochenende, wenn morgens
niemand zu einer festen Zeit aus dem Haus geht, war dieselbe Zahl zu kurz
oder unnötig lang.
"""

from __future__ import annotations

import asyncio
from datetime import datetime

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import ARMED, ARMING
from homepilot.integrations.alarm_rules import verzoegerung

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


def contact(entity_id: str, state: str = "off") -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.BINARY_SENSOR,
        name=entity_id,
        integration="test",
        state={"state": state, "device_class": "contact"},
    )


# ── Reine Hälfte ────────────────────────────────────────────────────────


def test_a_plain_number_applies_to_every_weekday():
    assert verzoegerung(45, 0) == 45
    assert verzoegerung(45, 6) == 45


def test_a_dict_picks_the_matching_weekday():
    setting = {"default": 45, 5: 90, 6: 90}
    assert verzoegerung(setting, 5) == 90
    assert verzoegerung(setting, 6) == 90
    assert verzoegerung(setting, 0) == 45


def test_a_dict_also_accepts_string_keys():
    # YAML/JSON liefern Wochentage manchmal als Text statt als Zahl -
    # beides soll denselben Eintrag treffen.
    assert verzoegerung({"default": 45, "5": 90}, 5) == 90


def test_missing_default_counts_as_zero():
    assert verzoegerung({5: 90}, 0) == 0


def test_broken_or_missing_settings_count_as_zero():
    assert verzoegerung(None, 0) == 0
    assert verzoegerung({}, 0) == 0
    assert verzoegerung("kaputt", 0) == 0
    assert verzoegerung({"default": "kaputt"}, 0) == 0


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
        await hub.registry.add(contact("test.tuer"))
        service = hub.integrations.get("alarm")
        await service.update_config(
            {
                "sensors": [{"entity_id": "test.tuer", "modes": ["ausser_haus"]}],
                "settings": {"notify_trigger": False, "notify_arming": False},
            }
        )
        return hub, service

    hub, service = asyncio.run(build())
    yield hub, service
    asyncio.run(hub.stop())


def test_todays_override_shortens_the_exit_delay(alarm_hub):
    hub, service = alarm_hub
    heute = datetime.now().weekday()

    async def run():
        # Hoher Grundwert, aber für den heutigen Wochentag auf 0 gesetzt -
        # scharf schalten soll darum sofort durchgehen, ohne Wartezeit.
        await service.update_config({"settings": {"exit_delay": {"default": 300, heute: 0}}})
        return await service.arm("ausser_haus")

    result = asyncio.run(run())
    assert result["ok"] is True
    assert service._entity.state["state"] == ARMED


def test_a_different_weekdays_override_does_not_apply_today(alarm_hub):
    hub, service = alarm_hub
    heute = datetime.now().weekday()
    ein_anderer_tag = (heute + 1) % 7

    async def run():
        # 0 gilt für einen anderen Tag, heute zählt der Grundwert - die
        # Anlage bleibt also während der Verzögerung im Zustand ARMING.
        await service.update_config(
            {"settings": {"exit_delay": {"default": 300, ein_anderer_tag: 0}}}
        )
        return await service.arm("ausser_haus")

    result = asyncio.run(run())
    assert result["ok"] is True
    assert service._entity.state["state"] == ARMING
    assert service._entity.state["seconds_left"] > 0
