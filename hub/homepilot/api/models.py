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


class BabysitterRequest(BaseModel):
    """Den Babysitter-Modus ein- oder ausschalten."""

    active: bool = False


class BabysitterAllowRequest(BaseModel):
    """Einen einzelnen Ablauf für den Modus freigeben."""

    allow: bool = False


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
    # Bleibt die Szene aktiv (Knopf leuchtet, zweiter Druck nimmt zurück)?
    # Aus für Handlungen wie «Alles aus», die keinen Zustand herstellen.
    toggles: bool = True


class HomeRequest(BaseModel):
    """Der Hausstandort, von der aktuellen Position übernommen."""

    latitude: float
    longitude: float
    # Wie weit «zuhause» reicht. Ein Bauernhof braucht mehr als eine
    # Wohnung im Block.
    radius: float | None = None


class PlaceRequest(BaseModel):
    """Ein Ort, den jemand in der App anlegt - meist ein Laden.

    Die Koordinaten kommen von der aktuellen Position: Wer davorsteht,
    drückt einen Knopf. Abgetippte Koordinaten liegen zu oft daneben, und
    ein Ort, der 300 m danebenliegt, meldet sich nie.
    """

    name: str
    latitude: float
    longitude: float
    radius: float | None = None
    # Beim Verschieben eines bestehenden Ortes: seine Kennung. Ohne
    # Angabe entsteht sie aus dem Namen.
    id: str | None = None


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
    # Gemeinschaftsgerät (Wandtablet, Küchendisplay) statt einer Person.
    shared: bool = False


class SelfNameRequest(BaseModel):
    # Der neue Name des angemeldeten Benutzers - Profil und
    # Benutzerverwaltung zeigen denselben.
    name: str


class UserUpdateRequest(BaseModel):
    enabled: bool | None = None
    features: list[str] | None = None
    # Ablaufdatum als "JJJJ-MM-TT"; leerer Text hebt es auf.
    expires: str | None = None
    # Zeitfenster {"from": "07:00", "to": "20:00"}; leer hebt es auf.
    hours: dict[str, str] | None = None
    # Kinder-Ansicht an/aus bzw. Räume ändern; leere Liste hebt sie auf.
    simple_rooms: list[str] | None = None
    # Gemeinschaftsgerät statt Person – siehe core/users.py.
    shared: bool | None = None
    # Passwort vor den persönlichen Bereichen; leerer Text nimmt es weg.
    # Nur setzbar, nie lesbar – zurück kommt bloss 'area_locked'.
    area_password: str | None = None
    # Rolle: besitzer, bewohner oder gast. Nur der Besitzer darf das, und
    # der letzte Besitzer kommt aus seiner Rolle nicht heraus.
    role: str | None = None


class AreaUnlockRequest(BaseModel):
    """Das Passwort vor den persönlichen Bereichen."""

    password: str = ""


class TemplateRequest(BaseModel):
    """Eine eigene Ablauf-Vorlage sichern.

    `draft` ist der Entwurf, wie ihn der Editor der App führt - der Hub
    reicht ihn unverändert durch und kennt seine Form nicht.
    """

    id: str | None = None
    draft: dict[str, Any] = {}
    icon: str = "flash-outline"


class TemplateHideRequest(BaseModel):
    """Eine eingebaute Vorlage ausblenden (oder wieder zeigen)."""

    label: str
    on: bool = True


class ConflictAckRequest(BaseModel):
    """Einen gegensätzlichen Ablauf abhaken - oder das rückgängig machen."""

    key: str
    on: bool = True


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


class PositionRequest(BaseModel):
    """Wo ein Telefon gerade ist – der ganze Zustand, keine Flanke.

    Die Bauart, auf die es ankommt: `GeofenceRequest` meldet «ich habe
    eine Grenze gekreuzt», und eine verlorene Meldung ist für immer weg.
    Hier kommt die Position, und der Hub rechnet selbst. Damit heilt die
    nächste beliebige Meldung jeden vorigen Verlust.
    """

    latitude: float
    longitude: float
    # Streuung in Metern. Ein Fix mit 400 m Streuung sagt über eine
    # 150-m-Zone nichts, und «weg» ist keine harmlose Antwort - daran
    # hängen Alarmanlage und «alles aus». Ohne Angabe wird die Messung
    # für bare Münze genommen, wie es die alten Melder erwarten.
    accuracy: float = 0.0
    # Ohne Zone gilt der Name des angemeldeten Benutzers.
    zone: str | None = None
    battery: int | None = None
    # Zeitpunkt der Messung in Sekunden seit 1970, nicht des Empfangs.
    # Das Telefon hebt auf, was es nicht loswurde; ohne diese Angabe legt
    # sich eine nachgereichte Messung über eine neuere.
    at: float | None = None


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


class ConfigEditRequest(BaseModel):
    """Eine gezielte Änderung an der Konfiguration – gerechnet, nicht gespeichert.

    Der Hub gibt den geänderten Text zurück; gespeichert wird er wie jede
    Änderung über PUT /api/config. So gibt es genau einen Speicherweg mit
    Prüfung, Verlauf und Neustart – die Bedienoberfläche ist bloss eine
    andere Art, den Text zu erzeugen.
    """

    content: str
    # Entweder einen Bereich ersetzen …
    start: int | None = None
    end: int | None = None
    text: str | None = None
    # … oder einen einzelnen Wert setzen (path leer = nichts tun).
    path: list[str] = []
    # Null nimmt den Wert zurück; Zahlen und Wahrheitswerte bleiben, was
    # sie sind.
    value: str | int | float | bool | None = None
    # Ausdrücklich löschen – sonst wäre «value: null» nicht von «nicht
    # mitgeschickt» zu unterscheiden.
    remove: bool = False
    # … oder einen Bereich aus- bzw. wieder einkommentieren: der übliche
    # Weg, eine Anbindung vorübergehend stillzulegen.
    enabled: bool | None = None


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



class EinladungRequest(BaseModel):
    """Einladung mit Link und Passwort statt Token im Chat.

    Das Passwort reist auf einem anderen Weg als der Link – darum steht
    es hier und wird nie gespeichert, nur sein Abdruck.
    """

    password: str = ""
    minutes: int | None = None


class MeldungRequest(BaseModel):
    """Ein Schalter auf der Seite «Familie und Freunde».

    Einer je Anfrage, nicht die ganze Karte: Zwei offene Telefone würden
    sich sonst gegenseitig überschreiben, und wer gerade den Akku
    abgestellt hat, bekäme ihn vom Tablet nebenan zurück.
    """

    key: str
    enabled: bool
