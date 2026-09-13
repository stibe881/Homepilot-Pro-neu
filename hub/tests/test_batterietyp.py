"""Die Batteriewarnung sagt, *welche* man kaufen muss (Punkt 633).

«Batterie schwach: Türkontakt Küche. Noch 12 %» - ob da eine CR2032,
CR2450 oder eine AAA drinsteckt, wusste weder Hub noch App. Jetzt trägt
das Gerät ein Meta-Feld ``battery_type``, die Warnung nennt es, und der
Knopf «Auf die Einkaufsliste» unter der Meldung weiss, was er einträgt.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.core.watchdog import Watchdog
from homepilot.core.watchrules import batterietyp_pruefen

TOKEN = "probe-token"


def test_nur_bekannte_typen_gehen_durch():
    assert batterietyp_pruefen("CR2032") == "CR2032"
    assert batterietyp_pruefen("cr2450") == "CR2450"
    assert batterietyp_pruefen(" aaa ") == "AAA"
    assert batterietyp_pruefen("CR2O32") is None
    assert batterietyp_pruefen("") is None
    assert batterietyp_pruefen(None) is None


def _melder() -> Entity:
    return Entity(
        id="hm.kueche",
        kind=EntityKind.BINARY_SENSOR,
        name="Türkontakt Küche",
        integration="hm",
        state={"state": "off", "device_class": "contact", "battery": 12, "low_battery": True},
    )


async def test_der_typ_haengt_am_geraet_und_ueberlebt_als_meta():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    try:
        await hub.registry.add(_melder())
        await hub.set_entity_meta("hm.kueche", battery_type="cr2032")
        assert hub.registry.get("hm.kueche").battery_type == "CR2032"
        assert hub.registry.get("hm.kueche").as_dict()["battery_type"] == "CR2032"
        # Ein Tippfehler wird nicht zum vierzehnten Typ.
        await hub.set_entity_meta("hm.kueche", battery_type="Knopfzelle")
        assert hub.registry.get("hm.kueche").battery_type is None
    finally:
        await hub.stop()


async def test_die_warnung_sagt_welche_batterie_und_gibt_sie_dem_knopf_mit():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    try:
        await hub.registry.add(_melder())
        await hub.set_entity_meta("hm.kueche", battery_type="CR2032")
        wache = Watchdog(hub)
        gemeldet: list = []

        async def merken(title, body, category="outage", to=None, data=None, **_):
            gemeldet.append({"title": title, "body": body, "data": data})

        wache._notify = merken  # type: ignore[method-assign]
        await wache._check_batteries(hub.registry.all())
        assert gemeldet[0]["title"] == "Batterie schwach: Türkontakt Küche"
        assert "CR2032 wechseln" in gemeldet[0]["body"]
        assert gemeldet[0]["data"]["battery_type"] == "CR2032"
    finally:
        await hub.stop()


def test_die_batterienliste_liefert_prognose_und_resttage():
    hub = Hub(
        HubConfig(
            api=ApiConfig(token=TOKEN),
            integrations=[],
            automations=[],
            users=[{"name": "Stefan", "role": "besitzer", "token": TOKEN}],
        )
    )
    kopf = {"Authorization": f"Bearer {TOKEN}"}
    with TestClient(create_app(hub)) as client:
        liste = client.get("/api/batteries", headers=kopf)
        assert liste.status_code == 200
        # Das Wort aus Punkt 258 stand in der App bereit, der Hub lieferte
        # es nie; jetzt kommen Wort und Tage - die Tage für den Bedarf.
        assert liste.json()["forecast"] == {}
        assert liste.json()["resttage"] == {}
        # Und das Feld an der Meta-Route: ohne Gerät 404, das Feld selbst
        # nimmt sie an.
        antwort = client.put(
            "/api/entities/hm.kueche/meta", headers=kopf, json={"battery_type": "AAA"}
        )
        assert antwort.status_code == 404
