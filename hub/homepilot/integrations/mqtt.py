"""Sonoff und andere Tasmota-Geräte über MQTT.

Konfiguration:
  - integration: mqtt
    broker: 192.168.1.5
    port: 1883
    username: "${MQTT_USER}"
    password: "${MQTT_PASSWORD}"
    devices:
      - topic: sonoff_kueche       # Tasmota-Topic des Geräts
        name: Steckdose Küche
        kind: switch               # switch (Standard) oder light
        relay: 1                   # nur bei Mehrfach-Relais nötig

Tasmota spricht drei Topic-Präfixe:
  cmnd/<topic>/POWER   Kommandos an das Gerät (ON/OFF/TOGGLE)
  stat/<topic>/...     Antworten auf Kommandos
  tele/<topic>/...     Telemetrie: STATE, SENSOR und LWT (Online/Offline)

Sonoff-Geräte mit Original-Firmware sprechen dagegen die eWeLink-Cloud und
müssen erst mit Tasmota geflasht werden.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import aiomqtt

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


def split_topic(topic: str) -> tuple[str, str, str] | None:
    """'tele/sonoff_kueche/STATE' → ('tele', 'sonoff_kueche', 'STATE').

    Das Geräte-Topic darf selbst Schrägstriche enthalten (z.B. 'haus/kueche').
    """
    parts = topic.split("/")
    if len(parts) < 3:
        return None
    return parts[0], "/".join(parts[1:-1]), parts[-1]


def _power_state(payload: str) -> str | None:
    value = payload.strip().upper()
    if value in ("ON", "1", "TRUE"):
        return "on"
    if value in ("OFF", "0", "FALSE"):
        return "off"
    return None


def _scan_sensors(payload: dict[str, Any]) -> dict[str, Any]:
    """Zieht Messwerte aus einem SENSOR-Payload.

    Tasmota verschachtelt je Sensor-Chip (AM2301, SI7021, ENERGY, …), die
    Schlüssel darunter sind aber einheitlich benannt.
    """
    changes: dict[str, Any] = {}
    for value in payload.values():
        if not isinstance(value, dict):
            continue
        if "Temperature" in value:
            changes["temperature"] = value["Temperature"]
        if "Humidity" in value:
            changes["humidity"] = value["Humidity"]
        if "Power" in value:
            changes["power"] = value["Power"]
        if "Today" in value:
            changes["energy_today"] = value["Today"]
    return changes


def parse_payload(
    suffix: str, payload: str, relay: int = 1
) -> tuple[dict[str, Any], bool | None]:
    """Übersetzt eine Tasmota-Nachricht in (Zustandsänderungen, Verfügbarkeit).

    Verfügbarkeit ist None, wenn die Nachricht nichts darüber aussagt.
    """
    if suffix == "LWT":
        return {}, payload.strip().lower() == "online"

    power_keys = (f"POWER{relay}", "POWER")

    if suffix.startswith("POWER"):
        # Einzelnes Relais: stat/<topic>/POWER2 betrifft nur Relais 2.
        if suffix not in power_keys:
            return {}, None
        state = _power_state(payload)
        return ({"state": state} if state else {}), None

    if suffix in ("STATE", "RESULT", "SENSOR"):
        try:
            data = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            return {}, None
        if not isinstance(data, dict):
            return {}, None

        changes: dict[str, Any] = {}
        for key in power_keys:
            if key in data:
                state = _power_state(str(data[key]))
                if state:
                    changes["state"] = state
                break
        changes.update(_scan_sensors(data))
        return changes, None

    return {}, None


class MqttIntegration(Integration):
    name = "mqtt"

    async def setup(self) -> None:
        self._broker = self.config.get("broker")
        if not self._broker:
            raise ConfigError("mqtt braucht 'broker' in der Konfiguration")
        self._port = int(self.config.get("port", 1883))
        self._username = self.config.get("username")
        self._password = self.config.get("password")
        self._client: aiomqtt.Client | None = None

        # Geräte-Topic → (entity_id, relay) und die Umkehrung für Kommandos
        self._devices: dict[str, tuple[str, int]] = {}
        self._by_entity: dict[str, tuple[str, int]] = {}

        for device in self.config.get("devices") or []:
            topic = device.get("topic")
            if not topic:
                raise ConfigError("mqtt: jedes Gerät braucht ein 'topic'")
            relay = int(device.get("relay", 1))
            object_id = topic.replace("/", "_")
            if relay > 1:
                object_id = f"{object_id}_{relay}"
            entity = await self.add_entity(
                object_id,
                device.get("kind", EntityKind.SWITCH),
                device.get("name", topic),
                state={"state": "off"},
                commands=["turn_on", "turn_off", "toggle"],
                # Bis die erste Nachricht kommt, wissen wir nichts über das Gerät.
                available=False,
            )
            self._devices[topic] = (entity.id, relay)
            self._by_entity[entity.id] = (topic, relay)

        self.start_task(self._connection_loop())

    # ── Broker → Hub ───────────────────────────────────────────────────────

    async def _connection_loop(self) -> None:
        delay = 1.0
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=self._broker,
                    port=self._port,
                    username=self._username,
                    password=self._password,
                ) as client:
                    self._client = client
                    delay = 1.0
                    self.log.info("Mit MQTT-Broker %s verbunden", self._broker)
                    for topic in self._devices:
                        await client.subscribe(f"tele/{topic}/#")
                        await client.subscribe(f"stat/{topic}/#")
                    async for message in client.messages:
                        await self._handle_message(
                            str(message.topic), _decode(message.payload)
                        )
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.warning(
                    "MQTT-Verbindung verloren (%s), neuer Versuch in %.0fs", err, delay
                )
            finally:
                self._client = None
            # Solange der Broker weg ist, wissen wir nichts über die Geräte.
            for entity_id, _relay in self._devices.values():
                await self.hub.registry.update_state(entity_id, {}, available=False)
            await asyncio.sleep(delay)
            delay = min(60.0, delay * 2)

    async def _handle_message(self, topic: str, payload: str) -> None:
        parts = split_topic(topic)
        if parts is None:
            return
        _prefix, device_topic, suffix = parts
        target = self._devices.get(device_topic)
        if target is None:
            return
        entity_id, relay = target

        changes, available = parse_payload(suffix, payload, relay)
        if changes or available is not None:
            await self.hub.registry.update_state(entity_id, changes, available=available)

    # ── Hub → Broker ───────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        client = self._client
        if client is None:
            raise ConnectionError("Keine Verbindung zum MQTT-Broker")

        device_topic, relay = self._by_entity[entity.id]
        payload = {"turn_on": "ON", "turn_off": "OFF", "toggle": "TOGGLE"}[command]
        power = "POWER" if relay == 1 else f"POWER{relay}"
        await client.publish(f"cmnd/{device_topic}/{power}", payload)
        # Den neuen Zustand meldet das Gerät selbst über stat/… zurück –
        # deshalb hier bewusst kein optimistisches Setzen.


def _decode(payload: Any) -> str:
    if isinstance(payload, (bytes, bytearray)):
        return payload.decode("utf-8", "ignore")
    return str(payload)


INTEGRATION = MqttIntegration
