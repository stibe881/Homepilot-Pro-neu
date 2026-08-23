"""Ein Ablauf für alle Kameras statt einer je Zimmer.

Der Fall aus dem Haus: «Jemand weint im Zimmer XYZ» – dafür musste man je
Kamera einen eigenen Ablauf bauen, weil der Text fest war und die Kamera
für das Bild fest gewählt werden musste. Fünf Zimmer, fünf fast gleiche
Abläufe, und beim Ändern findet man den fünften nie.
"""

import pytest

from homepilot.core import kamera
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub


def gerät(entity_id: str, name: str, room: str | None, kind=EntityKind.BINARY_SENSOR):
    return Entity(
        id=entity_id,
        kind=kind,
        name=name,
        integration="demo",
        state={"state": "off"},
        commands=[],
        room=room,
    )


def test_platzhalter_werden_gefuellt():
    melder = gerät("hm.kinderzimmer", "Melder Kinderzimmer", "Kinderzimmer")
    assert (
        kamera.fill("Jemand weint im Zimmer {raum}", melder)
        == "Jemand weint im Zimmer Kinderzimmer"
    )
    assert kamera.fill("{gerät} meldet sich", melder) == "Melder Kinderzimmer meldet sich"
    # Ohne Umlaut geschrieben zählt genauso - daran soll es nicht scheitern.
    assert kamera.fill("{geraet}", melder) == "Melder Kinderzimmer"


def test_ohne_auslöser_bleibt_der_satz_lesbar():
    # Keine geschweiften Klammern in der Nachricht, und keine Lücke, wo
    # der Platzhalter stand.
    assert kamera.fill("Jemand weint im Zimmer {raum}", None) == "Jemand weint im Zimmer"


def test_text_ohne_platzhalter_bleibt_wie_er_ist():
    melder = gerät("hm.flur", "Flur", "Flur")
    assert kamera.fill("Es hat geklingelt", melder) == "Es hat geklingelt"


def test_die_ausloesende_kamera_ist_die_kamera():
    cam = gerät("unifi.kind", "Kamera Kinderzimmer", None, EntityKind.CAMERA)
    assert kamera.camera_for(cam, [cam]) == "unifi.kind"


def test_sonst_die_kamera_im_selben_raum():
    melder = gerät("hm.kind", "Melder", "Kinderzimmer")
    cam = gerät("unifi.kind", "Kamera", "Kinderzimmer", EntityKind.CAMERA)
    assert kamera.camera_for(melder, [melder, cam]) == "unifi.kind"
    # Und ohne Kamera im Raum lieber keine als eine fremde.
    assert kamera.camera_for(melder, [melder]) is None


@pytest.mark.asyncio
async def test_ein_ablauf_meldet_fuer_mehrere_zimmer():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        await hub.registry.add(gerät("hm.kind1", "Melder Levin", "Levins Zimmer"))
        await hub.registry.add(gerät("hm.kind2", "Melder Lina", "Linas Zimmer"))
        gesendet: list[dict] = []

        async def merken(tokens, title, body, data=None, image=None):
            gesendet.append({"title": title, "body": body, "data": data or {}})
            return 1

        hub.push.send = merken  # type: ignore[method-assign]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        aktion = {
            "type": "notify",
            "to": "all",
            "title": "Weinen erkannt",
            "body": "Jemand weint im Zimmer {raum}",
        }
        automation = type("A", (), {"id": "a", "alias": "Weinen"})()
        # Derselbe Ablauf, zwei Auslöser - zwei verschiedene Nachrichten.
        await hub.automations._notify(automation, aktion, "hm.kind1")
        await hub.automations._notify(automation, aktion, "hm.kind2")
        assert [n["body"] for n in gesendet] == [
            "Jemand weint im Zimmer Levins Zimmer",
            "Jemand weint im Zimmer Linas Zimmer",
        ]
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_die_kamera_des_ausloesers_landet_in_der_nachricht():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        await hub.registry.add(gerät("hm.kind", "Melder", "Kinderzimmer"))
        await hub.registry.add(
            gerät("unifi.kind", "Kamera Kinderzimmer", "Kinderzimmer", EntityKind.CAMERA)
        )
        gesendet: list[dict] = []

        async def merken(tokens, title, body, data=None, image=None):
            gesendet.append({"data": data or {}})
            return 1

        hub.push.send = merken  # type: ignore[method-assign]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        automation = type("A", (), {"id": "a", "alias": "Weinen"})()
        await hub.automations._notify(
            automation,
            {"type": "notify", "camera": kamera.TRIGGER, "title": "Weinen"},
            "hm.kind",
        )
        # Ein Tipp auf die Nachricht öffnet die Kamera dieses Zimmers.
        assert gesendet[0]["data"]["camera"] == "unifi.kind"
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_ohne_passende_kamera_geht_die_nachricht_trotzdem_raus():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        await hub.registry.add(gerät("hm.keller", "Melder Keller", "Keller"))
        gesendet: list[dict] = []

        async def merken(tokens, title, body, data=None, image=None):
            gesendet.append({"data": data or {}})
            return 1

        hub.push.send = merken  # type: ignore[method-assign]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        automation = type("A", (), {"id": "a", "alias": "Melder"})()
        await hub.automations._notify(
            automation,
            {"type": "notify", "camera": kamera.TRIGGER, "title": "Bewegung"},
            "hm.keller",
        )
        assert len(gesendet) == 1
        assert "camera" not in gesendet[0]["data"]
    finally:
        await hub.stop()
