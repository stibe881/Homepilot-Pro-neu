"""Kamerabewegung, während die Anlage scharf ist: Bild aufs Telefon.

Der Fall dahinter: Wer die Sirene nicht von einer vorbeilaufenden Katze
auslösen lassen will, ordnet die Kamera *nicht* als Alarmsensor zu – und
erfuhr damit gar nichts, obwohl die Kamera die Bewegung längst sah.
"""

import asyncio

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.alarm_rules import (
    camera_for,
    camera_motion_due,
    motion_started,
    nearest_camera,
)

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


def kamera(entity_id: str, room: str | None = None, motion: str = "off") -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.CAMERA,
        name=entity_id,
        integration="demo",
        state={"motion": motion},
        commands=[],
        room=room,
    )


def test_motion_started_ist_die_flanke_nicht_der_pegel():
    # Eine Kamera meldet ihren Zustand immer wieder; nur der Übergang zählt.
    assert motion_started({"motion": "off"}, {"motion": "on"})
    assert not motion_started({"motion": "on"}, {"motion": "on"})
    assert not motion_started({"motion": "on"}, {"motion": "off"})
    assert motion_started(None, {"motion": "on"})


def test_abstand_zwischen_zwei_nachrichten():
    gesehen: dict[str, float] = {}
    assert camera_motion_due(gesehen, "ring.tuer", 1000.0)
    gesehen["ring.tuer"] = 1000.0
    # Solange sich etwas bewegt, meldet die Kamera im Sekundentakt.
    assert not camera_motion_due(gesehen, "ring.tuer", 1030.0)
    assert camera_motion_due(gesehen, "ring.tuer", 1000.0 + 120.0)
    # Eine andere Kamera hat ihren eigenen Abstand.
    assert camera_motion_due(gesehen, "unifi.hof", 1030.0)


def test_die_ausloesende_kamera_ist_die_kamera():
    # Vorher suchte auch eine auslösende Kamera erst nach «einer Kamera in
    # ihrem Raum» – und ging ohne Raum leer aus.
    ohne_raum = kamera("ring.tuer")
    assert camera_for(ohne_raum, [ohne_raum]) == "ring.tuer"


def test_sonst_die_kamera_im_selben_raum():
    melder = Entity(
        id="hm.flur",
        kind=EntityKind.BINARY_SENSOR,
        name="Flur",
        integration="demo",
        state={"state": "on"},
        commands=[],
        room="Flur",
    )
    flur = kamera("unifi.flur", room="Flur")
    assert camera_for(melder, [melder, flur]) == "unifi.flur"
    assert nearest_camera([melder, flur], "Flur") == "unifi.flur"


# ── Im laufenden Hub ───────────────────────────────────────────────────────


@pytest.fixture
def alarm_hub(tmp_path):
    async def build():
        hub = Hub(
            HubConfig(
                api=ApiConfig(),
                integrations=[{"integration": "demo"}],
                users=[OWNER],
                data_file=str(tmp_path / "daten.json"),
            )
        )
        await hub.start()
        await hub.registry.add(kamera("ring.tuer", room="Eingang"))
        service = hub.integrations.get("alarm")
        await service.update_config(
            {"settings": {"exit_delay": 0, "notify_trigger": False}}
        )
        return hub, service

    hub, service = asyncio.run(build())
    yield hub, service
    asyncio.run(hub.stop())


def gesendet(service) -> list[dict]:
    """Die Nachrichten abfangen, statt sie an Expo zu schicken."""
    nachrichten: list[dict] = []

    async def merken(title, body, category="alarm", data=None, image=None):
        nachrichten.append(
            {"title": title, "body": body, "category": category, "data": data or {}}
        )

    service._notify = merken
    return nachrichten


def test_bewegung_meldet_sich_mit_der_kamera(alarm_hub):
    hub, service = alarm_hub
    nachrichten = gesendet(service)

    async def run():
        await service.arm("ausser_haus")
        await hub.registry.update_state("ring.tuer", {"motion": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert len(nachrichten) == 1
    # Die Kamera kommt mit: Ein Tipp auf die Nachricht öffnet genau sie.
    assert nachrichten[0]["data"]["camera"] == "ring.tuer"
    assert nachrichten[0]["category"] == "camera_motion"


def test_unscharf_meldet_die_kamera_nichts(alarm_hub):
    hub, service = alarm_hub
    nachrichten = gesendet(service)

    async def run():
        await hub.registry.update_state("ring.tuer", {"motion": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert nachrichten == []


def test_dieselbe_bewegung_meldet_sich_nur_einmal(alarm_hub):
    hub, service = alarm_hub
    nachrichten = gesendet(service)

    async def run():
        await service.arm("ausser_haus")
        await hub.registry.update_state("ring.tuer", {"motion": "on"})
        await asyncio.sleep(0)
        # Die Kamera meldet weiter, solange sich etwas regt.
        await hub.registry.update_state("ring.tuer", {"motion": "off"})
        await hub.registry.update_state("ring.tuer", {"motion": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert len(nachrichten) == 1


def test_ist_die_kamera_alarmsensor_bleibt_es_bei_der_alarm_nachricht(alarm_hub):
    # Sonst kämen zwei Meldungen zum selben Ereignis – und die mit der
    # Sirene ist die wichtigere.
    hub, service = alarm_hub
    nachrichten = gesendet(service)

    async def run():
        await service.update_config(
            {"sensors": [{"entity_id": "ring.tuer", "modes": ["ausser_haus"]}]}
        )
        await service.arm("ausser_haus")
        await hub.registry.update_state("ring.tuer", {"motion": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert [n["category"] for n in nachrichten] == []
    assert service._entity.state["state"] == "ausgeloest"


def test_abschaltbar(alarm_hub):
    hub, service = alarm_hub
    nachrichten = gesendet(service)

    async def run():
        await service.update_config({"settings": {"notify_camera_motion": False}})
        await service.arm("ausser_haus")
        await hub.registry.update_state("ring.tuer", {"motion": "on"})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert nachrichten == []
