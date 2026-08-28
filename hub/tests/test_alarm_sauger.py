"""Der Saugroboter löst die scharfe Anlage nicht mehr aus.

Der Fall aus dem Haus: Beim Weggehen schaltet der Ablauf die Anlage
scharf und schickt den Sauger los – beides gewollt. Der Sauger fährt
durch die Wohnung, der erste Bewegungsmelder sieht ihn, und die Sirene
geht.
"""

from __future__ import annotations

import asyncio

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.alarm_rules import (
    SAUGER_NACHLAUF,
    erkennt_durchbruch,
    ist_bewegung,
    sauger_deckt,
    sauger_faehrt,
    sauger_unterwegs,
)


def melder(
    entity_id: str = "demo.motion_hall",
    device_class: str | None = "motion",
    name: str = "Bewegung Flur",
    state: str = "on",
) -> Entity:
    stand: dict[str, object] = {"state": state}
    if device_class is not None:
        stand["device_class"] = device_class
    return Entity(
        id=entity_id, kind="binary_sensor", name=name, integration="demo", state=stand
    )


def kontakt(entity_id: str = "demo.window_kitchen") -> Entity:
    return Entity(
        id=entity_id,
        kind="binary_sensor",
        name="Fenster Küche",
        integration="demo",
        state={"state": "on", "device_class": "contact"},
    )


def sauger(zustand: str) -> Entity:
    return Entity(
        id="demo.vacuum",
        kind="vacuum",
        name="Olga",
        integration="demo",
        state={"state": zustand},
    )


# ── Wer ist ein Bewegungsmelder ───────────────────────────────────────


def test_a_motion_sensor_is_recognised_by_its_class() -> None:
    assert ist_bewegung(melder()) is True


def test_a_window_contact_is_never_motion() -> None:
    # Der Punkt, an dem die Anlage scharf bleibt: Ein Sauger öffnet kein
    # Fenster.
    assert ist_bewegung(kontakt()) is False


def test_a_camera_counts_as_motion() -> None:
    kamera = Entity(
        id="demo.cam",
        kind=EntityKind.CAMERA,
        name="Eingang",
        integration="demo",
        state={"motion": "on"},
    )
    assert ist_bewegung(kamera) is True


def test_without_a_class_the_name_decides() -> None:
    # Die Notbremse für einen selbst gebauten Melder über MQTT. Die
    # Kennung zählt mit: Sie heisst oft «...motion_hall», auch wenn der
    # Anzeigename nur «Flur» ist.
    assert (
        ist_bewegung(melder("mqtt.flur", device_class=None, name="Bewegung Küche"))
        is True
    )
    assert (
        ist_bewegung(melder("mqtt.motion_hall", device_class=None, name="Flur")) is True
    )
    assert (
        ist_bewegung(melder("mqtt.fenster_bad", device_class=None, name="Fenster Bad"))
        is False
    )


def test_a_smoke_detector_stays_out_of_it() -> None:
    assert ist_bewegung(melder(device_class="smoke")) is False


# ── Fährt er? ─────────────────────────────────────────────────────────


def test_the_states_of_a_driving_vacuum() -> None:
    # Freier Text aus der Bibliothek, deshalb auf Wortteile.
    assert sauger_faehrt("cleaning") is True
    assert sauger_faehrt("segment cleaning") is True
    assert sauger_faehrt("returning home") is True
    assert sauger_faehrt("going to wash the mop") is True


def test_a_parked_vacuum_does_not_drive() -> None:
    assert sauger_faehrt("charging") is False
    assert sauger_faehrt("idle") is False
    assert sauger_faehrt("docked") is False
    assert sauger_faehrt(None) is False


def test_any_vacuum_in_the_house_counts() -> None:
    assert sauger_unterwegs([melder(), sauger("cleaning")]) is True
    assert sauger_unterwegs([melder(), sauger("charging")]) is False
    assert sauger_unterwegs([melder()]) is False


# ── Wann geschwiegen wird ─────────────────────────────────────────────


def test_motion_is_ignored_while_the_vacuum_drives() -> None:
    assert sauger_deckt(melder(), True, None, 1000.0) is True


def test_a_contact_is_never_ignored() -> None:
    assert sauger_deckt(kontakt(), True, None, 1000.0) is False


def test_the_grace_period_covers_the_docking() -> None:
    # Ein Melder hält sein «on» ein bis fünf Minuten - ohne Nachlauf löst
    # er genau in dem Moment aus, in dem der Sauger andockt.
    bis = 1000.0 + SAUGER_NACHLAUF
    assert sauger_deckt(melder(), False, bis, 1100.0) is True
    assert sauger_deckt(melder(), False, bis, bis + 1) is False


def test_without_a_vacuum_run_nothing_is_ignored() -> None:
    assert sauger_deckt(melder(), False, None, 1000.0) is False


def test_the_switch_turns_the_whole_thing_off() -> None:
    assert sauger_deckt(melder(), True, None, 1000.0, an=False) is False


# ── An der laufenden Anlage ───────────────────────────────────────────


async def scharfe_anlage() -> tuple[Hub, object]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    anlage = hub.integrations.get("alarm")
    await hub.registry.add(sauger("charging"))
    await hub.registry.add(melder(state="off"))
    await hub.registry.add(kontakt())
    await hub.registry.update_state("demo.window_kitchen", {"state": "off"})
    await anlage.update_config(
        {
            "sensors": [
                {"entity_id": "demo.motion_hall", "modes": ["ausser_haus"]},
                {"entity_id": "demo.window_kitchen", "modes": ["ausser_haus"]},
            ],
            "settings": {"exit_delay": 0, "entry_delay": 0},
        }
    )
    await anlage.arm("ausser_haus", force=True)
    await asyncio.sleep(0.05)
    return hub, anlage


@pytest.mark.asyncio
async def test_the_vacuum_no_longer_sets_off_the_siren() -> None:
    hub, anlage = await scharfe_anlage()
    try:
        await hub.registry.update_state("demo.vacuum", {"state": "cleaning"})
        await hub.registry.update_state("demo.motion_hall", {"state": "on"})
        await asyncio.sleep(0.05)
        assert anlage._state == "scharf"
        # Und im Verlauf steht, warum nichts passiert ist.
        assert any(e["kind"] == "vacuum" for e in anlage.history)
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_a_window_still_sets_it_off_while_the_vacuum_drives() -> None:
    """Der Punkt, an dem die Anlage scharf bleibt: Wer durch ein Fenster
    einsteigt, kommt weiterhin nicht unbemerkt hinein."""
    hub, anlage = await scharfe_anlage()
    try:
        await hub.registry.update_state("demo.vacuum", {"state": "cleaning"})
        await hub.registry.update_state("demo.window_kitchen", {"state": "on"})
        await asyncio.sleep(0.05)
        assert anlage._state == "ausgeloest"
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_motion_sets_it_off_again_once_the_vacuum_is_parked() -> None:
    hub, anlage = await scharfe_anlage()
    try:
        await hub.registry.update_state("demo.vacuum", {"state": "cleaning"})
        await hub.registry.update_state("demo.vacuum", {"state": "charging"})
        await asyncio.sleep(0.05)
        # Der Nachlauf läuft noch - jetzt künstlich abgelaufen.
        anlage._sauger_bis = 0.0
        await hub.registry.update_state("demo.motion_hall", {"state": "on"})
        await asyncio.sleep(0.05)
        assert anlage._state == "ausgeloest"
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_the_switch_brings_the_old_behaviour_back() -> None:
    hub, anlage = await scharfe_anlage()
    try:
        await anlage.update_config({"settings": {"ignore_vacuum": False}})
        await hub.registry.update_state("demo.vacuum", {"state": "cleaning"})
        await hub.registry.update_state("demo.motion_hall", {"state": "on"})
        await asyncio.sleep(0.05)
        assert anlage._state == "ausgeloest"
    finally:
        await hub.stop()


# ── Person und Tier brechen durch ─────────────────────────────────────


def kamera(**erkannt: str) -> Entity:
    return Entity(
        id="protect.flur",
        kind=EntityKind.CAMERA,
        name="Kamera Flur",
        integration="unifi_protect",
        state={"motion": "on", **erkannt},
    )


def test_a_camera_seeing_a_person_still_sets_it_off() -> None:
    # Ein Saugroboter ist keine Person.
    assert sauger_deckt(kamera(detected_person="on"), True, None, 1000.0) is False


def test_a_camera_seeing_an_animal_still_sets_it_off() -> None:
    assert sauger_deckt(kamera(detected_animal="on"), True, None, 1000.0) is False


def test_plain_motion_on_a_camera_stays_quiet() -> None:
    # Genau das ist der Sauger, der durchs Bild fährt.
    assert sauger_deckt(kamera(), True, None, 1000.0) is True
    assert sauger_deckt(kamera(detected_person="off"), True, None, 1000.0) is True


def test_a_parcel_is_not_an_intruder() -> None:
    # Protect erkennt auch Fahrzeuge und Pakete - die gehören nicht in
    # die Wohnung und lösen hier nichts aus.
    assert sauger_deckt(kamera(detected_package="on"), True, None, 1000.0) is True


def test_the_breakthrough_also_holds_during_the_grace_period() -> None:
    bis = 1000.0 + SAUGER_NACHLAUF
    assert sauger_deckt(kamera(detected_person="on"), False, bis, 1100.0) is False


def test_an_empty_list_lets_nothing_through() -> None:
    assert (
        sauger_deckt(kamera(detected_person="on"), True, None, 1000.0, durchbruch=[])
        is True
    )


def test_the_detection_alone_is_read_from_the_state() -> None:
    assert erkennt_durchbruch(kamera(detected_person="on")) is True
    assert erkennt_durchbruch(kamera(detected_animal="on")) is True
    assert erkennt_durchbruch(kamera()) is False
    # Ein Bewegungsmelder trägt solche Felder nie.
    assert erkennt_durchbruch(melder()) is False


@pytest.mark.asyncio
async def test_a_person_sets_off_the_alarm_while_the_vacuum_drives() -> None:
    """Der ganze Weg: Sauger fährt, die Kamera sieht eine Person - und die
    Sirene geht trotzdem."""
    hub, anlage = await scharfe_anlage()
    try:
        await hub.registry.add(kamera())
        await hub.registry.update_state("protect.flur", {"motion": "off"})
        await anlage.update_config(
            {
                "sensors": [
                    {"entity_id": "demo.motion_hall", "modes": ["ausser_haus"]},
                    {"entity_id": "protect.flur", "modes": ["ausser_haus"]},
                ]
            }
        )
        await hub.registry.update_state("demo.vacuum", {"state": "cleaning"})

        # Erst nur Bewegung: Das ist der Sauger, nichts passiert.
        await hub.registry.update_state("protect.flur", {"motion": "on"})
        await asyncio.sleep(0.05)
        assert anlage._state == "scharf"

        # Dann eine Person im Bild.
        await hub.registry.update_state("protect.flur", {"detected_person": "on"})
        await asyncio.sleep(0.05)
        assert anlage._state == "ausgeloest"
    finally:
        await hub.stop()
