"""Hue-Szenen als Entitäten – mit echtem Hub, ohne Bridge.

Die Netzwerkteile brauchen eine echte Bridge; prüfbar ist hier das, was
danach passiert: dass aus den Szenen der Bridge Entitäten werden, dass
sie im richtigen Zimmer landen und dass eine in der Hue-App gelöschte
Szene auch hier verschwindet. Genau darauf verlässt sich der
Szenen-Editor der App – er zeigt, was in der Registry steht.
"""

from typing import Any

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.hue import HueIntegration, parse_scenes


def bridge_scenes(*namen: tuple[str, str, str]) -> dict[str, Any]:
    """Antwort der Bridge auf /resource/scene, so knapp wie möglich."""
    return {
        "data": [
            {
                "id": kennung,
                "metadata": {"name": name},
                "group": {"rid": rid},
                "status": {"active": "inactive"},
            }
            for kennung, name, rid in namen
        ]
    }


async def _hue(rooms: dict[str, list[str]] | None = None) -> tuple[Hub, HueIntegration]:
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[],
            automations=[],
            rooms=rooms or {},
        )
    )
    await hub.start()
    integration = HueIntegration(hub, {"host": "127.0.0.1", "app_key": "x"})
    integration._scenes = []
    return hub, integration


async def test_bridge_scenes_become_entities_in_their_room():
    """Eine Szene je Entität, mit dem einen Befehl, den es dazu gibt –
    erst dadurch lässt sie sich in eine Szene des Hubs aufnehmen."""
    hub, hue = await _hue(rooms={"Wohnzimmer": ["hue.lampe"]})
    try:
        await hue._apply_scenes(
            parse_scenes(
                bridge_scenes(("aaa", "Entspannen", "r1"), ("bbb", "Kino", "r2")),
                {"r1": "Wohnzimmer", "r2": "Untergeschoss"},
            )
        )
        entspannen = hub.registry.get("hue.scene_aaa")
        assert entspannen is not None
        assert entspannen.kind == EntityKind.SCENE
        assert entspannen.name == "Entspannen"
        assert entspannen.commands == ["activate"]
        assert entspannen.state["state"] == "idle"
        # Der Raum der Bridge zählt nur, wenn es ihn im Haus gibt.
        assert entspannen.room == "Wohnzimmer"
        assert hub.registry.get("hue.scene_bbb").room is None
    finally:
        await hub.stop()


async def test_scene_deleted_in_the_hue_app_disappears_here_too():
    """Ein Knopf, hinter dem nichts mehr liegt, ist schlimmer als keiner."""
    hub, hue = await _hue()
    try:
        await hue._apply_scenes(
            parse_scenes(bridge_scenes(("aaa", "Entspannen", "r1"), ("bbb", "Kino", "r1")))
        )
        assert hub.registry.get("hue.scene_bbb") is not None

        await hue._apply_scenes(parse_scenes(bridge_scenes(("aaa", "Entspannen", "r1"))))
        assert hub.registry.get("hue.scene_aaa") is not None
        assert hub.registry.get("hue.scene_bbb") is None
    finally:
        await hub.stop()


async def test_scene_entity_only_takes_activate():
    """Die Bridge kann eine Szene nicht zurücknehmen. Ein «aus», das
    stattdessen die Lampen löscht, wäre etwas anderes als das, was
    draufsteht."""
    hub, hue = await _hue()
    gerufen: list[str] = []

    async def recall(scene_id: str) -> None:
        gerufen.append(scene_id)

    try:
        hub.integrations._integrations["hue"] = hue
        hue._recall = recall  # type: ignore[method-assign]
        await hue._apply_scenes(parse_scenes(bridge_scenes(("aaa", "Entspannen", "r1"))))

        await hub.integrations.dispatch_command("hue.scene_aaa", "activate")
        assert gerufen == ["aaa"]
        # Bis der Eventstream bestätigt, zeigt die Kachel schon, dass
        # etwas passiert ist.
        assert hub.registry.get("hue.scene_aaa").state["state"] == "active"

        try:
            await hub.integrations.dispatch_command("hue.scene_aaa", "turn_off")
        except Exception as err:
            assert "turn_off" in str(err)
        else:
            raise AssertionError("turn_off hätte abgewiesen werden müssen")
    finally:
        await hub.stop()


async def test_scene_event_without_status_leaves_the_state_alone():
    """Eine Umbenennung meldet keinen Status. «Kein Status» als «nicht
    aktiv» zu lesen hiesse: Die Szene geht beim Umbenennen aus."""
    hub, hue = await _hue()
    try:
        await hue._apply_scenes(parse_scenes(bridge_scenes(("aaa", "Entspannen", "r1"))))
        await hub.registry.update_state("hue.scene_aaa", {"state": "active"})

        await hue._apply_scene_event({"id": "aaa", "metadata": {"name": "Neu"}})
        assert hub.registry.get("hue.scene_aaa").state["state"] == "active"

        await hue._apply_scene_event({"id": "aaa", "status": {"active": "inactive"}})
        assert hub.registry.get("hue.scene_aaa").state["state"] == "idle"
    finally:
        await hub.stop()


async def test_hub_scene_can_contain_a_bridge_scene():
    """Der Fall, um den es geht: eine Szene des Hubs, die eine Hue-Szene
    aufruft – neben allem anderen, was sie sonst schaltet.

    Zurücknehmen lässt sich hier nur, was `_bridge_lichter_rueckweg`
    kennt: die Lampen aus `entity.state["lights"]` (Punkt 656 der
    Werkbank, `test_hub_scene_takes_back_the_lights_of_its_bridge_scene`
    unten). Diese Bridge-Antwort hier trägt keine `actions` und damit
    keine Lampen - `undo_fuer` bleibt für dieses Setup darum leer, nicht
    grundsätzlich.

    Ob die Szene noch *gilt*, ist eine andere Frage als die zurückzunehmen
    (Punkt 650 der Werkbank, der Fall «Zocken / Kino»): Die Hue-Szene
    selbst meldet nach dem Aufruf ``state: "active"`` - genau das lässt
    sich ablesen, ohne zu raten, was sie an den Lampen geändert hat. Vor
    Punkt 650 kannte ``zielzustand`` das Kommando ``activate`` gar nicht;
    eine Szene, die nur aus Bridge-Aufrufen und bereits erledigten
    Befehlen bestand, zeigte darum nie «gilt gerade» - selbst direkt nach
    dem Auslösen.
    """
    hub, hue = await _hue()
    gerufen: list[str] = []

    async def recall(scene_id: str) -> None:
        gerufen.append(scene_id)

    try:
        hub.integrations._integrations["hue"] = hue
        hue._recall = recall  # type: ignore[method-assign]
        await hue._apply_scenes(parse_scenes(bridge_scenes(("aaa", "Entspannen", "r1"))))

        hub.scenes.load(
            [
                {
                    "id": "abend",
                    "name": "Abend",
                    "actions": [{"entity_id": "hue.scene_aaa", "command": "activate"}],
                }
            ]
        )
        ergebnis = await hub.scenes.activate("abend")
        assert ergebnis["failed"] == []
        assert gerufen == ["aaa"]

        szene = hub.scenes.get("abend")
        assert szene is not None
        assert hub.scenes.ist_aktiv(szene) is True
        assert hub.scenes.undo_fuer("abend") == []
    finally:
        await hub.stop()


async def test_hub_scene_takes_back_the_lights_of_its_bridge_scene():
    """Punkt 656: «Zocken / Kino» stand nach Punkt 650/653 richtig auf
    «aktiv» - ein zweiter Druck nahm aber nichts von dem zurück, was die
    Hue-Szene an den Lampen verändert hatte. `fremde_szene` (der
    Direkt-Tipp auf die Hue-Szenen-Kachel) kannte den Rückweg über ihre
    Lampen längst; `activate()` einer Hub-Szene, die eine Bridge-Szene
    bloss mit aufruft, tat es nicht - `plane_rueckweg` sieht dort nur
    die Szenen-Entität selbst, an der `rueckbefehl` nie etwas findet.
    """
    hub, hue = await _hue()
    gerufen: list[str] = []

    async def recall(scene_id: str) -> None:
        gerufen.append(scene_id)

    try:
        hub.integrations._integrations["hue"] = hue
        hue._recall = recall  # type: ignore[method-assign]
        payload = bridge_scenes(("aaa", "Zocken", "r1"))
        payload["data"][0]["actions"] = [
            {"target": {"rid": "l1", "rtype": "light"}, "action": {}}
        ]
        hue._scenes = parse_scenes(payload, {})
        await hue._apply_scenes(hue._scenes)

        await hub.registry.add(
            Entity(
                id="hue.l1",
                kind=EntityKind.LIGHT,
                name="Deckenlampe",
                integration="hue",
                state={"state": "on", "brightness": 80},
                commands=["turn_on", "turn_off", "set_brightness"],
            )
        )

        hub.scenes.load(
            [
                {
                    "id": "abend",
                    "name": "Abend",
                    "actions": [{"entity_id": "hue.scene_aaa", "command": "activate"}],
                }
            ]
        )
        await hub.scenes.activate("abend")
        assert gerufen == ["aaa"]

        # Die Bridge hat die Lampe verändert (hier von Hand nachgestellt,
        # weil kein echtes Netz mitspielt).
        await hub.registry.update_state("hue.l1", {"state": "off"})

        assert hub.scenes.undo_fuer("abend") == [
            {
                "entity_id": "hue.l1",
                "command": "set_brightness",
                "data": {"brightness": 80},
            }
        ]

        # Geprüft wird der Rückweg, den der SceneManager plant - nicht
        # die Bridge-Anbindung selbst (die hat ihre eigenen Tests).
        async def stelle_licht(entity: Any, command: str, data: dict[str, Any]) -> None:
            if command == "set_brightness":
                await hub.registry.update_state(
                    entity.id, {"state": "on", "brightness": data.get("brightness")}
                )

        hue.handle_command = stelle_licht  # type: ignore[method-assign]

        ergebnis = await hub.scenes.revert("abend")
        assert ergebnis["reverted"] is True
        lampe = hub.registry.get("hue.l1")
        assert lampe is not None
        assert lampe.state["state"] == "on"
        assert lampe.state["brightness"] == 80
    finally:
        await hub.stop()


def test_scene_lights_kommen_aus_den_aktionen():
    """Welche Lampen die Szene stellt - für den Rückweg.

    Die Bridge kann eine Szene nicht zurücknehmen. Der Hub kann es, aber
    nur, wenn er weiss, welche Lampen dazugehören: Jede Aktion der Szene
    nennt ihr Ziel.
    """
    from homepilot.integrations.hue import scene_lights

    entry = {
        "actions": [
            {"target": {"rid": "l-1", "rtype": "light"}, "action": {}},
            {"target": {"rid": "l-2", "rtype": "light"}, "action": {}},
            # Doppelte und Fremdes fallen weg - gebraucht wird die Menge
            # der Lampen, nicht die Liste der Aktionen.
            {"target": {"rid": "l-1", "rtype": "light"}, "action": {}},
            {"target": {"rid": "g-9", "rtype": "grouped_light"}, "action": {}},
            "kaputt",
        ]
    }
    assert scene_lights(entry) == ("l-1", "l-2")
    assert scene_lights({}) == ()


async def test_szenen_entitaet_kennt_ihre_lampen():
    """Sie stehen im Zustand - die App zeigt daran «Bleibt aktiv» an."""
    hub, hue = await _hue()
    payload = bridge_scenes(("s-1", "Entspannen", "r-1"))
    payload["data"][0]["actions"] = [
        {"target": {"rid": "l-7", "rtype": "light"}, "action": {}}
    ]
    hue._scenes = parse_scenes(payload, {})
    await hue._apply_scenes(hue._scenes)
    entity = hub.registry.get("hue.scene_s-1")
    assert entity is not None
    assert entity.state["lights"] == ["hue.l-7"]
