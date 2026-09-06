"""Anwesenheit und Wetterwarnungen als Auslöser (Punkt 252 der Werkbank).

Der Anwesenheits-Auslöser hängt an denselben Zonen-Entitäten wie die
«Livia ist angekommen»-Nachrichten (Punkt 199) - kein eigenes Polling.
Der Wetter-Auslöser liest die Warnliste am Alert-Gerät, das
integrations/meteoalarm.py ohnehin pflegt, und feuert nur für Warnungen,
die neu dazukommen.
"""

import asyncio

from homepilot.core.automation import (
    neue_warnungen,
    person_matches,
    presence_trigger_matches,
)
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub


async def run_hub(automations):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            automations=automations,
        )
    )
    await hub.start()
    return hub


async def settle():
    for _ in range(10):
        await asyncio.sleep(0)


async def zone_anlegen(hub, kennung: str, name: str, zustand: str = "away"):
    """Eine Anwesenheits-Zone, wie sie die Geofence-Integration anlegt."""
    await hub.registry.add(
        Entity(
            id=f"geofence.{kennung}",
            kind=EntityKind.BINARY_SENSOR,
            name=name,
            integration="geofence",
            state={"state": zustand, "device_class": "presence"},
        )
    )


PRESENCE_AUTOMATION = {
    "id": "livia_kommt",
    "alias": "Livia kommt heim",
    "trigger": [{"type": "presence", "person": "Livia", "event": "arrives"}],
    "action": [
        {
            "type": "command",
            "entity_id": "demo.light_livingroom",
            "command": "turn_on",
        }
    ],
}


async def test_presence_trigger_fires_for_the_right_person_only():
    hub = await run_hub([PRESENCE_AUTOMATION])
    try:
        await zone_anlegen(hub, "livia", "Livia")
        await zone_anlegen(hub, "stefan", "Stefan")
        licht = "demo.light_livingroom"

        # Stefan kommt an - nicht die gesuchte Person, nichts passiert.
        await hub.registry.update_state("geofence.stefan", {"state": "home"})
        await settle()
        assert hub.registry.get(licht).state["state"] == "off"

        # Livia kommt an - jetzt feuert der Ablauf.
        await hub.registry.update_state("geofence.livia", {"state": "home"})
        await settle()
        assert hub.registry.get(licht).state["state"] == "on"
    finally:
        await hub.stop()


async def test_presence_trigger_ignores_the_restart_wave():
    """Nach einem Neustart melden alle Telefone einmal - aus «unbekannt»
    wird «zuhause», ohne dass jemand angekommen wäre. Dieselbe Regel wie
    bei den Ankunfts-Nachrichten (geofence._sagen)."""
    hub = await run_hub([PRESENCE_AUTOMATION])
    try:
        await zone_anlegen(hub, "livia", "Livia", zustand="unknown")
        await hub.registry.update_state("geofence.livia", {"state": "home"})
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
    finally:
        await hub.stop()


async def test_presence_trigger_fires_when_the_person_leaves():
    hub = await run_hub(
        [
            {
                "id": "livia_geht",
                "alias": "Livia geht",
                "trigger": [
                    {"type": "presence", "person": "livia", "event": "leaves"}
                ],
                "action": [
                    {
                        "type": "command",
                        "entity_id": "demo.light_livingroom",
                        "command": "turn_on",
                    }
                ],
            }
        ]
    )
    try:
        await zone_anlegen(hub, "livia", "Livia", zustand="home")
        # Eine blosse Neu-Meldung desselben Zustands (last_seen springt,
        # der Zustand nicht) darf nicht feuern.
        await hub.registry.update_state("geofence.livia", {"last_seen": 1.0})
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "off"

        await hub.registry.update_state("geofence.livia", {"state": "away"})
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
    finally:
        await hub.stop()


def test_person_matches_accepts_zone_id_entity_id_and_name():
    assert person_matches("livia", "geofence.livia", "Livia") is True
    assert person_matches("Livia", "geofence.livia", "Livia Gross") is True
    assert person_matches("geofence.livia", "geofence.livia", "Livia") is True
    assert person_matches("stefan", "geofence.livia", "Livia") is False
    assert person_matches("", "geofence.livia", "Livia") is False


def test_presence_trigger_matches_a_named_zone():
    """«kommt in der Schule an»: Die Zone ist der Zustand selbst."""
    daten = {
        "entity_id": "geofence.livia",
        "entity": {"name": "Livia"},
        "old_state": {"state": "away"},
        "new_state": {"state": "schule", "device_class": "presence"},
    }
    ankunft = {"type": "presence", "person": "livia", "event": "arrives", "zone": "schule"}
    assert presence_trigger_matches(ankunft, daten) is True
    # Ohne Zonenangabe zählt das Zuhause - «schule» ist keine Heimkehr.
    daheim = {"type": "presence", "person": "livia", "event": "arrives"}
    assert presence_trigger_matches(daheim, daten) is False


# ── Wetterwarnungen ────────────────────────────────────────────────────────


STURM = {
    "title": "Sturmwarnung",
    "event": "Sturm",
    "severity": "Severe",
    "onset": "2026-09-06T12:00:00+02:00",
}
REGEN = {
    "title": "Regen",
    "event": "Regen",
    "severity": "Moderate",
    "onset": "2026-09-06T14:00:00+02:00",
}

WETTER_AUTOMATION = {
    "id": "unwetter",
    "alias": "Unwetterwarnung",
    "trigger": [{"type": "weather_warning"}],
    "action": [
        {
            "type": "command",
            "entity_id": "demo.light_livingroom",
            "command": "toggle",
        }
    ],
}


async def alert_anlegen(hub):
    await hub.registry.add(
        Entity(
            id="meteoalarm.switzerland",
            kind=EntityKind.ALERT,
            name="MeteoAlarm Switzerland",
            integration="meteoalarm",
            state={"state": "ok", "count": 0, "alerts": []},
        )
    )


async def test_weather_warning_fires_on_a_new_warning_but_not_twice():
    hub = await run_hub([WETTER_AUTOMATION])
    try:
        await alert_anlegen(hub)
        licht = "demo.light_livingroom"

        await hub.registry.update_state(
            "meteoalarm.switzerland",
            {"state": "alert", "count": 1, "alerts": [STURM]},
        )
        await settle()
        assert hub.registry.get(licht).state["state"] == "on"

        # Die nächste Feed-Runde bringt DIESELBE Warnung erneut mit -
        # der Auslöser bleibt still (sonst togglete das Licht zurück).
        await hub.registry.update_state(
            "meteoalarm.switzerland",
            {"state": "alert", "count": 1, "alerts": [STURM], "max_severity": "Severe"},
        )
        await settle()
        assert hub.registry.get(licht).state["state"] == "on"

        # Eine zweite, neue Warnung feuert wieder.
        await hub.registry.update_state(
            "meteoalarm.switzerland",
            {"state": "alert", "count": 2, "alerts": [STURM, REGEN]},
        )
        await settle()
        assert hub.registry.get(licht).state["state"] == "off"
    finally:
        await hub.stop()


async def test_weather_warning_respects_the_minimum_severity():
    hub = await run_hub(
        [
            {
                **WETTER_AUTOMATION,
                "trigger": [{"type": "weather_warning", "min_severity": "Severe"}],
            }
        ]
    )
    try:
        await alert_anlegen(hub)
        licht = "demo.light_livingroom"

        # Eine mässige Warnung liegt unter der Schwelle.
        await hub.registry.update_state(
            "meteoalarm.switzerland",
            {"state": "alert", "count": 1, "alerts": [REGEN]},
        )
        await settle()
        assert hub.registry.get(licht).state["state"] == "off"

        await hub.registry.update_state(
            "meteoalarm.switzerland",
            {"state": "alert", "count": 2, "alerts": [REGEN, STURM]},
        )
        await settle()
        assert hub.registry.get(licht).state["state"] == "on"
    finally:
        await hub.stop()


def test_new_warnings_are_found_by_key_not_by_position():
    assert neue_warnungen({"alerts": [STURM]}, {"alerts": [REGEN, STURM]}) == [REGEN]
    assert neue_warnungen({"alerts": [STURM]}, {"alerts": [STURM]}) == []
    assert neue_warnungen({}, {"alerts": [STURM]}) == [STURM]
    # Eine Warnung ohne Stufe fällt bei gesetzter Schwelle NICHT weg -
    # lieber eine zu viel als eine unterschlagene.
    ohne_stufe = {"title": "Warnung", "event": "?", "onset": "x"}
    assert neue_warnungen({}, {"alerts": [ohne_stufe]}, "Severe") == [ohne_stufe]
    # Eine unlesbare Schwelle filtert nichts, statt alles zu schlucken.
    assert neue_warnungen({}, {"alerts": [REGEN]}, "quatsch") == [REGEN]
