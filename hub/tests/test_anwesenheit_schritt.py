"""«Levin ist da» – gemeldet von einem Ablauf statt von einem Telefon.

Der Fall aus dem Haus: Ein Kind ohne Telefon kommt heim und drückt einen
Knopf am Schlüsselanhänger. Die Türe geht auf – aber das Haus wusste
danach nicht, dass jemand angekommen ist, und der Heimkomm-Ablauf lief
nie. Die Zone gab es (sie entsteht aus der Benutzerliste), melden konnte
sie aber nur das Telefon selbst.
"""

import asyncio

from homepilot.core.automation import describe_action
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

KNOPF_AUTOMATION = {
    "id": "levin_da",
    "alias": "Levin drückt den Knopf",
    "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
    "action": [{"type": "presence", "zone": "levin", "event": "enter"}],
}


async def _hub(automations, zonen=(("levin", "Levin"),)):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[
                {"integration": "demo"},
                {
                    "integration": "geofence",
                    "zones": [{"id": kennung, "name": name} for kennung, name in zonen],
                },
            ],
            automations=automations,
        )
    )
    await hub.start()
    return hub


async def settle():
    for _ in range(20):
        await asyncio.sleep(0)


async def test_ein_ablauf_kann_jemanden_als_angekommen_melden():
    hub = await _hub([KNOPF_AUTOMATION])
    try:
        assert hub.registry.get("geofence.levin").state["state"] != "home"
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        zone = hub.registry.get("geofence.levin")
        assert zone.state["state"] == "home"
        # Die Quelle sagt, woher es kam. Sonst stünde in der Diagnose
        # dasselbe wie bei allen anderen, und die Frage «warum meldet
        # sich das Telefon nicht» wäre bei jemandem gestellt, der keines
        # hat.
        assert zone.state["source"] == "ablauf"
    finally:
        await hub.stop()


async def test_damit_gilt_auch_die_sammelfrage_jemand_zuhause():
    """Der eigentliche Zweck: Der Heimkomm-Ablauf soll laufen.

    Er hängt an `geofence.anyone_home`, und die zählt nur, was gemeldet
    ist. Ohne diesen Schritt blieb sie auf «niemand da», während Levin
    in der Küche stand.
    """
    hub = await _hub([KNOPF_AUTOMATION])
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("geofence.anyone_home").state["state"] == "on"
    finally:
        await hub.stop()


async def test_eine_unbekannte_person_ist_ein_satz_und_kein_absturz():
    """Eine Zone verschwindet, wenn jemand aus der Benutzerliste fällt.

    Dann soll im Verlauf stehen, wen der Ablauf nicht gefunden hat -
    nicht ein abgebrochener Durchgang, dessen Grund niemand sieht.
    """
    hub = await _hub([])
    try:
        satz = await hub.automations._anwesenheit({"zone": "niemand"})
        assert satz is not None and "niemand" in satz
    finally:
        await hub.stop()


async def test_ohne_person_passiert_nichts():
    hub = await _hub([])
    try:
        satz = await hub.automations._anwesenheit({"event": "enter"})
        assert satz == "Anwesenheit: keine Person angegeben"
    finally:
        await hub.stop()


async def test_das_weggehen_laesst_sich_ebenso_melden():
    """Ein langer Druck als «ich gehe» – dieselbe Mechanik, andere Richtung.

    Wichtig, weil sonst nur die Uhr abmeldet: Ohne neue Meldung fällt
    ein Stand erst nach zwölf Stunden auf «unbekannt».
    """
    hub = await _hub([])
    try:
        await hub.automations._anwesenheit({"zone": "levin", "event": "enter"})
        assert hub.registry.get("geofence.levin").state["state"] == "home"
        await hub.automations._anwesenheit({"zone": "levin", "event": "leave"})
        assert hub.registry.get("geofence.levin").state["state"] == "away"
    finally:
        await hub.stop()


def test_der_trockenlauf_sagt_was_passieren_wuerde():
    # «Punkt 2 der Werkbank»: Der Probelauf soll lesbar sein, nicht die
    # rohe Aktion zeigen.
    assert (
        describe_action({"type": "presence", "zone": "Levin", "event": "enter"})
        == "Levin gilt als zuhause"
    )
    assert (
        describe_action({"type": "presence", "zone": "Levin", "event": "leave"})
        == "Levin gilt als weg"
    )
