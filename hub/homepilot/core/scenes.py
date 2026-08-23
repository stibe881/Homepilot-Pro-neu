"""Szenen: eine benannte Liste von Kommandos.

  scenes:
    - id: kino
      name: Kino
      icon: film-outline
      actions:
        - {entity_id: hue.stehlampe, command: set_brightness, data: {brightness: 15}}
        - {entity_id: mqtt.sonoff_tv, command: turn_on}

Bewusst simpel gehalten: Eine Szene stellt einen Zustand her, sie hat keine
Bedingungen und keinen Zeitverlauf. Alles Weitere gehört in eine Automation.

**Zurücknehmen.** Beim Auslösen merkt sich der Hub, wie es vorher aussah -
aber nur bei den Geräten, an denen die Szene wirklich etwas verändert.
Der zweite Druck stellt genau das wieder her. Ein Fernseher, der schon
aus war, gehört nicht dazu: An ihm hat die Szene nichts getan, also darf
das Zurücknehmen ihn auch nicht einschalten. Das Rechnen dazu steht in
szenenrueckweg.py.

Ob eine Szene «gilt», wird am tatsächlichen Gerätezustand gemessen und
nicht daran, dass jemand einmal den Knopf gedrückt hat: Wer danach das
Licht von Hand anschaltet, hat sie verlassen.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from . import szenenrueckweg
from .errors import ConfigError, HomePilotError
from .source import as_source, scene_source

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)


@dataclass
class Scene:
    id: str
    name: str
    icon: str = "sparkles-outline"
    actions: list[dict[str, Any]] = field(default_factory=list)
    # In der App angelegte Szenen lassen sich dort auch wieder ändern und
    # löschen; die aus der config.yaml gehören der Datei.
    editable: bool = False
    # Optionaler Raum – dann erscheint die Szene in dessen Kategorie „Szenen“.
    room: str | None = None
    # Auf der Startseite als Schnellaktion anzeigen.
    on_start: bool = False
    # Frei benannte Kategorie zum Gruppieren in der App (siehe Automation).
    category: str | None = None
    # Übergangszeit in Sekunden: Helligkeiten werden über diese Dauer
    # angefahren statt schlagartig gesetzt – Lichtwecker und Einschlaflicht.
    transition: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "icon": self.icon,
            "actions": self.actions,
            "entity_ids": [action.get("entity_id") for action in self.actions],
            "editable": self.editable,
            "room": self.room,
            "on_start": self.on_start,
            "category": self.category,
            "transition": self.transition,
        }


# Länger als eine Stunde ist kein Übergang mehr, sondern ein Ablauf.
MAX_TRANSITION = 3600
# So oft wird während eines Übergangs nachgestellt. Alle fünf Sekunden:
# oft genug, dass es fliessend wirkt, selten genug, dass eine Hue-Bridge
# bei einer halbstündigen Rampe nicht in die Knie geht.
TRANSITION_STEP = 5.0


def ramp(start: int, target: int, seconds: float, step: float = TRANSITION_STEP) -> list[tuple[float, int]]:
    """Die Zwischenschritte eines Übergangs (rein, testbar).

    Liefert Paare aus Wartezeit und Zielwert. Der letzte Schritt trifft
    den Zielwert immer genau – eine Rampe, die bei 97 % endet, wäre ein
    Fehler, den man abends im Bett sieht.
    """
    if seconds <= 0 or start == target:
        return [(0.0, target)]
    count = max(1, int(seconds / step))
    steps: list[tuple[float, int]] = []
    for index in range(1, count + 1):
        value = round(start + (target - start) * index / count)
        steps.append((step if index > 1 else 0.0, value))
    steps[-1] = (steps[-1][0], target)
    return steps


def transition_for(scene: Scene, action: dict[str, Any]) -> float:
    """Die Übergangszeit dieser einen Aktion (rein, testbar).

    ``data.transition`` sticht die Szene – auch mit null: «diese Lampe
    sofort» ist beim Lichtwecker genau der Punkt. Unsinniges fällt auf
    die Szene zurück, und mehr als MAX_TRANSITION ist kein Übergang mehr,
    sondern ein Ablauf.
    """
    roh = (action.get("data") or {}).get("transition")
    if roh is None:
        return float(scene.transition)
    try:
        sekunden = float(roh)
    except (TypeError, ValueError):
        return float(scene.transition)
    if sekunden < 0:
        return float(scene.transition)
    return min(sekunden, MAX_TRANSITION)


def parse_scenes(configs: list[dict[str, Any]], editable: bool = False) -> list[Scene]:
    scenes = []
    for index, config in enumerate(configs):
        scene_id = str(config.get("id") or f"scene_{index}")
        actions = config.get("actions") or []
        if not isinstance(actions, list):
            raise ConfigError(f"Szene '{scene_id}': 'actions' muss eine Liste sein")
        for action in actions:
            if not action.get("entity_id") or not action.get("command"):
                raise ConfigError(
                    f"Szene '{scene_id}': jede Aktion braucht 'entity_id' und 'command'"
                )
        room = config.get("room")
        scenes.append(
            Scene(
                id=scene_id,
                name=str(config.get("name") or scene_id),
                icon=str(config.get("icon") or "sparkles-outline"),
                actions=actions,
                editable=editable,
                room=str(room) if room else None,
                on_start=bool(config.get("on_start")),
                category=str(config["category"]) if config.get("category") else None,
                transition=max(0, min(MAX_TRANSITION, int(config.get("transition") or 0))),
            )
        )
    return scenes


class SceneManager:
    def __init__(self, hub: Hub) -> None:
        # Laufende Übergänge – festgehalten, damit sie nicht vom
        # Müllsammler eingezogen werden, bevor sie fertig sind.
        self._fades: set[asyncio.Task] = set()
        self.hub = hub
        self.scenes: list[Scene] = []

    def load(
        self,
        configs: list[dict[str, Any]],
        stored: list[dict[str, Any]] | None = None,
    ) -> None:
        """Szenen aus der config.yaml plus die in der App angelegten."""
        self.scenes = parse_scenes(configs) + parse_scenes(stored or [], editable=True)
        if self.scenes:
            log.info("%d Szenen geladen", len(self.scenes))

    def get(self, scene_id: str) -> Scene | None:
        return next((scene for scene in self.scenes if scene.id == scene_id), None)

    # ── Rückweg ────────────────────────────────────────────────────────────

    #: Wo die Rückwege liegen. Auf der Platte, nicht im Speicher: Eine
    #: Szene, die man abends auslöst, will man nach einem Update um
    #: Mitternacht immer noch zurücknehmen können.
    UNDO_KEY = "scene_undo"

    def _geraete_stand(self, entity_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Kind, Kommandos und Zustand der beteiligten Geräte."""
        stand: dict[str, dict[str, Any]] = {}
        for entity_id in entity_ids:
            entity = self.hub.registry.get(entity_id)
            if entity is None:
                continue
            stand[entity_id] = {
                "kind": str(getattr(entity.kind, "value", entity.kind)),
                "commands": list(entity.commands),
                "state": dict(entity.state),
            }
        return stand

    def _undo_lesen(self) -> list[dict[str, Any]]:
        roh = self.hub.data.get(self.UNDO_KEY)
        return [eintrag for eintrag in roh if isinstance(eintrag, dict)]

    def _undo_setzen(self, scene_id: str, befehle: list[dict[str, Any]] | None) -> None:
        andere = [
            eintrag for eintrag in self._undo_lesen() if eintrag.get("scene") != scene_id
        ]
        if befehle:
            andere.append(
                {"scene": scene_id, "at": time.time(), "commands": befehle}
            )
        self.hub.data.set(self.UNDO_KEY, andere)

    def undo_fuer(self, scene_id: str) -> list[dict[str, Any]]:
        """Der gespeicherte Rückweg dieser Szene – leer, wenn es keinen gibt."""
        for eintrag in self._undo_lesen():
            if eintrag.get("scene") == scene_id:
                roh = eintrag.get("commands")
                return [b for b in roh if isinstance(b, dict)] if isinstance(roh, list) else []
        return []

    def ist_aktiv(self, scene: Scene) -> bool:
        """Steht der Raum noch so, wie die Szene ihn hinterlassen hat?

        Bewusst am tatsächlichen Zustand gemessen und nicht daran, dass
        jemand einmal den Knopf gedrückt hat: Wer danach das Licht von
        Hand wieder anschaltet, hat die Szene verlassen. Ein Knopf, der
        dann noch leuchtet, wäre eine Lüge - und der zweite Druck darauf
        eine Überraschung.
        """
        stand = self._geraete_stand(
            [str(a.get("entity_id") or "") for a in scene.actions]
        )
        return szenenrueckweg.szene_gilt_noch(scene.actions, stand)

    async def toggle(self, scene_id: str) -> dict[str, Any]:
        """Auslösen oder zurücknehmen – je nachdem, was gerade gilt."""
        scene = self.get(scene_id)
        if scene is None:
            raise HomePilotError(f"Unbekannte Szene: {scene_id}")
        if self.ist_aktiv(scene) and self.undo_fuer(scene_id):
            return await self.revert(scene_id)
        return await self.activate(scene_id)

    async def revert(self, scene_id: str) -> dict[str, Any]:
        """Die Szene zurücknehmen – nur, was sie geändert hat.

        Der Rückweg wurde beim Auslösen berechnet, nicht jetzt: Nur
        damals war noch bekannt, wie es vorher aussah.
        """
        scene = self.get(scene_id)
        if scene is None:
            raise HomePilotError(f"Unbekannte Szene: {scene_id}")
        befehle = self.undo_fuer(scene_id)
        if not befehle:
            raise HomePilotError(
                f"Für '{scene.name}' ist nichts zum Zurücknehmen gespeichert"
            )
        failed: list[dict[str, str]] = []
        with as_source(scene_source(scene.id, f"{scene.name} zurück")):
            for befehl in befehle:
                try:
                    await self.hub.integrations.dispatch_command(
                        befehl["entity_id"],
                        befehl["command"],
                        befehl.get("data") or {},
                    )
                except Exception as err:
                    log.warning(
                        "Szene '%s' zurücknehmen: %s ging nicht (%s)",
                        scene.name,
                        befehl.get("entity_id"),
                        err,
                    )
                    failed.append(
                        {"entity_id": str(befehl.get("entity_id")), "error": str(err)}
                    )
                await asyncio.sleep(0)
        self._undo_setzen(scene_id, None)
        log.info(
            "Szene '%s' zurückgenommen (%d Geräte)", scene.name, len(befehle) - len(failed)
        )
        return {"scene": scene.as_dict(), "failed": failed, "reverted": True}

    async def activate(self, scene_id: str) -> dict[str, Any]:
        """Führt alle Aktionen aus und meldet, was nicht geklappt hat.

        Ein defektes Gerät darf die restliche Szene nicht verhindern – das
        Licht soll auch dann angehen, wenn der Verstärker nicht antwortet.
        """
        scene = self.get(scene_id)
        if scene is None:
            raise HomePilotError(f"Unbekannte Szene: {scene_id}")

        # Vor dem Schalten festhalten, wie es aussah - danach ist es weg.
        # Gespeichert wird nur, was die Szene wirklich verändert: Ein
        # Fernseher, der schon aus war, gehört nicht in den Rückweg,
        # sonst ginge er beim zweiten Druck an.
        vorher = self._geraete_stand(
            [str(a.get("entity_id") or "") for a in scene.actions]
        )
        self._undo_setzen(
            scene_id, szenenrueckweg.plane_rueckweg(scene.actions, vorher)
        )

        failed: list[dict[str, str]] = []
        with as_source(scene_source(scene.id, scene.name)):
            for action in scene.actions:
                try:
                    # Mit Übergangszeit werden Helligkeiten angefahren statt
                    # gesetzt. Alles andere (an, aus, Storen) bleibt sofort:
                    # Ein Schalter, der «langsam» schaltet, gibt es nicht.
                    #
                    # `data.transition` je Aktion sticht die Szene: Beim
                    # Lichtwecker soll das Licht über zwanzig Minuten
                    # kommen, die Nachttischlampe aber sofort an – vorher
                    # galt die eine Zahl pauschal für jede Lampe.
                    uebergang = transition_for(scene, action)
                    if uebergang > 0 and action["command"] == "set_brightness":
                        await self._fade(scene, action, uebergang)
                        continue
                    await self.hub.integrations.dispatch_command(
                        action["entity_id"], action["command"], action.get("data") or {}
                    )
                except Exception as err:
                    log.warning(
                        "Szene '%s': %s konnte nicht geschaltet werden: %s",
                        scene.name,
                        action["entity_id"],
                        err,
                    )
                    failed.append({"entity_id": action["entity_id"], "error": str(err)})
                await asyncio.sleep(0)

        log.info(
            "Szene '%s' ausgelöst (%d von %d Aktionen erfolgreich)",
            scene.name,
            len(scene.actions) - len(failed),
            len(scene.actions),
        )
        return {"scene": scene.as_dict(), "failed": failed}

    async def _fade(
        self, scene: Scene, action: dict[str, Any], seconds: float
    ) -> None:
        """Eine Helligkeit über die Übergangszeit anfahren.

        Im Hintergrund, damit die übrigen Aktionen der Szene nicht warten –
        eine halbstündige Rampe darf das Licht im Flur nicht aufhalten. Der
        Startwert kommt vom Gerät selbst; ist es aus, beginnt die Rampe bei
        null und schaltet mit dem ersten Schritt ein.
        """
        entity_id = action["entity_id"]
        target = int((action.get("data") or {}).get("brightness") or 0)
        entity = self.hub.registry.get(entity_id)
        current = 0
        if entity is not None and entity.state.get("state") == "on":
            try:
                current = int(entity.state.get("brightness") or 0)
            except (TypeError, ValueError):
                current = 0
        steps = ramp(current, target, seconds)

        async def run() -> None:
            for wait, value in steps:
                if wait:
                    await asyncio.sleep(wait)
                try:
                    await self.hub.integrations.dispatch_command(
                        entity_id, "set_brightness", {"brightness": value}
                    )
                except Exception as err:
                    log.warning(
                        "Szene '%s': Übergang für %s abgebrochen (%s)",
                        scene.name,
                        entity_id,
                        err,
                    )
                    return

        task = asyncio.create_task(run())
        self._fades.add(task)
        task.add_done_callback(self._fades.discard)
