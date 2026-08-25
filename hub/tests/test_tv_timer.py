"""Der Einschlaf-Timer des Fernsehers als eigene Kachel.

Der Timer steckte nur in der Fernsehkachel – wer ihn griffbereit als
Favorit wollte, musste den ganzen Fernseher favorisieren. Jetzt legt die
Integration je Fernseher eine Timer-Entität an, die denselben Timer
zeigt und stellt. Beide Kacheln müssen immer dasselbe sagen.
"""

import pytest

from homepilot.core.entity import Entity, EntityKind
from homepilot.integrations.androidtv import SLEEP_MINUTES, AndroidTvIntegration


async def _aufbau(hub) -> tuple[AndroidTvIntegration, Entity, Entity]:
    """Integration ohne echtes Gerät verdrahten.

    setup() braucht androidtvremote2 und einen Fernseher im Netz – beides
    hat die Prüfumgebung nicht. Die Entitäten und Zuordnungen entstehen
    hier von Hand, genau wie setup() sie anlegt; geprüft wird die
    Spiegelung, nicht die Funkverbindung.
    """
    integration = AndroidTvIntegration(hub, {})
    integration._remotes = {}
    integration._sleep = {}
    integration._timer_of = {}
    integration._tv_of = {}
    tv = await integration.add_entity(
        "10_0_0_5",
        EntityKind.MEDIA_PLAYER,
        "Fernseher Schlafzimmer",
        state={"state": "on", "sleep_until": None, "sleep_minutes": SLEEP_MINUTES},
        commands=["turn_off", "sleep_timer"],
    )
    timer = await integration.add_entity(
        "10_0_0_5_timer",
        EntityKind.TIMER,
        "Fernseher Schlafzimmer Timer",
        state={"state": "off", "sleep_until": None, "sleep_minutes": SLEEP_MINUTES},
        commands=["sleep_timer"],
    )
    integration._timer_of[tv.id] = timer.id
    integration._tv_of[timer.id] = tv.id
    return integration, tv, timer


async def test_timer_stellen_spiegelt_auf_beide_kacheln(hub):
    integration, tv, timer = await _aufbau(hub)
    await integration._set_sleep(tv.id, 30)
    assert tv.state["sleep_until"] is not None
    assert timer.state["sleep_until"] == tv.state["sleep_until"]
    assert timer.state["state"] == "on"


async def test_abbrechen_loescht_beide_kacheln(hub):
    integration, tv, timer = await _aufbau(hub)
    await integration._set_sleep(tv.id, 30)
    await integration._set_sleep(tv.id, 0)
    assert tv.state["sleep_until"] is None
    assert timer.state["sleep_until"] is None
    assert timer.state["state"] == "off"


async def test_timer_kachel_stellt_den_timer_des_fernsehers(hub):
    integration, tv, timer = await _aufbau(hub)
    # Die Kachel funktioniert nur mit verbundenem Fernseher – wie die
    # Fernsehkachel selbst.
    integration._remotes[tv.id] = object()
    await integration.handle_command(timer, "sleep_timer", {"minutes": 45})
    assert tv.state["sleep_until"] is not None
    assert timer.state["state"] == "on"


async def test_timer_kachel_ohne_fernseher_sagt_es_ehrlich(hub):
    integration, _tv, timer = await _aufbau(hub)
    with pytest.raises(ConnectionError):
        await integration.handle_command(timer, "sleep_timer", {"minutes": 45})


async def test_timer_kachel_kennt_nur_den_timer(hub):
    integration, tv, timer = await _aufbau(hub)
    integration._remotes[tv.id] = object()
    with pytest.raises(ValueError):
        await integration.handle_command(timer, "turn_off", {})
