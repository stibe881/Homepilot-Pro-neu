"""Push-Benachrichtigungen über den Expo-Dienst.

Die App meldet beim Start ihren Push-Token an (/api/push/register); der Hub
merkt sich, welcher Benutzer dahintersteht. Automationen können dann per
Aktion ``notify`` an alle, an eine Rolle oder an einzelne Personen senden.

Ohne angemeldetes Gerät passiert schlicht nichts – der Hub läuft weiter.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import aiohttp

from .users import Role

log = logging.getLogger(__name__)

EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send"

# Die Arten von Nachrichten, die der Hub verschickt. Jede hat einen festen
# Schlüssel, damit sich einzelne davon je Benutzer abstellen lassen – wer
# nachts nicht wegen einer schwachen Batterie geweckt werden will, soll
# deswegen nicht den Alarm mit abschalten müssen.
CATEGORIES: dict[str, str] = {
    "alarm": "Alarm ausgelöst",
    "alarm_arming": "Alarmanlage scharf/unscharf",
    "outage": "Integration ausgefallen",
    "device_down": "Überwachtes Gerät antwortet nicht",
    "battery": "Batterie schwach",
    "open": "Fenster/Tür steht offen",
    "leak": "Wasser gemeldet",
    "disk": "Speicherplatz wird knapp",
    "frost": "Frost angekündigt",
    "appliance": "Haushaltgerät fertig",
    "tasks": "Fällige Aufgaben",
    "automation": "Nachricht aus einem Ablauf",
    "timer": "Küchen-Timer",
    "maintenance": "Wartung fällig",
    "shopping": "Einkaufsliste im Laden",
    "test": "Push-Test",
}


def parse_muted(raw: Any) -> dict[str, set[str]]:
    """Gespeicherte Abbestellungen einlesen (rein, testbar).

    Unbekannte Schlüssel fliegen raus: Eine umbenannte Kategorie soll nicht
    stillschweigend jemanden stumm schalten.
    """
    result: dict[str, set[str]] = {}
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("user") or "")
        if not name:
            continue
        result[name] = {
            str(key) for key in entry.get("muted") or [] if key in CATEGORIES
        }
    return result
EXPO_RECEIPTS = "https://exp.host/--/api/v2/push/getReceipts"

# Fehler, nach denen ein Token dauerhaft tot ist – App deinstalliert oder
# Berechtigung entzogen. Das Gerät fliegt dann aus der Liste.
DEAD_TOKEN_ERRORS = frozenset({"DeviceNotRegistered"})

# Was die Expo-Fehlercodes für uns bedeuten – roh sind sie wenig hilfreich.
ERROR_HINTS = {
    "DeviceNotRegistered": (
        "Das Gerät nimmt keine Nachrichten mehr an (App deinstalliert oder "
        "Benachrichtigungen entzogen). Es wurde abgemeldet – App einmal "
        "öffnen, dann meldet sie sich neu an."
    ),
    "InvalidCredentials": (
        "Expo hat für dieses Projekt keine gültigen Push-Zugangsdaten. Bei "
        "einem eigenen Build müssen sie einmal erzeugt werden "
        "(eas credentials)."
    ),
    "MessageTooBig": "Die Nachricht ist zu lang.",
    "MessageRateExceeded": "Zu viele Nachrichten in kurzer Zeit – später erneut.",
}

# Was Apple selbst ablehnt, reicht Expo im Klartext durch, ohne eigenen
# Code. Die Rohtexte sind zwar lesbar, sagen aber nicht, was zu tun ist.
APNS_HINTS = {
    "TopicDisallowed": (
        "Apple lehnt die Nachricht ab: Der Push-Token gehört zu einer "
        "anderen App-Kennung, als das hinterlegte Zertifikat abdeckt. "
        "Meist ein alter Token – noch von Expo Go oder einem früheren "
        "Build. Unter System → Push-Geräte die alten Einträge entfernen "
        "und die App einmal öffnen; sie meldet sich neu an. Bleibt es "
        "dabei, fehlt der App-Kennung im Apple-Konto die Berechtigung "
        "«Push Notifications» (Developer-Portal → Identifiers)."
    ),
    "BadDeviceToken": (
        "Apple kennt diesen Token nicht (mehr) – oder er stammt aus einem "
        "Build für die Entwicklungsumgebung, während produktiv gesendet "
        "wird. Gerät unter System → Push-Geräte entfernen und die App "
        "einmal öffnen."
    ),
    "DeviceTokenNotForTopic": (
        "Der Token gehört zu einer anderen App. Unter System → "
        "Push-Geräte entfernen und neu anmelden lassen."
    ),
    "ExpiredProviderToken": (
        "Expos Zugangsdaten für Apple sind abgelaufen. Einmal "
        "«npx eas-cli credentials -p ios» und den Push-Schlüssel erneuern."
    ),
}


def is_expo_token(token: str) -> bool:
    return token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")


@dataclass
class PushResult:
    """Was aus einem Sendeversuch geworden ist.

    ``accepted`` sind die vom Expo-Dienst angenommenen Nachrichten – das ist
    noch keine Zustellung. Ob sie wirklich ankamen, sagt erst die Quittung
    zu ``ticket_ids``.
    """

    accepted: int = 0
    errors: list[str] = field(default_factory=list)
    ticket_ids: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "accepted": self.accepted,
            "errors": list(self.errors),
            "ticket_ids": list(self.ticket_ids),
        }


def explain(code: str, message: str) -> str:
    """Aus einem Expo-Fehlercode einen brauchbaren Satz machen (rein).

    Zwei Quellen: Expos eigene Codes und das, was Apple ablehnt. Letzteres
    kommt ohne Code, nur als Text – deshalb wird darin nach dem Grund
    gesucht, statt ihn wörtlich durchzureichen. «TopicDisallowed» sagt
    einem niemandem etwas; «der Token gehört zu einer anderen App-Kennung»
    schon.
    """
    hint = ERROR_HINTS.get(code)
    if hint:
        return hint
    for reason, text in APNS_HINTS.items():
        if reason in message or reason == code:
            return text
    return message or code or "Unbekannter Fehler des Push-Dienstes"


def parse_tickets(payload: Any, tokens: list[str]) -> tuple[PushResult, list[str]]:
    """Wertet die Antwort des Expo-Dienstes aus (rein, testbar).

    Expo antwortet auch dann mit HTTP 200, wenn einzelne Nachrichten
    abgelehnt werden – der Status steht je Nachricht in ``data``. Genau
    dort steht auch, warum nichts ankommt.

    Gibt das Ergebnis zurück und die Tokens, die endgültig tot sind.
    """
    result = PushResult()
    dead: list[str] = []
    if not isinstance(payload, dict):
        result.errors.append("Unerwartete Antwort des Push-Dienstes")
        return result, dead

    # Fehler auf Anfrageebene (z.B. kaputtes JSON) stehen ganz oben.
    for entry in payload.get("errors") or []:
        if isinstance(entry, dict):
            result.errors.append(explain(str(entry.get("code", "")), str(entry.get("message", ""))))

    tickets = payload.get("data")
    if not isinstance(tickets, list):
        return result, dead

    for index, ticket in enumerate(tickets):
        if not isinstance(ticket, dict):
            continue
        if ticket.get("status") == "ok":
            result.accepted += 1
            if ticket.get("id"):
                result.ticket_ids.append(str(ticket["id"]))
            continue
        details = ticket.get("details") or {}
        code = str(details.get("error", "")) if isinstance(details, dict) else ""
        result.errors.append(explain(code, str(ticket.get("message", ""))))
        if code in DEAD_TOKEN_ERRORS and index < len(tokens):
            dead.append(tokens[index])
    return result, dead


def parse_receipts(payload: Any) -> list[str]:
    """Zustell-Quittungen auswerten (rein, testbar).

    Erst hier zeigt sich, ob Apple bzw. Google die Nachricht angenommen
    hat – der Sendevorgang selbst weiss davon nichts. Zurück kommen die
    Fehlertexte; eine leere Liste heisst: alles zugestellt.
    """
    if not isinstance(payload, dict):
        return []
    receipts = payload.get("data")
    if not isinstance(receipts, dict):
        return []
    problems: list[str] = []
    for receipt in receipts.values():
        if not isinstance(receipt, dict) or receipt.get("status") == "ok":
            continue
        details = receipt.get("details") or {}
        code = str(details.get("error", "")) if isinstance(details, dict) else ""
        problems.append(explain(code, str(receipt.get("message", ""))))
    return problems


@dataclass
class PushDevice:
    token: str
    user: str
    label: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {"token": self.token, "user": self.user, "label": self.label}


class PushService:
    # Benutzername → abbestellte Kategorien. Der Hub füllt das aus den
    # gespeicherten Einstellungen.
    muted: dict[str, set[str]]

    def __init__(self, session_factory=None) -> None:
        self._devices: dict[str, PushDevice] = {}
        # Wird vom Hub gesetzt: Ruf mich, wenn sich die Geräteliste
        # ändert. Bewusst ein Rückruf und kein DataStore hier - der
        # Push-Dienst soll nichts über die Ablage wissen müssen.
        self.on_change: Any = None
        self.muted = {}
        self._session_factory = session_factory or (
            lambda: aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        )

    @property
    def devices(self) -> list[PushDevice]:
        return list(self._devices.values())

    def restore(self, rows: list[dict[str, Any]]) -> None:
        """Gespeicherte Anmeldungen zurückholen (beim Start).

        Ein Token, das inzwischen tot ist, merkt der erste Sendeversuch -
        Expo meldet DeviceNotRegistered, und der Eintrag fliegt dann von
        selbst raus. Beim Laden zu prüfen wäre eine Netzanfrage im
        Startpfad und brächte nichts.
        """
        for row in rows:
            token = str(row.get("token") or "")
            if is_expo_token(token):
                self._devices[token] = PushDevice(
                    token=token,
                    user=str(row.get("user") or ""),
                    label=str(row.get("label") or ""),
                )

    def _changed(self) -> None:
        if self.on_change is not None:
            self.on_change([device.as_dict() for device in self.devices])

    def register(self, token: str, user: str, label: str = "") -> PushDevice:
        device = PushDevice(token=token, user=user, label=label)
        # Nach Token abgelegt: Meldet sich dasselbe Gerät erneut an, wird der
        # Eintrag ersetzt statt verdoppelt.
        self._devices[token] = device
        self._changed()
        return device

    def unregister(self, token: str) -> bool:
        gone = self._devices.pop(token, None) is not None
        if gone:
            self._changed()
        return gone

    def recipients(
        self, users: list[Any], to: str = "all", category: str | None = None
    ) -> list[str]:
        """Wählt die Empfänger aus.

        ``to`` ist "all", eine Rolle ("bewohner") oder ein Benutzername.
        Gäste bekommen nur etwas, wenn sie ausdrücklich gemeint sind.

        ``category`` ist die Art der Nachricht. Wer sie in seinem Profil
        abbestellt hat, fällt hier heraus – das ist die einzige Stelle, an
        der das geprüft wird, damit keine Nachrichtenart die Einstellung
        versehentlich übergeht.
        """
        by_name = {user.name: user for user in users}
        tokens = []
        for device in self._devices.values():
            user = by_name.get(device.user)
            if user is None:
                continue
            if category and category in self.muted.get(device.user, set()):
                continue
            if to == "all":
                if user.role != Role.GUEST:
                    tokens.append(device.token)
            elif to in Role.ALL:
                if user.role == to:
                    tokens.append(device.token)
            elif to == device.user:
                tokens.append(device.token)
        return tokens

    async def send(
        self,
        tokens: list[str],
        title: str,
        body: str,
        data: dict[str, Any] | None = None,
        image: str | None = None,
    ) -> PushResult:
        """Verschickt die Nachricht und sagt, was der Dienst dazu meint.

        Wichtig: ``accepted`` heisst «von Expo angenommen», nicht «beim
        Empfänger angekommen». Für die Zustellung gibt es ``delivered``.

        ``image`` ist eine Adresse, die das *Telefon* selbst aufruft, während
        es die Nachricht anzeigt – ohne Anmeldung, denn die App läuft zu dem
        Zeitpunkt noch gar nicht. Was das bedeutet, steht in
        ``core/snapshots.py``.
        """
        if not tokens:
            return PushResult()
        valid = [token for token in tokens if is_expo_token(token)]
        messages = [
            {
                "to": token,
                "title": title,
                "body": body,
                "sound": "default",
                "data": data or {},
                **({"richContent": {"image": image}} if image else {}),
            }
            for token in valid
        ]
        if not messages:
            return PushResult(errors=["Kein gültiger Expo-Push-Token angemeldet"])

        session = self._session_factory()
        try:
            async with session.post(EXPO_ENDPOINT, json=messages) as response:
                text = await response.text()
                if response.status >= 400:
                    log.warning("Push fehlgeschlagen (%s): %s", response.status, text[:200])
                    return PushResult(
                        errors=[f"Push-Dienst antwortet mit {response.status}: {text[:120]}"]
                    )
                payload = await response.json(content_type=None)
        except Exception as err:
            # Eine gescheiterte Benachrichtigung darf die Automation nicht
            # abbrechen, die sie ausgelöst hat.
            log.warning("Push nicht zustellbar: %s", err)
            return PushResult(errors=[f"Push-Dienst nicht erreichbar: {err}"])
        finally:
            await session.close()

        result, dead = parse_tickets(payload, valid)
        for token in dead:
            # Tote Tokens sammeln sich sonst für immer an und verfälschen
            # jede Zählung «an n Geräte verschickt».
            self.unregister(token)
            log.info("Push-Gerät abgemeldet, Token wird von Expo abgelehnt")
        for message in result.errors:
            log.warning("Push abgelehnt: %s", message)
        # Immer eine Zeile, auch wenn alles glattging: Sonst lässt sich im
        # Log nicht unterscheiden, ob nichts schiefging oder ob überhaupt
        # nie etwas gesendet wurde.
        log.info(
            "Push «%s»: %d von %d angenommen%s",
            title,
            result.accepted,
            len(messages),
            f", {len(result.errors)} abgelehnt" if result.errors else "",
        )
        return result

    async def delivered(self, ticket_ids: list[str]) -> list[str]:
        """Holt die Zustell-Quittungen zu bereits gesendeten Nachrichten.

        Der Sendevorgang endet bei Expo; ob Apple oder Google die Nachricht
        wirklich ausgeliefert haben, steht erst in der Quittung. Zurück
        kommen die Fehlertexte – leer heisst: zugestellt.
        """
        if not ticket_ids:
            return []
        session = self._session_factory()
        try:
            async with session.post(EXPO_RECEIPTS, json={"ids": ticket_ids}) as response:
                if response.status >= 400:
                    return []
                payload = await response.json(content_type=None)
        except Exception as err:
            log.warning("Quittungen nicht abrufbar: %s", err)
            return []
        finally:
            await session.close()
        problems = parse_receipts(payload)
        for message in problems:
            log.warning("Push nicht zugestellt: %s", message)
        if not problems:
            log.info("Push zugestellt (%d Quittung(en) ohne Beanstandung)", len(ticket_ids))
        return problems
