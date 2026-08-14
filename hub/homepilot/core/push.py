"""Push-Benachrichtigungen über den Expo-Dienst.

Die App meldet beim Start ihren Push-Token an (/api/push/register); der Hub
merkt sich, welcher Benutzer dahintersteht. Automationen können dann per
Aktion ``notify`` an alle, an eine Rolle oder an einzelne Personen senden.

Ohne angemeldetes Gerät passiert schlicht nichts – der Hub läuft weiter.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import aiohttp

from .users import Role

log = logging.getLogger(__name__)

EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send"


def is_expo_token(token: str) -> bool:
    return token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")


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
    ) -> int:
        """Verschickt die Nachricht und gibt zurück, an wie viele Geräte."""
        if not tokens:
            return 0
        messages = [
            {
                "to": token,
                "title": title,
                "body": body,
                "sound": "default",
                "data": data or {},
            }
            for token in tokens
            if is_expo_token(token)
        ]
        if not messages:
            return 0

        session = self._session_factory()
        try:
            async with session.post(EXPO_ENDPOINT, json=messages) as response:
                if response.status >= 400:
                    log.warning(
                        "Push fehlgeschlagen (%s): %s",
                        response.status,
                        (await response.text())[:200],
                    )
                    return 0
        except Exception as err:
            # Eine gescheiterte Benachrichtigung darf die Automation nicht
            # abbrechen, die sie ausgelöst hat.
            log.warning("Push nicht zustellbar: %s", err)
            return 0
        finally:
            await session.close()
        return len(messages)
