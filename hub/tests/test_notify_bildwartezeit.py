"""Eine langsame Kamera darf die Nachricht nicht aufhalten.

Der Fall aus dem Haus: Es klingelt, und die Push kommt spät. Ein Teil
davon lag hier – `snapshot()` holt kein fertiges Bild ab, sondern stösst
eines an. Bei Ring weckt das die Kamera und fragt in Runden nach, ob es
schon da ist. Ohne Zeitgrenze stand die ganze Nachricht so lange still:
Der Hub hatte alles beisammen und wartete auf ein Foto.
"""

from __future__ import annotations

import asyncio

import pytest

from homepilot.core import automation as automation_modul
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub


def gerät(entity_id: str, name: str, room: str, kind=EntityKind.BINARY_SENSOR):
    return Entity(
        id=entity_id,
        kind=kind,
        name=name,
        integration="demo",
        state={"state": "off"},
        commands=[],
        room=room,
    )


async def _klingeln(hub: Hub, gesendet: list[dict]) -> None:
    """Einen meldenden Ablauf mit Bild auslösen."""
    aktion = {
        "type": "notify",
        "to": "all",
        "title": "Es klingelt",
        "body": "Jemand steht vor der Tür",
        "camera": "demo.kamera",
    }
    automation = type("A", (), {"id": "klingel", "alias": "Türklingel"})()
    await hub.automations._notify(automation, aktion, "demo.klingel")
    del gesendet  # nur zur Lesbarkeit der Aufrufstelle


@pytest.mark.asyncio
async def test_eine_haengende_kamera_haelt_die_nachricht_nicht_auf(monkeypatch):
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        await hub.registry.add(gerät("demo.klingel", "Klingel", "Eingang"))
        await hub.registry.add(
            gerät("demo.kamera", "Türkamera", "Eingang", EntityKind.CAMERA)
        )
        # Eine Adresse muss konfiguriert sein, sonst wird das Bild gar
        # nicht erst geholt und der Test misst nichts.
        hub.config.push = {"public_url": "https://haus.example"}

        # Die Kamera, die nie antwortet. Genau der Fall, um den es geht:
        # kein Fehler, keine Absage - sie liefert einfach nicht.
        async def haengt(_entity):
            await asyncio.sleep(3600)

        integration = hub.integrations.get("demo")
        monkeypatch.setattr(integration, "snapshot", haengt, raising=False)
        # Kurze Frist, damit der Test schnell bleibt; geprüft wird, *dass*
        # eine gilt, nicht wie lang sie ist.
        monkeypatch.setattr(automation_modul, "BILD_WARTEZEIT", 0.05)

        gesendet: list[dict] = []

        async def merken(tokens, title, body, data=None, image=None, **_):
            gesendet.append({"title": title, "image": image})
            return 1

        hub.push.send = merken  # type: ignore[method-assign]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        begonnen = asyncio.get_running_loop().time()
        await _klingeln(hub, gesendet)
        gedauert = asyncio.get_running_loop().time() - begonnen

        # Die Nachricht ist raus, und zwar ohne Bild statt gar nicht.
        assert [n["title"] for n in gesendet] == ["Es klingelt"]
        assert gesendet[0]["image"] is None
        # Und sie hat nicht auf die Kamera gewartet. Grosszügig gemessen:
        # Es geht um Sekundenbruchteile gegen eine Stunde.
        assert gedauert < 1.0
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_ein_rechtzeitiges_bild_kommt_mit(monkeypatch):
    """Die Gegenprobe: Die Frist darf das Bild nicht generell wegwerfen."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        await hub.registry.add(gerät("demo.klingel", "Klingel", "Eingang"))
        await hub.registry.add(
            gerät("demo.kamera", "Türkamera", "Eingang", EntityKind.CAMERA)
        )
        hub.config.push = {"public_url": "https://haus.example"}

        async def liefert(_entity):
            return b"\xff\xd8\xff-ein-bild"

        integration = hub.integrations.get("demo")
        monkeypatch.setattr(integration, "snapshot", liefert, raising=False)

        gesendet: list[dict] = []

        async def merken(tokens, title, body, data=None, image=None, **_):
            gesendet.append({"image": image})
            return 1

        hub.push.send = merken  # type: ignore[method-assign]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        await _klingeln(hub, gesendet)
        assert gesendet[0]["image"] is not None
        assert gesendet[0]["image"].startswith("https://haus.example")
    finally:
        await hub.stop()
