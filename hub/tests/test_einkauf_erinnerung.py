"""Die Einkaufserinnerung geht an den, der im Laden steht.

Der Fall: «Du bist im Märti, Zell – Eier, Ketchup», bekommen von jemandem,
der zu der Zeit im Büro sass. Die Nachricht heisst «Du», sie ging aber an
alle: Ausgelöst hatte sie ein anderer, der wirklich dort stand.

Wer sie zu Unrecht bekommt, kann ihr nicht glauben – und schaltet die
Erinnerung ab, die für den Richtigen nützlich gewesen wäre.
"""

import time

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.core.shopping import STAY_SECONDS
from homepilot.core.users import Role, User
from homepilot.core.watchdog import Watchdog


async def _hub_mit_laden(
    bine_im_maert: bool, bine_hat_zugang: bool = True
) -> tuple[Hub, Watchdog, list]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    hub.users.add(User(name="Stefan", role=Role.OWNER, token="t-stefan"))
    if bine_hat_zugang:
        hub.users.add(User(name="Bine", role=Role.RESIDENT, token="t-bine"))

    lange_genug = time.time() - STAY_SECONDS - 60
    for zone, name, ort in [
        ("stefan", "Stefan", "arbeit_stibe"),
        ("bine", "Bine", "maert_zell" if bine_im_maert else "zuhause"),
    ]:
        await hub.registry.add(
            Entity(
                id=f"geofence.{zone}",
                kind=EntityKind.BINARY_SENSOR,
                name=name,
                integration="geofence",
                state={"state": ort, "changed_at": lange_genug},
            )
        )

    hub.data.set(
        "family_shops", [{"id": "s1", "name": "Märti, Zell", "place": "maert_zell"}]
    )
    hub.data.set("family_shopping", [{"id": "a", "text": "Eier"}])

    wache = Watchdog(hub)
    gemeldet: list = []

    async def merken(title, body, category="outage", to=None, data=None):
        gemeldet.append({"title": title, "to": to})

    wache._notify = merken  # type: ignore[method-assign]
    return hub, wache, gemeldet


async def test_die_erinnerung_geht_nur_an_die_person_im_laden():
    hub, wache, gemeldet = await _hub_mit_laden(bine_im_maert=True)
    try:
        await wache._check_shopping(hub.registry.all())
        assert len(gemeldet) == 1
        assert gemeldet[0]["title"] == "Du bist im Märti, Zell"
        # Und nicht an «alle»: Stefan sitzt im Büro.
        assert gemeldet[0]["to"] == "Bine"
    finally:
        await hub.stop()


async def test_ohne_jemanden_im_laden_kommt_nichts():
    hub, wache, gemeldet = await _hub_mit_laden(bine_im_maert=False)
    try:
        await wache._check_shopping(hub.registry.all())
        assert gemeldet == []
    finally:
        await hub.stop()


async def test_eine_ortung_ohne_benutzer_meldet_niemandem():
    """Ein Kind in Life360 hat kein Telefon in der App – an «alle» zu
    schicken wäre der alte Fehler."""
    hub, wache, gemeldet = await _hub_mit_laden(
        bine_im_maert=True, bine_hat_zugang=False
    )
    try:
        await wache._check_shopping(hub.registry.all())
        assert gemeldet == []
    finally:
        await hub.stop()
