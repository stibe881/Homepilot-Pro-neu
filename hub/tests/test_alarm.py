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
    DISARM,
    DISARMED,
    ENTRY,
    REARM,
    STAY,
    TRIGGERED,
    guards,
    is_sensor,
    parse_after,
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


# ── Nachverhalten je Modus ─────────────────────────────────────────────────


def test_parse_after_falls_back_to_staying_triggered():
    """Ohne oder mit unsinniger Angabe bleibt die Anlage ausgelöst – die
    Variante, bei der sich nichts unbemerkt abschaltet."""
    result = parse_after(None)
    assert set(result) == {"nacht", "ausser_haus", "urlaub"}
    assert all(entry["action"] == STAY for entry in result.values())
    assert parse_after({"nacht": {"action": "quatsch"}})["nacht"]["action"] == STAY


def test_parse_after_keeps_the_other_modes_untouched():
    """Die App schickt nur den Modus, den sie geändert hat."""
    base = parse_after({"nacht": {"action": DISARM}, "urlaub": {"action": REARM}})
    result = parse_after({"urlaub": {"after": 600}}, base)
    assert result["nacht"]["action"] == DISARM
    assert result["urlaub"] == {"action": REARM, "after": 600}


def test_parse_after_refuses_an_instant_rearm():
    """Sonst wäre es eine Schleife aus Alarm und sofortigem Wiederscharf."""
    assert parse_after({"nacht": {"action": REARM, "after": 0}})["nacht"]["after"] == 10


def test_stay_leaves_the_alarm_triggered(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert service._entity.state["state"] == TRIGGERED
    assert service._entity.state["seconds_left"] is None


def test_disarm_after_trigger_switches_the_alarm_off(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.update_config(
            {"after_trigger": {"ausser_haus": {"action": DISARM}}}
        )
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert service._entity.state["state"] == DISARMED
    # Gemeldet bleibt gemeldet: Der Auslöser steht weiter im Verlauf.
    assert any(event["kind"] == "triggered" for event in service.history)


def test_rearm_counts_down_and_arms_again(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.update_config(
            {"after_trigger": {"ausser_haus": {"action": REARM, "after": 60}}}
        )
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)
        during = dict(service._entity.state)
        # Statt 60 Sekunden zu warten: der Schritt, den der Timer auslöst.
        await service._rearm()
        return during, dict(service._entity.state)

    during, after = asyncio.run(run())
    assert during["state"] == TRIGGERED
    assert during["next_action"] == "rearm"
    assert during["seconds_left"] > 0
    # Danach wacht die Anlage wieder – im selben Modus, ohne Ausgangsfrist.
    assert after["state"] == ARMED
    assert after["mode"] == "ausser_haus"
    assert after["seconds_left"] is None


def test_rearm_notes_what_is_still_open(alarm_hub):
    """Ein Einbruch lässt die Tür offen stehen. Die Anlage schaltet
    trotzdem wieder scharf – aber schweigt nicht darüber."""
    hub, service = alarm_hub

    async def run():
        await service.update_config(
            {"after_trigger": {"ausser_haus": {"action": REARM, "after": 60}}}
        )
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)
        await service._rearm()

    asyncio.run(run())
    assert service._entity.state["state"] == ARMED
    assert "test.fenster" in service.history[0]["text"]


def test_disarming_by_hand_cancels_a_pending_rearm(alarm_hub):
    hub, service = alarm_hub

    async def run():
        await service.update_config(
            {"after_trigger": {"ausser_haus": {"action": REARM, "after": 60}}}
        )
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)
        await service.disarm()
        await asyncio.sleep(0.05)

    asyncio.run(run())
    assert service._entity.state["state"] == DISARMED
    assert service._entity.state["seconds_left"] is None


def test_after_trigger_survives_a_restart(tmp_path):
    async def first():
        hub = make_hub(tmp_path)
        await hub.start()
        service = hub.integrations.get("alarm")
        await service.update_config(
            {"after_trigger": {"urlaub": {"action": REARM, "after": 120}}}
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
    assert config["after_trigger"]["urlaub"] == {"action": REARM, "after": 120}
    assert config["after_trigger"]["nacht"]["action"] == STAY


def test_arming_warns_about_silent_sensors(alarm_hub):
    """Ein offenes Fenster sieht man, einen Sensor mit leerer Batterie
    nicht. Scharf schalten mit einem stummen Melder heisst, einen blinden
    Fleck zu haben und nichts davon zu wissen."""
    hub, service = alarm_hub

    async def run():
        await hub.registry.update_state("test.tuer", {"low_battery": True})
        await hub.registry.update_state("test.fenster", {}, available=False)
        return await service.arm("ausser_haus")

    result = asyncio.run(run())
    assert result["ok"] is False
    assert result["reason"] == "blind"
    assert result["battery"] == ["test.tuer"]
    assert result["offline"] == ["test.fenster"]
    assert service._entity.state["state"] == DISARMED


def test_arming_with_force_accepts_a_blind_spot(alarm_hub):
    """Wer es trotzdem will, bekommt es – aber erst nach der Warnung."""
    hub, service = alarm_hub

    async def run():
        await hub.registry.update_state("test.tuer", {"low_battery": True})
        return await service.arm("ausser_haus", force=True)

    assert asyncio.run(run())["ok"] is True
    assert service._entity.state["state"] == ARMED


def test_the_camera_of_the_room_travels_with_the_alarm():
    """Bei einem Alarm ist die erste Frage «was ist da los?» – die Antwort
    steht auf dem Kamerabild des richtigen Raums."""
    from homepilot.integrations.alarm import nearest_camera

    flur_cam = camera("test.cam_flur")
    flur_cam.room = "Flur"
    bad_cam = camera("test.cam_bad")
    bad_cam.room = "Bad"
    entities = [contact("test.tuer"), bad_cam, flur_cam]

    assert nearest_camera(entities, "Flur") == "test.cam_flur"
    assert nearest_camera(entities, "Küche") is None
    # Ohne Raum lieber keine Kamera als die falsche.
    assert nearest_camera(entities, None) is None


def test_the_alarm_message_carries_the_picture_from_that_moment(tmp_path):
    """Das Bild soll den Moment zeigen, in dem der Alarm losging – nicht
    den, in dem jemand das Telefon aus der Tasche zieht. Es wird deshalb
    beim Auslösen aufgenommen und abgelegt, nicht später abgerufen."""

    async def check():
        hub = Hub(
            HubConfig(
                api=ApiConfig(),
                integrations=[{"integration": "demo"}],
                users=[OWNER],
                data_file=str(tmp_path / "daten.json"),
                push={"public_url": "https://haus.example.ch"},
            )
        )
        await hub.start()
        try:
            cam = camera("test.cam_flur")
            cam.room = "Flur"
            await hub.registry.add(cam)
            service = hub.integrations.get("alarm")

            # Das Bild kommt über die Integration der Kamera, wie sonst
            # auch – der Alarm kennt keine Kameramodelle.
            async def fake_snapshot(entity):
                return b"\xff\xd8\xff\xe0 Flur um 3 Uhr"

            echte = hub.integrations.get
            hub.integrations.get = lambda name: (  # type: ignore[assignment]
                type("I", (), {"snapshot": staticmethod(fake_snapshot)})()
                if name == "test"
                else echte(name)
            )

            url = await service._snapshot_url("test.cam_flur")
            assert url is not None
            assert url.startswith("https://haus.example.ch/api/push/image/")

            # Und dahinter liegt genau dieses Bild.
            token = url.rsplit("/", 1)[-1]
            assert hub.snapshots.get(token) == b"\xff\xd8\xff\xe0 Flur um 3 Uhr"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_without_a_public_address_the_message_goes_out_without_a_picture(tmp_path):
    """Wer die Adresse weglässt, will das Bild nicht – dann entsteht auch
    keine Adresse, die ohne Anmeldung erreichbar wäre."""

    async def check():
        hub = make_hub(tmp_path)
        await hub.start()
        try:
            cam = camera("test.cam_flur")
            cam.room = "Flur"
            await hub.registry.add(cam)
            service = hub.integrations.get("alarm")
            assert await service._snapshot_url("test.cam_flur") is None
            assert len(hub.snapshots) == 0
        finally:
            await hub.stop()

    asyncio.run(check())


def test_a_camera_that_does_not_answer_does_not_hold_up_the_alarm(tmp_path):
    """Ein Alarm darf nicht daran scheitern, dass eine Kamera gerade
    schweigt – dann eben ohne Bild."""

    async def check():
        hub = Hub(
            HubConfig(
                api=ApiConfig(),
                integrations=[{"integration": "demo"}],
                users=[OWNER],
                data_file=str(tmp_path / "daten.json"),
                push={"public_url": "https://haus.example.ch"},
            )
        )
        await hub.start()
        try:
            cam = camera("test.cam_flur")
            cam.room = "Flur"
            await hub.registry.add(cam)

            async def kaputt(entity):
                raise RuntimeError("Kamera antwortet nicht")

            echte = hub.integrations.get

            def fake_get(name):
                if name == "test":
                    return type("I", (), {"snapshot": staticmethod(kaputt)})()
                return echte(name)

            service = echte("alarm")
            hub.integrations.get = fake_get  # type: ignore[assignment]
            assert await service._snapshot_url("test.cam_flur") is None
        finally:
            await hub.stop()

    asyncio.run(check())


# ── Die Anlage schaltet selbst ─────────────────────────────────────────────


def test_actions_without_a_command_are_dropped():
    """Ein halber Eintrag würde beim Auslösen scheitern – und das ist der
    schlechteste Zeitpunkt für einen Fehler."""
    from homepilot.integrations.alarm import parse_actions

    result = parse_actions(
        {
            "trigger": [
                {"entity_id": "demo.sirene", "command": "turn_on"},
                {"entity_id": "demo.sirene"},
                {"command": "turn_on"},
                "kaputt",
                {"entity_id": "demo.store", "command": "set_position", "data": {"position": 100}},
            ],
            "unbekannt": [{"entity_id": "x", "command": "y"}],
        }
    )
    assert result["trigger"] == [
        {"entity_id": "demo.sirene", "command": "turn_on"},
        {"entity_id": "demo.store", "command": "set_position", "data": {"position": 100}},
    ]
    assert result["warning"] == []
    assert result["clear"] == []
    assert "unbekannt" not in result


def test_the_alarm_switches_the_siren_and_turns_it_off_again(tmp_path):
    """Eine Alarmanlage, die nur eine Nachricht schickt, informiert bloss.
    Und eine Sirene, die nach dem Unscharfschalten weiterheult, ist ein
    eigenes Problem."""

    async def check():
        hub = make_hub(tmp_path)
        await hub.start()
        try:
            await hub.registry.add(contact("test.tuer"))
            service = hub.integrations.get("alarm")
            await service.update_config(
                {
                    "sensors": [{"entity_id": "test.tuer", "modes": ["ausser_haus"]}],
                    "settings": {
                        "exit_delay": 0,
                        "entry_delay": 0,
                        "notify_trigger": False,
                        "clip_seconds": 0,
                    },
                    "actions": {
                        "trigger": [
                            {"entity_id": "demo.light_livingroom", "command": "turn_on"}
                        ],
                        "clear": [
                            {"entity_id": "demo.light_livingroom", "command": "turn_off"}
                        ],
                    },
                }
            )
            await service.arm("ausser_haus")
            await hub.registry.update_state("test.tuer", {"state": "on"})
            await asyncio.sleep(0.05)
            assert hub.registry.get("demo.light_livingroom").state["state"] == "on"

            await service.disarm()
            assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_a_dead_siren_does_not_stop_the_rest(tmp_path):
    """Sonst hinge die ganze Anlage an dem Gerät, das am ehesten kaputt
    ist."""

    async def check():
        hub = make_hub(tmp_path)
        await hub.start()
        try:
            service = hub.integrations.get("alarm")
            await service.update_config(
                {
                    "actions": {
                        "trigger": [
                            {"entity_id": "gibt.es.nicht", "command": "turn_on"},
                            {"entity_id": "demo.light_livingroom", "command": "turn_on"},
                        ]
                    }
                }
            )
            await service._run_actions("trigger")
            # Das zweite Gerät wurde trotzdem geschaltet.
            assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_the_entry_delay_is_no_longer_silent(tmp_path):
    """Ein Zeichen sagt dem Berechtigten «schalt mich ab» – und dem
    Unberechtigten, dass die Uhr läuft."""

    async def check():
        hub = make_hub(tmp_path)
        await hub.start()
        try:
            await hub.registry.add(contact("test.haustuer"))
            service = hub.integrations.get("alarm")
            await service.update_config(
                {
                    "sensors": [
                        {
                            "entity_id": "test.haustuer",
                            "modes": ["ausser_haus"],
                            "delayed": True,
                        }
                    ],
                    "settings": {"exit_delay": 0, "entry_delay": 30},
                    "actions": {
                        "warning": [
                            {"entity_id": "demo.switch_coffee", "command": "turn_on"}
                        ]
                    },
                }
            )
            await service.arm("ausser_haus")
            await hub.registry.update_state("test.haustuer", {"state": "on"})
            await asyncio.sleep(0.05)
            assert service._entity.state["state"] == ENTRY
            assert hub.registry.get("demo.switch_coffee").state["state"] == "on"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_the_test_run_plays_the_whole_alarm_once(tmp_path, monkeypatch):
    """Ob Sirene und Nachricht überhaupt funktionieren, erfuhr man sonst
    beim ersten echten Einbruch."""
    from homepilot.integrations import alarm as alarm_module

    monkeypatch.setattr(alarm_module, "TEST_SIREN_SECONDS", 0.01)

    async def check():
        hub = make_hub(tmp_path)
        await hub.start()
        try:
            service = hub.integrations.get("alarm")
            await service.update_config(
                {
                    "actions": {
                        "trigger": [
                            {"entity_id": "demo.light_livingroom", "command": "turn_on"}
                        ],
                        "clear": [
                            {"entity_id": "demo.light_livingroom", "command": "turn_off"}
                        ],
                    },
                }
            )
            result = await service.test_run(by="Stefan")
            assert result["ok"] is True
            # Nach dem Test ist aufgeräumt: Sirene aus, Anlage unverändert
            # unscharf, und der Verlauf weiss, dass es ein Test war.
            assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
            assert service._state_dict()["state"] == "unscharf"
            assert any(entry["kind"] == "test" for entry in service.history)
        finally:
            await hub.stop()

    asyncio.run(check())


def test_the_test_run_refuses_while_armed(tmp_path):
    """Ein Test, während die Anlage wacht, wäre von einem Einbruch nicht
    zu unterscheiden."""

    async def check():
        hub = make_hub(tmp_path)
        await hub.start()
        try:
            await hub.registry.add(contact("test.tuer"))
            service = hub.integrations.get("alarm")
            await service.update_config(
                {
                    "sensors": [{"entity_id": "test.tuer", "modes": ["ausser_haus"]}],
                    "settings": {"exit_delay": 0, "entry_delay": 0},
                }
            )
            await service.arm("ausser_haus")
            from homepilot.core.errors import HomePilotError

            with pytest.raises(HomePilotError):
                await service.test_run()
        finally:
            await hub.stop()

    asyncio.run(check())
