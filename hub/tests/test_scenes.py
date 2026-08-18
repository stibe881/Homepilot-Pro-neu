import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.errors import ConfigError, HomePilotError
from homepilot.core.hub import Hub
from homepilot.core.scenes import parse_scenes

KINO = {
    "id": "kino",
    "name": "Kino",
    "actions": [
        {"entity_id": "demo.light_livingroom", "command": "set_brightness",
         "data": {"brightness": 15}},
        {"entity_id": "demo.switch_coffee", "command": "turn_off"},
    ],
}


async def make_hub(scenes):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            scenes=scenes,
        )
    )
    await hub.start()
    return hub


def test_parse_requires_entity_and_command():
    with pytest.raises(ConfigError, match="entity_id"):
        parse_scenes([{"id": "x", "actions": [{"command": "turn_on"}]}])


async def test_activate_runs_all_actions():
    hub = await make_hub([KINO])
    try:
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
        result = await hub.scenes.activate("kino")

        assert result["failed"] == []
        light = hub.registry.get("demo.light_livingroom")
        assert light.state["brightness"] == 15
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
    finally:
        await hub.stop()


async def test_broken_action_does_not_stop_the_scene():
    """Ein defektes Gerät darf die restliche Szene nicht verhindern."""
    scene = {
        "id": "abend",
        "actions": [
            {"entity_id": "gibt.es.nicht", "command": "turn_on"},
            {"entity_id": "demo.light_bedroom", "command": "turn_on"},
        ],
    }
    hub = await make_hub([scene])
    try:
        result = await hub.scenes.activate("abend")
        assert len(result["failed"]) == 1
        assert result["failed"][0]["entity_id"] == "gibt.es.nicht"
        assert hub.registry.get("demo.light_bedroom").state["state"] == "on"
    finally:
        await hub.stop()


async def test_unknown_scene_raises():
    hub = await make_hub([])
    try:
        with pytest.raises(HomePilotError):
            await hub.scenes.activate("gibtsnicht")
    finally:
        await hub.stop()


async def test_scene_is_recorded_as_source():
    """Die App soll zeigen können, dass eine Szene geschaltet hat."""
    hub = await make_hub([KINO])
    sources = []
    hub.bus.subscribe("state_changed", lambda t, d: sources.append(d["source"]))
    try:
        await hub.scenes.activate("kino")
        assert sources
        assert all(source["kind"] == "scene" for source in sources)
        assert sources[0]["label"] == "Kino"
    finally:
        await hub.stop()


def test_ramp_hits_the_target_exactly():
    """Eine Rampe, die bei 97 % endet, wäre ein Fehler, den man abends im
    Bett sieht."""
    from homepilot.core.scenes import ramp

    steps = ramp(0, 100, 30, step=5)
    assert len(steps) == 6
    assert steps[0] == (0.0, 17)
    assert steps[-1] == (5.0, 100)
    # Abwärts genauso.
    assert ramp(100, 0, 20, step=5)[-1][1] == 0
    # Ohne Zeit oder ohne Weg: ein einziger Schritt.
    assert ramp(40, 40, 60) == [(0.0, 40)]
    assert ramp(0, 80, 0) == [(0.0, 80)]
