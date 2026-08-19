"""Anmeldung mit E-Mail und Passwort über Supabase Auth.

Warum überhaupt: Bisher ist ein Token die Anmeldung – gut für ein
Wandpanel, unpraktisch für Menschen. Wer sein Telefon wechselt, braucht
einen QR-Code von jemandem, der schon drin ist. Mit E-Mail und Passwort
meldet sich jeder selbst an, und die Bestätigungs-E-Mail beweist
nebenbei, dass die Adresse stimmt.

Warum trotzdem nicht *nur* Supabase: Der Hub steuert das Haus und muss
das auch dann tun, wenn das Internet weg ist. Deshalb ist Supabase hier
nur die Anmeldestelle – wer sich einmal angemeldet hat, bekommt vom Hub
eine eigene Sitzung, die lokal gilt. Danach braucht der Alltag kein
Supabase mehr.

Der Hub spricht dabei selbst mit Supabase, nicht die App. Damit bleibt
der Anon-Key auf dem Hub, und die App kennt weiterhin nur eine einzige
Adresse: die des Hubs.
"""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

log = logging.getLogger(__name__)

# Anmeldungen dürfen nicht ewig hängen – lieber eine klare Fehlermeldung
# als eine App, die minutenlang «meldet an …» zeigt.
TIMEOUT = 15.0


class AuthError(Exception):
    """Anmeldung oder Registrierung abgelehnt – mit lesbarem Grund."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def error_text(status: int, payload: Any) -> str:
    """Supabase-Fehler in einen brauchbaren Satz übersetzen (rein, testbar).

    Die englischen Rohtexte («Invalid login credentials») sagen zwar, was
    los ist, aber nicht, was zu tun wäre – und in einer deutschen App
    stehen sie schief.
    """
    raw = ""
    if isinstance(payload, dict):
        raw = str(
            payload.get("error_description")
            or payload.get("msg")
            or payload.get("message")
            or payload.get("error")
            or ""
        )
    lowered = raw.lower()
    if "email not confirmed" in lowered:
        return (
            "Die E-Mail-Adresse ist noch nicht bestätigt. Schau in dein "
            "Postfach – auch im Spam-Ordner."
        )
    if "invalid login" in lowered or status == 400 and "credential" in lowered:
        return "E-Mail-Adresse oder Passwort stimmen nicht."
    if "user already registered" in lowered or "already been registered" in lowered:
        return "Für diese Adresse gibt es schon ein Konto. Melde dich an."
    if "password should be" in lowered or "weak password" in lowered:
        return "Das Passwort ist zu kurz – mindestens acht Zeichen."
    if status == 429:
        return "Zu viele Versuche. Warte einen Moment."
    if raw:
        return raw
    return f"Supabase antwortet mit {status}"


def parse_session(payload: dict[str, Any]) -> dict[str, Any]:
    """Aus der Supabase-Antwort machen, was der Hub braucht (rein, testbar).

    ``confirmed`` ist die Frage, auf die es ankommt: Ein Konto ohne
    bestätigte Adresse ist bei Supabase je nach Einstellung trotzdem
    anmeldbar – der Hub lässt es aber nicht durch.
    """
    user = payload.get("user") or {}
    return {
        "id": str(user.get("id") or ""),
        "email": str(user.get("email") or "").strip().lower(),
        "confirmed": bool(user.get("email_confirmed_at") or user.get("confirmed_at")),
        "access_token": str(payload.get("access_token") or ""),
    }


class SupabaseAuth:
    """Die drei Wege: anmelden, registrieren, Passwort vergessen."""

    def __init__(self, url: str, anon_key: str, timeout: float = TIMEOUT) -> None:
        self.base = url.rstrip("/") + "/auth/v1"
        self._anon = anon_key
        self._timeout = aiohttp.ClientTimeout(total=timeout)

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self._anon,
            "Content-Type": "application/json",
        }

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            async with aiohttp.ClientSession(timeout=self._timeout) as session:
                async with session.post(
                    f"{self.base}{path}", json=body, headers=self._headers()
                ) as response:
                    payload: Any = {}
                    try:
                        payload = await response.json()
                    except Exception:
                        payload = {}
                    if response.status >= 400:
                        raise AuthError(error_text(response.status, payload), response.status)
                    return payload if isinstance(payload, dict) else {}
        except AuthError:
            raise
        except Exception as err:
            # Kein Internet, DNS weg, Supabase down: Das ist kein
            # Anmeldefehler, und der Unterschied gehört gesagt.
            raise AuthError(
                "Der Anmeldedienst ist nicht erreichbar. Mit einem bereits "
                f"gekoppelten Gerät geht es weiter ({err}).",
                503,
            ) from err

    async def sign_in(self, email: str, password: str) -> dict[str, Any]:
        payload = await self._post(
            "/token?grant_type=password",
            {"email": email.strip().lower(), "password": password},
        )
        session = parse_session(payload)
        if not session["email"]:
            raise AuthError("Supabase liefert kein Konto zurück", 502)
        if not session["confirmed"]:
            raise AuthError(
                "Die E-Mail-Adresse ist noch nicht bestätigt. Schau in dein "
                "Postfach – auch im Spam-Ordner.",
                403,
            )
        return session

    async def sign_up(self, email: str, password: str) -> dict[str, Any]:
        """Konto anlegen – Supabase verschickt die Bestätigungs-E-Mail."""
        payload = await self._post(
            "/signup", {"email": email.strip().lower(), "password": password}
        )
        return parse_session(payload)

    async def recover(self, email: str) -> None:
        """Passwort-Vergessen-Mail anstossen.

        Die Antwort ist bewusst immer dieselbe: Ob es zu einer Adresse ein
        Konto gibt, geht niemanden etwas an, der sie nur eintippt.
        """
        try:
            await self._post("/recover", {"email": email.strip().lower()})
        except AuthError as err:
            if err.status == 503:
                raise
            log.info("Passwort-Zurücksetzen für %s: %s", email, err)
