"""Kontrollfluss in Aktionslisten (Punkt 251 der Werkbank).

«wenn … dann … sonst» und «wiederholen» mitten in der Aktionsliste -
mit Tiefengrenze und harter Obergrenze, damit sich nichts endlos frisst.
Dazu die Platzhalter in Nachrichtentexten.
"""

import asyncio

from homepilot.core.automation import (
    NEST_DEPTH,
    REPEAT_LIMIT,
    Automation,
    describe_action,
    parse_repeat_count,
)
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub


async def run_hub():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    return hub


def zaehl_befehle(hub, calls):
    """Jeden abgesetzten Befehl mitschreiben - so lässt sich zählen, wie
    oft eine Wiederholung wirklich gedreht hat."""
    echt = hub.integrations.dispatch_command

    async def zaehlend(entity_id, command, data=None):
        calls.append((entity_id, command))
        return await echt(entity_id, command, data or {})

    hub.integrations.dispatch_command = zaehlend


def wenn(conditions, then, sonst=None, match="all"):
    action = {"type": "if", "conditions": conditions, "match": match, "then": then}
    if sonst is not None:
        action["else"] = sonst
    return action


LICHT_AN = {"type": "state", "entity_id": "demo.light_livingroom", "equals": "on"}
KAFFEE_AN = {
    "type": "command",
    "entity_id": "demo.switch_coffee",
    "command": "turn_on",
}
SCHLAF_AN = {
    "type": "command",
    "entity_id": "demo.light_bedroom",
    "command": "turn_on",
}


async def test_if_runs_the_then_branch_when_the_condition_holds():
    hub = await run_hub()
    try:
        await hub.registry.update_state("demo.light_livingroom", {"state": "on"})
        automation = Automation(
            id="a",
            alias="Verzweigt",
            triggers=[],
            actions=[wenn([LICHT_AN], [KAFFEE_AN], [SCHLAF_AN])],
        )
        await hub.automations._run(automation)
        assert hub.registry.get("demo.switch_coffee").state["state"] == "on"
        assert hub.registry.get("demo.light_bedroom").state["state"] == "off"
        # Und der Verlauf sagt, welcher Zweig lief.
        assert "Bedingung traf zu" in hub.automations.runs[0]["steps"][0]["note"]
    finally:
        await hub.stop()


async def test_if_runs_the_else_branch_when_the_condition_fails():
    hub = await run_hub()
    try:
        automation = Automation(
            id="a",
            alias="Verzweigt",
            triggers=[],
            actions=[wenn([LICHT_AN], [KAFFEE_AN], [SCHLAF_AN])],
        )
        await hub.automations._run(automation)
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
        assert hub.registry.get("demo.light_bedroom").state["state"] == "on"
        assert "sonst-Zweig" in hub.automations.runs[0]["steps"][0]["note"]
    finally:
        await hub.stop()


async def test_if_without_an_else_branch_simply_does_nothing():
    hub = await run_hub()
    try:
        automation = Automation(
            id="a",
            alias="Nur wenn",
            triggers=[],
            actions=[wenn([LICHT_AN], [KAFFEE_AN])],
        )
        await hub.automations._run(automation)
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
        # Der Lauf selbst gilt als ausgeführt - der Schritt lief, er
        # hatte bloss nichts zu tun.
        assert hub.automations.runs[0]["executed"] is True
    finally:
        await hub.stop()


async def test_nested_ifs_work_inside_the_depth_limit():
    hub = await run_hub()
    try:
        await hub.registry.update_state("demo.light_livingroom", {"state": "on"})
        # Drei Ebenen - genau die Grenze, sie darf noch laufen.
        drei = wenn([LICHT_AN], [wenn([LICHT_AN], [wenn([], [KAFFEE_AN])])])
        automation = Automation(id="a", alias="Tief", triggers=[], actions=[drei])
        await hub.automations._run(automation)
        assert hub.registry.get("demo.switch_coffee").state["state"] == "on"
    finally:
        await hub.stop()


async def test_too_deep_nesting_is_cut_off_instead_of_eating_itself():
    hub = await run_hub()
    try:
        await hub.registry.update_state("demo.light_livingroom", {"state": "on"})
        # Vier Ebenen: Die innerste liegt jenseits von NEST_DEPTH und
        # wird übersprungen - der Rest des Laufs geht weiter.
        assert NEST_DEPTH == 3
        vier = wenn(
            [], [wenn([], [wenn([], [wenn([], [KAFFEE_AN])])])]
        )
        automation = Automation(
            id="a", alias="Zu tief", triggers=[], actions=[vier, SCHLAF_AN]
        )
        await hub.automations._run(automation)
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
        # Der Schritt danach lief trotzdem - abgeschnitten, nicht abgestürzt.
        assert hub.registry.get("demo.light_bedroom").state["state"] == "on"
    finally:
        await hub.stop()


async def test_repeat_count_runs_the_actions_that_many_times():
    hub = await run_hub()
    try:
        calls: list = []
        zaehl_befehle(hub, calls)
        automation = Automation(
            id="a",
            alias="Dreimal",
            triggers=[],
            actions=[{"type": "repeat", "count": 3, "actions": [KAFFEE_AN]}],
        )
        await hub.automations._run(automation)
        assert calls == [("demo.switch_coffee", "turn_on")] * 3
    finally:
        await hub.stop()


async def test_repeat_while_checks_before_each_round():
    hub = await run_hub()
    try:
        calls: list = []
        zaehl_befehle(hub, calls)
        kaffee_laeuft = {
            "type": "state",
            "entity_id": "demo.switch_coffee",
            "equals": "on",
        }
        automation = Automation(
            id="a",
            alias="Solange",
            triggers=[],
            actions=[
                {
                    "type": "repeat",
                    "while": [kaffee_laeuft],
                    "actions": [
                        {
                            "type": "command",
                            "entity_id": "demo.switch_coffee",
                            "command": "turn_off",
                        }
                    ],
                    "max": 10,
                }
            ],
        )
        # Bedingung gilt von Anfang an nicht: null Durchgänge.
        await hub.automations._run(automation)
        assert calls == []

        # Kaffee an: ein Durchgang schaltet ihn aus, die Prüfung vor dem
        # zweiten stoppt die Schleife.
        await hub.registry.update_state("demo.switch_coffee", {"state": "on"})
        await hub.automations._run(automation)
        assert calls == [("demo.switch_coffee", "turn_off")]
    finally:
        await hub.stop()


async def test_repeat_stops_at_the_hard_upper_bound():
    """Eine Bedingung, die nie kippt (toter Sensor, offene Türe), darf
    keine Endlosschleife werden - die Grenze ist hart und gilt auch für
    eine eigene, grössere max-Angabe."""
    hub = await run_hub()
    try:
        calls: list = []
        zaehl_befehle(hub, calls)
        immer_wahr = {
            "type": "state",
            "entity_id": "demo.light_livingroom",
            "equals": "off",
        }
        automation = Automation(
            id="a",
            alias="Endlos",
            triggers=[],
            actions=[
                {
                    "type": "repeat",
                    "while": [immer_wahr],
                    "actions": [KAFFEE_AN],
                    "max": 9999,
                }
            ],
        )
        await hub.automations._run(automation)
        assert len(calls) == REPEAT_LIMIT
        assert "Obergrenze" in hub.automations.runs[0]["steps"][0]["note"]
    finally:
        await hub.stop()


def test_repeat_count_is_parsed_conservatively():
    assert parse_repeat_count(3) == 3
    assert parse_repeat_count("5") == 5
    # Unsinn und Negatives heisst null - ein Tippfehler soll den Schritt
    # stumm machen, nicht fünfzigmal die Storen fahren.
    assert parse_repeat_count("viele") == 0
    assert parse_repeat_count(-2) == 0
    assert parse_repeat_count(None) == 0
    assert parse_repeat_count(9999) == REPEAT_LIMIT


def test_the_dry_run_describes_if_and_repeat():
    namen = {"demo.switch_coffee": "Kaffeemaschine"}.get
    satz = describe_action(
        {
            "type": "if",
            "conditions": [LICHT_AN],
            "then": [KAFFEE_AN],
            "else": [{"type": "delay", "seconds": 5}],
        },
        namen,
    )
    assert satz == (
        "wenn 1 Bedingung(en) (alle): Kaffeemaschine: turn_on"
        " – sonst: 5 Sekunden warten"
    )
    assert (
        describe_action({"type": "repeat", "count": 3, "actions": [KAFFEE_AN]}, namen)
        == "3-mal: Kaffeemaschine: turn_on"
    )
    solange = describe_action(
        {"type": "repeat", "while": [LICHT_AN], "actions": [KAFFEE_AN], "max": 10},
        namen,
    )
    assert solange == (
        "solange 1 Bedingung(en) gelten (höchstens 10-mal): Kaffeemaschine: turn_on"
    )


def test_notify_texts_fill_entity_placeholders():
    """«Die Waschküche hat {sensor} Grad» trägt in der Push den Messwert -
    und ein Tippfehler bleibt als Tippfehler lesbar stehen."""

    async def check():
        hub = await run_hub()
        try:
            await hub.registry.add(
                Entity(
                    id="test.aussen",
                    kind=EntityKind.SENSOR,
                    name="Aussenfühler",
                    integration="test",
                    state={"state": "21.5", "einheit": "°C"},
                )
            )
            sent: list[dict] = []

            async def fake_send(tokens, title, body, data=None, image=None, **_):
                sent.append({"title": title, "body": body})
                return len(tokens)

            hub.push.send = fake_send  # type: ignore[assignment]
            hub.push.register("ExponentPushToken[x]", "Stefan")

            automation = Automation(id="a", alias="Wetter", triggers=[], actions=[])
            await hub.automations._notify(
                automation,
                {
                    "type": "notify",
                    "title": "Draussen {test.aussen} {test.aussen.einheit}",
                    "body": "Stand um {time}: {tippfehler}",
                },
            )
            assert sent[0]["title"] == "Draussen 21.5 °C"
            # {time} wird zur Uhrzeit, der Tippfehler bleibt stehen.
            assert sent[0]["body"].startswith("Stand um ")
            assert "{time}" not in sent[0]["body"]
            assert sent[0]["body"].endswith(": {tippfehler}")
        finally:
            await hub.stop()

    asyncio.run(check())
