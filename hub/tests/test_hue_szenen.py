"""Hue-Szenen als Entitäten – mit echtem Hub, ohne Bridge.

Die Netzwerkteile brauchen eine echte Bridge; prüfbar ist hier das, was
danach passiert: dass aus den Szenen der Bridge Entitäten werden, dass
sie im richtigen Zimmer landen und dass eine in der Hue-App gelöschte
Szene auch hier verschwindet. Genau darauf verlässt sich der
Szenen-Editor der App – er zeigt, was in der Registry steht.
"""

from typing import Any

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import EntityKind
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

    Zurücknehmen lässt sich der Hue-Teil nicht: Was ``activate`` aus den
    Lampen macht, weiss nur die Bridge, und Raten wäre hier schlimmer als
    nichts tun. Deshalb steht die Szene auch nie auf «gilt gerade» – ein
    Knopf, der immer leuchtet, sagt nichts.
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
        assert hub.scenes.ist_aktiv(szene) is False
        assert hub.scenes.undo_fuer("abend") == []
    finally:
        await hub.stop()

