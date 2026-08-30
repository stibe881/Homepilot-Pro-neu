"""Benutzer und Rollen.

Drei Rollen, vom Alltag her gedacht:

  besitzer  – darf alles, auch Benutzer verwalten und Automationen ändern
  bewohner  – bedient das ganze Haus, darf Automationen pausieren
  gast      – sieht und schaltet nur, was ausdrücklich freigegeben ist

Jeder Benutzer hat sein eigenes Token. Damit steht in jedem Protokolleintrag,
wer etwas geschaltet hat, und ein Zugang lässt sich einzeln zurückziehen,
ohne dass alle anderen ein neues Token brauchen.

**Warum die Tokens im Klartext liegen** (Punkt 33 der Werkbank, geprüft
und bewusst so gelassen): Die Kopplung eines neuen Geräts läuft über
einen QR-Code, den die App jederzeit neu anzeigen kann - dafür muss der
Hub das Token *wiedergeben* können, nicht nur prüfen. Gehashte Tokens
hiessen: Jede Neukopplung erzwingt ein neues Token, und alle anderen
Geräte derselben Person fliegen raus. Die Abwägung dahinter: Die Datei
(homepilot-data.json bzw. config.yaml) liegt nur auf dem Hub, ist 0600
und steht in der .gitignore - wer sie lesen kann, hat den Rechner ohnehin.
Anders die *Sitzungen* aus der E-Mail-Anmeldung: Die muss niemand je
wieder ablesen, deshalb liegen dort nur Hashes (sessions.py).
"""

from __future__ import annotations

import fnmatch
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from . import bereich
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
    # Geräte anpassen: Name, Raum, Gruppe. Getrennt von EDIT_CONFIG,
    # weil es in der homepilot-data.json landet und nicht in der
    # config.yaml - und weil es Mitbewohnern zusteht: Wer hier wohnt und
    # ein Gerät schalten darf, darf auch sagen, wie es heisst und wo es
    # steht. Die Konfiguration des Hubs bleibt bei der Besitzerin.
    EDIT_DEVICES = "edit_devices"


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
            Capability.EDIT_DEVICES,
        }
    ),
    Role.RESIDENT: frozenset(
        {
            Capability.CONTROL,
            Capability.VIEW_HISTORY,
            Capability.VIEW_AUTOMATIONS,
            Capability.PAUSE_AUTOMATIONS,
            Capability.VIEW_SYSTEM,
            Capability.EDIT_DEVICES,
        }
    ),
    # Gäste dürfen bedienen, aber nichts über das Haus erfahren.
    Role.GUEST: frozenset({Capability.CONTROL}),
}

# Was ein Gast ohne ausdrückliche Freigabe sehen darf: Licht und Schalter.
# Kameras, Anwesenheit und Sensoren bleiben aussen vor.
# Lichtszenen gehören dazu: Sie stellen Lampen, und Lampen darf ein Gast
# hier ohnehin schon schalten. Ohne sie wäre eine Szene des Hubs, die eine
# Hue-Szene enthält, für ihn plötzlich gesperrt – während er dieselben
# Lampen einzeln bedienen kann.
GUEST_DEFAULT_KINDS = frozenset({"light", "switch", "scene"})

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
    # Nur die Türklingel, nicht die Kameras: Es klingelt, und die fremde
    # Person im Haus soll sehen, wer da ist - öffnen bleibt Sache der
    # Familie (Punkt 215).
    "klingel": "Türklingel (nur sehen)",
}

# Bereich → Gerätearten. Türen brauchen zusätzlich die Integrations-Prüfung
# in may_see, weil beide Schlösser die Art 'lock' haben.
_FEATURE_KINDS: dict[str, frozenset[str]] = {
    "licht": frozenset({"light", "switch", "scene"}),
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


def access_end(
    expires: str | None, hours: dict[str, str], now: datetime
) -> datetime | None:
    """Wann endet dieser Zugang? (rein, testbar)

    Ein Zugang lief bisher still ab. Zwei Nachrichten machen daraus
    etwas Verlässliches – «dein Zugang endet um 23:00» an den Gast und
    «Zugang ist abgelaufen» an die Familie –, und beide brauchen genau
    diesen einen Zeitpunkt.

    Das Fenster schlägt das Datum, solange es früher endet: Ein Zugang
    bis 23:00 endet um 23:00, nicht um Mitternacht. Ein Fenster über
    Mitternacht («20:00 bis 01:00») endet am Folgetag – sonst wäre der
    Zugang genau dann weg, wenn man ihn noch braucht.
    """
    tag = None
    if expires:
        try:
            jahr, monat, tagnr = (int(teil) for teil in str(expires)[:10].split("-"))
            tag = datetime(jahr, monat, tagnr, 23, 59, 59)
        except (ValueError, TypeError):
            tag = None
    if not hours:
        return tag
    try:
        stunde, minute = (int(teil) for teil in hours["to"].split(":"))
    except (KeyError, ValueError):
        return tag
    ende = now.replace(hour=stunde, minute=minute, second=0, microsecond=0)
    ueber_mitternacht = hours.get("from", "") > hours.get("to", "")
    if ende <= now and ueber_mitternacht:
        ende = ende.replace(day=ende.day) + timedelta(days=1)
    if tag is not None and ende > tag:
        return tag
    return ende


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
    # Rechte je Raum: Leer heisst «das ganze Haus» - so war es immer und
    # so bleibt es für alle, die nichts einstellen. Steht etwas drin,
    # sieht und schaltet diese Person *nur* dort.
    #
    # Warum es das braucht, obwohl es simple_rooms schon gibt: Die
    # Kinder-Ansicht ist eine *Ansicht*. Sie räumt den Rest der Wohnung
    # aus dem Bild, aber nicht aus der Reichweite - wer die Adresse des
    # Hubs und sein Token hat, schaltet weiterhin die Haustüre. Bisher
    # entschied darüber allein die Rolle, und die kann nur alles oder
    # nichts: «Bewohner» heisst ganzes Haus, «Gast» heisst Freigaben und
    # damit kein eigenes Zimmer.
    #
    # Es kann nur wegnehmen, nie hinzufügen: Die Prüfung steht *vor* den
    # Gast-Regeln, nicht neben ihnen. Ein Gast mit Raum bekommt also den
    # Schnitt aus beidem.
    #
    # Geräte ohne Raum fallen heraus. Das ist gewollt: «Nur diese Räume»
    # heisst nicht «diese Räume und alles Ortlose» - der Stromzähler und
    # die Anwesenheit gehören niemandem Bestimmten und sind genau das,
    # wovor der Schnitt schützen soll.
    rooms: list[str] = field(default_factory=list)
    # Kein einzelner Mensch, sondern ein Gerät, das allen gehört: das
    # Wandtablet im Flur, das Küchendisplay. Es meldet sich wie ein
    # Benutzer an, gehört aber keiner Person - angesprochen werden möchte
    # es darum nicht («Hallo Wandtablet»), und es meldet sich nie ab.
    # Nachrichten bekommt es sehr wohl: An der Wand im Flur ist die
    # Meldung «Haustüre offen» genau am richtigen Ort.
    shared: bool = False
    # Gesalzener Hashwert des Passworts vor den persönlichen Bereichen
    # (siehe core/bereich.py). Leer = kein Riegel. Steht hier statt in
    # einer eigenen Tabelle, weil es zum Benutzer gehört und mit ihm
    # verschwindet.
    area_lock: dict[str, str] = field(default_factory=dict)
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

    def darf_raum(self, room: str | None) -> bool:
        """Liegt dieses Gerät in einem Raum, den diese Person haben darf?

        Ohne Einschränkung gilt das ganze Haus - der Normalfall, und der
        Zustand, in dem alle Benutzer starten.
        """
        if not self.rooms:
            return True
        return bool(room) and room in self.rooms

    def may_see(
        self, entity_id: str, kind: str, integration: str = "", room: str | None = None
    ) -> bool:
        # Zuerst der Raum, und zwar für jede Rolle: Er nimmt weg, und was
        # weggenommen ist, holt auch eine Freigabe nicht zurück.
        if not self.darf_raum(room):
            return False
        if self.role != Role.GUEST:
            return True
        if self.features:
            for feature in self.features:
                if kind in _FEATURE_KINDS.get(feature, frozenset()):
                    return True
            # Die Türklingel ist eine Kamera - aber nur diese eine. Ohne
            # die Einschränkung wäre «Klingel» eine Freigabe für alle
            # Kameras im Haus, und das ist etwas ganz anderes.
            if kind == "camera" and "klingel" in self.features:
                if integration == "ring" or entity_id.startswith("ring."):
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
            "rooms": list(self.rooms),
            "shared": self.shared,
            # Nur die Tatsache, nie der Wert: Die App muss wissen, ob sie
            # fragen soll, nicht wonach.
            "area_locked": bool(self.area_lock),
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

    def rename(self, old: str, new: str) -> User:
        """Einen Benutzer umbenennen - Token und Rechte bleiben.

        Der Name im Profil ist derselbe wie in der Benutzerverwaltung;
        zwei Namen für denselben Menschen («Begrüssung» hier, Benutzer
        dort) haben nur Verwirrung gestiftet. Wer aus der config.yaml
        stammt, wird dort umbenannt - die Datei ist die Wahrheit, und
        eine App-Änderung, die der nächste Neustart zurückdreht, wäre
        schlimmer als die Fehlermeldung.
        """
        gewuenscht = str(new or "").strip()
        if not gewuenscht:
            raise ConfigError("Der Name darf nicht leer sein")
        user = self.by_name(old)
        if user is None:
            raise ConfigError(f"Unbekannter Benutzer: {old}")
        if gewuenscht == user.name:
            return user
        if not user.editable:
            raise ConfigError(
                f"'{old}' steht in der config.yaml - dort den Namen ändern "
                "und den Hub neu starten"
            )
        other = self.by_name(gewuenscht)
        if other is not None:
            raise ConfigError(f"Benutzer '{gewuenscht}' existiert bereits")
        user.name = gewuenscht
        self._changed()
        # Die Anmelde-Adressen liegen getrennt und sind nach Namen
        # abgelegt - ohne das hier zeigte die Adresse auf einen Namen,
        # den es nicht mehr gibt, und die Anmeldung liefe ins Leere.
        if user.email and self.on_email_change:
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
        rooms: list[str] | None = None,
        shared: bool | None = None,
        area_password: str | None = None,
        role: str | None = None,
    ) -> User:
        """Gast sperren/entsperren, Rolle oder Bereiche ändern – Token bleibt."""
        user = self.by_name(name)
        if user is None:
            raise ConfigError(f"Unbekannter Benutzer: {name}")
        if not user.editable:
            raise ConfigError(
                f"'{name}' steht in der config.yaml und muss dort geändert werden"
            )
        if role is not None and role != user.role:
            if role not in Role.ALL:
                raise ConfigError(f"Unbekannte Rolle: {role}")
            # Der letzte Besitzer bleibt Besitzer. Sonst gäbe es niemanden
            # mehr, der Benutzer verwaltet oder die Konfiguration ändert -
            # und zurück käme man nur noch über die config.yaml auf dem
            # Rechner im Keller. Dieselbe Schranke wie beim Löschen.
            if user.role == Role.OWNER and self._owner_count() <= 1:
                raise ConfigError(
                    "Der letzte Besitzer kann seine Rolle nicht abgeben - "
                    "erst jemand anderen zum Besitzer machen."
                )
            user.role = role
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
        if rooms is not None:
            user.rooms = [str(r) for r in rooms]
        if shared is not None:
            user.shared = bool(shared)
        if area_password is not None:
            # Leerer Wert nimmt den Riegel weg - anders käme man nie wieder
            # davon los, ohne den Benutzer neu anzulegen.
            if area_password.strip():
                user.area_lock = bereich.make_entry(
                    bereich.check_length(area_password)
                )
            else:
                user.area_lock = {}
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
                "rooms": list(user.rooms),
                "shared": user.shared,
                "area_lock": dict(user.area_lock),
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
        rooms = entry.get("rooms") or []
        if not isinstance(rooms, list):
            raise ConfigError(f"'rooms' bei {name} muss eine Liste sein")
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
                rooms=[str(r) for r in rooms],
                shared=bool(entry.get("shared")),
                area_lock={
                    str(k): str(v)
                    for k, v in (entry.get("area_lock") or {}).items()
                }
                if isinstance(entry.get("area_lock"), dict)
                else {},
            )
        )

    if legacy_token and not any(user.token == legacy_token for user in users):
        users.append(
            User(name="Hub-Token", role=Role.OWNER, token=legacy_token, system=True)
        )

    if users and not any(user.role == Role.OWNER for user in users):
        raise ConfigError("Mindestens ein Benutzer muss die Rolle 'besitzer' haben")

    return UserRegistry(users, open_access=not users)
