"""Gemeinsam umschalten: ein Taster, zwei Räume, ein Zustand.

Der Fall aus dem Haus: Ein Wandtaster schaltet das Licht im Eingang und
im Gang. Zwei einzelne «umschalten» machen daraus zuverlässig das
Gegenteil – ist eines an und eines aus, sind danach beide vertauscht,
aber nie beide gleich. Wer zweimal drückt, ist wieder am Anfang.
"""

import asyncio

import pytest

from homepilot.core.automation import describe_action, find_conflicts, parse_automations
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.light import common_target


def test_alles_an_geht_alles_aus():
    assert common_target(["on", "on"]) == "turn_off"


def test_gemischt_geht_alles_an():
    # Der Druck im Dunkeln soll Licht bringen, nicht den Rest löschen.
    assert common_target(["on", "off"]) == "turn_on"
    assert common_target(["off", "on"]) == "turn_on"


def test_alles_aus_geht_alles_an():
    assert common_target(["off", "off"]) == "turn_on"


def test_eine_stumme_lampe_kippt_die_entscheidung_nicht():
    # Sie zählt nicht mit: Sonst ginge alles an, nur weil eine Lampe
    # gerade nicht antwortet.
    assert common_target(["on", None]) == "turn_off"
    assert common_target([None, None]) == "turn_on"


def test_auch_steckdosen_zaehlen_als_an():
    assert common_target(["on", "true"]) == "turn_off"


def test_beschreibung_nennt_die_geraete():
    zeile = describe_action(
        {"type": "toggle_all", "entity_ids": ["hue.eingang", "hue.gang"]}
    )
    assert zeile == "hue.eingang, hue.gang: gemeinsam umschalten"


def test_gemeinsames_umschalten_ist_zu_nichts_gegensaetzlich():
    # «Umschalten» kann beides – als Konflikt zu melden wäre Lärm.
    ablaeufe = parse_automations(
        [
            {
                "id": "a",
                "alias": "Taster",
                "trigger": [],
                "action": [{"type": "toggle_all", "entity_ids": ["hue.gang"]}],
            },
            {
                "id": "b",
                "alias": "Nachts aus",
                "trigger": [],
                "action": [
                    {"type": "command", "entity_id": "hue.gang", "command": "turn_off"}
                ],
            },
        ]
    )
    assert find_conflicts(ablaeufe) == []


# ── Im laufenden Hub ───────────────────────────────────────────────────────

TASTER = {
    "id": "taster",
    "alias": "Wandtaster Eingang",
    "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
    "action": [
        {
            "type": "toggle_all",
            "entity_ids": ["demo.light_livingroom", "demo.light_bedroom"],
        }
    ],
}


async def taster_hub():
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            automations=[TASTER],
        )
    )
    await hub.start()
    return hub


async def druecken(hub):
    """Einen Tastendruck nachstellen – der Melder meldet «an»."""
    await hub.integrations.dispatch_command("demo.motion_hall", "turn_off")
    await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
    for _ in range(10):
        await asyncio.sleep(0)


def zustaende(hub):
    return [
        hub.registry.get(entity_id).state["state"]
        for entity_id in ("demo.light_livingroom", "demo.light_bedroom")
    ]


@pytest.mark.asyncio
async def test_aus_gemischt_wird_alles_an():
    hub = await taster_hub()
    try:
        await hub.integrations.dispatch_command("demo.light_livingroom", "turn_on")
        assert zustaende(hub) == ["on", "off"]
        await druecken(hub)
        assert zustaende(hub) == ["on", "on"]
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_der_zweite_druck_macht_alles_aus():
    hub = await taster_hub()
    try:
        await hub.integrations.dispatch_command("demo.light_livingroom", "turn_on")
        await druecken(hub)
        await druecken(hub)
        assert zustaende(hub) == ["off", "off"]
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_zweimal_druecken_ist_nicht_wieder_der_anfang():
    # Genau das war der Fehler mit zwei einzelnen «umschalten»: Nach zwei
    # Drücken stand alles wieder wie vorher, nur nie gemeinsam.
    hub = await taster_hub()
    try:
        await hub.integrations.dispatch_command("demo.light_livingroom", "turn_on")
        vorher = zustaende(hub)
        await druecken(hub)
        await druecken(hub)
        assert zustaende(hub) != vorher
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_ein_unbekanntes_geraet_haelt_die_gruppe_nicht_auf():
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            automations=[
                {
                    **TASTER,
                    "action": [
                        {
                            "type": "toggle_all",
                            "entity_ids": ["demo.light_livingroom", "hue.gibtsnicht"],
                        }
                    ],
                }
            ],
        )
    )
    await hub.start()
    try:
        await druecken(hub)
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
    finally:
        await hub.stop()
