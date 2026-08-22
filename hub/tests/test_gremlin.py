"""Der Gremlin: absichtlich unzuverlässige Geräte für die Fehlerpfade.

Der Wert liegt in der Planbarkeit: Jeder dritte Befehl scheitert
gezählt, nicht gewürfelt - so lässt sich «das Gerät hat nicht reagiert»
gezielt vorführen, statt auf einen echten Ausfall zu warten.
"""

import asyncio

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.errors import HomePilotError
from homepilot.core.hub import Hub


def make_hub(pace: float = 0.05) -> Hub:
    return Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "gremlin", "pace": pace, "seed": 7}],
        )
    )


def test_every_third_command_is_swallowed():
    async def check():
        hub = make_hub(pace=999)  # der Stundenplan soll hier nicht dazwischenfunken
        await hub.start()
        try:
            licht = hub.registry.get("gremlin.light_moody")
            assert licht is not None and licht.state["state"] == "off"

            await hub.integrations.dispatch_command("gremlin.light_moody", "turn_on", {})
            await hub.integrations.dispatch_command("gremlin.light_moody", "turn_off", {})
            with pytest.raises(HomePilotError, match="verschluckt"):
                await hub.integrations.dispatch_command(
                    "gremlin.light_moody", "turn_on", {}
                )
            # Nach dem Schlucken geht es normal weiter.
            await hub.integrations.dispatch_command("gremlin.light_moody", "turn_on", {})
            assert hub.registry.get("gremlin.light_moody").state["state"] == "on"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_the_dropout_sensor_disappears_and_returns():
    """Genau die Flanke, auf die «verstummt»/«wiederkommt»-Auslöser und
    der Wächter hören."""

    async def check():
        hub = make_hub(pace=0.02)
        await hub.start()
        try:
            gesehen: set[bool] = set()
            for _ in range(200):
                await asyncio.sleep(0.02)
                sensor = hub.registry.get("gremlin.sensor_dropout")
                assert sensor is not None
                gesehen.add(sensor.available)
                if gesehen == {True, False}:
                    break
            assert gesehen == {True, False}
        finally:
            await hub.stop()

    asyncio.run(check())
