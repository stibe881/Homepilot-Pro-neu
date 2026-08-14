import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub


def make_config(**kwargs) -> HubConfig:
    defaults = dict(
        api=ApiConfig(token=kwargs.pop("token", None)),
        integrations=[{"integration": "demo"}],
        automations=[],
    )
    defaults.update(kwargs)
    return HubConfig(**defaults)


@pytest.fixture
async def hub():
    hub = Hub(make_config())
    await hub.start()
    yield hub
    await hub.stop()
