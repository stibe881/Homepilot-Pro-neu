import asyncio

from homepilot.core.automation import Automation, parse_automations
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


def test_crosses_threshold_only_on_the_step_over():
    from homepilot.core.automation import crosses_threshold

    # Tumbler fertig: Leistung fällt unter 5 W.
    assert crosses_threshold(1450.0, 2.1, below=5) is True
    # Schwankungen unterhalb der Schwelle lösen nicht erneut aus.
    assert crosses_threshold(2.1, 2.0, below=5) is False
    # Anlaufen: über die Schwelle.
    assert crosses_threshold(2.0, 1450.0, above=5) is True
    assert crosses_threshold(1400.0, 1450.0, above=5) is False
    # Unbekannter Vorzustand zählt nicht als Übertritt.
    assert crosses_threshold(None, 2.0, below=5) is False
    assert crosses_threshold("unknown", 2.0, below=5) is False


async def test_threshold_trigger_fires_once_per_crossing():
    automation = {
        "id": "tumbler_fertig",
        "trigger": [
            {
                "type": "state",
                "entity_id": "demo.light_bedroom",
                "attribute": "brightness",
                "below": 5,
            }
        ],
        "action": [
            {"type": "command", "entity_id": "demo.switch_coffee", "command": "turn_on"}
        ],
    }
    hub = await run_hub([automation])
    try:
        await hub.registry.update_state("demo.light_bedroom", {"brightness": 80})
        await settle()
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"

        await hub.registry.update_state("demo.light_bedroom", {"brightness": 2})
        await settle()
        assert hub.registry.get("demo.switch_coffee").state["state"] == "on"

        # Weiter unterhalb der Schwelle: kein zweites Auslösen.
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_off")
        await hub.registry.update_state("demo.light_bedroom", {"brightness": 1})
        await settle()
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
    finally:
        await hub.stop()


def test_conditions_are_combined_with_and_by_default():
    """Zwei Bedingungen heissen «beide» – so hat es der Ablauf immer
    gemeint, und dabei bleibt es ohne ausdrückliche Angabe."""
    automation = Automation(
        id="a",
        alias="Test",
        triggers=[],
        conditions=[
            {"type": "state", "entity_id": "demo.a", "equals": "on"},
            {"type": "state", "entity_id": "demo.b", "equals": "on"},
        ],
    )
    assert automation.match == "all"
    assert automation.as_config()["match"] == "all"


def test_match_any_is_read_from_the_config():
    parsed = parse_automations(
        [
            {
                "id": "a",
                "alias": "Test",
                "trigger": [],
                "condition": [{"type": "state", "entity_id": "demo.a", "equals": "on"}],
                "match": "any",
            }
        ]
    )
    assert parsed[0].match == "any"
    # Unsinn fällt auf «all» zurück – die vorsichtigere Variante.
    assert parse_automations([{"id": "b", "alias": "B", "match": "quatsch"}])[0].match == "all"


async def test_match_any_runs_when_one_condition_holds():
    """«oder»: Eine erfüllte Bedingung genügt. Mit «und» bliebe der Ablauf
    hier stehen, weil die zweite Bedingung nicht stimmt."""
    hub = await run_hub(
        [
            {
                **MOTION_AUTOMATION,
                "match": "any",
                "condition": [
                    {"type": "state", "entity_id": "demo.light_livingroom", "equals": "off"},
                    {"type": "state", "entity_id": "demo.switch_coffee", "equals": "on"},
                ],
            }
        ]
    )
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
    finally:
        await hub.stop()


async def test_match_any_stays_quiet_when_none_holds():
    hub = await run_hub(
        [
            {
                **MOTION_AUTOMATION,
                "match": "any",
                "condition": [
                    {"type": "state", "entity_id": "demo.light_livingroom", "equals": "on"},
                    {"type": "state", "entity_id": "demo.switch_coffee", "equals": "on"},
                ],
            }
        ]
    )
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
    finally:
        await hub.stop()
