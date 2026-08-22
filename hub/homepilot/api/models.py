"""Die Pydantic-Modelle der API - auf Modulebene, wie FastAPI sie braucht.

Herausgelöst aus server.py (Punkt 16 der Werkbank).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from ..core import guestpass
from ..core.users import Role


class CommandRequest(BaseModel):
    command: str
    data: dict[str, Any] = {}


class PauseRequest(BaseModel):
    seconds: float = 7200


class SnoozeRequest(BaseModel):
    """Bis wann ein Ablauf ruht - None weckt ihn sofort."""

    until: str | float | None = None


class ProbeStepRequest(BaseModel):
    """Ein einzelner Ablauf-Schritt zum Ausprobieren (Punkt 164)."""

    action: dict[str, Any]


class RestoreVersionRequest(BaseModel):
    # Der Zeitstempel ist die Kennung der Fassung (siehe editversions.py).
    at: float


class PushRegistration(BaseModel):
    token: str
    label: str = ""


class AutomationRequest(BaseModel):
    alias: str
    trigger: list[dict[str, Any]] = []
    condition: list[dict[str, Any]] = []
    action: list[dict[str, Any]] = []
    # Was stattdessen läuft, wenn die Bedingungen nicht passen.
    otherwise: list[dict[str, Any]] = []
    enabled: bool = True
    # Was geschieht, wenn er noch läuft und erneut ausgelöst wird:
    # «single» verwirft den zweiten Auslöser, «restart» beginnt von vorn
    # (Nachlauf, siehe core/automation.py).
    mode: str = "single"
    # «all» = alle Bedingungen müssen stimmen, «any» = eine genügt.
    match: str = "all"
    # Frei gewählter Name zum Gruppieren in der App.
    category: str | None = None
    # Bis wann der Ablauf ruht: Unix-Sekunden oder ein ISO-Zeitstempel.
    # Anders als «enabled: false» meldet er sich von selbst zurück.
    quiet_until: float | str | None = None
    # Frühestens wieder nach so vielen Sekunden – gegen den zuckenden
    # Melder im Wind, der aus einer Durchsage zwanzig macht.
    cooldown: float = 0


class SceneRequest(BaseModel):
    name: str
    icon: str = "sparkles-outline"
    actions: list[dict[str, Any]] = []
    room: str | None = None
    # Auf der Startseite als Schnellaktion anzeigen.
    on_start: bool = False
    # Frei gewählter Name zum Gruppieren in der App.
    category: str | None = None
    # Übergangszeit in Sekunden: Helligkeiten werden angefahren statt
    # gesetzt – Lichtwecker, Einschlaflicht.
    transition: int = 0


class PushPrefsRequest(BaseModel):
    """Abbestellte Nachrichtenarten eines Benutzers."""

    muted: list[str] = []


class NotifyRuleRequest(BaseModel):
    """Änderung an einer eingebauten Wächter-Nachricht (Abläufe → Push)."""

    enabled: bool = True
    params: dict[str, float] = {}


class GoodNightRequest(BaseModel):
    """Einstellungen des Gute-Nacht-Knopfs."""

    night_lights: list[str] = []
    arm_alarm: bool = False


class VoucherRequest(BaseModel):
    """Ein WLAN-Gutschein fürs Captive Portal."""

    hours: float = 24
    note: str = ""


class TimerRequest(BaseModel):
    """Ein Küchen-Timer: Minuten und was danach gesagt wird."""

    minutes: float
    text: str = ""


class RecipeImportRequest(BaseModel):
    """Eine Rezeptseite, aus der das Rezept gelesen werden soll."""

    url: str


class BroadcastRequest(BaseModel):
    """Eine Durchsage an die Lautsprecher im Haus."""

    text: str
    # Leer = alle Cast-Boxen; sonst nur die genannten.
    speakers: list[str] = []
    # Lautstärke in Prozent für die Durchsage (None = so lassen).
    volume: int | None = None


class SpeakerRequest(BaseModel):
    """Eine gefundene Box, die in die Konfiguration soll."""

    name: str
    host: str
    # Gruppen laufen auf der Adresse einer ihrer Boxen, mit eigenem Port.
    port: int = 8009


class UserRequest(BaseModel):
    name: str
    role: str = Role.RESIDENT
    token: str | None = None
    allow: list[str] = []
    # Freigegebene Bereiche für Gäste (Schlüssel aus GUEST_FEATURES).
    features: list[str] = []
    expires: str | None = None
    hours: dict[str, str] = {}
    # Kinder-Ansicht: nur diese Räume, als grosse Knöpfe.
    simple_rooms: list[str] = []


class UserUpdateRequest(BaseModel):
    enabled: bool | None = None
    features: list[str] | None = None
    # Ablaufdatum als "JJJJ-MM-TT"; leerer Text hebt es auf.
    expires: str | None = None
    # Zeitfenster {"from": "07:00", "to": "20:00"}; leer hebt es auf.
    hours: dict[str, str] | None = None
    # Kinder-Ansicht an/aus bzw. Räume ändern; leere Liste hebt sie auf.
    simple_rooms: list[str] | None = None


class LoginRequest(BaseModel):
    """Anmeldung mit E-Mail und Passwort."""

    email: str
    password: str
    # Name des Geräts – damit man in der Sitzungsliste sieht, welches
    # Telefon das war.
    label: str = ""


class PasswordRequest(BaseModel):
    """Passwort setzen mit dem Ticket aus der Einladungs-E-Mail."""

    access_token: str
    password: str


class RecoverRequest(BaseModel):
    email: str


class UpdateTriggerRequest(BaseModel):
    """Was der Update-Knopf mitschickt. Auf Modulebene, wie alle Modelle
    hier - lokal definiert hielte FastAPI den Body für Query-Parameter."""

    # Zusätzlich einen iOS-Build auf den EAS-Servern anstossen. Kostet
    # Bauminuten im Kontingent und erzeugt eine TestFlight-Fassung -
    # deshalb eine bewusste Wahl in der App, nie die Vorgabe.
    ios: bool = False


class EmailRequest(BaseModel):
    """Anmelde-Adresse eines Benutzers setzen (leer = löschen)."""

    email: str | None = None


class GeofenceRequest(BaseModel):
    """Ortswechsel eines Telefons: enter/leave (oder home/away)."""

    event: str
    # Ohne Zone gilt der Name des angemeldeten Benutzers.
    zone: str | None = None
    # Welcher Ort betreten oder verlassen wurde («home», «schule»).
    # Ohne Angabe «home» - so melden die alten Kurzbefehle weiter.
    place: str | None = None
    # Akkustand des Telefons in Prozent, wenn der Melder ihn kennt. Die
    # häufigste Ursache für eine tote Ortung ist ein leeres Telefon, und
    # das kündigt sich an.
    battery: int | None = None


class PassTarget(BaseModel):
    entity_id: str
    command: str = "unlatch"


class PassRequest(BaseModel):
    """Ein Einmal-Link: ein bis mehrere Türen, wenige Minuten.

    Mehrere, weil im Mehrfamilienhaus ein Paket beides braucht – Haustüre
    und Wohnungstüre. Die alte Form mit einem einzelnen Gerät bleibt
    gültig, damit bestehende Kurzbefehle weiterlaufen.
    """

    targets: list[PassTarget] | None = None
    entity_id: str | None = None
    command: str = "unlatch"
    minutes: int = guestpass.DEFAULT_MINUTES
    # Festes Fenster statt «ab jetzt für N Minuten» – ISO-Zeitpunkte mit
    # Zone, so wie sie das Telefon kennt. Ohne beides zählen die Minuten.
    starts: str | None = None
    ends: str | None = None
    label: str = ""

    def wanted(self) -> list[PassTarget]:
        if self.targets:
            return self.targets
        if self.entity_id:
            return [PassTarget(entity_id=self.entity_id, command=self.command)]
        return []


def moment(text: str | None) -> float:
    """ISO-Zeitpunkt aus der App in Unix-Zeit (rein, testbar).

    Die App schickt die Zone mit ("2026-08-21T09:00:00+02:00"). Fehlt sie
    trotzdem, gilt die Zeit des Hubs – der steht im selben Haus wie die
    Türe, das ist die vernünftigere Annahme als UTC.
    """
    if not text:
        return 0.0
    try:
        stamp = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as err:
        raise ValueError(f"Unlesbarer Zeitpunkt: {text}") from err
    if stamp.tzinfo is None:
        stamp = stamp.astimezone()
    return stamp.timestamp()


class LightGroupRequest(BaseModel):
    """Mehrere Lampen zu einer Leuchte zusammenfassen."""

    name: str
    members: list[str]
    # light (Standard) oder switch.
    kind: str = "light"
    # Sollen die Einzelnen aus Räumen, Suche und Zählung verschwinden?
    # Standard ja - das ist der Fall, für den es die Zusammenfassung gibt.
    hide_members: bool = True


class PrefsRequest(BaseModel):
    prefs: dict[str, Any]


# Obergrenze der persönlichen Einstellungen je Benutzer - genug für viele
# Reihenfolgen, zu wenig, um die Datendatei zu fluten.
PREFS_BYTES = 32_768

# Dasselbe für die haushaltsweiten Einstellungen. Grosszügiger, weil dort
# die Reihenfolgen aller Ansichten zusammenkommen - aber immer noch eine
# Grenze: Was hier landet, ist eine Handvoll Listen von Kennungen, keine
# Ablage für Beliebiges.
HOUSE_PREFS_BYTES = 131_072


class ConfigRequest(BaseModel):
    content: str


class RoomRequest(BaseModel):
    room: str | None = None


class AlarmArmRequest(BaseModel):
    mode: str
    # Trotz offener Fenster scharf schalten – bewusste Entscheidung des
    # Benutzers, nachdem ihm gesagt wurde, was offen ist.
    force: bool = False


class AlarmDisarmRequest(BaseModel):
    """Entschärfen – mit PIN, falls eine gesetzt ist."""

    pin: str = ""


class AlarmPinRequest(BaseModel):
    """PIN fürs Entschärfen setzen; leer = entfernen."""

    pin: str = ""


class MetaRequest(BaseModel):
    """Anzeigename, Favorit oder Gruppe – nur gesetzte Felder ändern sich."""

    name: str | None = None
    favorite: bool | None = None
    group: str | None = None

