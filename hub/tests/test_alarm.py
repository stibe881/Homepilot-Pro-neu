"""Die Alarmanlage muss nachweisbar tun, was sie verspricht.

Eine Anlage, die im falschen Modus schweigt oder beim Nachhausekommen
sofort losschlägt, ist schlimmer als keine – deshalb hier die Fälle, auf
die es ankommt.
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import (
    ARMED,
    ARMING,
    DISARMED,
    ENTRY,
    TRIGGERED,
    guards,
    is_sensor,
    parse_sensors,
    sensor_open,
)

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


def contact(entity_id: str, state: str = "off") -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.BINARY_SENSOR,
        name=entity_id,
        integration="test",
        state={"state": state, "device_class": "contact"},
    )


def camera(entity_id: str, motion: str = "off", ring: str = "off") -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.CAMERA,
        name=entity_id,
        integration="test",
        state={"state": "online", "motion": motion, "ring": ring},
    )


def lock(entity_id: str, door: str = "closed") -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.LOCK,
        name=entity_id,
        integration="test",
        state={"state": "locked", "door": door},
    )


# ── Reine Hilfsfunktionen ──────────────────────────────────────────────────


def test_is_sensor_accepts_contacts_and_door_locks():
    assert is_sensor(contact("a"))
    assert is_sensor(lock("b"))
    # Ein Schloss ohne Türsensor kann nichts über Einbruch sagen.
    plain = Entity(id="c", kind=EntityKind.LOCK, name="c", integration="t",
                   state={"state": "locked"})
    assert not is_sensor(plain)
    light = Entity(id="d", kind=EntityKind.LIGHT, name="d", integration="t",
                   state={"state": "on"})
    assert not is_sensor(light)


def test_cameras_with_motion_are_sensors():
    # Protect- und Ring-Kameras melden Bewegung – damit sind sie
    # vollwertige Bewegungsmelder für die Anlage.
    assert is_sensor(camera("cam"))
    # Eine Kamera ohne Bewegungsmeldung taugt nicht dafür.
    ohne = Entity(id="c2", kind=EntityKind.CAMERA, name="c2", integration="t",
                  state={"state": "online"})
    assert not is_sensor(ohne)


def test_camera_open_counts_motion_not_ringing():
    assert sensor_open(camera("cam", motion="on"))
    assert not sensor_open(camera("cam", motion="off"))
    # Geklingelt ist nicht eingebrochen.
    assert not sensor_open(camera("cam", motion="off", ring="on"))


def test_sensor_open_uses_door_state_for_locks():
    assert sensor_open(contact("a", "on"))
    assert not sensor_open(contact("a", "off"))
    assert sensor_open(lock("b", "open"))
    # Abgeschlossen, aber Tür offen → trotzdem offen. Genau das ist der Fall,
    # den ein Alarm sehen muss.
    assert not sensor_open(lock("b", "closed"))


def test_parse_sensors_drops_unknown_modes():
    parsed = parse_sensors(
        [{"entity_id": "a", "modes": ["nacht", "quatsch"], "delayed": True}]
    )
    assert parsed["a"]["modes"] == ["nacht"]
    assert parsed["a"]["delayed"] is True


def test_parse_sensors_ignores_broken_entries():
    assert parse_sensors([{"modes": ["nacht"]}, "kaputt", None]) == {}


def test_guards_respects_mode_and_bypass():
    sensors = parse_sensors(
        [
            {"entity_id": "tuer", "modes": ["nacht", "ausser_haus"]},
            {"entity_id": "bewegung", "modes": ["ausser_haus"]},
            {"entity_id": "fenster", "modes": ["nacht"], "bypass": True},
        ]
    )
    assert guards(sensors, "tuer", "nacht")
    # Der Bewegungsmelder wacht nachts nicht – man geht ja selbst umher.
    assert not guards(sensors, "bewegung", "nacht")
    assert guards(sensors, "bewegung", "ausser_haus")
    # Überbrückt heisst überbrückt, auch im zugeordneten Modus.
    assert not guards(sensors, "fenster", "nacht")
    assert not guards(sensors, "unbekannt", "nacht")


# ── Anlage im Betrieb ──────────────────────────────────────────────────────


def make_hub(tmp_path) -> Hub:
    return Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            users=[OWNER],
            data_file=str(tmp_path / "daten.json"),
        )
    )


@pytest.fixture
def alarm_hub(tmp_path):
    """Hub mit Alarm und zwei Testsensoren, ohne Ausgangsverzögerung."""

    async def build():
        hub = make_hub(tmp_path)
        await hub.start()
        await hub.registry.add(contact("test.tuer"))
        await hub.registry.add(contact("test.fenster"))
        service = hub.integrations.get("alarm")
        await service.update_config(
            {
                "sensors": [
                    {"entity_id": "test.tuer", "modes": ["nacht", "ausser_haus"],
                     "delayed": True},
                    {"entity_id": "test.fenster", "modes": ["ausser_haus"]},
                ],
                "settings": {"exit_delay": 0, "entry_delay": 0, "notify_trigger": False},
            }
        )
        return hub, service

    hub, service = asyncio.run(build())
    yield hub, service
    asyncio.run(hub.stop())


def test_alarm_starts_disarmed(alarm_hub):
    _, service = alarm_hub
    assert service._entity.state["state"] == DISARMED


def test_arming_refuses_while_a_window_is_open(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await hub.registry.update_state("test.fenster", {"state": "on"})
        return await service.arm("ausser_haus")

    result = asyncio.run(run())
    assert result["ok"] is False
    assert result["reason"] == "offen"
    assert result["open"] == ["test.fenster"]
    # Und die Anlage bleibt unscharf, statt halb scharf zu sein.
    assert service._entity.state["state"] == DISARMED


def test_arming_with_force_ignores_the_open_window(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await hub.registry.update_state("test.fenster", {"state": "on"})
        return await service.arm("ausser_haus", force=True)

    assert asyncio.run(run())["ok"] is True
    assert service._entity.state["state"] == ARMED


def test_sensor_of_another_mode_does_not_trigger(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.arm("nacht")
        # Das Fenster wacht nur ausser Haus – nachts muss es schweigen.
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert service._entity.state["state"] == ARMED


def test_instant_sensor_triggers_the_alarm(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert service._entity.state["state"] == TRIGGERED
    assert service._entity.state["last_trigger"]["entity_id"] == "test.fenster"


def test_delayed_sensor_starts_the_entry_countdown(alarm_hub):
    hub, service = alarm_hub

    async def run():
        # Mit Eingangsverzögerung: Die Haustür löst nicht sofort aus.
        await service.update_config({"settings": {"entry_delay": 30}})
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.tuer", {"state": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert service._entity.state["state"] == ENTRY
    assert service._entity.state["seconds_left"] > 0


def test_disarming_during_entry_stops_the_alarm(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.update_config({"settings": {"entry_delay": 30}})
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.tuer", {"state": "on"})
        await asyncio.sleep(0)
        await service.disarm()
        # Auch nach der ursprünglichen Frist darf nichts mehr kommen.
        await asyncio.sleep(0.05)

    asyncio.run(run())
    assert service._entity.state["state"] == DISARMED


def test_exit_delay_keeps_the_alarm_quiet_while_leaving(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.update_config({"settings": {"exit_delay": 30}})
        await service.arm("ausser_haus")
        # Die eigene Haustür beim Hinausgehen darf nichts auslösen.
        await hub.registry.update_state("test.tuer", {"state": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert service._entity.state["state"] == ARMING


def test_config_survives_a_restart(tmp_path):
    async def first():
        hub = make_hub(tmp_path)
        await hub.start()
        service = hub.integrations.get("alarm")
        await service.update_config(
            {"sensors": [{"entity_id": "test.tuer", "modes": ["urlaub"]}]}
        )
        await hub.stop()

    async def second():
        hub = make_hub(tmp_path)
        await hub.start()
        service = hub.integrations.get("alarm")
        config = service.config_dict()
        await hub.stop()
        return config

    asyncio.run(first())
    config = asyncio.run(second())
    assert config["sensors"] == [
        {"entity_id": "test.tuer", "modes": ["urlaub"], "delayed": False, "bypass": False}
    ]


# ── API ────────────────────────────────────────────────────────────────────


def auth(token: str = "t-owner") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_alarm_api_lists_candidates_and_arms(tmp_path):
    with TestClient(create_app(make_hub(tmp_path))) as client:
        overview = client.get("/api/alarm", headers=auth())
        assert overview.status_code == 200
        body = overview.json()
        assert body["state"]["state"] == DISARMED
        # Der Demo-Hub hat einen Bewegungsmelder – der muss angeboten werden.
        assert any(
            entry["entity_id"] == "demo.motion_hall" for entry in body["candidates"]
        )

        saved = client.put(
            "/api/alarm",
            headers=auth(),
            json={
                "sensors": [
                    {"entity_id": "demo.motion_hall", "modes": ["ausser_haus"]}
                ],
                "settings": {"exit_delay": 0, "notify_trigger": False},
            },
        )
        assert saved.status_code == 200

        armed = client.post(
            "/api/alarm/arm", headers=auth(), json={"mode": "ausser_haus"}
        )
        assert armed.json()["ok"] is True

        off = client.post("/api/alarm/disarm", headers=auth())
        assert off.json()["state"] == DISARMED


def test_alarm_api_rejects_unknown_mode(tmp_path):
    with TestClient(create_app(make_hub(tmp_path))) as client:
        response = client.post("/api/alarm/arm", headers=auth(), json={"mode": "quatsch"})
        assert response.status_code >= 400


def test_camera_motion_triggers_the_alarm(tmp_path):
    """Der gemeldete Fall: Kameras sollen als Sensoren zur Auswahl stehen
    und im scharfen Modus auch wirklich auslösen."""

    async def run():
        hub = make_hub(tmp_path)
        await hub.start()
        await hub.registry.add(camera("test.kamera"))
        service = hub.integrations.get("alarm")

        # Die Kamera muss überhaupt erst angeboten werden.
        assert any(entity.id == "test.kamera" for entity in service.candidates())

        await service.update_config(
            {
                "sensors": [{"entity_id": "test.kamera", "modes": ["ausser_haus"]}],
                "settings": {"exit_delay": 0, "notify_trigger": False},
            }
        )
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.kamera", {"motion": "on"})
        await asyncio.sleep(0)
        state = dict(service._entity.state)
        await hub.stop()
        return state

    state = asyncio.run(run())
    assert state["state"] == TRIGGERED
    assert state["last_trigger"]["entity_id"] == "test.kamera"
