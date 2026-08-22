"""Eine Integration einzeln neu laden – ohne den Hub durchzustarten."""

import asyncio

import yaml

from homepilot.core.config import load_config
from homepilot.core.hub import Hub


def schreibe_config(pfad, rooms=None):
    inhalt = {
        "api": {"host": "127.0.0.1", "port": 8123, "token": "geheim"},
        "integrations": [{"integration": "demo"}],
        "automations": [],
    }
    if rooms:
        inhalt["rooms"] = rooms
    pfad.write_text(yaml.safe_dump(inhalt, allow_unicode=True), encoding="utf-8")


def test_reload_picks_up_the_fresh_config(tmp_path):
    """config.yaml ändern, neu laden, fertig – zwei Sekunden statt zwei
    Minuten Hub-Neustart beim Einrichten eines Geräts."""
    config_pfad = tmp_path / "config.yaml"
    schreibe_config(config_pfad)

    async def check():
        hub = Hub(load_config(config_pfad))
        await hub.start()
        try:
            assert hub.registry.get("demo.light_livingroom") is not None

            # Die Datei ändern, während der Hub läuft.
            schreibe_config(config_pfad)
            result = await hub.integrations.reload("demo")
            assert result["ok"] is True
            # Die Entitäten sind frisch da – keine Karteileichen, keine
            # Doppelten.
            lichter = [
                entity
                for entity in hub.registry.all()
                if entity.id == "demo.light_livingroom"
            ]
            assert len(lichter) == 1
        finally:
            await hub.stop()

    asyncio.run(check())


def test_reload_of_something_absent_explains_itself(tmp_path):
    config_pfad = tmp_path / "config.yaml"
    schreibe_config(config_pfad)

    async def check():
        import pytest

        from homepilot.core.errors import HomePilotError

        hub = Hub(load_config(config_pfad))
        await hub.start()
        try:
            with pytest.raises(HomePilotError):
                await hub.integrations.reload("hue")
        finally:
            await hub.stop()

    asyncio.run(check())
