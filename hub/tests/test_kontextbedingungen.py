"""Die Bedingungen zu den Auslösern aus Punkt 252/153 - als Dauerzustand.

Anwesenheit, Erreichbarkeit, Wetterwarnung und Kalender gab es nur als
Auslöser (Flanke). «Nur wenn Livia daheim ist» musste als
Gerätebedingung auf die Zonen-Entität nachgebaut werden - und dafür
musste man deren Kennung kennen. Dazu der «Zeitraum»-Auslöser, der
seine Zeitbedingung selbst mitbringt, und das auslösende Gerät als
Ziel eines Befehls.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from homepilot.core import kamera
from homepilot.core.automation import (
    Automation,
    describe_condition,
    termin_laeuft,
    warnung_aktiv,
    zeitfenster_bedingungen,
)
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import EntityKind
from homepilot.core.hub import Hub
from homepilot.core.integration import Integration

# ── Reine Hälften ─────────────────────────────────────────────────────────


def test_warnung_aktiv_respects_the_severity_floor():
    state = {"alerts": [{"event": "Wind", "severity": "Minor"}]}
    assert warnung_aktiv(state) is True
    assert warnung_aktiv(state, "Severe") is False
    assert warnung_aktiv({"alerts": []}) is False
    # Unlesbare Schwelle zählt jede Warnung - lieber eine zu viel.
    assert warnung_aktiv(state, "quatsch") is True


def test_termin_laeuft_only_between_start_and_end():
    jetzt = datetime(2026, 9, 11, 10, 0)
    events = [
        {
            "summary": "Homeoffice",
            "start": "2026-09-11T08:00:00",
            "end": "2026-09-11T12:00:00",
        }
    ]
    assert termin_laeuft(events, "homeoffice", jetzt) is True
    assert termin_laeuft(events, "zahnarzt", jetzt) is False
    assert termin_laeuft(events, "", jetzt + timedelta(hours=3)) is False


def test_termin_laeuft_treats_an_event_without_end_as_all_day():
    events = [{"summary": "Ferien", "start": "2026-09-11T00:00:00"}]
    assert termin_laeuft(events, "ferien", datetime(2026, 9, 11, 22, 0)) is True
    assert termin_laeuft(events, "ferien", datetime(2026, 9, 12, 1, 0)) is False


def test_window_trigger_brings_its_own_time_condition():
    triggers = [
        {"type": "window", "after": "07:00", "before": "09:00", "weekdays": ["Montag"]},
        {"type": "time", "at": "12:00"},
    ]
    assert zeitfenster_bedingungen(triggers) == [
        {"type": "time", "after": "07:00", "before": "09:00", "weekdays": ["Montag"]}
    ]
    assert zeitfenster_bedingungen([{"type": "state"}]) == []


def test_describe_condition_explains_the_new_kinds():
    assert "nicht zuhause" in describe_condition(
        {"type": "presence", "person": "Livia"}, None
    )
    assert "meldet sich nicht" in describe_condition(
        {"type": "availability", "entity_id": "x.y"}, None
    )
    assert "Keine Wetterwarnung" in describe_condition({"type": "weather_warning"}, None)
    assert "Kein Termin «Homeoffice»" in describe_condition(
        {"type": "calendar", "contains": "Homeoffice"}, None
    )


def test_fill_knows_the_triggering_value():
    class Geraet:
        label = "Melder Flur"
        room = "Flur"
        state = {"state": "on"}

    assert kamera.fill("{gerät} meldet {wert}", Geraet()) == "Melder Flur meldet on"


# ── Am lebenden Hub ───────────────────────────────────────────────────────


class Kontext(Integration):
    """Zone, Kalender und Warn-Gerät, wie Geofence, Kalender und
    MeteoAlarm sie auf den Hub legen."""

    name = "kontext"

    async def setup(self) -> None:
        await self.add_entity(
            "livia",
            EntityKind.BINARY_SENSOR,
            "Livia",
            state={"state": "home", "device_class": "presence"},
        )
        await self.add_entity(
            "kalender",
            EntityKind.SENSOR,
            "Kalender",
            state={
                "events": [
                    {
                        "summary": "Homeoffice",
                        "start": (datetime.now() - timedelta(hours=1)).isoformat(),
                        "end": (datetime.now() + timedelta(hours=1)).isoformat(),
                    }
                ]
            },
        )
        await self.add_entity(
            "warnung",
            EntityKind.SENSOR,
            "MeteoSchweiz",
            state={"alerts": [{"event": "Sturm", "severity": "Severe"}]},
        )

    async def handle_command(self, entity, command, data):
        pass


async def _hub() -> Hub:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    integration = Kontext(hub, {})
    hub.integrations._integrations["kontext"] = integration
    await integration.setup()
    return hub


def test_presence_condition_reads_the_zone_entity():
    async def check():
        hub = await _hub()
        try:
            pruefen = hub.automations._check_condition
            assert pruefen({"type": "presence", "person": "Livia"}) is True
            assert pruefen({"type": "presence", "person": "Livia", "state": "absent"}) is False
            await hub.registry.update_state(
                "kontext.livia", {"state": "away", "device_class": "presence"}
            )
            assert pruefen({"type": "presence", "person": "Livia"}) is False
            assert pruefen({"type": "presence", "person": "Livia", "state": "absent"}) is True
            # Eine unbekannte Person ist nie da.
            assert pruefen({"type": "presence", "person": "Niemand"}) is False
        finally:
            await hub.stop()

    asyncio.run(check())


def test_availability_weather_and_calendar_conditions():
    async def check():
        hub = await _hub()
        try:
            pruefen = hub.automations._check_condition
            assert pruefen({"type": "availability", "entity_id": "demo.light_livingroom"})
            assert not pruefen(
                {"type": "availability", "entity_id": "demo.light_livingroom", "available": False}
            )
            assert pruefen({"type": "availability", "entity_id": "gibt.esnicht"}) is False

            assert pruefen({"type": "weather_warning"}) is True
            assert pruefen({"type": "weather_warning", "min_severity": "Extreme"}) is False
            assert pruefen({"type": "weather_warning", "active": False}) is False

            # Mit genanntem Kalender: Die Demo-Integration führt selbst
            # einen, und ohne Namen nimmt der Hub den ersten, der Termine hat.
            kal = {"type": "calendar", "entity_id": "kontext.kalender"}
            assert pruefen({**kal, "contains": "Homeoffice"}) is True
            assert pruefen({**kal, "contains": "Zahnarzt"}) is False
            assert pruefen({**kal, "contains": "Zahnarzt", "active": False}) is True
        finally:
            await hub.stop()

    asyncio.run(check())


def test_window_trigger_blocks_runs_outside_its_window():
    async def check():
        hub = await _hub()
        try:
            jetzt = datetime.now()
            drin = Automation(
                id="drin",
                alias="Im Fenster",
                triggers=[
                    {
                        "type": "window",
                        "after": (jetzt - timedelta(hours=1)).strftime("%H:%M"),
                        "before": (jetzt + timedelta(hours=1)).strftime("%H:%M"),
                    }
                ],
                actions=[],
            )
            draussen = Automation(
                id="draussen",
                alias="Ausserhalb",
                triggers=[
                    {
                        "type": "window",
                        "after": (jetzt + timedelta(hours=2)).strftime("%H:%M"),
                        "before": (jetzt + timedelta(hours=3)).strftime("%H:%M"),
                    }
                ],
                actions=[],
                # Auch mit «eine genügt» gilt das Fenster - es ist der Rahmen,
                # kein Wunsch neben anderen.
                match="any",
            )
            assert hub.automations._conditions_hold(drin) == (True, [])
            gilt, gruende = hub.automations._conditions_hold(draussen)
            assert gilt is False
            assert gruende and "Uhrzeit ausserhalb" in gruende[0]
        finally:
            await hub.stop()

    asyncio.run(check())


def test_command_can_target_the_triggering_device():
    async def check():
        hub = await _hub()
        try:
            automation = Automation(
                id="taster",
                alias="Taster schaltet sich selbst",
                triggers=[{"type": "state", "entity_id": "demo.light_livingroom"}],
                actions=[{"type": "command", "entity_id": kamera.TRIGGER, "command": "turn_on"}],
            )
            await hub.automations._execute_action(
                automation, automation.actions[0], "demo.light_livingroom"
            )
            assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
            # Von Hand gestartet gibt es kein auslösendes Gerät - der Schritt
            # sagt es, statt still zu scheitern.
            notiz = await hub.automations._execute_action(automation, automation.actions[0], None)
            assert notiz and "kein auslösendes Gerät" in notiz
        finally:
            await hub.stop()

    asyncio.run(check())
