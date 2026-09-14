import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.errors import ConfigError, HomePilotError
from homepilot.core.hub import Hub
from homepilot.core.scenes import MAX_WAIT, parse_scenes, warte_dauer

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


def test_parse_erlaubt_einen_warte_schritt_ohne_entitaet():
    """Der einzige Aktion, die keine Entität braucht (Punkt 658)."""
    szenen = parse_scenes(
        [
            {
                "id": "x",
                "actions": [
                    {"entity_id": "demo.light_livingroom", "command": "turn_on"},
                    {"command": "wait", "data": {"seconds": 5}},
                ],
            }
        ]
    )
    assert szenen[0].actions[1]["command"] == "wait"
    # Der Warte-Schritt trägt keine Entität - er taucht darum auch nicht
    # als "None" in entity_ids auf.
    assert szenen[0].as_dict()["entity_ids"] == ["demo.light_livingroom"]


def test_parse_verlangt_trotzdem_ein_kommando():
    with pytest.raises(ConfigError, match="entity_id"):
        parse_scenes([{"id": "x", "actions": [{"entity_id": "demo.light_livingroom"}]}])


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


async def test_fremde_szene_merkt_sich_den_zustand_und_nimmt_zurueck():
    """Die Hue-Szene als Umschalter - was die Bridge nicht kann.

    Sie kann eine Szene aufrufen, aber nicht zurücknehmen: Sie kennt kein
    «vorher». Der Hub hält vor dem Aufrufen fest, wie die Lampen standen,
    und der zweite Druck stellt genau das wieder her.
    """
    hub = await make_hub([])
    try:
        lampe = hub.registry.get("demo.light_livingroom")
        await hub.integrations.dispatch_command(lampe.id, "turn_off")
        szene = Entity(
            id="hue.scene_s1",
            kind=EntityKind.SCENE,
            name="Entspannen",
            integration="hue",
            state={"state": "idle", "lights": [lampe.id]},
            commands=["activate"],
        )
        await hub.registry.add(szene)

        # Erster Druck: Zustand merken. Das «activate» selbst geht ins
        # Leere - die Integration «hue» läuft in diesem Test nicht -,
        # und genau das ist in Ordnung: Gemerkt wird trotzdem.
        try:
            await hub.scenes.fremde_szene(hub.registry.get(szene.id))
        except Exception:
            pass
        rueckweg = hub.scenes.undo_fuer(szene.id)
        assert rueckweg and rueckweg[0]["entity_id"] == lampe.id

        # Die Bridge meldet die Szene als geltend, die Lampe brennt.
        await hub.integrations.dispatch_command(lampe.id, "turn_on")
        await hub.registry.update_state(szene.id, {"state": "active"})
        antwort = await hub.scenes.fremde_szene(hub.registry.get(szene.id))
        assert antwort["reverted"] is True
        assert hub.registry.get(lampe.id).state["state"] == "off"
        # Der Rückweg ist verbraucht - ein dritter Druck ruft wieder auf.
        assert hub.scenes.undo_fuer(szene.id) == []
    finally:
        await hub.stop()


async def test_fremde_szene_ohne_gedaechtnis_loest_nur_aus():
    """«Löst nur aus»: kein Rückweg, kein zweiter Druck, der zurücknimmt."""
    hub = await make_hub([])
    try:
        szene = Entity(
            id="hue.scene_s2",
            kind=EntityKind.SCENE,
            name="Gute Nacht",
            integration="hue",
            state={"state": "idle", "lights": ["demo.light_livingroom"]},
            commands=["activate"],
        )
        await hub.registry.add(szene)
        # Über den Weg, den auch die App geht: Der Merker liegt im
        # Meta-Speicher des Hubs, nicht an der Entität selbst - beim
        # nächsten Start baut die Integration sie neu auf.
        await hub.set_entity_meta(szene.id, scene_toggles=False)
        assert hub.registry.get(szene.id).scene_toggles is False
        try:
            await hub.scenes.fremde_szene(hub.registry.get(szene.id))
        except Exception:
            pass
        assert hub.scenes.undo_fuer(szene.id) == []
    finally:
        await hub.stop()


async def test_eine_szene_kann_eine_durchsage_machen(monkeypatch):
    """Gewünscht im Haus: «Bei den Szenen soll man eine Durchsage machen
    können, wenn man einen Speaker auswählt.» (Punkt 657 der Werkbank)

    Dieselbe Rechnung wie ein Ablauf (core/automation.py, Aktionsart
    "broadcast") - nur auf genau den einen Lautsprecher der Aktion statt
    auf eine Liste, und ohne eigenen Aktionstyp: Eine Szene kennt nur
    entity_id/command/data, darum ist "announce" ein Kommando wie jedes
    andere - nur dass es nicht an die Integration geht, sondern an
    `say.speak`.
    """
    from homepilot.core import say

    hub = await make_hub(
        [
            {
                "id": "ansage",
                "name": "Ansage",
                "actions": [
                    {
                        "entity_id": "demo.speaker_kitchen",
                        "command": "announce",
                        "data": {"text": "Es hat geklingelt", "volume": 40},
                    }
                ],
            }
        ]
    )
    gesagt = []

    async def speak(_hub, text, speakers=None, volume=None, base=None, source=None):
        gesagt.append((text, speakers, volume))
        return {"sent": list(speakers or []), "errors": []}

    monkeypatch.setattr(say, "speak", speak)

    try:
        ergebnis = await hub.scenes.activate("ansage")
        assert ergebnis["failed"] == []
        assert gesagt == [("Es hat geklingelt", ["demo.speaker_kitchen"], 40)]
        # Eine Durchsage lässt sich nicht zurücknehmen - kein Rückweg.
        assert hub.scenes.undo_fuer("ansage") == []
    finally:
        await hub.stop()


async def test_eine_durchsage_ohne_text_scheitert_lesbar():
    """Kein stiller Fehlschlag - die Szene meldet, was fehlt."""
    hub = await make_hub(
        [
            {
                "id": "leer",
                "name": "Leer",
                "actions": [
                    {"entity_id": "demo.speaker_kitchen", "command": "announce", "data": {}}
                ],
            }
        ]
    )
    try:
        ergebnis = await hub.scenes.activate("leer")
        assert len(ergebnis["failed"]) == 1
        assert "Text" in ergebnis["failed"][0]["error"]
    finally:
        await hub.stop()


def test_warte_dauer_ignoriert_null_und_unsinn():
    """0 oder nichts heisst: gar nicht warten - kein leerer Leerlauf für
    eine Zahl, die niemand gemeint hat."""
    assert warte_dauer({}) == 0.0
    assert warte_dauer({"seconds": 0}) == 0.0
    assert warte_dauer({"seconds": -5}) == 0.0
    assert warte_dauer({"seconds": "unsinn"}) == 0.0
    assert warte_dauer({"seconds": None}) == 0.0


def test_warte_dauer_ist_gedeckelt():
    """Länger als eine Stunde ist kein Schritt einer Szene mehr, sondern
    ein Ablauf - dieselbe Grenze wie bei der Übergangszeit (Punkt 658)."""
    assert warte_dauer({"seconds": 30}) == 30.0
    assert warte_dauer({"seconds": 999999}) == MAX_WAIT


async def test_eine_szene_kann_zwischen_zwei_aktionen_warten(monkeypatch):
    """Gewünscht im Haus: eine Wartezeit zwischen zwei Aktionsgruppen -
    «Licht aus, warten, Store zu» statt beidem gleichzeitig (Punkt 658).

    `_warten` wird ersetzt statt `asyncio.sleep` selbst - ein
    Hub trägt eigene Hintergrund-Aufgaben (Verbindungsschleifen, Uhren),
    die echtes Warten brauchen; sie global stillzulegen liesse den Test
    hängen, statt ihn schneller zu machen.
    """
    hub = await make_hub(
        [
            {
                "id": "abfolge",
                "name": "Abfolge",
                "actions": [
                    {"entity_id": "demo.switch_coffee", "command": "turn_off"},
                    {"command": "wait", "data": {"seconds": 3}},
                    {"entity_id": "demo.light_livingroom", "command": "turn_on"},
                ],
            }
        ]
    )
    gewartet = []

    async def fake_warten(action) -> None:
        gewartet.append((action.get("data") or {}).get("seconds"))

    monkeypatch.setattr(hub.scenes, "_warten", fake_warten)

    try:
        ergebnis = await hub.scenes.activate("abfolge")
        assert ergebnis["failed"] == []
        assert gewartet == [3]
        assert hub.registry.get("demo.switch_coffee").state["state"] == "off"
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
    finally:
        await hub.stop()


async def test_eine_wartezeit_von_null_wartet_nicht():
    """0 oder nichts heisst: sofort weiter - kein leerer Leerlauf."""
    hub = await make_hub(
        [
            {
                "id": "ohne",
                "name": "Ohne",
                "actions": [
                    {"command": "wait", "data": {"seconds": 0}},
                    {"entity_id": "demo.light_livingroom", "command": "turn_on"},
                ],
            }
        ]
    )
    try:
        ergebnis = await hub.scenes.activate("ohne")
        assert ergebnis["failed"] == []
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
    finally:
        await hub.stop()
