"""Mehrere Lampen als eine Leuchte.

Der Fall, um den es geht: Eine Deckenlampe besteht aus fünf Spots, und
die Bridge meldet fünf Lichter. Bedienen will man sie aber als eines –
niemand schaltet Spot 3 allein ein.

Deshalb entsteht hier eine Entität, die alle Mitglieder gemeinsam
schaltet, dimmt und färbt. Auf Wunsch verschwinden die Mitglieder dabei aus Räumen,
Suche und Zählung («wieviele Lichter sind an») – bei einer Deckenlampe
mit fünf Spots ist das der eigentliche Gewinn, sonst stünde nur eine
Kachel mehr da und die Zählung wäre doppelt. Wer die Einzelnen behalten
will (zwei Stehlampen, die man meist gemeinsam, manchmal aber einzeln
schaltet), setzt ``hide_members: false``.

Unter Geräte bleiben sie in jedem Fall sichtbar und einzeln bedienbar;
beim Ausrichten nach dem Einbau braucht man genau das.

Nicht zu verwechseln mit der Anzeige-Kategorie (``group`` an einer
Entität): Die sortiert nur Kacheln innerhalb eines Raums und fasst
nichts zusammen.

Zwei Quellen, gleichwertig:

  - integration: group
    groups:
      - id: decke_wohnzimmer
        name: Deckenlampe Wohnzimmer
        members: [hue.spot_1, hue.spot_2, hue.spot_3]
        kind: light          # optional: light (Standard) oder switch

...und was in der App unter Geräte angelegt wird. Das landet in der
homepilot-data.json und überlebt Neustarts, ohne dass jemand eine Datei
bearbeiten muss.
"""

from __future__ import annotations

from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.integration import Integration

# Befehle, die eine Leuchte weiterreicht, wenn ein Mitglied sie kann.
# Bewusst die Vereinigung und nicht der Durchschnitt: Hat einer der Spots
# Farbe und ein anderer nur Weiss, soll die Farbe trotzdem bedienbar sein –
# der Befehl geht dann eben nur an die, die ihn kennen.
LIGHT_COMMANDS = (
    "turn_on",
    "turn_off",
    "toggle",
    "set_brightness",
    "set_color",
    "set_temperature",
    "set_white",
    "set_effect",
)
SWITCH_COMMANDS = ("turn_on", "turn_off", "toggle")

# Zustände, die als «an» zählen.
ON_STATES = ("on", "true", "playing", "open")


def slug(name: str) -> str:
    """Aus «Deckenlampe Wohnzimmer» wird «deckenlampe_wohnzimmer».

    Rein und testbar, weil die Kennung dauerhaft ist: Sie steht später in
    Szenen und Abläufen, und sie soll sich nicht ändern, nur weil jemand
    den Namen anders schreibt.
    """
    kept = [c.lower() if c.isalnum() else "_" for c in name.strip()]
    text = "".join(kept)
    while "__" in text:
        text = text.replace("__", "_")
    return text.strip("_") or "leuchte"


def merged_commands(
    members: list[Entity | None], is_light: bool
) -> list[str]:
    """Was die Leuchte kann, aus dem, was ihre Mitglieder können (rein).

    turn_on/turn_off/toggle immer – auch bei einer Leuchte, deren
    Mitglieder gerade alle nicht erreichbar sind, soll der Schalter da
    sein. Alles Weitere nur, wenn es mindestens einer versteht.
    """
    allowed = LIGHT_COMMANDS if is_light else SWITCH_COMMANDS
    can: set[str] = set()
    for member in members:
        if member is not None:
            can.update(member.commands)
    return [command for command in allowed if command in can or command in SWITCH_COMMANDS]


def combined_state(members: list[Entity | None], is_light: bool) -> dict[str, Any]:
    """Zustand der Leuchte aus ihren Mitgliedern (rein, testbar).

    «An», sobald einer an ist – das ist die Frage, die man beim
    Hereinkommen stellt. Die Helligkeit mittelt über die eingeschalteten
    Mitglieder: Ein ausgeschalteter Spot mit gespeicherten 0 % würde den
    Wert sonst nach unten ziehen und die Anzeige wäre falsch.
    """
    on = False
    levels: list[float] = []
    reachable = 0
    for member in members:
        if member is None:
            continue
        reachable += 1 if member.available else 0
        member_on = str(member.state.get("state")).lower() in ON_STATES
        on = on or member_on
        level = member.state.get("brightness")
        if member_on and isinstance(level, (int, float)) and not isinstance(level, bool):
            levels.append(float(level))
    shaped: dict[str, Any] = {
        "state": "on" if on else "off",
        "members": len([m for m in members if m is not None]),
        "members_on": sum(
            1
            for m in members
            if m is not None and str(m.state.get("state")).lower() in ON_STATES
        ),
    }
    if is_light and levels:
        shaped["brightness"] = round(sum(levels) / len(levels))
    return shaped


class GroupIntegration(Integration):
    name = "group"

    async def setup(self) -> None:
        self._members: dict[str, list[str]] = {}
        self._groups_of: dict[str, list[str]] = {}
        self._is_light: dict[str, bool] = {}
        # Leuchten, deren Mitglieder aus den Alltagsansichten verschwinden.
        self._hides: set[str] = set()

        # Der Registry sagen, wo sie die Zugehörigkeit erfragen kann –
        # damit auch Entitäten, die erst später auftauchen (eine Bridge
        # meldet sich langsam), gleich richtig markiert sind.
        self.hub.registry.combined_provider = self._combined_of

        await self._build(self._configured() + self._stored())

        self.hub.bus.subscribe("state_changed", self._on_change)
        self.hub.bus.subscribe("entity_added", self._on_added)

    def _configured(self) -> list[dict[str, Any]]:
        return [dict(item) for item in (self.config.get("groups") or [])]

    def _stored(self) -> list[dict[str, Any]]:
        return [dict(item) for item in self.hub.data.get("light_groups")]

    def _combined_of(self, entity_id: str) -> str | None:
        """Zu welcher Leuchte gehört diese Entität – und soll sie deswegen
        verschwinden? Nur dann steht hier etwas: ``combined_into`` ist für
        die App das Zeichen zum Ausblenden, nicht bloss eine Notiz."""
        for group_id in self._groups_of.get(entity_id, []):
            if group_id in self._hides:
                return group_id
        return None

    async def _build(self, definitions: list[dict[str, Any]]) -> None:
        """Leuchten anlegen und Mitglieder markieren."""
        for item in definitions:
            object_id = str(item.get("id") or "").strip()
            members = [str(m) for m in (item.get("members") or []) if str(m).strip()]
            if not object_id or not members:
                continue
            is_light = str(item.get("kind", "light")) == "light"
            # Standard: ausblenden. Das ist der Fall, für den es die
            # Zusammenfassung gibt; das Gegenteil ist die Ausnahme.
            hides = bool(item.get("hide_members", True))
            resolved = [self.hub.registry.get(m) for m in members]
            entity = await self.add_entity(
                object_id,
                EntityKind.LIGHT if is_light else EntityKind.SWITCH,
                str(item.get("name") or object_id),
                state=combined_state(resolved, is_light),
                commands=merged_commands(resolved, is_light),
            )
            self._members[entity.id] = members
            self._is_light[entity.id] = is_light
            if hides:
                self._hides.add(entity.id)
            for member in members:
                self._groups_of.setdefault(member, []).append(entity.id)
                await self.hub.registry.set_combined(member, self._combined_of(member))

    async def rebuild(self) -> None:
        """Nach einer Änderung in der App: alles neu aufbauen.

        Bewusst grob statt fein: Leuchten sind wenige und selten geändert,
        und ein vollständiger Neuaufbau kann nicht in einen halb
        aktualisierten Zustand geraten.
        """
        for member in list(self._groups_of):
            await self.hub.registry.set_combined(member, None)
        for group_id in list(self._members):
            await self.hub.registry.remove(group_id)
        self._members.clear()
        self._groups_of.clear()
        self._is_light.clear()
        self._hides.clear()
        await self._build(self._configured() + self._stored())

    def _on_change(self, _event: str, data: dict[str, Any]) -> None:
        for group_id in self._groups_of.get(data.get("entity_id", ""), []):
            self.start_task(self._recompute(group_id))

    def _on_added(self, _event: str, data: dict[str, Any]) -> None:
        entity = data.get("entity") or {}
        entity_id = entity.get("id", "")
        for group_id in self._groups_of.get(entity_id, []):
            # Ein Mitglied, das später auftaucht, muss auch markiert werden.
            self.start_task(self._adopt(entity_id, group_id))

    async def _adopt(self, entity_id: str, group_id: str) -> None:
        await self.hub.registry.set_combined(entity_id, self._combined_of(entity_id))
        await self._recompute(group_id)

    async def _recompute(self, group_id: str) -> None:
        members = [self.hub.registry.get(m) for m in self._members.get(group_id, [])]
        await self.hub.registry.update_state(
            group_id, combined_state(members, self._is_light.get(group_id, True))
        )

    async def handle_command(
        self, entity: Entity, command: str, data: dict[str, Any]
    ) -> None:
        # toggle einheitlich auflösen: ist die Leuchte an, alle aus, sonst an.
        if command == "toggle":
            command = "turn_off" if entity.state.get("state") == "on" else "turn_on"
        for member_id in self._members.get(entity.id, []):
            member = self.hub.registry.get(member_id)
            # Ein Spot ohne Farbe bekommt den Farbbefehl gar nicht erst –
            # sonst stünde für die ganze Leuchte ein Fehler da, obwohl vier
            # von fünf umgeschaltet haben.
            if member is None or command not in member.commands:
                continue
            try:
                await self.hub.integrations.dispatch_command(member_id, command, data)
            except Exception as err:
                self.log.warning(
                    "Leuchte %s: Mitglied %s (%s) – %s", entity.id, member_id, command, err
                )


INTEGRATION = GroupIntegration
