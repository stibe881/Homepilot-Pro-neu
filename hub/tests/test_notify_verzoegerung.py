"""Die Nachricht, die ein paar Sekunden auf sich warten lässt.

Der Fall aus dem Haus: «Jemand hat die Türe im Highlight geöffnet» - mit
einem Bild, auf dem niemand steht. Kein Fehler, sondern Reihenfolge: Der
Türkontakt meldet, während die Person noch hinter der Türe ist. Fünf
Sekunden später steht sie im Bild.

Geprüft wird beides, denn nur zusammen ergeben sie den Sinn: dass die
Nachricht später rausgeht - und dass das Bild *dann* entsteht und nicht
schon beim Auslösen.
"""

from __future__ import annotations

import asyncio

import pytest

from homepilot.core.automation import MELDE_VERZOEGERUNG_MAX, notify_verzoegerung
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub


def test_ohne_angabe_kommt_die_nachricht_sofort():
    assert notify_verzoegerung({"type": "notify"}) == 0.0
    assert notify_verzoegerung({"type": "notify", "delay": 0}) == 0.0


def test_die_angegebenen_sekunden_gelten():
    assert notify_verzoegerung({"delay": 5}) == 5.0
    assert notify_verzoegerung({"delay": "5"}) == 5.0


def test_unsinn_zaehlt_als_sofort():
    # Eine Nachricht, die wegen eines Tippfehlers gar nicht mehr käme,
    # wäre der schlimmere Fall.
    assert notify_verzoegerung({"delay": "gleich"}) == 0.0
    assert notify_verzoegerung({"delay": -3}) == 0.0


def test_lange_wartezeiten_werden_gekappt():
    # Eine Meldung eine Minute nach dem Ereignis ist keine Meldung mehr.
    assert notify_verzoegerung({"delay": 3600}) == MELDE_VERZOEGERUNG_MAX


def geraet(entity_id: str, name: str, kind=EntityKind.BINARY_SENSOR) -> Entity:
    return Entity(
        id=entity_id,
        kind=kind,
        name=name,
        integration="demo",
        state={"state": "off"},
        commands=[],
        room="Highlight",
    )


@pytest.mark.asyncio
async def test_die_nachricht_wartet_und_das_bild_entsteht_erst_dann():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        await hub.registry.add(geraet("demo.tuere", "Türe"))
        await hub.registry.add(geraet("demo.kamera", "Kamera", EntityKind.CAMERA))

        gesendet: list[dict] = []
        bilder: list[str | None] = []

        async def merken(tokens, title, body, data=None, image=None, **_):
            gesendet.append({"title": title, "image": image})
            return 1

        async def bild(camera):
            # Der Zeitpunkt zählt, nicht die Adresse: Sie entsteht erst,
            # wenn wirklich gesendet wird.
            bilder.append(camera)
            return "https://haus.example/bild.jpg"

        hub.push.send = merken  # type: ignore[method-assign]
        hub.automations._snapshot_url = bild  # type: ignore[method-assign]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        aktion = {
            "type": "notify",
            "to": "all",
            "title": "Türe",
            "body": "Jemand hat die Türe geöffnet",
            "camera": "demo.kamera",
            "delay": 0.05,
        }
        automation = type("A", (), {"id": "tuere", "alias": "Türe"})()

        await hub.automations._notify(automation, aktion, "demo.tuere")
        # Der Ablauf läuft weiter, während die Nachricht wartet: Was
        # nach ihr steht (Licht an), soll nicht auf sie warten.
        assert gesendet == [] and bilder == []

        await asyncio.sleep(0.2)
        assert [eintrag["title"] for eintrag in gesendet] == ["Türe"]
        # Und das Bild stammt aus dem Moment des Sendens.
        assert bilder == ["demo.kamera"]
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_ohne_verzoegerung_bleibt_alles_wie_bisher():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        await hub.registry.add(geraet("demo.tuere", "Türe"))
        gesendet: list[str] = []

        async def merken(tokens, title, body, data=None, image=None, **_):
            gesendet.append(title)
            return 1

        hub.push.send = merken  # type: ignore[method-assign]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        automation = type("A", (), {"id": "tuere", "alias": "Türe"})()
        await hub.automations._notify(
            automation, {"type": "notify", "to": "all", "title": "Sofort"}, "demo.tuere"
        )
        # Ohne Angabe wird nicht gewartet - kein `sleep` dazwischen.
        assert gesendet == ["Sofort"]
    finally:
        await hub.stop()
