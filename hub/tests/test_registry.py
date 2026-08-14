import pytest

from homepilot.core.entity import Entity, EntityKind
from homepilot.core.errors import UnknownEntityError
from homepilot.core.events import EventBus
from homepilot.core.registry import EntityRegistry


def make_light() -> Entity:
    return Entity(
        id="demo.light",
        kind=EntityKind.LIGHT,
        name="Testlicht",
        integration="demo",
        state={"state": "off"},
        commands=["turn_on"],
    )


async def test_add_and_get():
    registry = EntityRegistry(EventBus())
    await registry.add(make_light())
    assert registry.get("demo.light").name == "Testlicht"
    assert len(registry.all()) == 1


async def test_update_state_publishes_event():
    bus = EventBus()
    registry = EntityRegistry(bus)
    events = []
    bus.subscribe("state_changed", lambda t, d: events.append(d))

    await registry.add(make_light())
    await registry.update_state("demo.light", {"state": "on", "brightness": 50})

    assert len(events) == 1
    assert events[0]["old_state"] == {"state": "off"}
    assert events[0]["new_state"] == {"state": "on", "brightness": 50}
    assert registry.get("demo.light").state["brightness"] == 50


async def test_no_event_when_nothing_changed():
    bus = EventBus()
    registry = EntityRegistry(bus)
    events = []
    bus.subscribe("state_changed", lambda t, d: events.append(d))

    await registry.add(make_light())
    await registry.update_state("demo.light", {"state": "off"})
    assert events == []


async def test_unknown_entity_raises():
    registry = EntityRegistry(EventBus())
    with pytest.raises(UnknownEntityError):
        await registry.update_state("nope.nope", {"state": "on"})


async def test_room_provider_assigns_room():
    bus = EventBus()
    registry = EntityRegistry(bus)
    registry.room_provider = {"demo.light": "Wohnzimmer"}.get

    events = []
    bus.subscribe("entity_added", lambda t, d: events.append(d["entity"]))
    await registry.add(make_light())

    assert registry.get("demo.light").room == "Wohnzimmer"
    # Der Raum muss auch im Snapshot für die App stehen.
    assert events[0]["room"] == "Wohnzimmer"


async def test_entity_without_room_stays_none():
    registry = EntityRegistry(EventBus())
    registry.room_provider = {}.get
    await registry.add(make_light())
    assert registry.get("demo.light").room is None
