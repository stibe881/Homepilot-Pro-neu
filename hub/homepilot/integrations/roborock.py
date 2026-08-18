"""Roborock-Staubsauger über die python-roborock-Bibliothek.

Konfiguration:
  - integration: roborock
    username: "${ROBOROCK_EMAIL}"
    password: "${ROBOROCK_PASSWORD}"
    scan_interval: 60

Voraussetzung (bewusst nicht in den Grundabhängigkeiten, die Bibliothek
ist gross):  pip install "homepilot[roborock]"  bzw.  pip install python-roborock

Die Anmeldung läuft über das Roborock-Konto; die Bibliothek verbindet sich
danach bevorzugt lokal mit dem Sauger. Kommandos: start, pause, stop, dock
und clean_rooms (gezielt einzelne oder mehrere Räume saugen).

Die Räume des Saugers stehen als state.rooms auf der Entität; die Karte
liefert der Schnappschuss-Endpunkt (GET /api/entities/{id}/snapshot) als
fertig gerendertes PNG – dieselbe Leitung, über die auch Kamerabilder
laufen.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
from pathlib import Path
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


# Saugstärke-Stufen → Code (V2, moderne S-Serie). Für die App bewusst auf
# vier verständliche Stufen reduziert.
FAN_SPEEDS: dict[str, int] = {
    "silent": 101,
    "balanced": 102,
    "turbo": 103,
    "max": 104,
}
_FAN_BY_CODE = {code: name for name, code in FAN_SPEEDS.items()}


def fan_speed_code(level: Any) -> int:
    """Name oder Zahl einer Saugstärke in den Gerätecode übersetzen (rein).

    Wirft bei unbekannter Stufe, damit der Fehler beim Benutzer ankommt.
    """
    if isinstance(level, (int, float)) or (isinstance(level, str) and level.isdigit()):
        return int(level)
    name = str(level).lower()
    if name not in FAN_SPEEDS:
        raise ValueError(
            f"Unbekannte Saugstärke '{level}' – erlaubt: {', '.join(FAN_SPEEDS)}"
        )
    return FAN_SPEEDS[name]


def vacuum_state(status: Any) -> dict[str, Any]:
    """Übersetzt den Status der Bibliothek in Entitäts-Attribute.

    Nimmt jedes Objekt mit den passenden Attributen – so bleibt die
    Übersetzung ohne Konto und Gerät testbar.
    """
    state_name = getattr(status, "state_name", None)
    result: dict[str, Any] = {
        "state": state_name or "unknown",
        "battery": getattr(status, "battery", None),
    }
    error = getattr(status, "error_code_name", None)
    if error and error not in ("none", "None"):
        result["error"] = error
    clean_area = getattr(status, "clean_area", None)
    if clean_area:
        # Die Bibliothek liefert mm² – die App soll m² zeigen.
        result["clean_area_m2"] = round(float(clean_area) / 1_000_000, 1)
    clean_time = getattr(status, "clean_time", None)
    if clean_time:
        result["clean_minutes"] = round(float(clean_time) / 60)
    fan = getattr(status, "fan_power", None)
    if fan is not None:
        # Enum (hat .name) oder roher Code – auf einen der vier Namen bringen.
        name = getattr(fan, "name", None)
        if name is None:
            try:
                name = _FAN_BY_CODE.get(int(fan))
            except (TypeError, ValueError):
                name = None
        if name:
            result["fan_speed"] = name
    return result


def parse_rooms(mappings: Any) -> list[dict[str, Any]]:
    """Übersetzt die Raumliste der Bibliothek in App-taugliche Einträge.

    Erwartet Objekte mit segment_id und name (NamedRoomMapping) – als reine
    Funktion auch ohne Konto und Gerät testbar.
    """
    rooms = []
    for mapping in mappings or []:
        segment_id = getattr(mapping, "segment_id", None)
        if segment_id is None:
            continue
        rooms.append({"id": int(segment_id), "name": str(getattr(mapping, "name", segment_id))})
    return sorted(rooms, key=lambda room: room["name"])


def room_boxes(map_data: Any) -> tuple[dict[int, list[float]], dict[str, int] | None]:
    """Raum-Nummer → Bereich [x0, y0, x1, y1] als Anteile (0..1) des
    gerenderten Kartenbilds, dazu die Bildgrösse in Pixeln.

    Damit kann die App Räume direkt auf der Karte antippbar machen, ohne
    das Kartenformat zu kennen. Rein bis auf die to_img-Umrechnung des
    Parsers – die liefert der Aufrufer mit, dadurch bleibt es testbar.
    """
    image = getattr(map_data, "image", None)
    rooms = getattr(map_data, "rooms", None) or {}
    if image is None or getattr(image, "is_empty", True):
        return {}, None
    dimensions = image.dimensions
    width = max(1, round(dimensions.width * dimensions.scale))
    height = max(1, round(dimensions.height * dimensions.scale))

    try:
        from vacuum_map_parser_base.map_data import Point
    except ImportError:  # in Tests ohne Kartenbibliothek
        from types import SimpleNamespace as Point  # type: ignore[assignment]

    boxes: dict[int, list[float]] = {}
    for number, room in rooms.items():
        corners = [
            dimensions.to_img(Point(x=room.x0, y=room.y0)),
            dimensions.to_img(Point(x=room.x1, y=room.y1)),
        ]
        xs = [corner.x / width for corner in corners]
        ys = [corner.y / height for corner in corners]
        boxes[int(number)] = [
            round(max(0.0, min(xs)), 4),
            round(max(0.0, min(ys)), 4),
            round(min(1.0, max(xs)), 4),
            round(min(1.0, max(ys)), 4),
        ]
    return boxes, {"width": width, "height": height}


def _image_size(map_data: Any) -> tuple[Any, int, int] | None:
    """Bild samt gerenderter Grösse – None, wenn (noch) keine Karte da ist."""
    image = getattr(map_data, "image", None)
    if image is None or getattr(image, "is_empty", True):
        return None
    dimensions = image.dimensions
    width = max(1, round(dimensions.width * dimensions.scale))
    height = max(1, round(dimensions.height * dimensions.scale))
    return dimensions, width, height


def _point_cls() -> Any:
    try:
        from vacuum_map_parser_base.map_data import Point
    except ImportError:  # in Tests ohne Kartenbibliothek
        from types import SimpleNamespace as Point  # type: ignore[assignment]
    return Point


def map_calibration(map_data: Any) -> dict[str, float] | None:
    """Umrechnung Karten-Millimeter ↔ Bild-Anteile, als affine Faktoren.

    to_img ist eine reine Verschiebung+Skalierung je Achse; zwei Stützpunkte
    genügen also, um sie umkehrbar festzuhalten. Gebraucht wird das für die
    Zonenreinigung: Die App wählt die Zone auf dem Bild (Anteile 0..1), der
    Sauger will Karten-Millimeter.
    """
    size = _image_size(map_data)
    if size is None:
        return None
    dimensions, width, height = size
    point = _point_cls()
    p0 = dimensions.to_img(point(x=0, y=0))
    p1 = dimensions.to_img(point(x=10_000, y=10_000))
    ax = (p1.x - p0.x) / 10_000
    ay = (p1.y - p0.y) / 10_000
    if ax == 0 or ay == 0:
        return None
    return {
        "ax": ax, "bx": float(p0.x),
        "ay": ay, "by": float(p0.y),
        "width": float(width), "height": float(height),
    }


def robot_position(map_data: Any) -> list[float] | None:
    """Position des Saugers als Bild-Anteile [x, y] – None ohne Karte/Position."""
    size = _image_size(map_data)
    if size is None:
        return None
    dimensions, width, height = size
    position = getattr(map_data, "vacuum_position", None)
    if position is None:
        return None
    pixel = dimensions.to_img(position)
    x = pixel.x / width
    y = pixel.y / height
    if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
        return None
    return [round(x, 4), round(y, 4)]


def zone_clean_params(zone: Any, calibration: dict[str, float]) -> list[list[int]]:
    """Parameter für APP_ZONED_CLEAN aus einer Bild-Zone (rein, testbar).

    ``zone`` sind zwei Ecken als Bild-Anteile [x0, y0, x1, y1]; der Sauger
    erwartet Karten-Millimeter mit x0<x1 und y0<y1 – nach dem Umrechnen wird
    deshalb sortiert (die Bild-y-Achse zeigt meist in die Gegenrichtung).
    """
    if not (isinstance(zone, (list, tuple)) and len(zone) == 4):
        raise ValueError("clean_zone braucht data.zone mit [x0, y0, x1, y1] (Anteile 0..1)")
    fx0, fy0, fx1, fy1 = (float(value) for value in zone)
    xs = sorted(
        round((fx * calibration["width"] - calibration["bx"]) / calibration["ax"])
        for fx in (fx0, fx1)
    )
    ys = sorted(
        round((fy * calibration["height"] - calibration["by"]) / calibration["ay"])
        for fy in (fy0, fy1)
    )
    if xs[0] == xs[1] or ys[0] == ys[1]:
        raise ValueError("Die Zone hat keine Fläche – zwei verschiedene Ecken wählen")
    return [[xs[0], ys[0], xs[1], ys[1], 1]]


def segment_clean_params(room_ids: list[Any]) -> list[dict[str, Any]]:
    """Parameter für APP_SEGMENT_CLEAN (rein, testbar).

    Wirft bei leerer oder unbrauchbarer Auswahl, damit der Fehler beim
    Benutzer ankommt statt still nichts zu passieren.
    """
    segments = [int(room_id) for room_id in room_ids or []]
    if not segments:
        raise ValueError("clean_rooms braucht data.rooms mit mindestens einer Raum-ID")
    return [{"segments": segments, "repeat": 1}]


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


class RoborockIntegration(Integration):
    name = "roborock"

    async def setup(self) -> None:
        username = self.config.get("username")
        if not username:
            raise ConfigError("roborock braucht 'username' (E-Mail des Roborock-Kontos)")

        # Erst hier importieren: Die Bibliothek ist gross und soll den Hub
        # ohne Roborock-Konfiguration nicht belasten.
        try:
            from roborock import RoborockCommand, UserData
            from roborock.devices.device_manager import (
                UserParams,
                create_device_manager,
            )
            from roborock.web_api import RoborockApiClient
        except ImportError as err:
            raise ConfigError(
                "python-roborock fehlt – installieren mit: pip install python-roborock"
            ) from err

        self._commands = {
            "start": RoborockCommand.APP_START,
            "pause": RoborockCommand.APP_PAUSE,
            "stop": RoborockCommand.APP_STOP,
            "dock": RoborockCommand.APP_CHARGE,
            "locate": RoborockCommand.FIND_ME,
        }
        self._segment_clean = RoborockCommand.APP_SEGMENT_CLEAN
        self._zone_clean = RoborockCommand.APP_ZONED_CLEAN
        self._set_fan = RoborockCommand.SET_CUSTOM_MODE
        self._interval = float(self.config.get("scan_interval", 60))
        # Während der Reinigung wird die Position öfter geholt als der
        # restliche Status, damit der Punkt auf der Karte live mitwandert.
        self._position_interval = float(self.config.get("position_interval", 15))
        # entity_id → Umrechnung Bild-Anteile ↔ Karten-Millimeter, wird bei
        # jedem Karten-Abruf aufgefrischt (die Karte kann sich verschieben).
        self._calibration: dict[str, dict[str, float]] = {}

        # Anmeldung: Gespeichertes Token bevorzugen. Sonst mit Passwort, was
        # aber bei vielen Konten nicht mehr geht (E-Mail-Code, Fehler 2031) –
        # dann auf den einmaligen Code-Login-Helfer verweisen.
        # 'base_url' erzwingt den Regions-Server (z.B. https://euiot.roborock.com):
        # Die automatische Suche probiert US zuerst und kann dort ein leeres
        # Zweitkonto erwischen bzw. anlegen.
        base_url = self.config.get("base_url")
        user_data = self._load_user_data(UserData)
        if user_data is None:
            password = self.config.get("password")
            if not password:
                raise ConfigError(
                    "roborock: keine Anmeldung. Einmalig mit E-Mail-Code anmelden: "
                    "python -m homepilot.integrations.roborock -c config.yaml"
                )
            api = RoborockApiClient(username, base_url=base_url)
            try:
                user_data = await api.pass_login(password)
            except Exception as err:
                raise ConfigError(
                    "Roborock-Anmeldung mit Passwort fehlgeschlagen "
                    f"({err}). Viele Konten verlangen inzwischen einen E-Mail-Code "
                    "(Fehler 2031). Einmalig anmelden mit: "
                    "python -m homepilot.integrations.roborock -c config.yaml"
                ) from err
        self.log.info(
            "Roborock-Konto: rruid=%s region=%s server=%s",
            getattr(user_data, "rruid", "?"),
            getattr(user_data, "region", "?"),
            base_url or "automatisch",
        )
        self._manager = await create_device_manager(
            UserParams(username=username, user_data=user_data, base_url=base_url)
        )

        # entity_id → Gerät der Bibliothek
        self._devices: dict[str, Any] = {}
        devices = list(await _maybe_await(self._manager.get_devices()))
        self.log.info("Roborock: %d Gerät(e) im Konto gefunden", len(devices))
        for device in devices:
            name = getattr(device, "name", "?")
            # Erst verbinden – manche Eigenschaften (v1_properties) füllen sich
            # erst danach.
            if not getattr(device, "is_connected", False):
                try:
                    await _maybe_await(device.connect())
                except Exception as err:
                    self.log.warning("Roborock: %s liess sich nicht verbinden: %s", name, err)
            v1 = getattr(device, "v1_properties", None)
            self.log.info(
                "Roborock-Gerät: name=%s duid=%s v1=%s attrs=%s",
                name,
                getattr(device, "duid", "?"),
                "ja" if v1 is not None else "nein",
                ", ".join(a for a in dir(device) if a.endswith("_properties")),
            )
            if v1 is None:
                # Nur Sauger mit v1-Protokoll – Waschtürme u.ä. haben andere APIs.
                continue
            entity = await self.add_entity(
                str(device.duid),
                EntityKind.VACUUM,
                name or "Roborock",
                state={"state": "unknown", "fan_speeds": list(FAN_SPEEDS)},
                commands=[*self._commands, "clean_rooms", "clean_zone", "set_fan_speed"],
                available=False,
            )
            self._devices[entity.id] = device
            await self._load_rooms(entity.id, device)

        if not self._devices:
            # Rohdaten des Kontos protokollieren, damit man sieht, was die
            # Cloud überhaupt liefert (welches Zuhause, welche Produkte).
            home = getattr(self._manager, "_home_data", None)
            if home is not None:
                self.log.info(
                    "Roborock-HomeData: id=%s eigene Geräte=%d geteilte=%d Produkte=[%s] Räume=%d",
                    getattr(home, "id", "?"),
                    len(getattr(home, "devices", []) or []),
                    len(getattr(home, "received_devices", []) or []),
                    ", ".join(
                        str(getattr(p, "model", getattr(p, "name", "?")))
                        for p in (getattr(home, "products", []) or [])
                    ),
                    len(getattr(home, "rooms", []) or []),
                )
            raise ConfigError(
                "Das Roborock-Konto liefert keinen Sauger. Häufigste Ursache: "
                "Der Sauger ist in der Xiaomi/Mi-Home-App eingebunden statt in "
                "der Roborock-App – dann muss er einmal in der Roborock-App "
                "hinzugefügt werden. Details stehen im Log (Roborock-HomeData)."
            )

        await self._refresh_all()
        self.start_task(self._poll_loop())

    async def teardown(self) -> None:
        await super().teardown()
        if hasattr(self, "_manager"):
            await _maybe_await(self._manager.close())

    def _token_file(self) -> Path:
        return Path(
            self.config.get("token_file")
            or Path(self.hub.config.data_file).parent / "roborock-token.json"
        )

    def _load_user_data(self, user_data_cls: Any) -> Any:
        """Gespeichertes UserData laden – None, wenn keins da/lesbar ist."""
        path = self._token_file()
        if not path.is_file():
            return None
        try:
            return user_data_cls.from_dict(json.loads(path.read_text()))
        except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as err:
            self.log.warning("roborock-token.json nicht lesbar (%s) – neu anmelden", err)
            return None

    async def _load_rooms(self, entity_id: str, device: Any) -> None:
        """Raumliste des Saugers holen und auf die Entität schreiben.

        Kein harter Fehler, wenn das Modell keine Räume kennt – dann fehlt
        in der App einfach die Raumauswahl.
        """
        try:
            rooms_trait = getattr(device.v1_properties, "rooms", None)
            if rooms_trait is None:
                return
            await _maybe_await(rooms_trait.refresh())
            rooms = parse_rooms(rooms_trait.rooms)
            if not rooms:
                return
        except Exception as err:
            self.log.warning("Raumliste von %s nicht abrufbar: %s", device.name, err)
            return

        # Raum-Bereiche aus der Karte, damit die App die Räume direkt auf
        # der Karte antippbar machen kann. Ohne Karte bleiben die Chips.
        state: dict[str, Any] = {"rooms": rooms}
        try:
            map_trait = getattr(device.v1_properties, "map_content", None)
            if map_trait is not None:
                await _maybe_await(map_trait.refresh())
                boxes, size = room_boxes(map_trait.map_data)
                for room in rooms:
                    if room["id"] in boxes:
                        room["box"] = boxes[room["id"]]
                if size:
                    state["map"] = size
                calibration = map_calibration(map_trait.map_data)
                if calibration:
                    self._calibration[entity_id] = calibration
                position = robot_position(map_trait.map_data)
                if position:
                    state["robot"] = position
        except Exception as err:
            self.log.debug("Raum-Bereiche von %s nicht abrufbar: %s", device.name, err)
        await self.hub.registry.update_state(entity_id, state)

    async def _poll_loop(self) -> None:
        # Zwei Takte in einer Schleife: Der Status kommt alle scan_interval
        # Sekunden, die Position eines gerade reinigenden Saugers öfter –
        # sie ändert sich im Sekundentakt, der Akkustand nicht.
        elapsed = 0.0
        while True:
            await asyncio.sleep(self._position_interval)
            elapsed += self._position_interval
            await self._track_positions()
            if elapsed >= self._interval:
                elapsed = 0.0
                await self._refresh_all()

    async def _track_positions(self) -> None:
        """Position der reinigenden Sauger nachführen (die anderen stehen).

        Der Kartenabruf ist der teuerste Einzelaufruf der Bibliothek –
        deshalb nur für Geräte, die sich wirklich bewegen.
        """
        for entity_id, device in self._devices.items():
            entity = self.hub.registry.get(entity_id)
            if entity is None or entity.state.get("state") != "cleaning":
                continue
            try:
                map_trait = getattr(device.v1_properties, "map_content", None)
                if map_trait is None:
                    continue
                await _maybe_await(map_trait.refresh())
                calibration = map_calibration(map_trait.map_data)
                if calibration:
                    self._calibration[entity_id] = calibration
                position = robot_position(map_trait.map_data)
                if position:
                    await self.hub.registry.update_state(entity_id, {"robot": position})
            except Exception as err:
                self.log.debug("Position von %s nicht abrufbar: %s", device.name, err)

    async def _refresh_all(self) -> None:
        for entity_id, device in self._devices.items():
            try:
                status = device.v1_properties.status
                await _maybe_await(status.refresh())
                await self.hub.registry.update_state(
                    entity_id, vacuum_state(status), available=True
                )
            except Exception as err:
                self.log.warning("Roborock %s nicht erreichbar: %s", device.name, err)
                await self.hub.registry.update_state(entity_id, {}, available=False)

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        device = self._devices[entity.id]
        properties = device.v1_properties
        sender = getattr(properties, "command", None) or getattr(
            properties.status, "command", None
        )
        if sender is None:
            raise ConfigError("Dieses Gerät nimmt keine Kommandos entgegen")
        if command == "clean_rooms":
            await _maybe_await(
                sender.send(self._segment_clean, params=segment_clean_params(data.get("rooms")))
            )
        elif command == "clean_zone":
            calibration = self._calibration.get(entity.id)
            if calibration is None:
                # Karte einmal holen – die Umrechnung fällt dabei mit ab.
                await self.snapshot(entity)
                calibration = self._calibration.get(entity.id)
            if calibration is None:
                raise ConfigError(
                    "Ohne Karte keine Zonenreinigung – der Sauger liefert gerade keine."
                )
            await _maybe_await(
                sender.send(
                    self._zone_clean, params=zone_clean_params(data.get("zone"), calibration)
                )
            )
        elif command == "set_fan_speed":
            await _maybe_await(
                sender.send(self._set_fan, params=[fan_speed_code(data.get("level"))])
            )
        else:
            await _maybe_await(sender.send(self._commands[command]))
        await self._refresh_all()

    async def snapshot(self, entity: Entity) -> bytes | None:
        """Die Karte des Saugers als fertig gerendertes PNG."""
        device = self._devices.get(entity.id)
        if device is None:
            return None
        try:
            map_trait = getattr(device.v1_properties, "map_content", None)
            if map_trait is None:
                return None
            await _maybe_await(map_trait.refresh())
            # Die frisch geladene Karte weiss, wo der Sauger gerade steht –
            # das wandert als Nebeneffekt in den Zustand, damit die App die
            # Position zeigen kann, ohne die Karte doppelt abzurufen. Die
            # Umrechnung für die Zonenreinigung frischt dabei gleich mit auf.
            try:
                calibration = map_calibration(map_trait.map_data)
                if calibration:
                    self._calibration[entity.id] = calibration
                position = robot_position(map_trait.map_data)
                if position:
                    await self.hub.registry.update_state(entity.id, {"robot": position})
            except Exception:
                pass
            return map_trait.image_content
        except Exception as err:
            self.log.debug("Karte von %s nicht abrufbar: %s", device.name, err)
            return None


INTEGRATION = RoborockIntegration


# ── Anmelde-Helfer ─────────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.roborock -c config.yaml
# Fordert einen Code per E-Mail an, fragt ihn ab, meldet sich an und legt das
# Token neben die homepilot-data.json. Danach braucht die config.yaml kein
# Passwort mehr – der Hub nutzt das gespeicherte Token.


async def _login_main(config_path: str) -> int:
    from roborock.web_api import RoborockApiClient

    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "roborock"]
    username = (blocks[0].get("username") if blocks else None) or input(
        "Roborock-E-Mail: "
    ).strip()

    # Regions-Server: Die automatische Suche probiert US zuerst – existiert
    # das Konto dort nicht, legt der Code-Login ein leeres Zweitkonto an und
    # der Hub sieht 0 Geräte. Für die Schweiz/Europa ist 'eu' richtig.
    base_url = blocks[0].get("base_url") if blocks else None
    if not base_url:
        region = (
            input("Region [eu/us/cn/ru, leer = automatisch]: ").strip().lower()
        )
        if region in ("eu", "us", "cn", "ru"):
            base_url = f"https://{region}iot.roborock.com"
    if base_url:
        print(f"Verwende Server {base_url}")

    api = RoborockApiClient(username, base_url=base_url)

    async def _try(request: str, login: str) -> Any:
        """Code anfordern, abfragen, anmelden – über den gegebenen Endpunkt."""
        print(f"Fordere Anmeldecode für {username} an …")
        await getattr(api, request)()
        print("Ein Code wurde an deine E-Mail geschickt (Absender Roborock).")
        code = input("Code aus der E-Mail: ").strip()
        return await getattr(api, login)(code)

    # Zuerst der neuere v4-Endpunkt: er erkennt die in der App bestätigte
    # Nutzungsvereinbarung, wo der alte Weg noch „user agreement“ meldet.
    user_data = None
    for request, login in (("request_code_v4", "code_login_v4"), ("request_code", "code_login")):
        if not hasattr(api, login):
            continue
        try:
            user_data = await _try(request, login)
            break
        except Exception as err:
            print(f"  {login} fehlgeschlagen: {err}")
            if "user agreement" in str(err).lower():
                print(
                    "  → In der Roborock-App die aktualisierte Nutzungsvereinbarung "
                    "bestätigen (Profil → Einstellungen), dann erneut versuchen."
                )
    if user_data is None:
        print("✗ Anmeldung fehlgeschlagen.")
        return 1

    # Konto-ID zeigen: Sie muss mit der in der Roborock-App (Profil)
    # übereinstimmen – sonst ist man auf dem falschen Regions-Server gelandet.
    print(
        f"Angemeldet als rruid={getattr(user_data, 'rruid', '?')} "
        f"region={getattr(user_data, 'region', '?')}"
    )

    token_file = Path(
        (blocks[0].get("token_file") if blocks else None)
        or Path(config.data_file).parent / "roborock-token.json"
    )
    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(json.dumps(user_data.as_dict()))
    os.chmod(token_file, 0o600)
    print(f"✓ Token gespeichert in {token_file} – jetzt den Hub (neu) starten.")
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Roborock-Anmeldung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    args = parser.parse_args()
    sys.exit(asyncio.run(_login_main(args.config)))
