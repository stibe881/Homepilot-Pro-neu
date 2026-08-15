"""Overkiz (Somfy TaHoma & Co.) – Storen, Rollläden, Markisen.

Konfiguration:
  - integration: overkiz
    host: gateway-2310-9733-0267.local:8443
    token: "${OVERKIZ_TOKEN}"    # lokales Token, siehe unten

Voraussetzung:  pip install "homepilot[overkiz]"  bzw.  pip install pyoverkiz

Gesteuert wird lokal über das Gateway (Somfy Developer Mode) – schnell und
ohne Cloud. Einmalig braucht es ein lokales Token. Am einfachsten direkt
in der TaHoma-App erzeugen:

  1. Im Somfy-/TaHoma-Konto den Entwicklermodus für das Gateway aktivieren.
  2. In der TaHoma-App unter „Token verwalten“ ein neues lokales Token
     erstellen und in die config.yaml eintragen (token: ...).
  3. Hub (neu) starten.

Alternativ erzeugt der Helfer das Token über die Somfy-Cloud und legt es
in overkiz-token.json:
     python -m homepilot.integrations.overkiz -c config.yaml

Aussenraffstoren (ExteriorVenetianBlind) haben Position UND Lamellenwinkel;
beides erscheint als cover-Entität mit den Kommandos open/close/stop,
set_position und – wo vorhanden – set_tilt.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Overkiz-Widgets, die wir als Storen/Rollläden (cover) führen.
COVER_WIDGETS = {
    "ExteriorVenetianBlind",
    "PositionableExteriorVenetianBlind",
    "RollerShutter",
    "PositionableRollerShutter",
    "PositionableScreen",
    "PositionableHorizontalAwning",
    "UpDownRollerShutter",
    "Awning",
    "Blind",
}
COVER_UI_CLASSES = {"ExteriorVenetianBlind", "RollerShutter", "Screen", "Awning", "Blind"}

# Zustandsnamen der Overkiz-API.
CLOSURE = "core:ClosureState"          # 0 = offen, 100 = geschlossen
ORIENTATION = "core:SlateOrientationState"  # Lamellenwinkel 0…100
OPEN_CLOSED = "core:OpenClosedState"

# Ein Storen-Kommando heisst je nach Funk-Standard anders: io-homecontrol
# kennt open/close/stop, RTS dagegen up/down/my. Deshalb bilden wir jedes
# App-Kommando auf die erste vom Gerät wirklich unterstützte Variante ab –
# sonst antwortet das Gateway mit „No such command" (UNSPECIFIED_ERROR).
COMMAND_ALIASES: dict[str, list[str]] = {
    "open": ["open", "up", "rollUp"],
    "close": ["close", "down", "rollDown"],
    "stop": ["stop", "my"],
    "set_position": ["setClosure"],
    "set_tilt": ["setOrientation"],
}


def cover_state(states: dict[str, Any]) -> dict[str, Any]:
    """Übersetzt Overkiz-Zustände in Entitäts-Attribute (rein, testbar).

    Overkiz zählt 'closure' als Geschlossenheit (0 offen … 100 zu); die App
    denkt in 'offen %', deshalb wird hier gedreht.
    """
    result: dict[str, Any] = {}
    closure = states.get(CLOSURE)
    open_closed = states.get(OPEN_CLOSED)
    if closure is not None:
        try:
            position = max(0, min(100, 100 - int(closure)))
            result["position"] = position
            result["state"] = (
                "open" if position >= 99 else "closed" if position <= 1 else "partial"
            )
        except (TypeError, ValueError):
            pass
    if "state" not in result and open_closed is not None:
        result["state"] = "open" if str(open_closed).lower() == "open" else "closed"
    orientation = states.get(ORIENTATION)
    if orientation is not None:
        try:
            result["tilt"] = max(0, min(100, int(orientation)))
        except (TypeError, ValueError):
            pass
    result.setdefault("state", "unknown")
    return result


class OverkizIntegration(Integration):
    name = "overkiz"

    async def setup(self) -> None:
        host = self.config.get("host")
        if not host:
            raise ConfigError(
                "overkiz braucht 'host' (z.B. gateway-XXXX-XXXX-XXXX.local:8443)"
            )

        try:
            from pyoverkiz.client import OverkizClient
            from pyoverkiz.models import Command
            from pyoverkiz.utils import generate_local_server
        except ImportError as err:
            raise ConfigError(
                "pyoverkiz fehlt – installieren mit: pip install pyoverkiz"
            ) from err

        self._Command = Command
        token = self.config.get("token") or self._load_token()
        if not token:
            raise ConfigError(
                "overkiz: kein Token – einmalig anmelden mit: "
                "python -m homepilot.integrations.overkiz -c config.yaml"
            )

        # Lokale API über das Gateway: eigener SSL-Kontext der Bibliothek.
        server = generate_local_server(host=host)
        self._session = self.http_session()
        self._client = OverkizClient(
            username="", password="", server=server, token=token,
            verify_ssl=False, session=self._session,
        )
        try:
            await self._client.login()
        except Exception as err:
            # Im Docker-Container lässt sich ein .local-mDNS-Name nicht
            # auflösen – der häufigste Stolperstein. Klarer Hinweis statt
            # rohem DNS-Fehler.
            if ".local" in host:
                raise ConfigError(
                    f"Gateway '{host}' nicht erreichbar. Im Container lässt sich der "
                    ".local-Name meist nicht auflösen – trag die feste IP des Gateways "
                    "ein (z.B. host: 192.168.1.50:8443) und gib ihm im Router eine "
                    "feste Adresse."
                ) from err
            raise ConfigError(f"Overkiz-Gateway '{host}' nicht erreichbar: {err}") from err

        # device_url → entity_id und zurück; je Entität die Abbildung
        # App-Kommando → echter Overkiz-Kommandoname (open→up bei RTS usw.).
        self._devices: dict[str, str] = {}
        self._url_by_entity: dict[str, str] = {}
        self._cmd_by_entity: dict[str, dict[str, list[str]]] = {}
        for device in await self._client.get_devices():
            if not self._is_cover(device):
                continue
            states = {state.name: state.value for state in device.states or []}
            supported = {
                cd.command_name for cd in getattr(device.definition, "commands", []) or []
            }
            # Je App-Kommando ALLE vom Gerät gekannten Varianten, nach Vorzug
            # sortiert. Wird die erste abgewiesen, probiert handle_command die
            # nächste – ein abgelehnter Befehl bewegt ohnehin nichts.
            cmd_map: dict[str, list[str]] = {}
            for app_cmd, variants in COMMAND_ALIASES.items():
                got = [v for v in variants if v in supported]
                if got:
                    cmd_map[app_cmd] = got
            # setClosure/setOrientation nur, wenn es dazu auch einen Zustand gibt
            # (sonst hätte die App einen Regler ohne Rückmeldung).
            if CLOSURE not in states:
                cmd_map.pop("set_position", None)
            if ORIENTATION not in states:
                cmd_map.pop("set_tilt", None)
            commands = list(cmd_map.keys())
            self.log.info(
                "Overkiz: %s (%s) – App-Kommandos [%s]; Gerät kann [%s]",
                device.label,
                getattr(device, "widget", None) or getattr(device, "ui_class", None),
                ", ".join(commands) or "keine",
                ", ".join(sorted(supported)) or "keine",
            )
            entity = await self.add_entity(
                device.device_url.replace("/", "_").replace(":", "_"),
                EntityKind.COVER,
                device.label or "Storen",
                state=cover_state(states),
                commands=commands,
                available=bool(getattr(device, "available", True)),
            )
            self._devices[device.device_url] = entity.id
            self._url_by_entity[entity.id] = device.device_url
            self._cmd_by_entity[entity.id] = cmd_map

        if not self._devices:
            self.log.warning("Overkiz verbunden, aber keine Storen/Rollläden gefunden")

        self.start_task(self._event_loop())

    @staticmethod
    def _is_cover(device: Any) -> bool:
        return (
            str(getattr(device, "widget", "")) in COVER_WIDGETS
            or str(getattr(device, "ui_class", "")) in COVER_UI_CLASSES
        )

    def _token_file(self) -> Path:
        return Path(
            self.config.get("token_file")
            or Path(self.hub.config.data_file).parent / "overkiz-token.json"
        )

    def _load_token(self) -> str | None:
        path = self._token_file()
        if not path.is_file():
            return None
        try:
            return json.loads(path.read_text()).get("token")
        except (OSError, json.JSONDecodeError):
            return None

    # ── Gateway → Hub ────────────────────────────────────────────────────────

    async def _event_loop(self) -> None:
        """Live-Updates über den Ereigniskanal des Gateways."""
        while True:
            try:
                await self._client.register_event_listener()
                while True:
                    for event in await self._client.fetch_events():
                        await self._handle_event(event)
                    await asyncio.sleep(2)
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.debug("Overkiz-Ereigniskanal unterbrochen (%s), neu in 15s", err)
                await asyncio.sleep(15)

    async def _handle_event(self, event: Any) -> None:
        device_url = getattr(event, "device_url", None)
        entity_id = self._devices.get(device_url) if device_url else None
        if entity_id is None:
            return
        changed = getattr(event, "device_states", None)
        if not changed:
            return
        states = {state.name: state.value for state in changed}
        updates = cover_state(states)
        # Nur melden, was das Event wirklich enthielt (kein Zustand erfunden).
        if "position" not in updates and CLOSURE not in states:
            updates.pop("position", None)
        await self.hub.registry.update_state(entity_id, updates, available=True)

    # ── Hub → Gateway ────────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        device_url = self._url_by_entity[entity.id]
        Command = self._Command
        # Alle vom Gerät gekannten Varianten dieses App-Kommandos (Vorzug zuerst).
        variants = self._cmd_by_entity.get(entity.id, {}).get(command)
        if not variants:
            raise ConfigError(f"Diese Storen kennen das Kommando '{command}' nicht")
        # Parameter bestimmen. Wichtig: leere Liste statt None – sonst wird aus
        # dem JSON-null in der Gateway-Firmware ein 'nil' und der Befehl fällt
        # mit UNSPECIFIED_ERROR / error:'nil' durch.
        if command == "set_position":
            # App: offen %, Overkiz: geschlossen %.
            params: list[Any] = [max(0, min(100, 100 - int(data.get("position", 0))))]
        elif command == "set_tilt":
            params = [max(0, min(100, int(data.get("tilt", 0))))]
        else:
            params = []

        last_err: Exception | None = None
        for name in variants:
            self.log.info("Overkiz sendet '%s' an %s", name, device_url)
            try:
                await self._client.execute_command(device_url, Command(name, params))
                # Klappt eine spätere Variante, in Zukunft direkt diese nehmen.
                if name != variants[0]:
                    self._cmd_by_entity[entity.id][command] = [name]
                return
            except Exception as err:
                last_err = err
                self.log.warning(
                    "Overkiz: '%s' abgewiesen (%s) – nächste Variante", name, err
                )
        raise ConfigError(f"Gateway lehnt '{command}' ab: {last_err}")


INTEGRATION = OverkizIntegration


# ── Anmelde-Helfer ─────────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.overkiz -c config.yaml
# Loggt sich einmalig in die Somfy-Cloud ein, erzeugt ein lokales Token für
# das Gateway und legt es neben die homepilot-data.json.


async def _login_main(config_path: str) -> int:
    import getpass

    from pyoverkiz.client import OverkizClient
    from pyoverkiz.const import SUPPORTED_SERVERS

    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "overkiz"]
    host = (blocks[0].get("host") if blocks else None) or input("Gateway-Host: ").strip()
    # gateway-2310-9733-0267.local:8443 → Gateway-ID 2310-9733-0267
    gateway_id = host.split(".")[0].replace("gateway-", "")

    print("Verfügbare Server (die meisten Somfy-Nutzer in Europa: somfy_europe):")
    print("  " + ", ".join(sorted(str(s.value) for s in SUPPORTED_SERVERS)))
    server_key = input("Server [somfy_europe]: ").strip() or "somfy_europe"
    overkiz_server = next(
        (srv for key, srv in SUPPORTED_SERVERS.items() if key.value == server_key), None
    )
    if overkiz_server is None:
        print(f"✗ Unbekannter Server '{server_key}'")
        return 1

    username = input("Somfy-E-Mail: ").strip()
    password = getpass.getpass("Somfy-Passwort: ")

    # Durchgängig Keyword-Argumente: manche pyoverkiz-Versionen machen
    # username/password keyword-only.
    async with OverkizClient(
        username=username, password=password, server=overkiz_server
    ) as client:
        try:
            await client.login()
            token = await client.generate_local_token(gateway_id)
            await client.activate_local_token(
                gateway_id=gateway_id, token=token, label="HomePilot"
            )
        except Exception as err:
            print(f"✗ Anmeldung/Token fehlgeschlagen: {err}")
            print("  Ist der Entwicklermodus für das Gateway aktiviert?")
            return 1

    token_file = Path(
        (blocks[0].get("token_file") if blocks else None)
        or Path(config.data_file).parent / "overkiz-token.json"
    )
    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(json.dumps({"token": token}))
    os.chmod(token_file, 0o600)
    print(f"✓ Lokales Token erstellt und in {token_file} gespeichert – jetzt den Hub starten.")
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Overkiz-Anmeldung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    args = parser.parse_args()
    sys.exit(asyncio.run(_login_main(args.config)))
