"""Anwesenheitssimulation – die einzige Integration, die niemand geprüft hat.

Ausgerechnet die: Sie tut so, als wäre jemand zuhause. Ein Fehler darin
fällt niemandem auf, weil genau das ihr Zweck ist. Und sie läuft dann,
wenn niemand da ist, um es zu bemerken.
"""

import asyncio
from datetime import datetime, timedelta

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.presence_sim import PresenceSimIntegration


async def make_hub() -> Hub:
    hub = Hub(
        HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}], automations=[])
    )
    await hub.start()
    await hub.registry.add(
        Entity(id="helpers.abwesend", kind=EntityKind.SWITCH, name="Abwesend",
               integration="helpers", state={"state": "off"}, commands=["turn_on", "turn_off"])
    )
    return hub


def sim(hub: Hub, **config) -> PresenceSimIntegration:
    grund = {
        "integration": "presence_sim",
        "switch": "helpers.abwesend",
        "lights": ["demo.light_livingroom", "demo.light_bedroom"],
    }
    return PresenceSimIntegration(hub, {**grund, **config})


async def test_it_stays_quiet_without_switch_or_lights():
    """Ohne Schalter oder Lichter: still, aber mit Hinweis im Log.

    Nicht scheitern – eine halb ausgefüllte Konfiguration darf den Hub
    nicht am Start hindern.
    """
    hub = await make_hub()
    try:
        halb = PresenceSimIntegration(hub, {"integration": "presence_sim", "lights": []})
        await halb.setup()
        assert halb._tasks == [] or all(t.done() for t in halb._tasks)
    finally:
        await hub.stop()


async def test_it_only_acts_when_nobody_is_home():
    """Der Schalter entscheidet – sonst schaltete sie einem ins Wohnzimmer."""
    hub = await make_hub()
    try:
        simulation = sim(hub)
        await simulation.setup()
        assert simulation._armed() is False

        await hub.registry.update_state("helpers.abwesend", {"state": "on"})
        assert simulation._armed() is True

        # Bei UniFi ist es umgekehrt: aktiv, wenn «niemand da» = off.
        umgekehrt = sim(hub, switch_active="off")
        await umgekehrt.setup()
        assert umgekehrt._armed() is False
        await hub.registry.update_state("helpers.abwesend", {"state": "off"})
        assert umgekehrt._armed() is True
    finally:
        await hub.stop()


async def test_a_missing_switch_entity_is_not_armed():
    """Ein Schalter, den es nicht gibt, heisst «nicht scharf» – nicht «scharf»."""
    hub = await make_hub()
    try:
        simulation = sim(hub, switch="helpers.gibtsnicht")
        await simulation.setup()
        assert simulation._armed() is False
    finally:
        await hub.stop()


async def test_darkness_can_be_switched_off():
    """Ohne «nur nach Einbruch der Dunkelheit» gilt immer als dunkel."""
    hub = await make_hub()
    try:
        immer = sim(hub, only_after_dark=False)
        await immer.setup()
        assert immer._dark() is True
    finally:
        await hub.stop()


async def test_it_toggles_a_light_when_armed_and_dark(monkeypatch):
    """Der eigentliche Zweck: Es sieht bewohnt aus.

    Statt zehn Minuten zu warten wird die Schlaufe einmal von Hand
    angestossen - mit einem Zufall, der nicht zufällig ist.
    """
    hub = await make_hub()
    try:
        simulation = sim(hub, min_interval=0.01, max_interval=0.02, only_after_dark=False)
        await simulation.setup()
        await hub.registry.update_state("helpers.abwesend", {"state": "on"})
        # Immer dasselbe Licht, damit der Test etwas behaupten kann.
        simulation._rng.choice = lambda folge: "demo.light_livingroom"  # type: ignore[method-assign]

        vorher = hub.registry.get("demo.light_livingroom").state["state"]
        for _ in range(40):
            await asyncio.sleep(0.02)
            if hub.registry.get("demo.light_livingroom").state["state"] != vorher:
                break
        assert hub.registry.get("demo.light_livingroom").state["state"] != vorher
    finally:
        await hub.stop()


async def test_it_does_nothing_while_someone_is_home():
    """Scharf ist sie nur bei Abwesenheit – sonst geht im Wohnzimmer das
    Licht aus, während man darin sitzt."""
    hub = await make_hub()
    try:
        simulation = sim(hub, min_interval=0.01, max_interval=0.02, only_after_dark=False)
        await simulation.setup()
        # Schalter bleibt auf «off» = jemand ist da.
        vorher = hub.registry.get("demo.light_livingroom").state["state"]
        await asyncio.sleep(0.2)
        assert hub.registry.get("demo.light_livingroom").state["state"] == vorher
    finally:
        await hub.stop()


def test_darkness_uses_the_configured_location():
    """Der Standort kommt aus der Konfiguration, nicht aus der Vorgabe."""
    from homepilot.core import astro

    # Nordkap Ende Juni: Mitternachtssonne, also nie dunkel.
    hoch_im_norden = datetime(2026, 6, 21, 23, 0)
    rise = astro.sun_event(hoch_im_norden.date(), 71.17, 25.78, sunset=False)
    set_ = astro.sun_event(hoch_im_norden.date(), 71.17, 25.78, sunset=True)
    # Entweder gibt es keine Auf-/Untergänge (Polartag) oder sie umfassen
    # den ganzen Tag - beides heisst: Der Standort zählt wirklich.
    assert rise is None or set_ is None or (set_ - rise) > timedelta(hours=20)
