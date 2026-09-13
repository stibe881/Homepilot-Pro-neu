"""Die eingebaute Nachricht «Paket vor der Haustüre» (Punkt 617).

Protect meldete das Paket als eigene Erkennung, der Hub führte das Feld
``detected_package`` - und nichts hörte darauf: keine Push, kein Merker,
keine Erinnerung am Abend. Wie beim Weinen (test_baby_weint.py) hängt
die Nachricht jetzt an der Erkennung selbst, und dazu kommt der
Alltagsteil: Das Paket bleibt vermerkt, bis eine Person an derselben
Kamera vorbeikam oder jemand heimgekommen ist.
"""

import asyncio
import time

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.core.watchdog import Watchdog
from homepilot.core.watchrules import (
    PAKET_KEY,
    paket_abgeholt,
    paket_erinnerung_faellig,
    paket_merken,
    pakete_lesen,
    pakete_zeilen,
)


def test_paket_merken_behaelt_den_ersten_zeitpunkt():
    pakete = paket_merken({}, "cam.tuer", 100.0)
    pakete = paket_merken(pakete, "cam.tuer", 200.0)
    assert pakete == {"cam.tuer": {"since": 100.0, "reminded": False}}


def test_eine_person_holt_nur_das_paket_ihrer_kamera_ein_heimkommen_alle():
    pakete = {"cam.tuer": {"since": 1.0, "reminded": False}, "cam.hof": {"since": 2.0, "reminded": False}}
    assert list(paket_abgeholt(pakete, "cam.tuer")) == ["cam.hof"]
    assert paket_abgeholt(pakete) == {}


def test_die_abend_erinnerung_ist_ab_der_stunde_faellig_und_nur_fuer_heute():
    heute_14 = time.mktime((2026, 9, 14, 14, 12, 0, 0, 0, -1))
    abend = time.mktime((2026, 9, 14, 20, 0, 0, 0, 0, -1))
    gestern = time.mktime((2026, 9, 13, 9, 0, 0, 0, 0, -1))
    pakete = {
        "cam.tuer": {"since": heute_14, "reminded": False},
        "cam.hof": {"since": gestern, "reminded": False},
        "cam.garage": {"since": heute_14, "reminded": True},
    }
    assert paket_erinnerung_faellig(pakete, abend - 3600, 20) == []
    assert paket_erinnerung_faellig(pakete, abend, 20) == ["cam.tuer"]


def test_die_ablage_geht_hin_und_zurueck():
    pakete = {"cam.tuer": {"since": 5.0, "reminded": True}}
    assert pakete_lesen(pakete_zeilen(pakete)) == pakete
    assert pakete_lesen([{"camera": "x"}, "kaputt", {"camera": "y", "since": "nein"}]) == {}


async def _hub_mit_kamera() -> tuple[Hub, Watchdog, list]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    await hub.registry.add(
        Entity(
            id="unifi_protect.haustuere",
            kind=EntityKind.CAMERA,
            name="Haustüre",
            integration="unifi_protect",
            state={"state": "online", "detected_package": "off", "detected_person": "off"},
            commands=["set_privacy"],
        )
    )
    wache = Watchdog(hub)
    gemeldet: list = []

    async def merken(title, body, category="outage", to=None, data=None, entity_id=None, image=None):
        gemeldet.append(
            {"title": title, "body": body, "category": category, "data": data, "entity_id": entity_id}
        )

    wache._senden = merken  # type: ignore[method-assign]
    wache._notify = merken  # type: ignore[method-assign]
    wache.start()
    return hub, wache, gemeldet


async def _paket(hub: Hub, an: bool = True) -> None:
    await hub.registry.update_state(
        "unifi_protect.haustuere", {"detected_package": "on" if an else "off"}
    )
    await asyncio.sleep(0)
    await asyncio.sleep(0)


async def test_ein_erkanntes_paket_erreicht_das_telefon_und_bleibt_vermerkt():
    hub, wache, gemeldet = await _hub_mit_kamera()
    try:
        await _paket(hub)
        assert len(gemeldet) == 1
        assert gemeldet[0]["title"] == "Paket vor der Haustüre"
        assert gemeldet[0]["category"] == "package"
        # Über das Gerät setzt _senden das Ziel: die Kamera im Vollbild.
        assert gemeldet[0]["entity_id"] == "unifi_protect.haustuere"
        assert list(pakete_lesen(hub.data.get(PAKET_KEY))) == ["unifi_protect.haustuere"]
        # Die Kamera sieht das Paket in jedem Bild neu: keine zweite Nachricht.
        await _paket(hub, an=False)
        await _paket(hub)
        assert len(gemeldet) == 1
    finally:
        await wache.stop()
        await hub.stop()


async def test_eine_person_an_der_kamera_holt_das_paket_herein():
    hub, wache, gemeldet = await _hub_mit_kamera()
    try:
        await _paket(hub)
        await hub.registry.update_state("unifi_protect.haustuere", {"detected_person": "on"})
        await asyncio.sleep(0)
        assert hub.data.get(PAKET_KEY) == []
    finally:
        await wache.stop()
        await hub.stop()


async def test_wer_heimkommt_holt_alle_pakete_herein():
    hub, wache, gemeldet = await _hub_mit_kamera()
    try:
        await hub.registry.add(
            Entity(
                id="geofence.anyone_home",
                kind=EntityKind.BINARY_SENSOR,
                name="Jemand zuhause",
                integration="geofence",
                state={"state": "off", "device_class": "presence"},
            )
        )
        await _paket(hub)
        assert hub.data.get(PAKET_KEY)
        await hub.registry.update_state("geofence.anyone_home", {"state": "on", "device_class": "presence"})
        await asyncio.sleep(0)
        assert hub.data.get(PAKET_KEY) == []
    finally:
        await wache.stop()
        await hub.stop()


async def test_am_abend_erinnert_der_hub_einmal_an_das_liegengebliebene_paket(monkeypatch):
    hub, wache, gemeldet = await _hub_mit_kamera()
    try:
        await _paket(hub)
        # Die Erkennung von heute früh - und die Uhr steht auf 21 Uhr.
        heute = time.localtime()[:3]
        vormittag = time.mktime((*heute, 9, 0, 0, 0, 0, -1))
        abend = time.mktime((*heute, 21, 0, 0, 0, 0, -1))
        hub.data.set(PAKET_KEY, [{"camera": "unifi_protect.haustuere", "since": vormittag, "reminded": False}])
        monkeypatch.setattr(time, "time", lambda: abend)
        await wache._check_paket()
        await wache._check_paket()
        titel = [m["title"] for m in gemeldet]
        assert titel == ["Paket vor der Haustüre", "Das Paket liegt noch draussen"]
        assert "Seit 09:00 vor der Haustüre" in gemeldet[1]["body"]
    finally:
        await wache.stop()
        await hub.stop()
