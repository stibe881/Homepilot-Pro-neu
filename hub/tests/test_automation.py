import asyncio

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

MOTION_AUTOMATION = {
    "id": "motion_light",
    "alias": "Licht bei Bewegung",
    "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
    "condition": [
        {"type": "state", "entity_id": "demo.light_livingroom", "equals": "off"}
    ],
    "action": [
        {
            "type": "command",
            "entity_id": "demo.light_livingroom",
            "command": "turn_on",
            "data": {"brightness": 80},
        }
    ],
}


async def run_hub(automations):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            automations=automations,
        )
    )
    await hub.start()
    return hub


async def settle():
    # Automationen laufen als eigene Tasks – kurz abwarten.
    for _ in range(10):
        await asyncio.sleep(0)


async def test_state_trigger_runs_action():
    hub = await run_hub([MOTION_AUTOMATION])
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        light = hub.registry.get("demo.light_livingroom")
        assert light.state["state"] == "on"
        assert light.state["brightness"] == 80
    finally:
        await hub.stop()


async def test_condition_blocks_action():
    hub = await run_hub([MOTION_AUTOMATION])
    try:
        # Licht ist schon an → Bedingung (equals "off") schlägt fehl.
        await hub.integrations.dispatch_command(
            "demo.light_livingroom", "turn_on", {"brightness": 30}
        )
        await settle()
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["brightness"] == 30
    finally:
        await hub.stop()


async def test_from_filter():
    automation = {
        "id": "off_to_on_only",
        "trigger": [
            {"type": "state", "entity_id": "demo.switch_coffee", "from": "on", "to": "off"}
        ],
        "action": [
            {"type": "command", "entity_id": "demo.light_bedroom", "command": "turn_on"}
        ],
    }
    hub = await run_hub([automation])
    try:
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_bedroom").state["state"] == "off"

        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_off")
        await settle()
        assert hub.registry.get("demo.light_bedroom").state["state"] == "on"
    finally:
        await hub.stop()
