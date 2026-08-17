"""Laden und Validieren der YAML-Konfiguration."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .errors import ConfigError

ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


@dataclass
class ApiConfig:
    host: str = "0.0.0.0"
    port: int = 8123
    token: str | None = None
    # Herkünfte, denen der Browser Zugriff erlauben darf. "*" ist für ein
    # Gerät im eigenen Netz vertretbar, weil der Token nicht automatisch
    # mitgeschickt wird; einschränken lässt es sich trotzdem.
    cors_origins: list[str] = field(default_factory=lambda: ["*"])


@dataclass
class HubConfig:
    api: ApiConfig = field(default_factory=ApiConfig)
    supabase: dict[str, Any] = field(default_factory=dict)
    integrations: list[dict[str, Any]] = field(default_factory=list)
    automations: list[dict[str, Any]] = field(default_factory=list)
    # Raumname → Liste von Entitäts-IDs. Die App macht daraus ihre Reiter.
    rooms: dict[str, list[str]] = field(default_factory=dict)
    scenes: list[dict[str, Any]] = field(default_factory=list)
    users: list[dict[str, Any]] = field(default_factory=list)
    # Strompreis für die Kostenanzeige, z.B. {price_per_kwh: 0.32, currency: CHF}
    energy: dict[str, Any] = field(default_factory=dict)
    # Standort für Sonnenauf-/-untergangs-Trigger. Standard: Zell LU.
    location: dict[str, Any] = field(default_factory=dict)
    # Live-Bild: Adressen von mediamtx, falls es nicht neben dem Hub läuft
    # ({mediamtx_api, mediamtx_hls}). Leer = die Standardadressen probieren.
    streaming: dict[str, Any] = field(default_factory=dict)
    # Push-Nachrichten: {public_url: "https://haus.example.ch"} – die von
    # aussen erreichbare Adresse des Hubs. Nur damit kann eine Alarm-Meldung
    # das Kamerabild mitbringen; das Telefon holt es beim Anzeigen selbst,
    # also ohne Token. Ohne diesen Eintrag geht die Nachricht ohne Bild raus.
    push: dict[str, Any] = field(default_factory=dict)
    # Wohin in der App angelegte Benutzer und Automationen geschrieben werden.
    data_file: str | None = None
    # Woher diese Konfiguration geladen wurde – für den Editor in der App.
    source_path: str | None = None


def expand_env(value: Any) -> Any:
    """Ersetzt ${VARIABLE} rekursiv durch Umgebungsvariablen.

    So bleiben Tokens und Keys aus der Konfigurationsdatei heraus. Eine
    nicht gesetzte Variable ist ein Fehler – lieber ein klarer Abbruch als
    ein Hub, der sich still ohne Datenbank verbindet.
    """
    if isinstance(value, str):
        def replace(match: re.Match[str]) -> str:
            name = match.group(1)
            resolved = os.environ.get(name)
            if resolved is None:
                raise ConfigError(f"Umgebungsvariable '{name}' ist nicht gesetzt")
            return resolved

        return ENV_PATTERN.sub(replace, value)
    if isinstance(value, dict):
        return {key: expand_env(item) for key, item in value.items()}
    if isinstance(value, list):
        return [expand_env(item) for item in value]
    return value


def load_config(path: str | Path) -> HubConfig:
    path = Path(path)
    if not path.exists():
        raise ConfigError(f"Konfigurationsdatei nicht gefunden: {path}")

    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as err:
        # Als ConfigError weiterreichen, damit der Fehler überall lesbar
        # ankommt – etwa als Meldung im Konfigurations-Editor der App.
        raise ConfigError(f"Kein gültiges YAML: {err}") from err
    if not isinstance(raw, dict):
        raise ConfigError("Konfiguration muss ein YAML-Mapping sein")
    raw = expand_env(raw)

    api_raw = raw.get("api") or {}
    origins = api_raw.get("cors_origins")
    if origins is not None and not isinstance(origins, list):
        raise ConfigError("'api.cors_origins' muss eine Liste sein")
    api = ApiConfig(
        host=api_raw.get("host", "0.0.0.0"),
        port=int(api_raw.get("port", 8123)),
        token=api_raw.get("token"),
        cors_origins=[str(origin) for origin in origins] if origins else ["*"],
    )

    supabase = raw.get("supabase") or {}
    if not isinstance(supabase, dict):
        raise ConfigError("'supabase' muss ein Mapping sein")

    integrations = raw.get("integrations") or []
    automations = raw.get("automations") or []
    if not isinstance(integrations, list) or not isinstance(automations, list):
        raise ConfigError("'integrations' und 'automations' müssen Listen sein")

    rooms = raw.get("rooms") or {}
    if not isinstance(rooms, dict) or not all(
        isinstance(members, list) for members in rooms.values()
    ):
        raise ConfigError("'rooms' muss Raumnamen auf Listen von Entitäts-IDs abbilden")

    scenes = raw.get("scenes") or []
    users = raw.get("users") or []
    if not isinstance(scenes, list) or not isinstance(users, list):
        raise ConfigError("'scenes' und 'users' müssen Listen sein")

    energy = raw.get("energy") or {}
    if not isinstance(energy, dict):
        raise ConfigError("'energy' muss ein Mapping sein")

    location = raw.get("location") or {}
    if not isinstance(location, dict):
        raise ConfigError("'location' muss ein Mapping sein (latitude, longitude)")

    streaming = raw.get("streaming") or {}
    if not isinstance(streaming, dict):
        raise ConfigError("'streaming' muss ein Mapping sein (mediamtx_api, mediamtx_hls)")

    push_config = raw.get("push") or {}
    if not isinstance(push_config, dict):
        raise ConfigError("'push' muss ein Mapping sein (public_url)")
    public_url = push_config.get("public_url")
    if public_url is not None and not str(public_url).startswith(("http://", "https://")):
        # Lieber hier abbrechen als später eine Nachricht mit einem leeren
        # Kasten verschicken, wo ein Bild sein sollte.
        raise ConfigError(
            "'push.public_url' muss mit http:// oder https:// beginnen, "
            f"nicht «{public_url}»"
        )

    # Neben der config.yaml, wenn nichts anderes angegeben ist.
    data_file = raw.get("data_file") or str(path.parent / "homepilot-data.json")

    return HubConfig(
        api=api,
        supabase=supabase,
        data_file=str(data_file),
        integrations=integrations,
        automations=automations,
        rooms={
            str(name): [str(member) for member in members]
            for name, members in rooms.items()
        },
        scenes=scenes,
        users=users,
        streaming=streaming,
        energy=energy,
        location=location,
        push=push_config,
        source_path=str(path),
    )
