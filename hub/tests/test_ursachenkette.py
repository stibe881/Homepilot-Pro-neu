"""Die Kette am Gerät: Auslöser → Ablauf → Gerät.

Am Gerät stand «Ablauf «Licht bei Bewegung»», und die nächste Frage kam
sofort: welche Bewegung? Flur oder Keller - beide hängen am selben
Ablauf.
"""

from homepilot.core.automation import Automation, trigger_wort
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.source import automation_source


def test_das_geraet_das_gemeldet_hat_ist_die_antwort():
    assert trigger_wort([{"type": "state"}], "Bewegung Flur") == "Bewegung Flur"


def test_ohne_geraet_bleibt_die_uhrzeit():
    assert trigger_wort([{"type": "time", "at": "20:00"}], None) == "um 20:00"
    assert trigger_wort([{"type": "sun", "event": "sunset"}], None) == "Sonnenuntergang"


def test_bei_zwei_ausloesern_wird_nicht_geraten():
    """Ein geratener Auslöser ist schlimmer als keiner - dann steht am
    Gerät weiterhin nur der Ablauf."""
    assert (
        trigger_wort(
            [{"type": "time", "at": "20:00"}, {"type": "sun", "event": "sunset"}], None
        )
        is None
    )
    assert trigger_wort([{"type": "interval", "seconds": 60}], None) is None
    assert trigger_wort([], None) is None


def test_die_quelle_traegt_den_ausloeser_nur_wenn_es_einen_gibt():
    assert automation_source("a", "Licht bei Bewegung") == {
        "kind": "automation",
        "label": "Licht bei Bewegung",
        "id": "a",
    }
    assert automation_source("a", "Licht bei Bewegung", "Bewegung Flur")["trigger"] == (
        "Bewegung Flur"
    )


async def test_am_geraet_steht_hinterher_die_ganze_kette():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        melder = hub.registry.get("demo.motion_hall")
        ablauf = Automation(
            id="a",
            alias="Licht bei Bewegung",
            triggers=[{"type": "state", "entity_id": melder.id, "to": "on"}],
            conditions=[],
            actions=[
                {
                    "type": "command",
                    "entity_id": "demo.light_livingroom",
                    "command": "turn_on",
                }
            ],
        )
        await hub.automations._run(ablauf, ausloeser=melder.id)
        licht = hub.registry.get("demo.light_livingroom")
        assert licht.last_source == {
            "kind": "automation",
            "label": "Licht bei Bewegung",
            "id": "a",
            "trigger": melder.label,
        }
    finally:
        await hub.stop()
