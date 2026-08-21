import asyncio

from homepilot.core.automation import (
    Automation,
    describe_condition,
    parse_automations,
)
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub

MOTION_AUTOMATION = {
    "id": "motion_light",
    "alias": "Licht bei Bewegung",
    "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
    "condition": [
        {"type": "state", "entity_id": "demo.light_livingroom", "equals": "off"}
    ],
    "action": [
        {
            "type": "command",
            "entity_id": "demo.light_livingroom",
            "command": "turn_on",
            "data": {"brightness": 80},
        }
    ],
}


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
    # Automationen laufen als eigene Tasks – kurz abwarten.
    for _ in range(10):
        await asyncio.sleep(0)


async def test_state_trigger_runs_action():
    hub = await run_hub([MOTION_AUTOMATION])
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        light = hub.registry.get("demo.light_livingroom")
        assert light.state["state"] == "on"
        assert light.state["brightness"] == 80
    finally:
        await hub.stop()


async def test_condition_blocks_action():
    hub = await run_hub([MOTION_AUTOMATION])
    try:
        # Licht ist schon an → Bedingung (equals "off") schlägt fehl.
        await hub.integrations.dispatch_command(
            "demo.light_livingroom", "turn_on", {"brightness": 30}
        )
        await settle()
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["brightness"] == 30
    finally:
        await hub.stop()


async def test_from_filter():
    automation = {
        "id": "off_to_on_only",
        "trigger": [
            {"type": "state", "entity_id": "demo.switch_coffee", "from": "on", "to": "off"}
        ],
        "action": [
            {"type": "command", "entity_id": "demo.light_bedroom", "command": "turn_on"}
        ],
    }
    hub = await run_hub([automation])
    try:
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_bedroom").state["state"] == "off"

        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_off")
        await settle()
        assert hub.registry.get("demo.light_bedroom").state["state"] == "on"
    finally:
        await hub.stop()


def test_crosses_threshold_only_on_the_step_over():
    from homepilot.core.automation import crosses_threshold

    # Tumbler fertig: Leistung fällt unter 5 W.
    assert crosses_threshold(1450.0, 2.1, below=5) is True
    # Schwankungen unterhalb der Schwelle lösen nicht erneut aus.
    assert crosses_threshold(2.1, 2.0, below=5) is False
    # Anlaufen: über die Schwelle.
    assert crosses_threshold(2.0, 1450.0, above=5) is True
    assert crosses_threshold(1400.0, 1450.0, above=5) is False
    # Unbekannter Vorzustand zählt nicht als Übertritt.
    assert crosses_threshold(None, 2.0, below=5) is False
    assert crosses_threshold("unknown", 2.0, below=5) is False


async def test_threshold_trigger_fires_once_per_crossing():
    automation = {
        "id": "tumbler_fertig",
        "trigger": [
            {
                "type": "state",
                "entity_id": "demo.light_bedroom",
                "attribute": "brightness",
                "below": 5,
            }
        ],
        "action": [
            {"type": "command", "entity_id": "demo.switch_coffee", "command": "turn_on"}
        ],
    }
    hub = await run_hub([automation])
    try:
        await hub.registry.update_state("demo.light_bedroom", {"brightness": 80})
        await settle()
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"

        await hub.registry.update_state("demo.light_bedroom", {"brightness": 2})
        await settle()
        assert hub.registry.get("demo.switch_coffee").state["state"] == "on"

        # Weiter unterhalb der Schwelle: kein zweites Auslösen.
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_off")
        await hub.registry.update_state("demo.light_bedroom", {"brightness": 1})
        await settle()
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
    finally:
        await hub.stop()


def test_conditions_are_combined_with_and_by_default():
    """Zwei Bedingungen heissen «beide» – so hat es der Ablauf immer
    gemeint, und dabei bleibt es ohne ausdrückliche Angabe."""
    automation = Automation(
        id="a",
        alias="Test",
        triggers=[],
        conditions=[
            {"type": "state", "entity_id": "demo.a", "equals": "on"},
            {"type": "state", "entity_id": "demo.b", "equals": "on"},
        ],
    )
    assert automation.match == "all"
    assert automation.as_config()["match"] == "all"


def test_match_any_is_read_from_the_config():
    parsed = parse_automations(
        [
            {
                "id": "a",
                "alias": "Test",
                "trigger": [],
                "condition": [{"type": "state", "entity_id": "demo.a", "equals": "on"}],
                "match": "any",
            }
        ]
    )
    assert parsed[0].match == "any"
    # Unsinn fällt auf «all» zurück – die vorsichtigere Variante.
    assert parse_automations([{"id": "b", "alias": "B", "match": "quatsch"}])[0].match == "all"


async def test_match_any_runs_when_one_condition_holds():
    """«oder»: Eine erfüllte Bedingung genügt. Mit «und» bliebe der Ablauf
    hier stehen, weil die zweite Bedingung nicht stimmt."""
    hub = await run_hub(
        [
            {
                **MOTION_AUTOMATION,
                "match": "any",
                "condition": [
                    {"type": "state", "entity_id": "demo.light_livingroom", "equals": "off"},
                    {"type": "state", "entity_id": "demo.switch_coffee", "equals": "on"},
                ],
            }
        ]
    )
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
    finally:
        await hub.stop()


async def test_match_any_stays_quiet_when_none_holds():
    hub = await run_hub(
        [
            {
                **MOTION_AUTOMATION,
                "match": "any",
                "condition": [
                    {"type": "state", "entity_id": "demo.light_livingroom", "equals": "on"},
                    {"type": "state", "entity_id": "demo.switch_coffee", "equals": "on"},
                ],
            }
        ]
    )
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
    finally:
        await hub.stop()


async def test_the_same_button_works_more_than_once():
    """Der gemeldete Fall: Ein Wandtaster hat genau einmal funktioniert.

    Beim zweiten Druck steht wieder «short» da – die Prüfung «hat sich
    etwas geändert?» hat ihn verworfen. Ein Taster meldet aber Ereignisse,
    keinen Zustand: Zweimal drücken sind zwei Ereignisse.
    """
    hub = await run_hub(
        [
            {
                "id": "taster",
                "alias": "Licht umschalten",
                "trigger": [
                    {"type": "state", "entity_id": "test.taster", "to": "short"}
                ],
                "action": [
                    {
                        "type": "command",
                        "entity_id": "demo.light_livingroom",
                        "command": "toggle",
                    }
                ],
            }
        ]
    )
    try:
        await hub.registry.add(
            Entity(
                id="test.taster",
                kind=EntityKind.BUTTON,
                name="Wandtaster",
                integration="test",
                state={"state": "unknown"},
            )
        )
        light = "demo.light_livingroom"
        await hub.integrations.dispatch_command(light, "turn_off")
        await settle()

        await hub.registry.update_state("test.taster", {"state": "short", "last_press": 1.0})
        await settle()
        assert hub.registry.get(light).state["state"] == "on"

        # Zweiter Druck auf dieselbe Taste – derselbe Wert, neuer Zeitpunkt.
        await hub.registry.update_state("test.taster", {"state": "short", "last_press": 2.0})
        await settle()
        assert hub.registry.get(light).state["state"] == "off"

        # Und ein dritter, damit es nicht am Zufall liegt.
        await hub.registry.update_state("test.taster", {"state": "short", "last_press": 3.0})
        await settle()
        assert hub.registry.get(light).state["state"] == "on"
    finally:
        await hub.stop()


async def test_an_unchanged_state_still_does_not_trigger():
    """Die Regel bleibt, wo sie hingehört: Ein Licht, dessen Helligkeit sich
    ändert, während es an bleibt, löst «geht an» nicht erneut aus."""
    hub = await run_hub(
        [
            {
                "id": "an",
                "alias": "Licht ging an",
                "trigger": [
                    {"type": "state", "entity_id": "demo.light_livingroom", "to": "on"}
                ],
                "action": [
                    {
                        "type": "command",
                        "entity_id": "demo.switch_coffee",
                        "command": "turn_on",
                    }
                ],
            }
        ]
    )
    try:
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_off")
        await hub.integrations.dispatch_command(
            "demo.light_livingroom", "turn_on", {"brightness": 40}
        )
        await settle()
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_off")
        await settle()
        # Nur die Helligkeit ändert sich – der Zustand bleibt «on».
        await hub.integrations.dispatch_command(
            "demo.light_livingroom", "turn_on", {"brightness": 90}
        )
        await settle()
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
    finally:
        await hub.stop()


def test_describe_condition_names_the_actual_value():
    """«Bedingung 2 war falsch» hilft niemandem – man will die Zahl sehen."""
    assert describe_condition(
        {"type": "state", "entity_id": "Helligkeit", "below": 30}, 44
    ) == "Helligkeit ist «44», verlangt ist unter 30"
    assert describe_condition(
        {"type": "state", "entity_id": "Anwesend", "above": 0}, 0
    ) == "Anwesend ist «0», verlangt ist über 0"
    assert describe_condition(
        {"type": "state", "entity_id": "Licht", "equals": "off"}, "on"
    ) == "Licht ist «on», verlangt ist «off»"
    assert "01:00" in describe_condition(
        {"type": "time", "after": "01:00", "before": "06:00"}, None
    )
    assert describe_condition({"type": "sun", "state": "down"}, None) == "Es ist nicht Nacht"
    # Ein Gerät, das es nicht gibt, meldet «nichts» statt eines leeren Werts.
    assert "nichts" in describe_condition(
        {"type": "state", "entity_id": "Weg", "equals": "on"}, None
    )


async def test_a_blocked_run_is_logged_with_the_reason():
    """Der Support-Fall «der Ablauf geht nicht»: Man muss sehen können, dass
    er lief und woran es lag."""
    hub = await run_hub([MOTION_AUTOMATION])
    try:
        # Licht ist an → Bedingung (equals "off") schlägt fehl.
        await hub.integrations.dispatch_command("demo.light_livingroom", "turn_on")
        await settle()
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()

        runs = hub.automations.runs
        assert runs and runs[0]["alias"] == "Licht bei Bewegung"
        assert runs[0]["executed"] is False
        assert runs[0]["skipped"] == [
            'demo.light_livingroom ist «on», verlangt ist «off»'
        ]
    finally:
        await hub.stop()


async def test_a_disabled_automation_stays_quiet():
    """Ausschalten statt löschen: Im Sommer nicht gebraucht heisst nicht,
    dass man ihn im Winter neu bauen will."""
    hub = await run_hub([{**MOTION_AUTOMATION, "enabled": False}])
    try:
        await hub.integrations.dispatch_command("demo.light_livingroom", "turn_off")
        await settle()
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
        assert hub.automations.runs == []
    finally:
        await hub.stop()


def test_a_notification_can_carry_the_picture_of_the_doorbell_camera():
    """Wenn es klingelt, will man sehen wer da steht – nicht erst die App
    öffnen, bis der Besucher weg ist."""

    async def check():
        hub = Hub(
            HubConfig(
                api=ApiConfig(),
                integrations=[{"integration": "demo"}],
                automations=[],
                push={"public_url": "https://haus.example.ch"},
            )
        )
        await hub.start()
        try:
            await hub.registry.add(
                Entity(
                    id="test.klingel_cam",
                    kind=EntityKind.CAMERA,
                    name="Haustür",
                    integration="test",
                    state={"state": "online"},
                )
            )

            async def fake_snapshot(entity):
                return b"\xff\xd8\xff\xe0 jemand steht vor der Tuer"

            echt = hub.integrations.get
            hub.integrations.get = lambda name: (  # type: ignore[assignment]
                type("I", (), {"snapshot": staticmethod(fake_snapshot)})()
                if name == "test"
                else echt(name)
            )

            sent: list[dict] = []

            async def fake_send(tokens, title, body, data=None, image=None):
                sent.append({"title": title, "data": data, "image": image})
                return len(tokens)

            hub.push.send = fake_send  # type: ignore[assignment]
            hub.push.register("ExponentPushToken[x]", "Stefan")

            automation = Automation(id="a", alias="Es klingelt", triggers=[], actions=[])
            await hub.automations._notify(
                automation,
                {
                    "type": "notify",
                    "title": "Es klingelt",
                    "body": "Haustür",
                    "camera": "test.klingel_cam",
                },
            )

            assert len(sent) == 1
            assert sent[0]["image"].startswith("https://haus.example.ch/api/push/image/")
            # Und beim Antippen findet die App dieselbe Kamera.
            assert sent[0]["data"]["camera"] == "test.klingel_cam"

            token = sent[0]["image"].rsplit("/", 1)[-1]
            assert hub.snapshots.get(token) == b"\xff\xd8\xff\xe0 jemand steht vor der Tuer"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_a_notification_without_a_camera_stays_as_it_was():
    """Der Normalfall darf sich durch die Zugabe nicht ändern."""

    async def check():
        hub = Hub(
            HubConfig(
                api=ApiConfig(),
                integrations=[{"integration": "demo"}],
                automations=[],
                push={"public_url": "https://haus.example.ch"},
            )
        )
        await hub.start()
        try:
            sent: list[dict] = []

            async def fake_send(tokens, title, body, data=None, image=None):
                sent.append({"data": data, "image": image})
                return len(tokens)

            hub.push.send = fake_send  # type: ignore[assignment]
            hub.push.register("ExponentPushToken[x]", "Stefan")

            automation = Automation(id="a", alias="Hinweis", triggers=[], actions=[])
            await hub.automations._notify(automation, {"type": "notify", "body": "Text"})

            assert sent[0]["image"] is None
            assert sent[0]["data"] == {"automation_id": "a"}
            assert len(hub.snapshots) == 0
        finally:
            await hub.stop()

    asyncio.run(check())


# ── Wochentage ─────────────────────────────────────────────────────────────


def test_weekdays_are_read_leniently():
    from homepilot.core.automation import parse_weekdays

    assert parse_weekdays([0, 1, "2"]) == {0, 1, 2}
    # Unsinn fliegt raus, statt den Ablauf stumm zu schalten.
    assert parse_weekdays([9, -1, "Montag", None]) == set()
    assert parse_weekdays(None) == set()


def test_weekday_labels_read_like_a_human_wrote_them():
    from homepilot.core.automation import weekday_label

    assert weekday_label({0, 1, 2, 3, 4}) == "Werktage"
    assert weekday_label({5, 6}) == "Wochenende"
    assert weekday_label({0, 2}) == "Mo, Mi"
    assert weekday_label(set()) == "jeden Tag"


def test_a_typo_in_the_weekdays_lets_the_automation_run_not_starve():
    """Ein Ablauf, der zu oft läuft, fällt auf. Einer, der stumm bleibt,
    wird erst im Winter vermisst."""

    async def check():
        hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
        await hub.start()
        try:
            engine = hub.automations
            assert engine._check_condition({"type": "time", "weekdays": ["Montag"]})
        finally:
            await hub.stop()

    asyncio.run(check())


def test_the_weekday_decides_before_the_clock():
    async def check():
        hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
        await hub.start()
        try:
            import datetime as dt

            heute = dt.datetime.now().weekday()
            morgen = (heute + 1) % 7
            engine = hub.automations
            assert engine._check_condition({"type": "time", "weekdays": [heute]})
            assert not engine._check_condition({"type": "time", "weekdays": [morgen]})
        finally:
            await hub.stop()

    asyncio.run(check())


# ── «Sonst»-Zweig ──────────────────────────────────────────────────────────


def test_the_otherwise_branch_runs_when_the_condition_fails():
    """Sonst bräuchte «sonst mach das andere» zwei Abläufe mit
    gegenteiliger Bedingung, die man beim Ändern beide anfassen muss."""

    async def check():
        hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
        await hub.start()
        try:
            automation = Automation(
                id="a",
                alias="Licht je nach Sonne",
                triggers=[],
                conditions=[
                    {"type": "state", "entity_id": "demo.light_livingroom", "equals": "on"}
                ],
                actions=[
                    {"type": "command", "entity_id": "demo.switch_coffee", "command": "turn_on"}
                ],
                otherwise=[
                    {"type": "command", "entity_id": "demo.switch_coffee", "command": "turn_off"}
                ],
            )
            hub.automations.automations = [automation]

            # Lampe ist aus → «sonst» greift.
            await hub.automations._run(automation)
            assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
            # Und der Lauf gilt als ausgeführt, nicht als übersprungen.
            assert hub.automations.runs[0]["executed"] is True

            await hub.registry.update_state("demo.light_livingroom", {"state": "on"})
            await hub.automations._run(automation)
            assert hub.registry.get("demo.switch_coffee").state["state"] == "on"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_without_an_otherwise_branch_nothing_changes():
    async def check():
        hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
        await hub.start()
        try:
            automation = Automation(
                id="a",
                alias="nur wenn",
                triggers=[],
                conditions=[
                    {"type": "state", "entity_id": "demo.light_livingroom", "equals": "on"}
                ],
                actions=[
                    {"type": "command", "entity_id": "demo.switch_coffee", "command": "turn_on"}
                ],
            )
            await hub.automations._run(automation)
            assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
            assert hub.automations.runs[0]["executed"] is False
            assert hub.automations.runs[0]["skipped"]
        finally:
            await hub.stop()

    asyncio.run(check())


# ── «Warten bis» ───────────────────────────────────────────────────────────


def test_waiting_stops_as_soon_as_the_condition_holds():
    async def check():
        hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
        await hub.start()
        try:
            automation = Automation(id="a", alias="warten", triggers=[], actions=[])

            async def spaeter():
                await asyncio.sleep(0.05)
                await hub.registry.update_state("demo.light_livingroom", {"state": "on"})

            asyncio.create_task(spaeter())
            import homepilot.core.automation as modul

            modul.WAIT_POLL = 0.01
            await hub.automations._wait_until(
                automation,
                {
                    "type": "wait_until",
                    "entity_id": "demo.light_livingroom",
                    "equals": "on",
                    "timeout": 5,
                },
            )
            assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_waiting_gives_up_instead_of_blocking_forever():
    """Ohne Frist bliebe der Ablauf stehen, wenn die Tür offen bleibt – und
    blockierte damit jeden weiteren Lauf desselben Ablaufs."""

    async def check():
        hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
        await hub.start()
        try:
            import homepilot.core.automation as modul

            modul.WAIT_POLL = 0.01
            automation = Automation(id="a", alias="warten", triggers=[], actions=[])
            await asyncio.wait_for(
                hub.automations._wait_until(
                    automation,
                    {
                        "type": "wait_until",
                        "entity_id": "demo.light_livingroom",
                        "equals": "on",
                        "timeout": 1,
                    },
                ),
                timeout=3,
            )
            # Die Lampe ist immer noch aus – aufgegeben, nicht hängengeblieben.
            assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
        finally:
            await hub.stop()

    asyncio.run(check())


# ── Trockenlauf ────────────────────────────────────────────────────────────


def test_actions_are_described_in_readable_german():
    from homepilot.core.automation import describe_action

    namen = {"demo.light_livingroom": "Stehlampe"}.get
    assert (
        describe_action(
            {"type": "command", "entity_id": "demo.light_livingroom",
             "command": "turn_on", "data": {"brightness": 40}},
            namen,
        )
        == "Stehlampe: turn_on auf 40 %"
    )
    assert describe_action({"type": "delay", "seconds": 30}) == "30 Sekunden warten"
    assert describe_action({"type": "scene", "scene": "Kino"}) == "Szene «Kino»"
    assert (
        describe_action(
            {"type": "wait_until", "entity_id": "demo.light_livingroom",
             "equals": "off", "timeout": 60},
            namen,
        )
        == "warten bis Stehlampe «off» ist (höchstens 60 s)"
    )
    assert "mit Kamerabild" in describe_action(
        {"type": "notify", "title": "Es klingelt", "camera": "cam.tuer"}
    )


def test_the_dry_run_changes_nothing():
    """Genau das ist der Punkt: Der Testlauf über /trigger fährt die Storen
    wirklich aus."""

    async def check():
        hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
        await hub.start()
        try:
            automation = Automation(
                id="a",
                alias="Kaffee",
                triggers=[],
                conditions=[
                    {"type": "state", "entity_id": "demo.light_livingroom", "equals": "on"}
                ],
                actions=[
                    {"type": "command", "entity_id": "demo.switch_coffee", "command": "turn_on"}
                ],
                otherwise=[{"type": "delay", "seconds": 5}],
            )

            result = hub.automations.dry_run(automation)
            assert result["conditions_hold"] is False
            assert result["branch"] == "sonst"
            assert result["would_run"] == ["5 Sekunden warten"]
            assert result["skipped"]
            # Und nichts wurde geschaltet.
            assert hub.registry.get("demo.switch_coffee").state["state"] == "off"

            await hub.registry.update_state("demo.light_livingroom", {"state": "on"})
            result = hub.automations.dry_run(automation)
            assert result["conditions_hold"] is True
            assert result["branch"] == "aktionen"
            # Der Anzeigename statt der Kennung – man soll es lesen können.
            assert "turn_on" in result["would_run"][0]
            assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
        finally:
            await hub.stop()

    asyncio.run(check())


# ── Erneut ausgelöst, während der Ablauf noch wartet ────────────────────────
#
# Das Bewegungslicht: an bei Bewegung, nach einer Weile wieder aus. Was
# passiert, wenn während dieser Weile noch jemand durchgeht, ist eine
# Entscheidung und keine Nebensache - beide Antworten sind für sich
# richtig, nur eben in verschiedenen Räumen.


def motion_light(mode: str | None = None, seconds: float = 0.2) -> dict:
    """Bewegung → Licht an, warten, Licht aus."""
    automation = {
        "id": "bewegungslicht",
        "alias": "Bewegungslicht Flur",
        "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
        "action": [
            {"type": "command", "entity_id": "demo.light_livingroom", "command": "turn_on"},
            {"type": "delay", "seconds": seconds},
            {"type": "command", "entity_id": "demo.light_livingroom", "command": "turn_off"},
        ],
    }
    if mode is not None:
        automation["mode"] = mode
    return automation


async def move(hub) -> None:
    """Eine Bewegung melden – auch die zweite, kurz nach der ersten."""
    await hub.registry.update_state("demo.motion_hall", {"state": "off"})
    await hub.registry.update_state("demo.motion_hall", {"state": "on"})
    await settle()


def light_state(hub) -> str:
    return hub.registry.get("demo.light_livingroom").state["state"]


async def test_mode_single_keeps_the_first_wait():
    """Vorgabe: Das Licht geht aus, wann es die erste Bewegung sagt.

    Für einen Durchgangsraum das Gewünschte – dort will man kein Licht,
    das sich immer weiter selbst verlängert.
    """
    hub = await run_hub([motion_light()])
    try:
        await move(hub)
        assert light_state(hub) == "on"

        # Zweite Bewegung mitten in der Wartezeit: wird verworfen.
        await asyncio.sleep(0.1)
        await move(hub)
        assert light_state(hub) == "on"

        # 0.2 s nach der *ersten* Bewegung ist Schluss, nicht nach der zweiten.
        await asyncio.sleep(0.2)
        assert light_state(hub) == "off"
    finally:
        await hub.stop()


async def test_mode_restart_begins_the_wait_again():
    """«restart»: Solange sich etwas rührt, bleibt das Licht an."""
    hub = await run_hub([motion_light(mode="restart")])
    try:
        await move(hub)
        assert light_state(hub) == "on"

        await asyncio.sleep(0.15)
        await move(hub)

        # Wäre die erste Wartezeit weitergelaufen, wäre hier schon aus.
        await asyncio.sleep(0.1)
        assert light_state(hub) == "on"

        await asyncio.sleep(0.2)
        assert light_state(hub) == "off"
    finally:
        await hub.stop()


async def test_without_a_wait_the_light_simply_stays_on():
    """Keine Zeit angegeben = niemand schaltet aus.

    Das ist kein Sonderfall im Code, sondern das Fehlen der beiden
    Schritte: Der Ablauf ist nach dem Einschalten fertig.
    """
    automation = {
        "id": "bewegungslicht_ohne_zeit",
        "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
        "action": [
            {"type": "command", "entity_id": "demo.light_livingroom", "command": "turn_on"}
        ],
    }
    hub = await run_hub([automation])
    try:
        await move(hub)
        assert light_state(hub) == "on"
        await asyncio.sleep(0.3)
        assert light_state(hub) == "on"
    finally:
        await hub.stop()


async def test_a_restarted_run_stays_in_the_history():
    """Der abgebrochene Lauf verschwindet nicht aus dem Protokoll.

    Sonst stünde im Verlauf nur der letzte – und die Frage «wann ging das
    Licht eigentlich an?» bliebe unbeantwortet.
    """
    hub = await run_hub([motion_light(mode="restart")])
    try:
        await move(hub)
        await asyncio.sleep(0.05)
        # Schon jetzt steht der abgebrochene Lauf im Protokoll - er hat ja
        # etwas getan, auch wenn er sein Ende nie erreicht.
        await move(hub)
        await asyncio.sleep(0.05)
        assert len(hub.automations.runs) == 1
        # Und der Nachfolger kommt dazu, sobald er durch ist.
        await asyncio.sleep(0.25)
        runs = [run for run in hub.automations.runs if run["automation_id"] == "bewegungslicht"]
        assert len(runs) == 2
        assert all(run["executed"] and not run["error"] for run in runs)
    finally:
        await hub.stop()


def test_mode_is_parsed_conservatively():
    """Nur «restart» bricht ab – ein Tippfehler tut nichts Unerwartetes."""
    assert parse_automations([{"id": "a"}])[0].mode == "single"
    assert parse_automations([{"id": "a", "mode": "restart"}])[0].mode == "restart"
    assert parse_automations([{"id": "a", "mode": "neustart"}])[0].mode == "single"
    assert parse_automations([{"id": "a", "mode": "restart"}])[0].as_config()["mode"] == "restart"
