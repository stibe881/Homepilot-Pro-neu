"""Die eingebaute Klingel-Benachrichtigung.

Der Fall dahinter: «Wenn jemand an der Haustüre klingelt, kommt gar keine
Push mehr.» Der Ereigniskanal stand, der Hub hörte das Klingeln - und
trotzdem kam nichts an. Der Grund war, dass es die Nachricht gar nicht
gab: Sie hing an einem selbst gebauten Ablauf, und ein Ablauf ist eine
Verdrahtung, die man versehentlich falsch setzt.

Die wichtigste Nachricht im Haus soll daran nicht hängen. Und sie darf
nicht in der Minuten-Runde des Wächters mitlaufen: Bis die das Feld
sähe, steht der Besucher wieder auf der Strasse.
"""

import asyncio

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.core.watchdog import Watchdog


async def _hub_mit_klingel() -> tuple[Hub, Watchdog, list]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    await hub.registry.add(
        Entity(
            id="ring.haustuere",
            kind=EntityKind.LOCK,
            name="Haustüre",
            integration="ring",
            state={"state": "online", "ring": "off"},
            commands=["open_door"],
        )
    )
    wache = Watchdog(hub)
    gemeldet: list = []

    async def merken(title, body, category="outage", to=None, data=None):
        gemeldet.append({"title": title, "category": category, "data": data})

    wache._notify = merken  # type: ignore[method-assign]
    wache.start()
    return hub, wache, gemeldet


async def test_a_ring_reaches_the_phone_without_an_automation():
    hub, wache, gemeldet = await _hub_mit_klingel()
    try:
        await hub.registry.update_state("ring.haustuere", {"ring": "on"})
        # Der Bus ruft synchron, die Nachricht geht als eigene Aufgabe
        # hinaus - ihr einmal Zeit lassen.
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(gemeldet) == 1
        assert gemeldet[0]["title"] == "Es klingelt: Haustüre"
        assert gemeldet[0]["category"] == "doorbell"
        # Der Tipp auf die Nachricht soll zur Türe führen.
        assert gemeldet[0]["data"] == {
            "type": "doorbell",
            "entity_id": "ring.haustuere",
            # Ein Tipp darauf führt ins Klingel-Vollbild mit den
            # Türknöpfen, nicht bloss in die App.
            "ziel": "klingel",
        }
    finally:
        await wache.stop()
        await hub.stop()


async def test_the_same_ring_is_reported_once():
    """Ring lässt das Feld eine Weile auf «on» stehen, und jede weitere
    Meldung desselben Klingelns läuft durch denselben Weg. Ohne
    Gedächtnis käme eine Nachricht je Meldung."""
    hub, wache, gemeldet = await _hub_mit_klingel()
    try:
        await hub.registry.update_state("ring.haustuere", {"ring": "on"})
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await hub.registry.update_state("ring.haustuere", {"ring": "on", "battery": 80})
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(gemeldet) == 1
    finally:
        await wache.stop()
        await hub.stop()


async def test_the_next_visitor_rings_again():
    """Nach der Sperrfrist ist die Nachricht wieder scharf.

    Die Frist ist bewusst eine Minute - wer davorsteht und nochmals
    drückt, weil niemand kommt, will dieselbe Sache. Hier wird sie
    zurückgedreht, statt im Test eine Minute zu warten.
    """
    from homepilot.core.watchrules import KLINGEL_SPERRE

    hub, wache, gemeldet = await _hub_mit_klingel()
    try:
        await hub.registry.update_state("ring.haustuere", {"ring": "on"})
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(gemeldet) == 1

        await hub.registry.update_state("ring.haustuere", {"ring": "off"})
        await asyncio.sleep(0)
        # Die Uhr zurückdrehen: ein Besucher später am Tag.
        wache._klingel_gemeldet["ring.haustuere"] -= KLINGEL_SPERRE + 1

        await hub.registry.update_state("ring.haustuere", {"ring": "on"})
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(gemeldet) == 2
    finally:
        await wache.stop()
        await hub.stop()


async def test_other_devices_stay_quiet():
    """Ein Gerät ohne Klingel-Feld darf hier nie auftauchen - und eine
    Bewegung ist kein Klingeln."""
    hub, wache, gemeldet = await _hub_mit_klingel()
    try:
        await hub.registry.add(
            Entity(
                id="hue.stube",
                kind=EntityKind.LIGHT,
                name="Stube",
                integration="hue",
                state={"state": "off"},
                commands=["turn_on"],
            )
        )
        await hub.registry.update_state("hue.stube", {"state": "on"})
        await hub.registry.update_state("ring.haustuere", {"motion": "on"})
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert gemeldet == []
    finally:
        await wache.stop()
        await hub.stop()


def test_the_rule_can_be_switched_off_like_the_others():
    from homepilot.core import notifyrules, push

    schluessel = [regel["key"] for regel in notifyrules.describe(None)]
    assert "doorbell" in schluessel
    assert "doorbell" in push.CATEGORIES
    # Unter «Sicherheit», nicht im Sammeltopf: Sie ist die Nachricht, auf
    # die man sofort reagiert.
    regel = next(r for r in notifyrules.describe(None) if r["key"] == "doorbell")
    assert regel["group"] == "Sicherheit"


# ── Der Riegel an der letzten Stelle ────────────────────────────────────
#
# Gemessen: Ring liefert das Klingeln, der Hub hört es - und verschickt
# vier Nachrichten. Ein Klingeln kommt auf mehreren Wegen an, und jeder
# Weg kann den Zustand für sich auf «an» setzen; liegt dazwischen ein
# «aus», zählt es als neues Klingeln. Was auch immer davor schiefgeht:
# Hier geht je Türe und Minute eine Nachricht hinaus.

from homepilot.core.watchrules import KLINGEL_SPERRE, klingel_gesperrt


def test_a_second_message_within_the_minute_is_blocked():
    jetzt = 1_700_000_000.0
    assert klingel_gesperrt(jetzt, jetzt + 0.2) is True
    assert klingel_gesperrt(jetzt, jetzt + 10) is True
    assert klingel_gesperrt(jetzt, jetzt + KLINGEL_SPERRE - 0.1) is True


def test_the_next_visitor_gets_through():
    jetzt = 1_700_000_000.0
    assert klingel_gesperrt(jetzt, jetzt + KLINGEL_SPERRE) is False
    assert klingel_gesperrt(jetzt, jetzt + 300) is False


def test_the_first_ring_is_never_blocked():
    assert klingel_gesperrt(None, 1_700_000_000.0) is False


def test_a_clock_that_jumped_does_not_block_forever():
    jetzt = 1_700_000_000.0
    assert klingel_gesperrt(jetzt + 600, jetzt) is False


async def test_the_state_flapping_does_not_multiply_the_message():
    """Der gemeldete Fall in einem Test: an, aus, an, aus, an - und
    trotzdem eine Nachricht."""
    hub, wache, gemeldet = await _hub_mit_klingel()
    try:
        for _ in range(4):
            await hub.registry.update_state("ring.haustuere", {"ring": "on"})
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            await hub.registry.update_state("ring.haustuere", {"ring": "off"})
            await asyncio.sleep(0)
        assert len(gemeldet) == 1
    finally:
        await wache.stop()
        await hub.stop()
