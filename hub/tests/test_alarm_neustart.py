"""Scharf bleibt scharf, auch über einen Neustart (Punkt 641).

Der Fall aus dem Betrieb: Die Anlage stand seit 13:08 scharf, um 16:40
startete der Hub neu - und kam unscharf hoch, weil der Zustand nur im
Speicher lag. Zehn Minuten später schaltete die Anwesenheits-Kopplung
sie wieder scharf, mit einer Meldung («Niemand mehr zuhause - die
Anlage ist scharf»), die klang, als hätte der Hub eben erst gemerkt,
dass niemand da ist. Wer die Kopplung auf «vorschlagen» stehen hat oder
wer zuhause ist, dem blieb die Anlage nach jedem Update einfach aus.
"""

import asyncio

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import ARMED, DISARMED
from homepilot.integrations.alarm_rules import (
    TRIGGERED,
    zustand_merken,
    zustand_nach_neustart,
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


# ── Die Regel für sich ─────────────────────────────────────────────────────


def test_eine_scharfe_anlage_kommt_scharf_zurueck():
    gespeichert = [zustand_merken(ARMED, "ausser_haus", None, 1000.0)]
    assert zustand_nach_neustart(gespeichert, ("nacht", "ausser_haus")) == {
        "state": ARMED,
        "mode": "ausser_haus",
        "zone": None,
        "grund": "",
    }


def test_ein_laufender_alarm_kommt_als_scharf_zurueck_und_nicht_als_sirene():
    """Eine Sirene, die Minuten nach dem Ereignis von selbst losgeht, ist
    für alle im Haus unerklärlich - der Vorfall steht im Verlauf.
    Geschützt ist das Haus trotzdem wieder."""
    gespeichert = [zustand_merken(TRIGGERED, "nacht", None, 1000.0)]
    assert zustand_nach_neustart(gespeichert, ("nacht",))["state"] == ARMED


def test_eine_zone_reist_mit():
    gespeichert = [zustand_merken(ARMED, "nacht", "obergeschoss", 1000.0)]
    assert zustand_nach_neustart(gespeichert, ("nacht",))["zone"] == "obergeschoss"


def test_ohne_gespeicherten_zustand_bleibt_es_unscharf():
    """Der erste Start nach dem Einbau - und jeder Start danach, bei dem
    die Anlage wirklich aus war."""
    for leer in ([], None, [{}], ["kaputt"]):
        assert zustand_nach_neustart(leer, ("nacht",))["state"] == DISARMED


def test_ein_gestrichener_modus_entschaerft_mit_grund():
    """Ein eigener Modus, den jemand inzwischen gelöscht hat, hat keine
    Sensorzuordnung mehr - scharf in einem Modus, den niemand kennt,
    wäre eine Anlage, die nichts bewacht und trotzdem scharf aussieht."""
    gespeichert = [zustand_merken(ARMED, "gaestezimmer", None, 1000.0)]
    wieder = zustand_nach_neustart(gespeichert, ("nacht", "ausser_haus"))
    assert wieder["state"] == DISARMED
    assert "gaestezimmer" in wieder["grund"]


# ── Und dasselbe am laufenden Hub ──────────────────────────────────────────


@pytest.fixture
def zwei_starts(tmp_path):
    """Zweimal derselbe Hub auf derselben Datendatei - ein Neustart."""

    def hub() -> Hub:
        return Hub(
            HubConfig(
                api=ApiConfig(),
                integrations=[{"integration": "demo"}],
                users=[OWNER],
                data_file=str(tmp_path / "daten.json"),
            )
        )

    return hub


def test_die_anlage_ueberlebt_den_neustart_scharf(zwei_starts):
    async def lauf():
        erster = zwei_starts()
        await erster.start()
        await erster.registry.add(contact("test.tuer"))
        dienst = erster.integrations.get("alarm")
        await dienst.update_config(
            {
                "sensors": [{"entity_id": "test.tuer", "modes": ["ausser_haus"]}],
                "settings": {"exit_delay": 0, "notify_arming": False},
            }
        )
        ergebnis = await dienst.arm("ausser_haus")
        assert ergebnis["ok"], ergebnis
        assert dienst._entity.state["state"] == ARMED
        # Wie beim Neustart des Behälters: Der Hub hält an, die Datei bleibt.
        await erster.stop()

        zweiter = zwei_starts()
        await zweiter.start()
        try:
            nach = zweiter.integrations.get("alarm")
            assert nach._entity.state["state"] == ARMED
            assert nach._entity.state["mode"] == "ausser_haus"
            # Und man sieht im Verlauf, warum sie scharf ist.
            assert any(
                zeile["kind"] == "armed" and "Neustart" in zeile["text"]
                for zeile in nach.history
            )
        finally:
            await zweiter.stop()

    asyncio.run(lauf())


def test_eine_entschaerfte_anlage_bleibt_nach_dem_neustart_aus(zwei_starts):
    """Die Gegenprobe - sonst stünde nach jedem Update eine Anlage
    scharf, die jemand ausdrücklich abgeschaltet hat."""

    async def lauf():
        erster = zwei_starts()
        await erster.start()
        await erster.registry.add(contact("test.tuer"))
        dienst = erster.integrations.get("alarm")
        await dienst.update_config(
            {
                "sensors": [{"entity_id": "test.tuer", "modes": ["ausser_haus"]}],
                "settings": {"exit_delay": 0, "notify_arming": False},
            }
        )
        await dienst.arm("ausser_haus")
        await dienst.disarm(by="Stefan")
        await erster.stop()

        zweiter = zwei_starts()
        await zweiter.start()
        try:
            assert (
                zweiter.integrations.get("alarm")._entity.state["state"] == DISARMED
            )
        finally:
            await zweiter.stop()

    asyncio.run(lauf())
