"""Der Einschlaf-Timer des Fernsehers als eigene Kachel.

Der Timer steckte nur in der Fernsehkachel – wer ihn griffbereit als
Favorit wollte, musste den ganzen Fernseher favorisieren. Jetzt legt die
Integration je Fernseher eine Timer-Entität an, die denselben Timer
zeigt und stellt. Beide Kacheln müssen immer dasselbe sagen.
"""

import time

import pytest

from homepilot.core.entity import Entity, EntityKind
from homepilot.integrations.androidtv import (
    SLEEP_KEY,
    SLEEP_MINUTES,
    AndroidTvIntegration,
    offene_timer,
    timer_ablage,
)


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


# ── Über den Neustart hinweg ───────────────────────────────────────────
#
# Gemeldet aus dem Haus: «Wenn bei einem Fernseher der Timer gestellt
# ist und man den Hub neu startet, geht es nicht weiter.» Der Timer lebt
# im Hub, damit ein gesperrtes Telefon ihn nicht abwürgt - aber er lebte
# nur so lange wie der Hub selbst, und ein Update dauert eine Minute.


def test_timer_ablage_haelt_je_fernseher_einen_eintrag():
    rows = timer_ablage(None, "10_0_0_5", 1000.0)
    assert rows == [{"entity_id": "10_0_0_5", "until": 1000.0}]
    # Neu gestellt heisst ersetzt, nicht danebengelegt.
    rows = timer_ablage(rows, "10_0_0_5", 2000.0)
    assert rows == [{"entity_id": "10_0_0_5", "until": 2000.0}]
    rows = timer_ablage(rows, "10_0_0_6", 1500.0)
    assert len(rows) == 2


def test_ein_abgebrochener_timer_verschwindet_aus_der_ablage():
    """Sonst überlebte ausgerechnet der Abbruch den Neustart."""
    rows = timer_ablage([{"entity_id": "10_0_0_5", "until": 1000.0}], "10_0_0_5", None)
    assert rows == []


def test_offene_timer_nimmt_nur_was_noch_kommt():
    rows = [
        {"entity_id": "a", "until": 2000.0},
        {"entity_id": "b", "until": 500.0},
        {"entity_id": "c", "until": "kaputt"},
        "gar kein Eintrag",
    ]
    assert offene_timer(rows, 1000.0) == {"a": 2000.0}
    assert offene_timer(None, 1000.0) == {}


async def test_der_timer_laeuft_nach_dem_neustart_weiter(hub):
    integration, tv, timer = await _aufbau(hub)
    integration._geraete[tv.id] = {
        "host": "10.0.0.5",
        "cert_dir": "/tmp",
        "ime": True,
        "name": "Fernseher Schlafzimmer",
    }
    bis = time.time() + 1800
    hub.data.set(SLEEP_KEY, [{"entity_id": tv.id, "until": bis}])

    await integration._timer_zurueckholen()

    # Derselbe Zeitpunkt wie vorher, nicht eine neu gerechnete Restzeit:
    # Wer um 22:10 «in einer Stunde» sagte, meint 23:10.
    assert tv.state["sleep_until"] == bis
    assert timer.state["sleep_until"] == bis
    assert timer.state["state"] == "on"
    assert tv.id in integration._sleep
    await integration.teardown()


async def test_ein_abgelaufener_timer_schaltet_nach_dem_neustart_nichts(hub):
    """Der Hub weiss nicht, wie lange er weg war. Ein Fernseher, der beim
    Hochfahren mitten im Film ausgeht, ist schlimmer als ein Timer, den
    man neu stellt."""
    integration, tv, timer = await _aufbau(hub)
    integration._geraete[tv.id] = {
        "host": "10.0.0.5", "cert_dir": "/tmp", "ime": True, "name": "x",
    }
    hub.data.set(SLEEP_KEY, [{"entity_id": tv.id, "until": time.time() - 60}])

    await integration._timer_zurueckholen()

    assert tv.state["sleep_until"] is None
    assert integration._sleep == {}
    # Und er steht auch nicht mehr in der Ablage, sonst käme er beim
    # nächsten Start wieder zur Prüfung.
    assert hub.data.get(SLEEP_KEY) == []


async def test_stellen_und_abbrechen_gehen_in_die_ablage(hub):
    integration, tv, _ = await _aufbau(hub)
    await integration._set_sleep(tv.id, 30)
    liegt = hub.data.get(SLEEP_KEY)
    assert len(liegt) == 1 and liegt[0]["entity_id"] == tv.id
    await integration._set_sleep(tv.id, 0)
    assert hub.data.get(SLEEP_KEY) == []
