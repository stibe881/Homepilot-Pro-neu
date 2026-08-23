import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.errors import ConfigError, HomePilotError
from homepilot.core.hub import Hub
from homepilot.core.scenes import parse_scenes

KINO = {
    "id": "kino",
    "name": "Kino",
    "actions": [
        {"entity_id": "demo.light_livingroom", "command": "set_brightness",
         "data": {"brightness": 15}},
        {"entity_id": "demo.switch_coffee", "command": "turn_off"},
    ],
}


async def make_hub(scenes):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            scenes=scenes,
        )
    )
    await hub.start()
    return hub


def test_parse_requires_entity_and_command():
    with pytest.raises(ConfigError, match="entity_id"):
        parse_scenes([{"id": "x", "actions": [{"command": "turn_on"}]}])


async def test_activate_runs_all_actions():
    hub = await make_hub([KINO])
    try:
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
        result = await hub.scenes.activate("kino")

        assert result["failed"] == []
        light = hub.registry.get("demo.light_livingroom")
        assert light.state["brightness"] == 15
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
    finally:
        await hub.stop()


async def test_broken_action_does_not_stop_the_scene():
    """Ein defektes Gerät darf die restliche Szene nicht verhindern."""
    scene = {
        "id": "abend",
        "actions": [
            {"entity_id": "gibt.es.nicht", "command": "turn_on"},
            {"entity_id": "demo.light_bedroom", "command": "turn_on"},
        ],
    }
    hub = await make_hub([scene])
    try:
        result = await hub.scenes.activate("abend")
        assert len(result["failed"]) == 1
        assert result["failed"][0]["entity_id"] == "gibt.es.nicht"
        assert hub.registry.get("demo.light_bedroom").state["state"] == "on"
    finally:
        await hub.stop()


async def test_unknown_scene_raises():
    hub = await make_hub([])
    try:
        with pytest.raises(HomePilotError):
            await hub.scenes.activate("gibtsnicht")
    finally:
        await hub.stop()


async def test_scene_is_recorded_as_source():
    """Die App soll zeigen können, dass eine Szene geschaltet hat."""
    hub = await make_hub([KINO])
    sources = []
    hub.bus.subscribe("state_changed", lambda t, d: sources.append(d["source"]))
    try:
        await hub.scenes.activate("kino")
        assert sources
        assert all(source["kind"] == "scene" for source in sources)
        assert sources[0]["label"] == "Kino"
    finally:
        await hub.stop()


def test_ramp_hits_the_target_exactly():
    """Eine Rampe, die bei 97 % endet, wäre ein Fehler, den man abends im
    Bett sieht."""
    from homepilot.core.scenes import ramp

    steps = ramp(0, 100, 30, step=5)
    assert len(steps) == 6
    assert steps[0] == (0.0, 17)
    assert steps[-1] == (5.0, 100)
    # Abwärts genauso.
    assert ramp(100, 0, 20, step=5)[-1][1] == 0
    # Ohne Zeit oder ohne Weg: ein einziger Schritt.
    assert ramp(40, 40, 60) == [(0.0, 40)]
    assert ramp(0, 80, 0) == [(0.0, 80)]


def test_transition_for_lets_one_lamp_be_instant():
    """Beim Lichtwecker kommt das Licht über zwanzig Minuten – die
    Nachttischlampe soll trotzdem sofort angehen."""
    from homepilot.core.scenes import Scene, transition_for

    szene = Scene(id="wecker", name="Wecker", transition=1200)
    langsam = {"entity_id": "hue.decke", "command": "set_brightness", "data": {"brightness": 80}}
    sofort = {
        "entity_id": "hue.nachttisch",
        "command": "set_brightness",
        "data": {"brightness": 30, "transition": 0},
    }
    eigene = {
        "entity_id": "hue.flur",
        "command": "set_brightness",
        "data": {"brightness": 50, "transition": 60},
    }
    assert transition_for(szene, langsam) == 1200
    assert transition_for(szene, sofort) == 0
    assert transition_for(szene, eigene) == 60
    # Unsinn fällt auf die Szene zurück, statt die Rampe zu zerlegen.
    kaputt = {"entity_id": "x", "command": "set_brightness", "data": {"transition": "gleich"}}
    assert transition_for(szene, kaputt) == 1200


async def test_der_zweite_druck_nimmt_die_szene_zurueck():
    """Und zwar nur, was sie geändert hat.

    Die Kaffeemaschine war schon aus - «Kino» hat an ihr nichts getan,
    also darf der Rückweg sie nicht einschalten. Sonst liefe sie nach
    dem Film, weil man einen Knopf gedrückt hat, der «rückgängig» heisst.
    """
    hub = await make_hub([KINO])
    try:
        await hub.integrations.dispatch_command(
            "demo.light_livingroom", "set_brightness", {"brightness": 80}
        )
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_off")

        await hub.scenes.activate("kino")
        licht = hub.registry.get("demo.light_livingroom")
        assert licht.state["brightness"] == 15
        assert hub.scenes.ist_aktiv(hub.scenes.get("kino")) is True

        await hub.scenes.toggle("kino")
        licht = hub.registry.get("demo.light_livingroom")
        assert licht.state["brightness"] == 80
        # Die Kaffeemaschine ist nicht angegangen.
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
        # Und der Rückweg ist verbraucht.
        assert hub.scenes.undo_fuer("kino") == []
    finally:
        await hub.stop()


async def test_von_hand_eingegriffen_heisst_szene_verlassen():
    """Dann leuchtet der Knopf nicht mehr, und der nächste Druck löst aus."""
    hub = await make_hub([KINO])
    try:
        await hub.scenes.activate("kino")
        assert hub.scenes.ist_aktiv(hub.scenes.get("kino")) is True

        await hub.integrations.dispatch_command("demo.light_livingroom", "turn_off")
        assert hub.scenes.ist_aktiv(hub.scenes.get("kino")) is False

        # Der zweite Druck löst deshalb aus statt zurückzunehmen.
        await hub.scenes.toggle("kino")
        assert hub.registry.get("demo.light_livingroom").state["brightness"] == 15
    finally:
        await hub.stop()


async def test_zuruecknehmen_ohne_gespeicherten_weg_sagt_das():
    hub = await make_hub([KINO])
    try:
        with pytest.raises(HomePilotError, match="zum Zurücknehmen"):
            await hub.scenes.revert("kino")
    finally:
        await hub.stop()


async def test_eine_handlung_bleibt_nicht_aktiv():
    """«Alles aus» ist keine Szene, die gilt – sie ist etwas, das man tut.

    Ein Knopf, der danach leuchtet und beim nächsten Druck das halbe
    Haus wieder anschaltet, wäre dort das Gegenteil von hilfreich.
    """
    handlung = {**KINO, "id": "alles_aus", "name": "Alles aus", "toggles": False}
    hub = await make_hub([handlung])
    try:
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
        await hub.scenes.activate("alles_aus")
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"

        # Kein Leuchten, kein Rückweg.
        assert hub.scenes.ist_aktiv(hub.scenes.get("alles_aus")) is False
        assert hub.scenes.undo_fuer("alles_aus") == []
        with pytest.raises(HomePilotError, match="löst nur aus"):
            await hub.scenes.revert("alles_aus")

        # Und der zweite Druck löst schlicht noch einmal aus.
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
        await hub.scenes.toggle("alles_aus")
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
    finally:
        await hub.stop()


def test_toggles_ist_voreingestellt_an():
    """Der Umschalter ist das nützlichere Verhalten – wer es nicht will,
    hakt es beim Anlegen ab."""
    from homepilot.core.scenes import parse_scenes

    (szene,) = parse_scenes([{"id": "x", "actions": []}])
    assert szene.toggles is True
    (aus,) = parse_scenes([{"id": "x", "actions": [], "toggles": False}])
    assert aus.toggles is False
    assert szene.as_dict()["toggles"] is True
