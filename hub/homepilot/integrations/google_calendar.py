"""Google Calendar – die nächsten Termine als Kachel.

Konfiguration:
  - integration: google_calendar
    client_id: "${GOOGLE_CLIENT_ID}"
    client_secret: "${GOOGLE_CLIENT_SECRET}"
    # Mehrere Kalender möglich; 'primary' ist der Hauptkalender, der zweite
    # hier ist Googles Geburtstags-Kalender (aus den Kontakten).
    calendar_ids:
      - primary
      - addressbook#contacts@group.v.calendar.google.com
    scan_interval: 300

Einmalige Einrichtung (~10 Minuten):
  1. console.cloud.google.com → Projekt anlegen → «Google Calendar API»
     aktivieren → OAuth-Zustimmungsbildschirm (Extern, sich selbst als
     Testnutzer eintragen) → Anmeldedaten → OAuth-Client-ID, Typ «Desktop».
  2. client_id und client_secret in die .env auf dem Hub eintragen.
  3. Anmelden:  python -m homepilot.integrations.google_calendar -c config.yaml
     Der Helfer zeigt eine Google-Adresse, dort anmelden und den Code aus
     der Adresszeile zurück in den Helfer kopieren. Das Token landet in
     google-token.json neben der homepilot-data.json.

Ein refresh_token in der Konfiguration wird weiterhin unterstützt und hat
Vorrang vor der Token-Datei.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import aiohttp

from ..core.entity import EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/calendar/v3"
# events statt readonly: damit lassen sich aus der App auch Termine anlegen.
SCOPE = "https://www.googleapis.com/auth/calendar.events"
REDIRECT = "http://127.0.0.1:8888"


def build_event(
    summary: str, date: str, time_text: str = "", duration_minutes: int = 60
) -> dict[str, Any]:
    """Baut den Google-Event-Körper aus App-Eingaben (rein, testbar).

    date: «TT.MM.JJJJ» oder «JJJJ-MM-TT»; ohne time_text wird es ein
    Ganztages-Termin.
    """
    import re
    from datetime import datetime as _dt
    from datetime import timedelta

    swiss = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", date.strip())
    if swiss:
        day = _dt(int(swiss.group(3)), int(swiss.group(2)), int(swiss.group(1)))
    else:
        day = _dt.fromisoformat(date.strip())
    if not summary.strip():
        raise ValueError("Der Termin braucht einen Titel")

    if time_text.strip():
        hour, minute = time_text.strip().split(":", 1)
        start = day.replace(hour=int(hour), minute=int(minute))
        end = start + timedelta(minutes=int(duration_minutes))
        zone = "Europe/Zurich"
        return {
            "summary": summary.strip(),
            "start": {"dateTime": start.isoformat(), "timeZone": zone},
            "end": {"dateTime": end.isoformat(), "timeZone": zone},
        }
    end_day = day + timedelta(days=1)
    return {
        "summary": summary.strip(),
        "start": {"date": day.date().isoformat()},
        "end": {"date": end_day.date().isoformat()},
    }


def is_birthday_calendar(calendar_id: str) -> bool:
    """Googles Geburtstags-Kalender (aus den Kontakten) erkennen."""
    return "#contacts" in calendar_id or "birthday" in calendar_id.lower()


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
    """Übersetzt die (bereits zusammengeführte) Ereignisliste in Attribute.

    Bereits beendete Termine fliegen raus; „frei“ ist der normale Zustand
    ohne anstehende Termine. Einträge aus dem Geburtstags-Kalender tragen
    das Feld ``birthday`` – die App zeigt sie getrennt von den Terminen.
    """
    upcoming = []
    for event in items:
        start, end, all_day = _event_bounds(event)
        if end:
            try:
                end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
                if end_dt.tzinfo is None:
                    end_dt = end_dt.replace(tzinfo=UTC)
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
                "birthday": bool(event.get("_birthday")),
            }
        )
    upcoming.sort(key=lambda event: event.get("start") or "")

    first = next((event for event in upcoming if not event["birthday"]), None)
    return {
        "state": first["summary"] if first else "frei",
        "next_start": first["start"] if first else None,
        "next_all_day": first["all_day"] if first else False,
        "events": upcoming[:12],
    }


class GoogleCalendarIntegration(Integration):
    name = "google_calendar"

    async def setup(self) -> None:
        self._client_id = self.config.get("client_id")
        self._client_secret = self.config.get("client_secret")
        self._refresh_token = self.config.get("refresh_token") or self._load_token()
        if not (self._client_id and self._client_secret):
            raise ConfigError(
                "google_calendar braucht 'client_id' und 'client_secret' "
                "(OAuth-Client Typ Desktop, console.cloud.google.com)"
            )
        if not self._refresh_token:
            raise ConfigError(
                "google_calendar: kein Token – einmalig anmelden mit: "
                "python -m homepilot.integrations.google_calendar -c config.yaml"
            )

        # Ein oder mehrere Kalender; 'calendar_id' bleibt als Einzahl gültig.
        ids = self.config.get("calendar_ids") or [self.config.get("calendar_id", "primary")]
        self._calendar_ids = [str(calendar_id) for calendar_id in ids]
        self._interval = self.scan_interval()
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=20))
        self._access_token: str | None = None
        self._token_expires_at = 0.0

        await self.add_entity(
            "next",
            EntityKind.CALENDAR,
            self.config.get("name", "Kalender"),
            state={"state": "frei", "events": []},
            commands=["create_event"],
            available=False,
        )
        await self._refresh()
        self.start_task(self._poll_loop())

    def _token_file(self) -> Path:
        return Path(
            self.config.get("token_file")
            or Path(self.hub.config.data_file).parent / "google-token.json"
        )

    def _load_token(self) -> str | None:
        path = self._token_file()
        if not path.is_file():
            return None
        try:
            return json.loads(path.read_text()).get("refresh_token")
        except (OSError, json.JSONDecodeError):
            return None

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
        now = datetime.now(UTC)
        merged: list[dict[str, Any]] = []
        try:
            token = await self._ensure_token()
            for calendar_id in self._calendar_ids:
                url = (
                    f"{API}/calendars/{quote(calendar_id)}/events"
                    f"?timeMin={now.isoformat().replace('+00:00', 'Z')}"
                    "&maxResults=10&singleEvents=true&orderBy=startTime"
                )
                async with self._session.get(
                    url, headers={"Authorization": f"Bearer {token}"}
                ) as response:
                    # Ein einzelner fehlender Kalender (Tippfehler, keine
                    # Geburtstage) soll die übrigen nicht mitreissen.
                    if response.status == 404:
                        self.log.warning("Kalender '%s' nicht gefunden", calendar_id)
                        continue
                    response.raise_for_status()
                    payload = await response.json()
                birthday = is_birthday_calendar(calendar_id)
                for item in payload.get("items", []):
                    if birthday:
                        item["_birthday"] = True
                    merged.append(item)
        except Exception as err:
            self.log.warning("Google Calendar nicht erreichbar: %s", err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return

        await self.hub.registry.update_state(
            entity_id, parse_events(merged, now), available=True
        )


    async def handle_command(self, entity: Any, command: str, data: dict[str, Any]) -> None:
        if command != "create_event":
            raise ConfigError(f"Kalender kennt das Kommando '{command}' nicht")
        body = build_event(
            str(data.get("summary", "")),
            str(data.get("date", "")),
            str(data.get("time", "")),
            int(data.get("duration", 60)),
        )
        token = await self._ensure_token()
        # Immer in den Hauptkalender – Geburtstags- u.ä. Kalender sind
        # von Google verwaltet und nicht beschreibbar.
        target = next(
            (c for c in self._calendar_ids if not is_birthday_calendar(c)), "primary"
        )
        async with self._session.post(
            f"{API}/calendars/{quote(target)}/events",
            headers={"Authorization": f"Bearer {token}"},
            json=body,
        ) as response:
            if response.status >= 400:
                detail = await response.text()
                raise ConnectionError(
                    f"Termin konnte nicht angelegt werden ({response.status}): {detail[:200]}"
                )
        await self._refresh()


INTEGRATION = GoogleCalendarIntegration


# ── Anmelde-Helfer ─────────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.google_calendar -c config.yaml
# Zeigt die Google-Anmeldeadresse, tauscht den Code gegen Tokens und legt den
# refresh_token in google-token.json neben der homepilot-data.json ab.


async def _login_main(config_path: str) -> int:
    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [
        b for b in config.integrations if b.get("integration") == "google_calendar"
    ]
    client_id = (blocks[0].get("client_id") if blocks else None) or input(
        "Google client_id: "
    ).strip()
    client_secret = (blocks[0].get("client_secret") if blocks else None) or input(
        "Google client_secret: "
    ).strip()
    if not client_id or not client_secret:
        print("✗ client_id und client_secret sind nötig (OAuth-Client Typ Desktop).")
        return 1

    auth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={quote(client_id)}"
        f"&response_type=code&redirect_uri={quote(REDIRECT)}"
        f"&scope={quote(SCOPE)}"
        "&access_type=offline&prompt=consent"
    )
    print("\n1. Diese Adresse im Browser öffnen und mit dem Google-Konto anmelden:\n")
    print(f"   {auth_url}\n")
    print(
        "2. Nach dem Zustimmen leitet Google auf 127.0.0.1:8888 um – die Seite\n"
        "   lädt nicht, das ist normal. Aus der Adresszeile den Wert hinter\n"
        "   'code=' kopieren (bis vor das nächste '&')."
    )
    code = input("\nCode: ").strip()

    async with aiohttp.ClientSession() as session, session.post(
        TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT,
        },
    ) as response:
        payload = await response.json()
    refresh_token = payload.get("refresh_token")
    if not refresh_token:
        print(f"✗ Kein refresh_token erhalten: {payload}")
        print(
            "  Häufigste Ursachen: Code doppelt verwendet (neu anmelden) oder "
            "der Zustimmungsbildschirm hat den Testnutzer nicht eingetragen."
        )
        return 1

    token_file = Path(
        (blocks[0].get("token_file") if blocks else None)
        or Path(config.data_file).parent / "google-token.json"
    )
    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(json.dumps({"refresh_token": refresh_token}))
    os.chmod(token_file, 0o600)
    print(f"\n✓ Token gespeichert in {token_file} – jetzt den Hub (neu) starten.")
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Google-Calendar-Anmeldung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    args = parser.parse_args()
    sys.exit(asyncio.run(_login_main(args.config)))
