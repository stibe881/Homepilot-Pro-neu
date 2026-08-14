"""End-to-End-Test der MQTT-Integration gegen einen echten Broker.

Startet für die Dauer des Tests einen lokalen mosquitto. Ist keiner
installiert, werden die Tests übersprungen – die reine Parsing-Logik deckt
test_mqtt.py ohnehin ab.
"""

from __future__ import annotations

import asyncio
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

import aiomqtt
import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

pytestmark = pytest.mark.skipif(
    shutil.which("mosquitto") is None, reason="mosquitto nicht installiert"
)

DEVICE_TOPIC = "sonoff_kueche"
ENTITY_ID = "mqtt.sonoff_kueche"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def _wait_until(predicate, timeout: float = 10.0, publish=None) -> bool:
    """Wartet auf eine Bedingung und kann dabei wiederholt publizieren.

    Tasmota-Nachrichten laufen mit QoS 0: wer publiziert, bevor der Hub
    seine Subscription hat, verliert die Nachricht. Deshalb wird während
    des Wartens erneut gesendet, statt sich auf ein Timing zu verlassen.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if predicate():
            return True
        if publish is not None:
            await publish()
        await asyncio.sleep(0.1)
    return predicate()


@pytest.fixture
async def broker():
    port = _free_port()
    with tempfile.TemporaryDirectory() as tmp:
        config = Path(tmp) / "mosquitto.conf"
        config.write_text(
            f"listener {port} 127.0.0.1\nallow_anonymous true\n", encoding="utf-8"
        )
        process = subprocess.Popen(
            ["mosquitto", "-c", str(config)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            await _wait_until(lambda: _port_open(port), timeout=10)
            yield port
        finally:
            process.terminate()
            process.wait(timeout=10)


def _port_open(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


async def make_hub(port: int) -> Hub:
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[
                {
                    "integration": "mqtt",
                    "broker": "127.0.0.1",
                    "port": port,
                    "devices": [{"topic": DEVICE_TOPIC, "name": "Steckdose Küche"}],
                }
            ],
        )
    )
    await hub.start()
    return hub


async def test_device_messages_update_entity(broker):
    hub = await make_hub(broker)
    try:
        entity = hub.registry.get(ENTITY_ID)
        assert entity is not None
        # Vor der ersten Nachricht gilt das Gerät als nicht erreichbar.
        assert entity.available is False

        async with aiomqtt.Client("127.0.0.1", port=broker) as publisher:

            async def send_online():
                await publisher.publish(f"tele/{DEVICE_TOPIC}/LWT", "Online")

            assert await _wait_until(
                lambda: hub.registry.get(ENTITY_ID).available, publish=send_online
            ), "Gerät wurde nicht als erreichbar erkannt"

            async def send_state():
                await publisher.publish(
                    f"tele/{DEVICE_TOPIC}/STATE",
                    '{"POWER":"ON","Uptime":"1T02:03:04"}',
                )

            assert await _wait_until(
                lambda: hub.registry.get(ENTITY_ID).state.get("state") == "on",
                publish=send_state,
            ), "Zustand wurde nicht übernommen"

            async def send_sensor():
                await publisher.publish(
                    f"tele/{DEVICE_TOPIC}/SENSOR",
                    '{"ENERGY":{"Power":37.2,"Today":0.85}}',
                )

            assert await _wait_until(
                lambda: hub.registry.get(ENTITY_ID).state.get("power") == 37.2,
                publish=send_sensor,
            ), "Messwert wurde nicht übernommen"

            async def send_offline():
                await publisher.publish(f"tele/{DEVICE_TOPIC}/LWT", "Offline")

            assert await _wait_until(
                lambda: hub.registry.get(ENTITY_ID).available is False,
                publish=send_offline,
            ), "Ausfall des Geräts wurde nicht erkannt"
    finally:
        await hub.stop()


async def test_command_is_published_to_device(broker):
    hub = await make_hub(broker)
    try:
        received: list[tuple[str, str]] = []

        async with aiomqtt.Client("127.0.0.1", port=broker) as listener:
            await listener.subscribe(f"cmnd/{DEVICE_TOPIC}/#")

            async def collect():
                async for message in listener.messages:
                    received.append(
                        (str(message.topic), message.payload.decode())
                    )

            collector = asyncio.create_task(collect())

            async def send_command():
                # Erst wenn der Hub verbunden ist, nimmt er Kommandos an.
                try:
                    await hub.integrations.dispatch_command(ENTITY_ID, "turn_on")
                except ConnectionError:
                    pass

            assert await _wait_until(
                lambda: bool(received), publish=send_command
            ), "Kein Kommando beim Gerät angekommen"

            collector.cancel()

        assert received[0] == (f"cmnd/{DEVICE_TOPIC}/POWER", "ON")
    finally:
        await hub.stop()
