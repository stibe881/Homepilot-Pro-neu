"""Panikknopf, Sabotagewache, Anwesenheit und Nachbericht - im Zusammenspiel.

Die reinen Regeln stehen in test_alarmwache/-anwesenheit/-bericht. Hier
steht, dass sie in der Anlage wirklich greifen - das ist der Teil, den
man beim Verdrahten verliert.
"""

from __future__ import annotations

import asyncio

import pytest

from homepilot.core import alarmanwesenheit, alarmwache
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import ARMED, DISARMED, TRIGGERED

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


def contact(entity_id: str, state: str = "off", available: bool = True) -> Entity:
    entity = Entity(
        id=entity_id,
        kind=EntityKind.BINARY_SENSOR,
        name=entity_id,
        integration="test",
        state={"state": state, "device_class": "contact"},
    )
    entity.available = available
    return entity


def person(entity_id: str, state: str) -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.BINARY_SENSOR,
        name=entity_id,
        integration="geofence",
        state={"state": state, "device_class": "presence"},
    )


@pytest.fixture
def anlage(tmp_path):
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
        await hub.registry.add(contact("test.fenster"))
        service = hub.integrations.get("alarm")
        await service.update_config(
            {
                "sensors": [{"entity_id": "test.fenster", "modes": ["ausser_haus"]}],
                "settings": {
                    "exit_delay": 0,
                    "entry_delay": 0,
                    "notify_trigger": False,
                    "clip_seconds": 0,
                },
            }
        )
        befehle: list[tuple[str, str]] = []

        async def merken(entity_id, command, data=None):
            befehle.append((entity_id, command))

        hub.integrations.dispatch_command = merken
        return hub, service, befehle

    hub, service, befehle = asyncio.run(build())
    yield hub, service, befehle
    asyncio.run(hub.stop())


# ── Panikknopf ─────────────────────────────────────────────────────────────


def test_der_panikknopf_loest_auch_aus_unscharf_aus(anlage):
    """Eine Anlage, die erst scharf geschaltet werden muss, bevor man um
    Hilfe rufen kann, hilft nicht."""
    hub, service, _ = anlage
    assert service._entity.state["state"] == DISARMED
    asyncio.run(service.panic(by="Stefan"))
    assert service._entity.state["state"] == TRIGGERED


def test_der_panikknopf_wird_sofort_laut(anlage):
    """Die Frist der Eskalation ist dafür da, einem Fehlalarm Zeit zum
    Entschärfen zu geben. Wer den Knopf selbst drückt, meint es."""
    hub, service, befehle = anlage

    async def run():
        await service.update_config(
            # Eine Frist, die im Test nie ablaufen würde.
            {"escalation": {"enabled": True, "after": 300, "sirens": ["hm.sirene"]}}
        )
        await service.panic(by="Stefan")

    asyncio.run(run())
    assert ("hm.sirene", "turn_on") in befehle


def test_der_panikknopf_braucht_keine_pin(anlage):
    """Eine Tastatur zwischen Bedrängnis und Sirene ist ein Fehler."""
    hub, service, _ = anlage
    asyncio.run(service.set_pin("1234") or asyncio.sleep(0))
    asyncio.run(service.panic(by="Stefan"))
    assert service._entity.state["state"] == TRIGGERED


def test_wer_gedrueckt_hat_steht_im_verlauf(anlage):
    hub, service, _ = anlage
    asyncio.run(service.panic(by="Stefan"))
    assert any("Stefan" in zeile["text"] for zeile in service.history)


# ── Sabotagewache ──────────────────────────────────────────────────────────


def test_ein_stiller_sensor_faellt_auf_waehrend_scharf(anlage):
    """Der Fall, der sich als Ruhe tarnt: Die Anlage steht auf «scharf»,
    die App zeigt ein grünes Schild, und das Kellerfenster wird seit
    Stunden nicht überwacht."""
    hub, service, _ = anlage

    async def run():
        await service.arm("ausser_haus")
        # Vier Runden vor der Frist: Die Vorgeschichte entsteht.
        await hub.registry.update_state("test.fenster", {}, available=False)
        await service.takt()
        # Jetzt, als wäre die Frist um.
        service._stumm_seit["test.fenster"] = 0.0
        await service.takt()

    asyncio.run(run())
    assert any(zeile["kind"] == "blind" for zeile in service.history)
    blind = service._entity.state["blind"]
    assert [zeile["art"] for zeile in blind] == [alarmwache.FUNKSTILLE]


def test_derselbe_blinde_fleck_meldet_sich_nicht_jede_minute(anlage):
    """Eine Nachricht, die jede Minute kommt, ist ein Protokoll, das man
    nicht mehr liest."""
    hub, service, _ = anlage

    async def run():
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {}, available=False)
        for _ in range(4):
            service._stumm_seit["test.fenster"] = 0.0
            await service.takt()

    asyncio.run(run())
    assert sum(1 for zeile in service.history if zeile["kind"] == "blind") == 1


def test_unscharf_wird_nichts_gemeldet(anlage):
    """Ein Sensor, der niemanden bewacht, ist kein blinder Fleck."""
    hub, service, _ = anlage

    async def run():
        await hub.registry.update_state("test.fenster", {}, available=False)
        service._stumm_seit["test.fenster"] = 0.0
        await service.takt()

    asyncio.run(run())
    assert not any(zeile["kind"] == "blind" for zeile in service.history)


def test_die_sirene_bleibt_bei_funkstille_still(anlage):
    """Sie ist von einer leeren Batterie nicht zu unterscheiden - und
    eine Anlage, die deswegen nachts heult, wird nicht mehr scharf
    geschaltet."""
    hub, service, _ = anlage

    async def run():
        await service.update_config({"settings": {"sabotage_alarm": True}})
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {}, available=False)
        service._stumm_seit["test.fenster"] = 0.0
        await service.takt()

    asyncio.run(run())
    assert service._entity.state["state"] == ARMED


# ── Anwesenheit ────────────────────────────────────────────────────────────


def test_sind_alle_weg_kommt_ein_vorschlag(anlage):
    """Die Vorgabe: eine Nachricht, kein stilles Scharfschalten."""
    hub, service, _ = anlage
    meldungen: list[str] = []

    async def run():
        await hub.registry.add(person("geofence.stefan", "away"))
        service._notify = lambda titel, text, *a, **k: meldungen.append(text) or asyncio.sleep(0)
        service._weg_seit = 0.0
        await service.takt()

    asyncio.run(run())
    assert service._entity.state["state"] == DISARMED
    assert any("scharf schalten?" in text for text in meldungen)


def test_automatisch_schaltet_wirklich_scharf(anlage):
    hub, service, _ = anlage

    async def run():
        await hub.registry.add(person("geofence.stefan", "away"))
        await service.update_config(
            {"settings": {"presence_arm": alarmanwesenheit.AUTOMATISCH}}
        )
        service._weg_seit = 0.0
        await service.takt()

    asyncio.run(run())
    assert service._entity.state["state"] == ARMED


def test_ein_offenes_fenster_haelt_auch_die_automatik_auf(anlage):
    """Eine Anlage, die sich selbst scharf schaltet und dabei ein offenes
    Fenster übergeht, wäre schlechter als gar keine Kopplung."""
    hub, service, _ = anlage
    meldungen: list[str] = []

    async def run():
        await hub.registry.add(person("geofence.stefan", "away"))
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await service.update_config(
            {"settings": {"presence_arm": alarmanwesenheit.AUTOMATISCH}}
        )
        service._notify = lambda titel, text, *a, **k: meldungen.append(text) or asyncio.sleep(0)
        service._weg_seit = 0.0
        await service.takt()

    asyncio.run(run())
    assert service._entity.state["state"] == DISARMED
    assert any("noch etwas offen" in text for text in meldungen)


def test_solange_jemand_da_ist_geschieht_nichts(anlage):
    hub, service, _ = anlage
    meldungen: list[str] = []

    async def run():
        await hub.registry.add(person("geofence.stefan", "home"))
        service._notify = lambda titel, text, *a, **k: meldungen.append(text) or asyncio.sleep(0)
        await service.takt()

    asyncio.run(run())
    assert meldungen == []


# ── Nachbericht ────────────────────────────────────────────────────────────


def test_nach_einem_alarm_kommt_ein_bericht(anlage):
    """Zehn Minuten später steht man in der Küche und weiss nicht mehr,
    was eigentlich passiert ist."""
    hub, service, _ = anlage
    meldungen: list[tuple[str, str]] = []

    async def run():
        await service.arm("ausser_haus")
        await hub.registry.update_state("test.fenster", {"state": "on"})
        await asyncio.sleep(0)
        service._notify = lambda titel, text, *a, **k: (
            meldungen.append((titel, text)) or asyncio.sleep(0)
        )
        await service.disarm(by="Stefan")

    asyncio.run(run())
    assert any(titel.startswith("Was war:") for titel, _ in meldungen)
    assert any("von Stefan" in text for _, text in meldungen)


def test_ohne_alarm_kommt_kein_bericht(anlage):
    """Die Anlage wird viel häufiger unscharf geschaltet, als sie
    auslöst - ein Nachbericht über nichts wird abbestellt."""
    hub, service, _ = anlage
    meldungen: list[tuple[str, str]] = []

    async def run():
        await service.arm("ausser_haus")
        service._notify = lambda titel, text, *a, **k: (
            meldungen.append((titel, text)) or asyncio.sleep(0)
        )
        await service.disarm(by="Stefan")

    asyncio.run(run())
    assert not any(titel.startswith("Was war:") for titel, _ in meldungen)
