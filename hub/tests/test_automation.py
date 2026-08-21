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


async def test_a_second_ring_triggers_again():
    """Klingelt es zweimal, läuft der Ablauf zweimal.

    Der Fall aus dem Betrieb: «ring» stand nach dem ersten Mal auf «on» und
    blieb dort hängen - ein Neustart des Hubs mitten in den drei Minuten
    reicht dafür. Beim nächsten Läuten stand wieder «on» da, die Prüfung
    «hat sich etwas geändert?» verwarf es, und die Push blieb aus, ohne
    dass irgendwo ein Fehler stand.
    """
    hub = await run_hub(
        [
            {
                "id": "klingel",
                "alias": "Es klingelt",
                "trigger": [
                    {
                        "type": "state",
                        "entity_id": "test.klingel",
                        "attribute": "ring",
                        "to": "on",
                    }
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
                id="test.klingel",
                kind=EntityKind.CAMERA,
                name="Haustüre",
                integration="test",
                state={"state": "online", "ring": "on", "last_ring": "10:00"},
            )
        )
        light = "demo.light_livingroom"
        await hub.integrations.dispatch_command(light, "turn_off")
        await settle()

        # «ring» steht schon auf «on» – nur der Zeitpunkt ist neu.
        await hub.registry.update_state(
            "test.klingel", {"ring": "on", "last_ring": "10:05"}
        )
        await settle()
        assert hub.registry.get(light).state["state"] == "on"

        await hub.registry.update_state(
            "test.klingel", {"ring": "on", "last_ring": "10:09"}
        )
        await settle()
        assert hub.registry.get(light).state["state"] == "off"
    finally:
        await hub.stop()


async def test_a_ring_does_not_trigger_an_unrelated_state_rule():
    """Der Zeitstempel gilt nur für sein eigenes Feld.

    Sonst liesse ein Klingeln jeden Ablauf loslaufen, der auf «Gerät ist
    online» wartet - dort hat sich nichts geändert.
    """
    hub = await run_hub(
        [
            {
                "id": "online",
                "alias": "Kamera ist online",
                "trigger": [
                    {"type": "state", "entity_id": "test.klingel", "to": "online"}
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
        await hub.registry.add(
            Entity(
                id="test.klingel",
                kind=EntityKind.CAMERA,
                name="Haustüre",
                integration="test",
                state={"state": "online", "ring": "off"},
            )
        )
        light = "demo.light_livingroom"
        await hub.integrations.dispatch_command(light, "turn_off")
        await settle()

        await hub.registry.update_state(
            "test.klingel", {"ring": "on", "last_ring": "10:05"}
        )
        await settle()
        assert hub.registry.get(light).state["state"] == "off"
    finally:
        await hub.stop()


async def test_motion_light_stays_on_while_there_is_movement():
    """Treppenhauslicht: Die Nachlaufzeit zählt ab der letzten Bewegung.

    Genau der Fall, für den es «mode: restart» gibt. Ohne ihn wurde der
    zweite Auslöser verworfen, weil der Ablauf noch in seiner Wartezeit
    stand - und das Licht ging nach der Zeit ab der *ersten* Bewegung
    aus, mitten im Betrieb.
    """
    hub = await run_hub(
        [
            {
                "id": "bewegungslicht",
                "alias": "Licht bei Bewegung",
                "mode": "restart",
                "trigger": [
                    {"type": "state", "entity_id": "test.melder", "to": "on"}
                ],
                "action": [
                    {
                        "type": "command",
                        "entity_id": "demo.light_livingroom",
                        "command": "turn_on",
                    },
                    # Im Test Sekundenbruchteile statt vier Minuten.
                    {"type": "delay", "seconds": 0.3},
                    {
                        "type": "command",
                        "entity_id": "demo.light_livingroom",
                        "command": "turn_off",
                    },
                ],
            }
        ]
    )
    try:
        await hub.registry.add(
            Entity(
                id="test.melder",
                kind=EntityKind.BINARY_SENSOR,
                name="Bewegung Eingang",
                integration="test",
                state={"state": "off"},
            )
        )
        licht = "demo.light_livingroom"
        await hub.integrations.dispatch_command(licht, "turn_off")
        await settle()

        # Erste Bewegung: Licht an, Nachlauf beginnt.
        await hub.registry.update_state("test.melder", {"state": "on"})
        await settle()
        assert hub.registry.get(licht).state["state"] == "on"

        # Nach der halben Wartezeit neue Bewegung – der Nachlauf beginnt
        # von vorn, das Licht bleibt an.
        await asyncio.sleep(0.15)
        await hub.registry.update_state("test.melder", {"state": "off"})
        await hub.registry.update_state("test.melder", {"state": "on"})
        await settle()
        # Nach der ursprünglichen Wartezeit müsste es ohne Nachlauf
        # bereits dunkel sein.
        await asyncio.sleep(0.2)
        assert hub.registry.get(licht).state["state"] == "on"

        # Bleibt es ruhig, geht es aus.
        await asyncio.sleep(0.25)
        assert hub.registry.get(licht).state["state"] == "off"
    finally:
        await hub.stop()


async def test_without_the_mode_a_second_trigger_is_still_ignored():
    """Die Vorgabe bleibt, wo sie hingehört: einmal ist einmal.

    Eine Nachricht soll nicht doppelt kommen, bloss weil sich etwas
    zweimal geregt hat.
    """
    hub = await run_hub(
        [
            {
                "id": "einmal",
                "alias": "Nur einmal",
                "trigger": [
                    {"type": "state", "entity_id": "test.melder", "to": "on"}
                ],
                "action": [
                    {"type": "delay", "seconds": 0.3},
                    {
                        "type": "command",
                        "entity_id": "demo.light_livingroom",
                        "command": "toggle",
                    },
                ],
            }
        ]
    )
    try:
        await hub.registry.add(
            Entity(
                id="test.melder",
                kind=EntityKind.BINARY_SENSOR,
                name="Bewegung Eingang",
                integration="test",
                state={"state": "off"},
            )
        )
        licht = "demo.light_livingroom"
        await hub.integrations.dispatch_command(licht, "turn_off")
        await settle()

        await hub.registry.update_state("test.melder", {"state": "on"})
        await settle()
        await asyncio.sleep(0.1)
        await hub.registry.update_state("test.melder", {"state": "off"})
        await hub.registry.update_state("test.melder", {"state": "on"})
        await settle()
        await asyncio.sleep(0.4)
        # Genau ein Umschalten, nicht zwei.
        assert hub.registry.get(licht).state["state"] == "on"
    finally:
        await hub.stop()
