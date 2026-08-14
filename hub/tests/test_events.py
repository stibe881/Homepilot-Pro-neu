from homepilot.core.events import EventBus


async def test_publish_reaches_subscriber():
    bus = EventBus()
    received = []
    bus.subscribe("state_changed", lambda t, d: received.append((t, d)))
    await bus.publish("state_changed", {"x": 1})
    assert received == [("state_changed", {"x": 1})]


async def test_wildcard_and_async_callbacks():
    bus = EventBus()
    received = []

    async def listener(event_type, data):
        received.append(event_type)

    bus.subscribe("*", listener)
    await bus.publish("foo", {})
    await bus.publish("bar", {})
    assert received == ["foo", "bar"]


async def test_unsubscribe():
    bus = EventBus()
    received = []
    unsubscribe = bus.subscribe("foo", lambda t, d: received.append(t))
    await bus.publish("foo", {})
    unsubscribe()
    await bus.publish("foo", {})
    assert received == ["foo"]


async def test_failing_listener_does_not_break_others():
    bus = EventBus()
    received = []

    def broken(event_type, data):
        raise RuntimeError("kaputt")

    bus.subscribe("foo", broken)
    bus.subscribe("foo", lambda t, d: received.append(t))
    await bus.publish("foo", {})
    assert received == ["foo"]
