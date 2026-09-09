"""Die Eskalationsstufe der Alarmanlage (Punkt 255 der Werkbank).

Der Fall dahinter: Wer die Sirene direkt in die trigger-Aktionen legt,
weckt bei jedem Fehlalarm die Nachbarschaft. Die Eskalation wartet eine
Frist ab - wer rechtzeitig entschärft, bleibt unhörbar; wer nicht
entschärfen kann, ist ein Einbrecher, und dann wird es laut und hell.
"""

import asyncio

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import (
    ARMED,
    DISARMED,
    TRIGGERED,
    durchsage_boxen,
    eskalation_wirkt,
    eskalations_befehle,
    eskalations_ende_befehle,
    parse_escalation,
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


def box(entity_id: str, room: str | None = None) -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.MEDIA_PLAYER,
        name=entity_id,
        integration="test",
        state={"state": "idle"},
        commands=["play_url"],
        room=room,
    )


def light(entity_id: str) -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.LIGHT,
        name=entity_id,
        integration="test",
        state={"state": "off"},
        commands=["turn_on", "turn_off"],
    )


# ── Reine Regeln ───────────────────────────────────────────────────────────


def test_parse_escalation_faellt_auf_die_vorgaben_zurueck():
    """Ohne oder mit kaputter Angabe: aus, 30 Sekunden - nichts ändert
    sich am heutigen Verhalten."""
    vorgabe = parse_escalation(None)
    assert vorgabe["enabled"] is False
    assert vorgabe["after"] == 30
    assert vorgabe["sirens"] == []
    assert parse_escalation("quatsch") == vorgabe
    kaputt = parse_escalation({"after": "bald", "sirens": "keine-liste", "volume": "laut"})
    assert kaputt["after"] == 30
    assert kaputt["sirens"] == []
    assert kaputt["volume"] is None


def test_parse_escalation_uebernimmt_und_begrenzt_die_werte():
    parsed = parse_escalation(
        {
            "enabled": True,
            "after": 10,
            "sirens": ["hm.sirene", "", None],
            "all_lights": 1,
            "announce": "  Alarm im Haus  ",
            "volume": 250,
        }
    )
    assert parsed["enabled"] is True
    assert parsed["after"] == 10
    # Leere Kennungen fliegen raus - ein halber Eintrag scheiterte sonst
    # genau im Alarmfall.
    assert parsed["sirens"] == ["hm.sirene"]
    assert parsed["all_lights"] is True
    assert parsed["announce"] == "Alarm im Haus"
    assert parsed["volume"] == 100


def test_parse_escalation_nimmt_das_ziel_der_durchsage():
    parsed = parse_escalation(
        {"announce_target": "raum", "announce_speakers": ["cast.kueche", ""]}
    )
    assert parsed["announce_target"] == "raum"
    assert parsed["announce_speakers"] == ["cast.kueche"]
    # Ein Ziel, das es nicht gibt, fällt auf «alle» zurück - im Alarmfall
    # ist eine Durchsage überallhin besser als gar keine.
    assert parse_escalation({"announce_target": "kueche"})["announce_target"] == "alle"


def test_durchsage_geht_ohne_wahl_an_alle():
    # None heisst «alle» - genau das, was say.speak ohne Liste tut.
    assert durchsage_boxen(parse_escalation(None), [], None) is None


def test_durchsage_an_die_ausgewaehlten_boxen():
    eskalation = parse_escalation(
        {"announce_target": "auswahl", "announce_speakers": ["cast.flur"]}
    )
    assert durchsage_boxen(eskalation, [box("cast.flur")], None) == ["cast.flur"]


def test_leere_auswahl_geht_an_alle_statt_ins_leere():
    # Der schlimmere Fehler wäre eine Durchsage, die beim Einbruch
    # nirgends ankommt: Der Sinn ist, dass es im Haus laut wird.
    eskalation = parse_escalation({"announce_target": "auswahl"})
    assert durchsage_boxen(eskalation, [box("cast.flur")], None) is None


def test_durchsage_in_den_raum_des_melders():
    eskalation = parse_escalation({"announce_target": "raum"})
    boxen = [box("cast.kueche", "Küche"), box("cast.stube", "Stube")]
    assert durchsage_boxen(eskalation, boxen, "Küche") == ["cast.kueche"]
    # Ein Raum ohne Box - und ein Melder ohne Raum - fallen auf «alle».
    assert durchsage_boxen(eskalation, boxen, "Estrich") is None
    assert durchsage_boxen(eskalation, boxen, None) is None


def test_eskalation_wirkt_nur_wenn_sie_etwas_tun_wuerde():
    assert not eskalation_wirkt(parse_escalation(None))
    # Eingeschaltet, aber ohne Sirene, Licht und Durchsage: ein Timer ins
    # Leere - der wird gar nicht erst gestellt.
    assert not eskalation_wirkt(parse_escalation({"enabled": True}))
    assert eskalation_wirkt(parse_escalation({"enabled": True, "sirens": ["a"]}))
    assert eskalation_wirkt(parse_escalation({"enabled": True, "all_lights": True}))
    assert eskalation_wirkt(parse_escalation({"enabled": True, "announce": "Hallo"}))
    # Nicht eingeschaltet schlägt alles - auch mit konfigurierter Sirene.
    assert not eskalation_wirkt(parse_escalation({"sirens": ["a"]}))


def test_eskalations_befehle_schalten_sirene_und_alle_lichter():
    escalation = parse_escalation(
        {"enabled": True, "sirens": ["hm.sirene"], "all_lights": True}
    )
    entities = [light("a.licht"), light("b.licht"), contact("c.kontakt")]
    befehle = eskalations_befehle(escalation, entities)
    # Sirene zuerst: Der Lärm ist der Zweck, das Licht die Zugabe.
    assert befehle[0] == {"entity_id": "hm.sirene", "command": "turn_on"}
    assert {"entity_id": "a.licht", "command": "turn_on"} in befehle
    assert {"entity_id": "b.licht", "command": "turn_on"} in befehle
    # Der Kontakt ist kein Licht und bekommt nichts.
    assert all(befehl["entity_id"] != "c.kontakt" for befehl in befehle)


def test_ohne_all_lights_bleiben_die_lichter_aus():
    escalation = parse_escalation({"enabled": True, "sirens": ["hm.sirene"]})
    befehle = eskalations_befehle(escalation, [light("a.licht")])
    assert befehle == [{"entity_id": "hm.sirene", "command": "turn_on"}]


def test_ende_befehle_schalten_nur_die_sirenen_aus():
    escalation = parse_escalation(
        {"enabled": True, "sirens": ["hm.sirene"], "all_lights": True}
    )
    # Die Lichter bleiben bewusst an - wer nach einem Alarm durchs Haus
    # geht, will nicht im Dunkeln stehen.
    assert eskalations_ende_befehle(escalation) == [
        {"entity_id": "hm.sirene", "command": "turn_off"}
    ]


# ── Anlage im Betrieb ──────────────────────────────────────────────────────


@pytest.fixture
def alarm_hub(tmp_path):
    """Hub mit einem Sofort-Sensor, ohne Verzögerungen, Befehle abgefangen."""

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
                    # Kein Mitschnitt: Hier geht es um die Eskalation.
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


def ausloesen(hub):
    return hub.registry.update_state("test.fenster", {"state": "on"})


def test_eskalation_feuert_nach_der_frist(alarm_hub):
    hub, service, befehle = alarm_hub

    async def run():
        await service.update_config(
            {"escalation": {"enabled": True, "after": 0.05, "sirens": ["hm.sirene"]}}
        )
        await service.arm("ausser_haus")
        await ausloesen(hub)
        await asyncio.sleep(0.15)

    asyncio.run(run())
    assert service._entity.state["state"] == TRIGGERED
    assert ("hm.sirene", "turn_on") in befehle
    assert any(eintrag["kind"] == "escalated" for eintrag in service.history)


def test_eskalation_feuert_nicht_vor_der_frist(alarm_hub):
    hub, service, befehle = alarm_hub

    async def run():
        await service.update_config(
            {"escalation": {"enabled": True, "after": 30, "sirens": ["hm.sirene"]}}
        )
        await service.arm("ausser_haus")
        await ausloesen(hub)
        # Der Alarm ist ausgelöst, aber die Frist läuft noch.
        await asyncio.sleep(0.05)

    asyncio.run(run())
    assert service._entity.state["state"] == TRIGGERED
    assert ("hm.sirene", "turn_on") not in befehle


def test_entschaerfen_bricht_die_eskalation_ab(alarm_hub):
    hub, service, befehle = alarm_hub

    async def run():
        await service.update_config(
            {"escalation": {"enabled": True, "after": 0.05, "sirens": ["hm.sirene"]}}
        )
        await service.arm("ausser_haus")
        await ausloesen(hub)
        await service.disarm()
        # Auch nach der ursprünglichen Frist darf nichts mehr kommen -
        # genau dafür ist die Frist da: Fehlalarm entschärft, Sirene stumm.
        await asyncio.sleep(0.15)

    asyncio.run(run())
    assert service._entity.state["state"] == DISARMED
    assert ("hm.sirene", "turn_on") not in befehle
    # Und kein überflüssiges turn_off: Die Sirene lief ja nie.
    assert ("hm.sirene", "turn_off") not in befehle


def test_sirene_geht_beim_entschaerfen_aus(alarm_hub):
    hub, service, befehle = alarm_hub

    async def run():
        await service.update_config(
            {"escalation": {"enabled": True, "after": 0, "sirens": ["hm.sirene"]}}
        )
        await service.arm("ausser_haus")
        await ausloesen(hub)
        await asyncio.sleep(0.05)
        assert ("hm.sirene", "turn_on") in befehle
        await service.disarm()

    asyncio.run(run())
    assert service._entity.state["state"] == DISARMED
    assert ("hm.sirene", "turn_off") in befehle


def test_ohne_konfiguration_bleibt_alles_wie_heute(alarm_hub):
    hub, service, befehle = alarm_hub

    async def run():
        await service.arm("ausser_haus")
        await ausloesen(hub)
        await asyncio.sleep(0.1)

    asyncio.run(run())
    assert service._entity.state["state"] == TRIGGERED
    # Kein Timer, kein Befehl: Eine Anlage ohne Eskalations-Eintrag
    # verhält sich exakt wie vor Punkt 255.
    assert befehle == []
    assert service._eskalation_task is None


def test_wieder_scharf_heisst_keine_eskalation_mehr(alarm_hub):
    """Ist die Anlage beim Ablauf der Frist nicht mehr ausgelöst (etwa
    nach dem automatischen Wiederscharfschalten), bleibt es still."""
    hub, service, befehle = alarm_hub

    async def run():
        await service.update_config(
            {"escalation": {"enabled": True, "after": 0.1, "sirens": ["hm.sirene"]}}
        )
        await service.arm("ausser_haus")
        await ausloesen(hub)
        # Von Hand in den Zustand nach dem Wiederscharfschalten.
        await service._rearm()
        await asyncio.sleep(0.2)

    asyncio.run(run())
    assert service._entity.state["state"] == ARMED
    assert ("hm.sirene", "turn_on") not in befehle
