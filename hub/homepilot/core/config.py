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


@dataclass
class HubConfig:
    api: ApiConfig = field(default_factory=ApiConfig)
    supabase: dict[str, Any] = field(default_factory=dict)
    integrations: list[dict[str, Any]] = field(default_factory=list)
    automations: list[dict[str, Any]] = field(default_factory=list)
    # Raumname → Liste von Entitäts-IDs. Die App macht daraus ihre Reiter.
    rooms: dict[str, list[str]] = field(default_factory=dict)


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

    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise ConfigError("Konfiguration muss ein YAML-Mapping sein")
    raw = expand_env(raw)

    api_raw = raw.get("api") or {}
    api = ApiConfig(
        host=api_raw.get("host", "0.0.0.0"),
        port=int(api_raw.get("port", 8123)),
        token=api_raw.get("token"),
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

    return HubConfig(
        api=api,
        supabase=supabase,
        integrations=integrations,
        automations=automations,
        rooms={
            str(name): [str(member) for member in members]
            for name, members in rooms.items()
        },
    )
