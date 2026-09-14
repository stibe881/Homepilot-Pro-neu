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
from ..core.farbraum import hex_zu_xy, xy_zu_hex
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
    #: Die Lampen, die sie stellt - als Kennungen der Bridge.
    #:
    #: Die Bridge kann eine Szene nicht zurücknehmen; wer den Knopf ein
    #: zweites Mal drücken und den Zustand von vorher wiederhaben will,
    #: braucht die Liste der betroffenen Lampen (core/scenes.py). Sie
    #: steht in der Szene selbst - jede Aktion nennt ihr Ziel.
    lights: tuple[str, ...] = ()

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


def scene_lights(entry: dict[str, Any]) -> tuple[str, ...]:
    """Welche Lampen diese Szene stellt (rein, testbar).

    Jede Aktion der Szene nennt ihr Ziel (``target.rid``); uns
    interessieren die Lampen. Reihenfolge und Doppelte spielen keine
    Rolle - gebraucht wird die Menge, um vor dem Aufrufen zu merken, wie
    sie standen.
    """
    lights: list[str] = []
    for aktion in entry.get("actions") or []:
        if not isinstance(aktion, dict):
            continue
        ziel = aktion.get("target") or {}
        if str(ziel.get("rtype") or "") != "light":
            continue
        rid = str(ziel.get("rid") or "").strip()
        if rid and rid not in lights:
            lights.append(rid)
    return tuple(lights)


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
                lights=scene_lights(entry),
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


#: Das Einschaltverhalten nach Stromausfall (Punkt 630 der Werkbank).
#:
#: Die Bridge führt es je Leuchte als ``powerup`` mit vier Voreinstellungen:
#: «safety» (an, volle Helligkeit - der Blitz um drei Uhr nachts),
#: «powerfail» (wie vor dem Ausfall), «last_on_state» (an, mit dem
#: letzten Licht) und «custom». Der Hub kennt drei Wörter, dieselben wie
#: bei Zigbee und Homematic: ``previous``, ``off``, ``on``.
POWERUP_VON_PRESET = {
    "powerfail": "previous",
    "safety": "on",
    "last_on_state": "on",
}


def powerup_lesen(powerup: Any) -> str | None:
    """Was die Bridge als Einschaltverhalten meldet (rein, testbar).

    «other» heisst: eingestellt, aber nichts, was der Hub anbietet
    (etwa «custom» mit Umschalten). Es steht so in der App, statt
    zufällig eines der drei Wörter zu sein.
    """
    if not isinstance(powerup, dict):
        return None
    preset = str(powerup.get("preset") or "")
    if preset in POWERUP_VON_PRESET:
        return POWERUP_VON_PRESET[preset]
    if preset != "custom":
        return None
    an = powerup.get("on") or {}
    modus = str(an.get("mode") or "")
    if modus == "previous":
        return "previous"
    if modus == "on":
        return "on" if (an.get("on") or {}).get("on", True) else "off"
    return "other"


def powerup_body(mode: str) -> dict[str, Any]:
    """Was für ``set_power_on`` an die Leuchte geht (rein, testbar).

    «aus» gibt es bei Hue nur als eigene Einstellung: Die Bridge kennt
    keine Voreinstellung dafür, wohl aber ``custom`` mit «an: nein».
    """
    if mode == "previous":
        return {"preset": "powerfail"}
    if mode == "on":
        return {"preset": "safety"}
    if mode == "off":
        return {"preset": "custom", "on": {"mode": "on", "on": {"on": False}}}
    raise HomePilotError("Nach Stromausfall geht nur 'previous', 'off' oder 'on'")


def farbtemperatur_mirek(data: dict[str, Any]) -> int:
    """Die gewünschte Farbtemperatur als Mirek, geklemmt auf Hues Bereich
    (153 = kalt/6500K … 500 = warm/2000K) (rein, testbar).

    Nimmt ``kelvin``, ``color_temp`` oder ``mirek`` entgegen - so, wie es
    beim jeweiligen Aufrufer gerade vorliegt.
    """
    if "kelvin" in data and float(data["kelvin"]) > 0:
        mirek = 1_000_000 / float(data["kelvin"])
    else:
        mirek = float(data.get("color_temp", data.get("mirek", 366)))
    return max(153, min(500, round(mirek)))


def xy_aus(data: dict[str, Any]) -> tuple[float, float] | None:
    """Die gewünschte Farbe als Farbort - oder nichts (rein, testbar).

    Die Bridge kennt kein Hex (core/farbraum.py). ``None`` heisst: Es
    war keine Farbe dabei, dann gehört auch keine in den PUT.
    """
    if "color" not in data:
        return None
    return hex_zu_xy(data.get("color"))


def light_body(command: str, data: dict[str, Any], war_an: bool) -> dict[str, Any]:
    """Der PUT-Rumpf für ein Kommando an ein Hue-Licht (rein, testbar) -
    Punkt 645 der Werkbank.

    ``war_an`` ist der Zustand vor dem Befehl - nur ``toggle`` braucht
    ihn.

    Eine Farbtemperatur reist im selben PUT wie das Einschalten oder
    Dimmen mit, wenn eine angegeben ist - nicht erst in einem zweiten,
    danach geschickten. Der gemeldete Fall: «Büro Spot 1» schaltete
    immer auf warmweiss, ganz gleich welchen Weisston man wählte. Der
    Hub schickte zwei PUT-Anfragen nacheinander - erst «an, mit dieser
    Helligkeit», dann «und diese Farbtemperatur» - und damit zwei
    Übergänge an der Lampe statt einem. Die zweite Anfrage kam auf der
    Zigbee-Funkstrecke der Leuchte manchmal zu spät oder ging unter,
    und die Lampe blieb bei der Farbe, mit der sie einschaltete. Jetzt
    trägt schon die erste Anfrage die gewünschte Farbtemperatur mit,
    wenn eine mitgegeben wurde - unabhängig davon, ob core/automation.py
    danach zusätzlich noch die eigene set_color_temp-Anfrage schickt
    (das bleibt sie, für Anbindungen, die diese Abkürzung nicht kennen -
    bei Hue bestätigt sie dann nur noch denselben Wert).
    """
    body: dict[str, Any] = {}
    if command == "turn_on":
        body["on"] = {"on": True}
        if "brightness" in data:
            body["dimming"] = {"brightness": float(data["brightness"])}
    elif command == "turn_off":
        body["on"] = {"on": False}
    elif command == "toggle":
        body["on"] = {"on": not war_an}
    elif command == "set_brightness":
        brightness = float(data.get("brightness", 100))
        body["dimming"] = {"brightness": brightness}
        body["on"] = {"on": brightness > 0}
    elif command == "set_power_on":
        # Nach Stromausfall (Punkt 630): keine Schaltung, eine
        # Einstellung - sie steht in der Leuchte selbst. Farbe hat hier
        # nichts verloren, deshalb hier heraus, bevor sie unten dazu käme.
        body["powerup"] = powerup_body(str(data.get("mode") or ""))
        return body

    schaltet_an = body.get("on", {}).get("on", True)
    # Farbe schlägt Weisston: Eine Lampe leuchtet entweder bunt oder
    # weiss, und wer in der Farbreihe tippt, meint die Farbe. Kämen
    # beide im selben PUT, entschiede die Bridge - und zwar je nach
    # Lampe verschieden.
    farbe = xy_aus(data) if command == "set_color" or schaltet_an else None
    if farbe is not None and (
        command == "set_color"
        or (schaltet_an and command in ("turn_on", "set_brightness"))
    ):
        body["color"] = {"xy": {"x": farbe[0], "y": farbe[1]}}
        if command == "set_color":
            # Ein Farbtipp an einer ausgeschalteten Lampe soll sie
            # anschalten - so steht es in der App an der Farbreihe («ein
            # Tipp schaltet ein und stellt die Farbe in einem Zug»), und
            # ohne das bliebe die Lampe dunkel und die Farbe ein
            # Versprechen für das nächste Einschalten.
            body.setdefault("on", {"on": True})
        return body
    if command == "set_color_temp" or (
        schaltet_an
        and command in ("turn_on", "set_brightness")
        and ("color_temp" in data or "mirek" in data or "kelvin" in data)
    ):
        body["color_temperature"] = {"mirek": farbtemperatur_mirek(data)}
    return body


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
                # Die Lampen als Entitäten des Hubs: Damit kann die
                # Szenen-Verwaltung vor dem Aufrufen festhalten, wie sie
                # standen, und der zweite Druck stellt es wieder her -
                # dasselbe «Bleibt aktiv» wie bei eigenen Szenen. Die
                # Bridge selbst kann das nicht.
                "lights": [self.entity_id(rid) for rid in scene.lights],
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
            # Ob die Lampe *gerade* weiss leuchtet, sagt die Bridge
            # ausdrücklich: In der Farbe steht `mirek_valid: false`, und
            # der letzte Weisston bleibt trotzdem stehen. Ohne dieses
            # Feld müsste die App raten, welcher der beiden Werte gilt -
            # und markierte dann in der Farbreihe und in den Weisstönen
            # je einen Punkt, obwohl nur einer leuchtet.
            changes["color_mode"] = (
                "weiss" if light["color_temperature"].get("mirek_valid") else "farbe"
            )
        # Die Farbe, in Hex wie überall sonst (core/farbraum.py). Ohne
        # sie stand in der App keine Farbreihe an einer Hue-Lampe, die
        # längst bunt kann - der gemeldete Fall.
        if "color" in light:
            xy = (light["color"] or {}).get("xy") or {}
            if isinstance(xy.get("x"), (int, float)) and isinstance(
                xy.get("y"), (int, float)
            ):
                changes["color"] = xy_zu_hex(xy["x"], xy["y"])
        # Das Einschaltverhalten kommt mit jeder Leuchte mit (Punkt 630)
        # - bisher las der Hub nur on und dimming und liess es liegen.
        if "powerup" in light:
            power_on = powerup_lesen(light["powerup"])
            if power_on:
                changes["power_on"] = power_on

        if self.hub.registry.get(entity_id) is None:
            name = (light.get("metadata") or {}).get("name") or "Hue Licht"
            commands = ["turn_on", "turn_off", "toggle"]
            if "dimming" in light:
                commands.append("set_brightness")
            if "color_temperature" in light:
                commands.append("set_color_temp")
            if "color" in light:
                commands.append("set_color")
            if "powerup" in light:
                commands.append("set_power_on")
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

        body = light_body(command, data, entity.state.get("state") == "on")

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
        if "powerup" in body:
            changes["power_on"] = str(data.get("mode"))
        if changes:
            await self.hub.registry.update_state(entity.id, changes)


INTEGRATION = HueIntegration
