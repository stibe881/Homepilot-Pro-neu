"""Benutzer und Rollen.

Drei Rollen, vom Alltag her gedacht:

  besitzer  – darf alles, auch Benutzer verwalten und Automationen ändern
  bewohner  – bedient das ganze Haus, darf Automationen pausieren
  gast      – sieht und schaltet nur, was ausdrücklich freigegeben ist

Jeder Benutzer hat sein eigenes Token. Damit steht in jedem Protokolleintrag,
wer etwas geschaltet hat, und ein Zugang lässt sich einzeln zurückziehen,
ohne dass alle anderen ein neues Token brauchen.
"""

from __future__ import annotations

import fnmatch
import secrets
from dataclasses import dataclass, field
from typing import Any

from .errors import ConfigError


class Role:
    OWNER = "besitzer"
    RESIDENT = "bewohner"
    GUEST = "gast"

    ALL = (OWNER, RESIDENT, GUEST)


class Capability:
    CONTROL = "control"
    VIEW_HISTORY = "view_history"
    VIEW_AUTOMATIONS = "view_automations"
    PAUSE_AUTOMATIONS = "pause_automations"
    EDIT_AUTOMATIONS = "edit_automations"
    VIEW_SYSTEM = "view_system"
    MANAGE_USERS = "manage_users"


CAPABILITIES: dict[str, frozenset[str]] = {
    Role.OWNER: frozenset(
        {
            Capability.CONTROL,
            Capability.VIEW_HISTORY,
            Capability.VIEW_AUTOMATIONS,
            Capability.PAUSE_AUTOMATIONS,
            Capability.EDIT_AUTOMATIONS,
            Capability.VIEW_SYSTEM,
            Capability.MANAGE_USERS,
        }
    ),
    Role.RESIDENT: frozenset(
        {
            Capability.CONTROL,
            Capability.VIEW_HISTORY,
            Capability.VIEW_AUTOMATIONS,
            Capability.PAUSE_AUTOMATIONS,
            Capability.VIEW_SYSTEM,
        }
    ),
    # Gäste dürfen bedienen, aber nichts über das Haus erfahren.
    Role.GUEST: frozenset({Capability.CONTROL}),
}

# Was ein Gast ohne ausdrückliche Freigabe sehen darf: Licht und Schalter.
# Kameras, Anwesenheit und Sensoren bleiben aussen vor.
GUEST_DEFAULT_KINDS = frozenset({"light", "switch"})


@dataclass
class User:
    name: str
    role: str
    token: str
    # Muster auf Entitäts-IDs, z.B. ["hue.*", "mqtt.sonoff_kueche"].
    allow: list[str] = field(default_factory=list)

    def can(self, capability: str) -> bool:
        return capability in CAPABILITIES.get(self.role, frozenset())

    def may_see(self, entity_id: str, kind: str) -> bool:
        if self.role != Role.GUEST:
            return True
        if self.allow:
            return any(fnmatch.fnmatch(entity_id, pattern) for pattern in self.allow)
        return kind in GUEST_DEFAULT_KINDS

    def as_dict(self, include_token: bool = False) -> dict[str, Any]:
        data: dict[str, Any] = {
            "name": self.name,
            "role": self.role,
            "allow": list(self.allow),
        }
        if include_token:
            data["token"] = self.token
        return data


class UserRegistry:
    """Hält die Benutzer und schlägt sie über ihr Token nach."""

    def __init__(self, users: list[User], open_access: bool = False) -> None:
        self._users = list(users)
        # Ohne konfigurierte Benutzer und ohne Token ist die API offen –
        # nur fürs eigene Netz gedacht, dann gilt jeder als Besitzer.
        self.open_access = open_access

    @property
    def users(self) -> list[User]:
        return list(self._users)

    def by_token(self, token: str | None) -> User | None:
        if self.open_access:
            return User(name="Offener Zugang", role=Role.OWNER, token="")
        if not token:
            return None
        for user in self._users:
            # Konstante Laufzeit, damit sich ein Token nicht erraten lässt,
            # indem man die Antwortzeit misst.
            if secrets.compare_digest(user.token, token):
                return user
        return None

    def by_name(self, name: str) -> User | None:
        return next((user for user in self._users if user.name == name), None)

    def add(self, user: User) -> None:
        if self.by_name(user.name):
            raise ConfigError(f"Benutzer '{user.name}' existiert bereits")
        self._users.append(user)

    def remove(self, name: str) -> bool:
        user = self.by_name(name)
        if user is None:
            return False
        if user.role == Role.OWNER and self._owner_count() <= 1:
            raise ConfigError("Der letzte Besitzer kann nicht entfernt werden")
        self._users.remove(user)
        return True

    def _owner_count(self) -> int:
        return sum(1 for user in self._users if user.role == Role.OWNER)


def parse_users(raw: list[dict[str, Any]], legacy_token: str | None) -> UserRegistry:
    """Baut die Benutzerliste aus der Konfiguration.

    Ein einzelnes ``api.token`` aus früheren Fassungen gilt weiterhin und
    wird als Besitzer geführt – bestehende Einrichtungen brechen dadurch
    nicht.
    """
    users: list[User] = []
    for entry in raw:
        name = entry.get("name")
        token = entry.get("token")
        role = str(entry.get("role", Role.RESIDENT)).lower()
        if not name or not token:
            raise ConfigError("Jeder Benutzer braucht 'name' und 'token'")
        if role not in Role.ALL:
            raise ConfigError(
                f"Unbekannte Rolle '{role}' für {name} – erlaubt: {', '.join(Role.ALL)}"
            )
        allow = entry.get("allow") or []
        if not isinstance(allow, list):
            raise ConfigError(f"'allow' bei {name} muss eine Liste sein")
        users.append(
            User(name=str(name), role=role, token=str(token), allow=[str(a) for a in allow])
        )

    if legacy_token and not any(user.token == legacy_token for user in users):
        users.append(User(name="Hub-Token", role=Role.OWNER, token=legacy_token))

    if users and not any(user.role == Role.OWNER for user in users):
        raise ConfigError("Mindestens ein Benutzer muss die Rolle 'besitzer' haben")

    return UserRegistry(users, open_access=not users)
