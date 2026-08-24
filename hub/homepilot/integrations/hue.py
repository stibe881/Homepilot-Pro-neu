"""Philips Hue Bridge über die lokale CLIP-v2-API.

Konfiguration:
  - integration: hue
    host: 192.168.1.20
    app_key: "..."   # siehe config.example.yaml zum Erzeugen

Liest alle Lichter, lauscht auf den SSE-Eventstream der Bridge für
Live-Updates und pollt zusätzlich als Fallback.

Die auf der Bridge gespeicherten **Szenen** kommen als eigene Entitäten
mit (``hue.scene_<Kennung>``, Art ``scene``, ein Befehl: ``activate``).
Sie gehören der Bridge – Farben und Helligkeiten stecken dort, und nur
sie kann alles in einem Zug setzen. Der Hub ruft sie auf, baut sie aber
nicht nach.
"""

from __future__ import annotations

import asyncio
import json
from collections import Counter
from dataclasses import dataclass
from typing import Any

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError, HomePilotError, UnsupportedCommandError
from ..core.integration import Integration


@dataclass(frozen=True)
class HueScene:
    """Eine auf der Bridge gespeicherte Szene."""

    id: str
    #: Wie sie in der Hue-App heisst – «Entspannen».
    name: str
    #: Raum oder Zone der Bridge, sofern sie einer angehört.
    room: str | None
    #: Eindeutiger Name für Auswahllisten – «Entspannen (Wohnzimmer)».
    label: str
    #: «active», solange die Lampen so stehen, wie die Szene sie setzte.
    state: str = "idle"

    @property
    def object_id(self) -> str:
        """Der Namensteil ihrer Entität: ``hue.scene_<Kennung>``."""
        return f"scene_{self.id}"


def parse_rooms(*payloads: dict[str, Any] | None) -> dict[str, str]:
    """Räume und Zonen der Bridge als Kennung → Name (rein, testbar).

    Beide Ressourcen in einen Topf, weil eine Szene an beidem hängen
    kann: «Entspannen» am Zimmer Wohnzimmer, «Alles gedimmt» an der Zone
    Erdgeschoss. Für den Namen der Szene ist der Unterschied ohne Belang.
    """
    rooms: dict[str, str] = {}
    for payload in payloads:
        for entry in (payload or {}).get("data") or []:
            rid = entry.get("id")
            name = (entry.get("metadata") or {}).get("name")
            if rid and name:
                rooms[str(rid)] = str(name)
    return rooms


def scene_state(entry: dict[str, Any]) -> str:
    """Gilt diese Szene gerade? (rein, testbar)

    Die Bridge meldet «static» oder «dynamic_palette», solange die Lampen
    so stehen, wie die Szene sie gesetzt hat, und «inactive», sobald
    jemand eine davon von Hand verstellt. Ältere Firmware meldet gar
    nichts – dann ist «bereit» die ehrlichere Antwort als eine geratene.
    """
    aktiv = str((entry.get("status") or {}).get("active") or "").strip()
    return "active" if aktiv and aktiv != "inactive" else "idle"


def parse_scenes(
    payload: dict[str, Any] | None, rooms: dict[str, str] | None = None
) -> list[HueScene]:
    """Die Szenen der Bridge (rein, testbar).

    Der Raumname gehört dazu: «Entspannen» gibt es in jedem Zimmer, und
    ohne Unterscheidung wäre die Auswahl ein Ratespiel.

    Den Zusatz bekommen *alle* gleichnamigen, nicht nur die zweite und
    dritte. Vorher behielt die erste ihren blossen Namen, und dann stand
    «Entspannen» neben «Entspannen (Büro)» – ohne dass irgendwo steht,
    welches Zimmer das namenlose ist.

    Kennt die Bridge den Raum nicht (alte Firmware, gelöschte Zone),
    bleibt der Anfang der Kennung als Notnagel: hässlich, aber eindeutig.
    """
    entries = [
        entry
        for entry in (payload or {}).get("data") or []
        if entry.get("id") and (entry.get("metadata") or {}).get("name")
    ]
    haeufig = Counter(str((entry.get("metadata") or {}).get("name")) for entry in entries)
    scenes: list[HueScene] = []
    belegt: set[str] = set()
    for entry in entries:
        name = str((entry.get("metadata") or {}).get("name"))
        rid = (entry.get("group") or {}).get("rid")
        room = (rooms or {}).get(str(rid)) if rid else None
        label = name
        if haeufig[name] > 1:
            if room:
                label = f"{name} ({room})"
            elif rid:
                label = f"{name} ({str(rid)[:8]})"
        # Zwei gleichnamige Szenen im selben Zimmer gibt es auch. Als
        # Schlüssel eines Wörterbuchs verschluckte das früher eine davon
        # lautlos; jetzt bekommt sie eine Nummer und bleibt wählbar.
        stamm, zaehler = label, 2
        while label in belegt:
            label = f"{stamm} {zaehler}"
            zaehler += 1
        belegt.add(label)
        scenes.append(
            HueScene(
                id=str(entry["id"]),
                name=name,
                room=room,
                label=label,
                state=scene_state(entry),
            )
        )
    return scenes


def matching_room(hue_room: str | None, known: list[str]) -> str | None:
    """Der Raum des Hubs zu diesem Hue-Raum – oder keiner (rein, testbar).

    Nur wenn es ihn im Haus schon gibt. Die Bridge kennt ihre eigenen
    Zimmernamen («Living room», «Zone EG»), und die müssen mit denen der
    config.yaml nichts zu tun haben. Übernähme man sie ungeprüft, stünden
    für dreissig Szenen plötzlich Räume in der App, die es im Haus nicht
    gibt.
    """
    if not hue_room:
        return None
    for raum in known:
        if raum.casefold() == hue_room.casefold():
            return raum
    return None


class HueIntegration(Integration):
    name = "hue"

    async def setup(self) -> None:
        host = self.config.get("host")
        app_key = self.config.get("app_key")
        if not host or not app_key:
            raise ConfigError("hue braucht 'host' und 'app_key' in der Konfiguration")

        self._base = f"https://{host}"
        # Die Bridge nutzt ein selbstsigniertes Zertifikat – Verifikation
        # ist für das lokale Gerät deshalb deaktiviert.
        self._session = self.http_session(
            connector=aiohttp.TCPConnector(ssl=False),
            headers={"hue-application-key": app_key},
            timeout=aiohttp.ClientTimeout(total=None),
        )
        # Die Szenen der Bridge, in der Reihenfolge, in der sie kommt.
        self._scenes: list[HueScene] = []
        await self._refresh()
        self.start_task(self._event_loop())
        self.start_polling(self._refresh)

    # ── Bridge → Hub ───────────────────────────────────────────────────────

    async def _get(self, resource: str) -> dict[str, Any]:
        """Eine CLIP-v2-Ressource holen (light, scene, room, zone …)."""
        async with self._session.get(
            f"{self._base}/clip/v2/resource/{resource}",
            timeout=aiohttp.ClientTimeout(total=15),
        ) as response:
            response.raise_for_status()
            payload: dict[str, Any] = await response.json()
            return payload

    async def _refresh(self) -> None:
        try:
            payload = await self._get("light")
        except Exception as err:
            self.log.warning("Hue Bridge nicht erreichbar: %s", err)
            for entity in self.hub.registry.all():
                if entity.integration == self.name:
                    await self.hub.registry.update_state(entity.id, {}, available=False)
            return

        for light in payload.get("data", []):
            await self._apply_light(light)
        # Szenen im selben Takt: Wer in der Hue-App eine anlegt oder
        # umbenennt, soll sie hier finden, ohne den Hub neu zu starten.
        await self._load_scenes()

    async def _load_scenes(self) -> None:
        """Die auf der Bridge gespeicherten Szenen holen.

        Sie gehören der Bridge, nicht dem Hub: Farben und Helligkeiten
        stecken dort, und nur die Bridge kann sie in einem Zug setzen. Der
        Hub kann sie deshalb aufrufen, aber nicht nachbauen.
        """
        try:
            payload = await self._get("scene")
            rooms = parse_rooms(await self._get("room"), await self._get("zone"))
        except Exception as err:
            self.log.warning("Hue-Szenen nicht abrufbar: %s", err)
            return
        await self._apply_scenes(parse_scenes(payload, rooms))

    async def _apply_scenes(self, scenes: list[HueScene]) -> None:
        """Die Szenen der Bridge als Entitäten führen.

        Eine Entität je Szene, mit dem einen Befehl, den es dazu gibt:
        ``activate``. Erst dadurch steht eine Hue-Szene überall zur
        Auswahl, wo ein Gerät steht – in einer Szene des Hubs, in einem
        Ablauf, als Kachel im Raum. Vorher gab es sie nur als Namensliste,
        und die kannte allein der Ablauf-Editor.
        """
        self._scenes = scenes
        bekannt = self.hub.known_rooms()
        gewuenscht: set[str] = set()
        for scene in scenes:
            entity_id = self.entity_id(scene.object_id)
            gewuenscht.add(entity_id)
            zustand = {
                "state": scene.state,
                # Der eindeutige Name – unter ihm steht die Szene auch in
                # der Aktion «Hue-Szene» eines Ablaufs.
                "scene": scene.label,
                "hue_room": scene.room,
            }
            if self.hub.registry.get(entity_id) is None:
                await self.add_entity(
                    scene.object_id,
                    EntityKind.SCENE,
                    scene.name,
                    state=zustand,
                    commands=["activate"],
                    room=matching_room(scene.room, bekannt),
                )
            else:
                await self.hub.registry.update_state(entity_id, zustand, available=True)
        # In der Hue-App gelöschte Szenen verschwinden auch hier: Ein
        # Knopf, hinter dem nichts mehr liegt, ist schlimmer als keiner.
        for entity in self.hub.registry.all():
            if (
                entity.integration == self.name
                and entity.kind == EntityKind.SCENE
                and entity.id not in gewuenscht
            ):
                await self.hub.registry.remove(entity.id)
        self.log.info("Hue: %d Szenen gefunden", len(scenes))

    def scenes(self) -> list[str]:
        """Namen der Bridge-Szenen – für die Auswahl in der App."""
        return sorted(scene.label for scene in self._scenes)

    def _scene_id(self, name: str) -> str | None:
        """Kennung zu einem Szenennamen – auch ohne passenden Zusatz.

        Abläufe speichern den Namen, nicht die Kennung. Wer in der
        Hue-App ein Zimmer umbenennt, ändert damit den Zusatz in
        «Entspannen (Wohnzimmer)», und der Ablauf zeigte danach ins
        Leere. Der blosse Name ist dann die bessere Antwort als ein
        Fehler – gibt es ihn mehrfach, gewinnt die erste Szene, was immer
        noch mehr Licht macht als gar nichts.
        """
        for scene in self._scenes:
            if scene.label == name:
                return scene.id
        for scene in self._scenes:
            if scene.name == name:
                return scene.id
        return None

    async def activate_scene(self, name: str) -> None:
        """Eine Bridge-Szene aufrufen."""
        scene_id = self._scene_id(name)
        if scene_id is None:
            raise HomePilotError(
                f"Unbekannte Hue-Szene '{name}'. Bekannt: "
                + (", ".join(self.scenes()) or "keine")
            )
        await self._recall(scene_id)

    async def _recall(self, scene_id: str) -> None:
        async with self._session.put(
            f"{self._base}/clip/v2/resource/scene/{scene_id}",
            json={"recall": {"action": "active"}},
            timeout=aiohttp.ClientTimeout(total=15),
        ) as response:
            response.raise_for_status()

    async def _apply_light(self, light: dict[str, Any]) -> None:
        resource_id = light.get("id")
        if not resource_id:
            return
        entity_id = self.entity_id(resource_id)
        changes: dict[str, Any] = {}
        if "on" in light:
            changes["state"] = "on" if light["on"].get("on") else "off"
        if "dimming" in light:
            changes["brightness"] = round(float(light["dimming"].get("brightness", 100)))
        if "color_temperature" in light:
            mirek = light["color_temperature"].get("mirek")
            if isinstance(mirek, (int, float)):
                changes["color_temp"] = round(mirek)

        if self.hub.registry.get(entity_id) is None:
            name = (light.get("metadata") or {}).get("name") or "Hue Licht"
            commands = ["turn_on", "turn_off", "toggle"]
            if "dimming" in light:
                commands.append("set_brightness")
            if "color_temperature" in light:
                commands.append("set_color_temp")
            await self.add_entity(
                resource_id,
                EntityKind.LIGHT,
                name,
                state=changes or {"state": "off"},
                commands=commands,
            )
        elif changes:
            await self.hub.registry.update_state(entity_id, changes, available=True)

    async def _event_loop(self) -> None:
        """SSE-Eventstream der Bridge – liefert Änderungen praktisch sofort."""
        while True:
            try:
                async with self._session.get(
                    f"{self._base}/eventstream/clip/v2",
                    headers={"Accept": "text/event-stream"},
                    timeout=aiohttp.ClientTimeout(total=None, sock_read=None),
                ) as response:
                    response.raise_for_status()
                    async for raw_line in response.content:
                        line = raw_line.decode("utf-8", "ignore").strip()
                        if not line.startswith("data:"):
                            continue
                        await self._handle_events(json.loads(line[5:].strip()))
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.debug("Hue-Eventstream unterbrochen (%s), reconnect in 10s", err)
                await asyncio.sleep(10)

    async def _handle_events(self, events: list[dict[str, Any]]) -> None:
        for event in events:
            art = event.get("type")
            if art in ("add", "delete") and any(
                item.get("type") == "scene" for item in event.get("data", [])
            ):
                # In der Hue-App wurde eine Szene angelegt oder gelöscht.
                # Die Liste sofort neu holen statt bis zum nächsten Takt
                # zu warten: Wer sie gerade angelegt hat, sucht sie jetzt.
                await self._load_scenes()
                continue
            if art != "update":
                continue
            for item in event.get("data", []):
                if item.get("type") == "light":
                    await self._apply_light(item)
                elif item.get("type") == "scene":
                    await self._apply_scene_event(item)

    async def _apply_scene_event(self, item: dict[str, Any]) -> None:
        """Eine Szene wurde aufgerufen – oder von Hand verlassen.

        Die Bridge meldet das für alle Szenen des Zimmers: eine wird
        aktiv, die übrigen fallen zurück. Genau daran sieht man in der
        App, welche gerade gilt.

        Ohne ``status`` im Ereignis wird nichts gesetzt. Solche Meldungen
        gibt es (eine Umbenennung etwa), und «kein Status» hiesse hier
        sonst «nicht aktiv» – die Szene ginge beim Umbenennen aus.
        """
        if "status" not in item:
            return
        entity_id = self.entity_id(f"scene_{item.get('id')}")
        if self.hub.registry.get(entity_id) is None:
            return
        await self.hub.registry.update_state(
            entity_id, {"state": scene_state(item)}, available=True
        )

    # ── Hub → Bridge ───────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        if entity.kind == EntityKind.SCENE:
            # Eine Szene kennt genau eine Handlung: aufrufen. Kein
            # «turn_off» – die Bridge kann eine Szene nicht zurücknehmen,
            # und ein Knopf, der die Lampen ausschaltet, wäre etwas
            # anderes als das, was draufsteht.
            if command != "activate":
                raise UnsupportedCommandError(entity.id, command)
            await self._recall(entity.id.split(".", 1)[1].removeprefix("scene_"))
            # Der Eventstream bestätigt es gleich; bis dahin soll die
            # Kachel schon zeigen, dass etwas passiert ist.
            await self.hub.registry.update_state(entity.id, {"state": "active"})
            return

        body: dict[str, Any] = {}
        if command == "turn_on":
            body["on"] = {"on": True}
            if "brightness" in data:
                body["dimming"] = {"brightness": float(data["brightness"])}
        elif command == "turn_off":
            body["on"] = {"on": False}
        elif command == "toggle":
            body["on"] = {"on": entity.state.get("state") != "on"}
        elif command == "set_brightness":
            brightness = float(data.get("brightness", 100))
            body["dimming"] = {"brightness": brightness}
            body["on"] = {"on": brightness > 0}
        elif command == "set_color_temp":
            # Farbtemperatur als Mirek (153 = kalt/6500K … 500 = warm/2000K).
            # Alternativ 'kelvin' entgegennehmen und umrechnen.
            if "kelvin" in data and float(data["kelvin"]) > 0:
                mirek = 1_000_000 / float(data["kelvin"])
            else:
                mirek = float(data.get("color_temp", data.get("mirek", 366)))
            body["color_temperature"] = {"mirek": max(153, min(500, round(mirek)))}

        resource_id = entity.id.split(".", 1)[1]
        async with self._session.put(
            f"{self._base}/clip/v2/resource/light/{resource_id}",
            json=body,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as response:
            response.raise_for_status()
        # Der Eventstream liefert danach den neuen Zustand; für schnelles
        # UI-Feedback optimistisch direkt nachziehen.
        changes: dict[str, Any] = {}
        if "on" in body:
            changes["state"] = "on" if body["on"]["on"] else "off"
        if "dimming" in body:
            changes["brightness"] = round(body["dimming"]["brightness"])
        if "color_temperature" in body:
            changes["color_temp"] = body["color_temperature"]["mirek"]
        if changes:
            await self.hub.registry.update_state(entity.id, changes)


INTEGRATION = HueIntegration
