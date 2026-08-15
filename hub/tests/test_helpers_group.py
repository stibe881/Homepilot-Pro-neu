"""Helfer-Schalter und Gerätegruppen mit echtem Hub."""

import asyncio

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub


async def settle():
    for _ in range(10):
        await asyncio.sleep(0)


async def _hub(integrations):
    hub = Hub(HubConfig(api=ApiConfig(), integrations=integrations, automations=[]))
    await hub.start()
    return hub


async def test_helper_switch_toggles():
    hub = await _hub(
        [{"integration": "helpers", "switches": [{"id": "abwesend", "name": "Abwesend"}]}]
    )
    try:
        entity = hub.registry.get("helpers.abwesend")
        assert entity is not None and entity.state["state"] == "off"
        await hub.integrations.dispatch_command("helpers.abwesend", "turn_on")
        assert hub.registry.get("helpers.abwesend").state["state"] == "on"
        await hub.integrations.dispatch_command("helpers.abwesend", "toggle")
        assert hub.registry.get("helpers.abwesend").state["state"] == "off"
    finally:
        await hub.stop()


async def test_group_reflects_and_controls_members():
    hub = await _hub(
        [
            {"integration": "demo"},
            {
                "integration": "group",
                "groups": [
                    {
                        "id": "lichter",
                        "name": "Alle Lichter",
                        "members": ["demo.light_livingroom", "demo.light_bedroom"],
                    }
                ],
            },
        ]
    )
    try:
        await settle()
        group = hub.registry.get("group.lichter")
        assert group is not None and group.state["state"] == "off"

        # Ein Mitglied an → Gruppe an.
        await hub.integrations.dispatch_command("demo.light_livingroom", "turn_on")
        await settle()
        assert hub.registry.get("group.lichter").state["state"] == "on"

        # Gruppe aus → alle Mitglieder aus.
        await hub.integrations.dispatch_command("group.lichter", "turn_off")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
        assert hub.registry.get("demo.light_bedroom").state["state"] == "off"
        assert hub.registry.get("group.lichter").state["state"] == "off"

        # Gruppe an mit Helligkeit → an alle Mitglieder weitergereicht.
        await hub.integrations.dispatch_command(
            "group.lichter", "turn_on", {"brightness": 55}
        )
        await settle()
        assert hub.registry.get("demo.light_bedroom").state["brightness"] == 55
    finally:
        await hub.stop()
