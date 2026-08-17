"""Push-Benachrichtigungen über den Expo-Dienst.

Die App meldet beim Start ihren Push-Token an (/api/push/register); der Hub
merkt sich, welcher Benutzer dahintersteht. Automationen können dann per
Aktion ``notify`` an alle, an eine Rolle oder an einzelne Personen senden.

Ohne angemeldetes Gerät passiert schlicht nichts – der Hub läuft weiter.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

import aiohttp

from .users import Role

log = logging.getLogger(__name__)

EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send"
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
    """Aus einem Expo-Fehlercode einen brauchbaren Satz machen (rein)."""
    hint = ERROR_HINTS.get(code)
    if hint:
        return hint
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
    def __init__(self, session_factory=None) -> None:
        self._devices: dict[str, PushDevice] = {}
        self._session_factory = session_factory or (
            lambda: aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        )

    @property
    def devices(self) -> list[PushDevice]:
        return list(self._devices.values())

    def register(self, token: str, user: str, label: str = "") -> PushDevice:
        device = PushDevice(token=token, user=user, label=label)
        # Nach Token abgelegt: Meldet sich dasselbe Gerät erneut an, wird der
        # Eintrag ersetzt statt verdoppelt.
        self._devices[token] = device
        return device

    def unregister(self, token: str) -> bool:
        return self._devices.pop(token, None) is not None

    def recipients(self, users: list[Any], to: str = "all") -> list[str]:
        """Wählt die Empfänger aus.

        ``to`` ist "all", eine Rolle ("bewohner") oder ein Benutzername.
        Gäste bekommen nur etwas, wenn sie ausdrücklich gemeint sind.
        """
        by_name = {user.name: user for user in users}
        tokens = []
        for device in self._devices.values():
            user = by_name.get(device.user)
            if user is None:
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
        self, tokens: list[str], title: str, body: str, data: dict[str, Any] | None = None
    ) -> PushResult:
        """Verschickt die Nachricht und sagt, was der Dienst dazu meint.

        Wichtig: ``accepted`` heisst «von Expo angenommen», nicht «beim
        Empfänger angekommen». Für die Zustellung gibt es ``delivered``.
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
        return problems
