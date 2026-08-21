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
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .errors import ConfigError

_HHMM = re.compile(r"\d{2}:\d{2}")


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
    EDIT_CONFIG = "edit_config"


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
            Capability.EDIT_CONFIG,
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

# Freigebbare Bereiche für Gäste. Jeder Bereich wird auf Geräte übersetzt;
# 'familie' schaltet die geteilten Familien-Listen frei, 'raeume' die
# Raum-Ansicht in der App.
GUEST_FEATURES: dict[str, str] = {
    "licht": "Licht",
    "storen": "Storen",
    "familie": "Familie",
    "haustuere": "Haustüre",
    "wohnungstuere": "Wohnungstüre",
    "kalender": "Kalender",
    "haushalt": "Haushalt",
    "raeume": "Räume",
    "kameras": "Kameras",
}

# Bereich → Gerätearten. Türen brauchen zusätzlich die Integrations-Prüfung
# in may_see, weil beide Schlösser die Art 'lock' haben.
_FEATURE_KINDS: dict[str, frozenset[str]] = {
    "licht": frozenset({"light", "switch"}),
    "storen": frozenset({"cover"}),
    "kalender": frozenset({"calendar"}),
    "haushalt": frozenset({"appliance"}),
    "kameras": frozenset({"camera"}),
}


def parse_hours(raw: Any) -> dict[str, str]:
    """Zeitfenster einlesen (rein, testbar).

    Nur vollständige Fenster zählen. Ein halbes – nur «ab 07:00» – wäre
    mehrdeutig: bis Mitternacht oder für immer? Lieber gar keins.
    """
    if not isinstance(raw, dict):
        return {}
    start = str(raw.get("from") or "").strip()
    end = str(raw.get("to") or "").strip()
    if not (_HHMM.fullmatch(start) and _HHMM.fullmatch(end)):
        return {}
    return {"from": start, "to": end}


def in_hours(hours: dict[str, str], now: datetime) -> bool:
    """Liegt dieser Moment im Zeitfenster? (rein, testbar)

    Ein Fenster über Mitternacht («22:00 bis 06:00») ist der Normalfall bei
    Nachtruhe und wird deshalb ausdrücklich unterstützt.
    """
    if not hours:
        return True
    current = now.strftime("%H:%M")
    start, end = hours["from"], hours["to"]
    if start <= end:
        return start <= current <= end
    return current >= start or current <= end


@dataclass
class User:
    name: str
    role: str
    token: str
    # Muster auf Entitäts-IDs, z.B. ["hue.*", "mqtt.sonoff_kueche"].
    allow: list[str] = field(default_factory=list)
    # Aus der config.yaml stammende Benutzer sind in der App nur lesbar;
    # dort angelegte liegen in der Datendatei und sind änderbar.
    editable: bool = False
    # Deaktivierte Benutzer behalten ihr Token, kommen aber nicht mehr rein –
    # zum vorübergehenden Sperren eines Gastes ohne neues Token.
    enabled: bool = True
    # Freigegebene Bereiche für Gäste (Schlüssel aus GUEST_FEATURES).
    features: list[str] = field(default_factory=list)
    # Zugang läuft ab: Datum als "JJJJ-MM-TT". Ein Wochenendgast, den man
    # nach dem Wochenende von Hand sperren müsste, bleibt sonst für immer
    # drin – man denkt genau einmal daran.
    expires: str | None = None
    # Zugang nur in diesem Zeitfenster, z.B. {"from": "07:00", "to": "20:00"}.
    # Für Kinder gedacht: Licht im eigenen Zimmer ja, um Mitternacht nicht.
    hours: dict[str, str] = field(default_factory=dict)
    # E-Mail-Adresse für die Anmeldung mit Passwort. Sie ist zugleich die
    # Einladung: Registrieren kann sich nur, wessen Adresse hier schon
    # steht – sonst legte sich jeder mit der Hub-Adresse ein Konto an.
    email: str | None = None
    # Kinder-Ansicht: Nur diese Räume, als grosse Knöpfe, ohne alles
    # andere. Gedacht für Levin und Lina - das eigene Zimmer ja, die
    # Alarmanlage und der Rest der Wohnung nicht.
    simple_rooms: list[str] = field(default_factory=list)
    # Kein Mensch, sondern ein Zugang: das einzelne api.token aus der
    # Konfiguration, mit dem Skripte und das Wandpanel hereinkommen. Es
    # gehört in kein Verzeichnis von Personen - dort stünde es zwischen
    # Livia und Levin, ohne dass jemand es je anlegen oder ändern könnte.
    # Der Zugang bleibt davon unberührt, und im Protokoll steht der Name
    # weiterhin: Dort ist «wer war das» die Frage, und «Hub-Token» eine
    # brauchbare Antwort.
    system: bool = False

    def active(self, now: datetime | None = None) -> bool:
        """Darf dieser Benutzer *jetzt* herein? (rein, testbar)

        Getrennt von ``enabled``: Das ist die Entscheidung eines Menschen,
        dies hier die Uhr. Ein abgelaufener Gast bleibt in der Liste
        sichtbar, statt spurlos zu verschwinden – sonst rätselt man, wem man
        den Zugang gegeben hat.
        """
        if not self.enabled:
            return False
        moment = now or datetime.now()
        if self.expires and moment.strftime("%Y-%m-%d") > self.expires:
            return False
        return in_hours(self.hours, moment)

    def can(self, capability: str) -> bool:
        return capability in CAPABILITIES.get(self.role, frozenset())

    def may_see(self, entity_id: str, kind: str, integration: str = "") -> bool:
        if self.role != Role.GUEST:
            return True
        if self.features:
            for feature in self.features:
                if kind in _FEATURE_KINDS.get(feature, frozenset()):
                    return True
            if kind == "lock":
                is_ring = integration == "ring" or entity_id.startswith("ring.")
                if "haustuere" in self.features and is_ring:
                    return True
                if "wohnungstuere" in self.features and not is_ring:
                    return True
        if self.allow:
            return any(fnmatch.fnmatch(entity_id, pattern) for pattern in self.allow)
        # Weder Bereiche noch Muster: die alte Standard-Freigabe.
        return not self.features and kind in GUEST_DEFAULT_KINDS

    def as_dict(self, include_token: bool = False) -> dict[str, Any]:
        data: dict[str, Any] = {
            "name": self.name,
            "role": self.role,
            "allow": list(self.allow),
            "editable": self.editable,
            "enabled": self.enabled,
            "features": list(self.features),
            "expires": self.expires,
            "hours": dict(self.hours),
            "active": self.active(),
            "email": self.email,
            "simple_rooms": list(self.simple_rooms),
        }
        if include_token:
            data["token"] = self.token
        return data


class UserRegistry:
    """Hält die Benutzer und schlägt sie über ihr Token nach."""

    def __init__(self, users: list[User], open_access: bool = False) -> None:
        self._users = list(users)
        # Wird gerufen, wenn sich eine Anmelde-Adresse ändert.
        self.on_email_change: Any = None
        # Wird gerufen, wenn sich die in der App verwalteten Benutzer ändern.
        self.on_change: Any = None
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
                return user if user.active() else None
        return None

    def by_name(self, name: str) -> User | None:
        return next((user for user in self._users if user.name == name), None)

    def add(self, user: User) -> None:
        if self.by_name(user.name):
            raise ConfigError(f"Benutzer '{user.name}' existiert bereits")
        self._users.append(user)
        self._changed()

    def remove(self, name: str) -> bool:
        user = self.by_name(name)
        if user is None:
            return False
        if not user.editable:
            raise ConfigError(
                f"'{name}' steht in der config.yaml und muss dort entfernt werden"
            )
        if user.role == Role.OWNER and self._owner_count() <= 1:
            raise ConfigError("Der letzte Besitzer kann nicht entfernt werden")
        self._users.remove(user)
        self._changed()
        return True

    def by_email(self, email: str | None) -> User | None:
        """Benutzer zu einer E-Mail-Adresse (Gross/Klein egal)."""
        if not email:
            return None
        wanted = email.strip().lower()
        for user in self._users:
            if (user.email or "").strip().lower() == wanted:
                return user
        return None

    def set_email(self, name: str, email: str | None) -> User:
        """Die Anmelde-Adresse setzen oder löschen.

        Auch für Benutzer aus der config.yaml erlaubt: Die Adresse ist
        keine Berechtigung, sondern nur der Weg hinein – und sie soll sich
        eintragen lassen, ohne die Datei anzufassen. Gespeichert wird sie
        deshalb getrennt (siehe emails in der Datendatei).
        """
        user = self.by_name(name)
        if user is None:
            raise ConfigError(f"Unbekannter Benutzer: {name}")
        wanted = (email or "").strip().lower() or None
        if wanted:
            other = self.by_email(wanted)
            if other is not None and other.name != name:
                raise ConfigError(
                    f"Diese Adresse gehört schon zu '{other.name}'"
                )
        user.email = wanted
        if self.on_email_change:
            self.on_email_change(
                [
                    {"name": entry.name, "email": entry.email}
                    for entry in self._users
                    if entry.email
                ]
            )
        return user

    def rotate_token(self, name: str) -> str:
        """Ein frisches Token ausstellen und das alte sofort ungültig machen.

        Gedacht für den Ernstfall: Ein Token ist irgendwo gelandet, wo es
        nicht hingehört (Screenshot, Chat, verlorenes Telefon). Dann muss
        es in Sekunden zu ersetzen sein und nicht erst nach einer Runde
        durch die config.yaml – die App verliert dabei zwar ihre
        Verbindung, aber genau das ist ja der Zweck.
        """
        user = self.by_name(name)
        if user is None:
            raise ConfigError(f"Unbekannter Benutzer: {name}")
        if not user.editable:
            raise ConfigError(
                f"'{name}' steht in der config.yaml – dort das Token ändern "
                "und den Hub neu starten"
            )
        user.token = secrets.token_urlsafe(24)
        self._changed()
        return user.token

    def update(
        self,
        name: str,
        enabled: bool | None = None,
        features: list[str] | None = None,
        expires: str | None = None,
        hours: dict[str, str] | None = None,
        simple_rooms: list[str] | None = None,
    ) -> User:
        """Gast sperren/entsperren oder Bereiche ändern – Token bleibt gleich."""
        user = self.by_name(name)
        if user is None:
            raise ConfigError(f"Unbekannter Benutzer: {name}")
        if not user.editable:
            raise ConfigError(
                f"'{name}' steht in der config.yaml und muss dort geändert werden"
            )
        if enabled is not None:
            user.enabled = bool(enabled)
        if features is not None:
            unknown = [f for f in features if f not in GUEST_FEATURES]
            if unknown:
                raise ConfigError(f"Unbekannte Bereiche: {', '.join(unknown)}")
            user.features = [str(f) for f in features]
        if expires is not None:
            user.expires = expires.strip() or None
        if hours is not None:
            user.hours = parse_hours(hours)
        if simple_rooms is not None:
            user.simple_rooms = [str(r) for r in simple_rooms]
        self._changed()
        return user

    def editable_users(self) -> list[dict[str, Any]]:
        """Nur die in der App angelegten – die anderen gehören der Datei."""
        return [
            {
                "name": user.name,
                "role": user.role,
                "token": user.token,
                "allow": list(user.allow),
                "enabled": user.enabled,
                "features": list(user.features),
                "expires": user.expires,
                "hours": dict(user.hours),
                "simple_rooms": list(user.simple_rooms),
            }
            for user in self._users
            if user.editable
        ]

    def _changed(self) -> None:
        if self.on_change:
            self.on_change(self.editable_users())

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
        features = entry.get("features") or []
        if not isinstance(features, list):
            raise ConfigError(f"'features' bei {name} muss eine Liste sein")
        simple_rooms = entry.get("simple_rooms") or []
        if not isinstance(simple_rooms, list):
            raise ConfigError(f"'simple_rooms' bei {name} muss eine Liste sein")
        users.append(
            User(
                name=str(name),
                role=role,
                token=str(token),
                allow=[str(a) for a in allow],
                enabled=bool(entry.get("enabled", True)),
                features=[str(f) for f in features],
                expires=str(entry["expires"]) if entry.get("expires") else None,
                hours=parse_hours(entry.get("hours")),
                simple_rooms=[str(r) for r in simple_rooms],
            )
        )

    if legacy_token and not any(user.token == legacy_token for user in users):
        users.append(
            User(name="Hub-Token", role=Role.OWNER, token=legacy_token, system=True)
        )

    if users and not any(user.role == Role.OWNER for user in users):
        raise ConfigError("Mindestens ein Benutzer muss die Rolle 'besitzer' haben")

    return UserRegistry(users, open_access=not users)
