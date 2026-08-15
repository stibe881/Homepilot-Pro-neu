"""Google Calendar – die nächsten Termine als Kachel.

Konfiguration:
  - integration: google_calendar
    client_id: "${GOOGLE_CLIENT_ID}"
    client_secret: "${GOOGLE_CLIENT_SECRET}"
    refresh_token: "${GOOGLE_REFRESH_TOKEN}"
    calendar_id: primary
    scan_interval: 300

Einmalige Einrichtung (analog Spotify, ~10 Minuten):
  1. In der Google Cloud Console ein Projekt anlegen, die Calendar API
     aktivieren und einen OAuth-Client (Typ „Desktop“) erstellen.
  2. Im Browser aufrufen (client_id einsetzen):
       https://accounts.google.com/o/oauth2/v2/auth?client_id=...
       &response_type=code&redirect_uri=http://127.0.0.1:8888
       &scope=https://www.googleapis.com/auth/calendar.readonly
       &access_type=offline&prompt=consent
  3. Den 'code' aus der Adresszeile gegen Tokens tauschen:
       curl -s https://oauth2.googleapis.com/token \\
            -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \\
            -d grant_type=authorization_code -d code=DER_CODE \\
            -d redirect_uri=http://127.0.0.1:8888
     Der refresh_token aus der Antwort kommt in die .env.

access_type=offline und prompt=consent sind wichtig – nur dann gibt Google
überhaupt einen refresh_token heraus.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import aiohttp

from ..core.entity import EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/calendar/v3"


def _event_bounds(event: dict[str, Any]) -> tuple[str | None, str | None, bool]:
    start = event.get("start") or {}
    end = event.get("end") or {}
    all_day = "date" in start
    return (
        start.get("dateTime") or start.get("date"),
        end.get("dateTime") or end.get("date"),
        all_day,
    )


def parse_events(items: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    """Übersetzt die Ereignisliste der API in Entitäts-Attribute.

    Bereits beendete Termine fliegen raus; „frei“ ist der normale Zustand
    ohne anstehende Termine.
    """
    upcoming = []
    for event in items:
        start, end, all_day = _event_bounds(event)
        if end:
            try:
                end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
                if end_dt.tzinfo is None:
                    end_dt = end_dt.replace(tzinfo=timezone.utc)
                if end_dt <= now:
                    continue
            except ValueError:
                pass
        upcoming.append(
            {
                "summary": event.get("summary") or "(ohne Titel)",
                "start": start,
                "end": end,
                "all_day": all_day,
                "location": event.get("location"),
            }
        )

    first = upcoming[0] if upcoming else None
    return {
        "state": first["summary"] if first else "frei",
        "next_start": first["start"] if first else None,
        "next_all_day": first["all_day"] if first else False,
        "events": upcoming[:5],
    }


class GoogleCalendarIntegration(Integration):
    name = "google_calendar"

    async def setup(self) -> None:
        self._client_id = self.config.get("client_id")
        self._client_secret = self.config.get("client_secret")
        self._refresh_token = self.config.get("refresh_token")
        if not (self._client_id and self._client_secret and self._refresh_token):
            raise ConfigError(
                "google_calendar braucht 'client_id', 'client_secret' und "
                "'refresh_token' – die Einrichtung steht im Kopf von "
                "integrations/google_calendar.py"
            )

        self._calendar_id = self.config.get("calendar_id", "primary")
        self._interval = float(self.config.get("scan_interval", 300))
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=20))
        self._access_token: str | None = None
        self._token_expires_at = 0.0

        await self.add_entity(
            "next",
            EntityKind.CALENDAR,
            self.config.get("name", "Kalender"),
            state={"state": "frei", "events": []},
            available=False,
        )
        await self._refresh()
        self.start_task(self._poll_loop())

    async def _ensure_token(self) -> str:
        loop = asyncio.get_running_loop()
        if self._access_token and loop.time() < self._token_expires_at:
            return self._access_token
        async with self._session.post(
            TOKEN_URL,
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "refresh_token": self._refresh_token,
                "grant_type": "refresh_token",
            },
        ) as response:
            if response.status >= 400:
                raise ConnectionError(
                    f"Google-Token-Erneuerung fehlgeschlagen ({response.status})"
                )
            payload = await response.json()
        self._access_token = payload["access_token"]
        self._token_expires_at = loop.time() + float(payload.get("expires_in", 3600)) * 0.9
        return self._access_token

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh()

    async def _refresh(self) -> None:
        entity_id = self.entity_id("next")
        now = datetime.now(timezone.utc)
        try:
            token = await self._ensure_token()
            url = (
                f"{API}/calendars/{quote(self._calendar_id)}/events"
                f"?timeMin={now.isoformat().replace('+00:00', 'Z')}"
                "&maxResults=10&singleEvents=true&orderBy=startTime"
            )
            async with self._session.get(
                url, headers={"Authorization": f"Bearer {token}"}
            ) as response:
                response.raise_for_status()
                payload = await response.json()
        except Exception as err:
            self.log.warning("Google Calendar nicht erreichbar: %s", err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return

        await self.hub.registry.update_state(
            entity_id, parse_events(payload.get("items", []), now), available=True
        )


INTEGRATION = GoogleCalendarIntegration
