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
    # Wie viele Minuten vor einem Termin eine Nachricht kommt (0 = keine).
    remind_minutes: 15

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
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import aiohttp

from ..core import tokenstore
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


def month_window(year: int, month: int) -> tuple[str, str]:
    """Anfang und Ende eines Monats als RFC-3339 (rein, testbar).

    Grosszügig gerechnet - eine Woche davor und danach -, weil die
    Monatsansicht die angeschnittenen Wochen mit anzeigt. Ohne diese
    Ränder blieben in der ersten und letzten Zeile Termine unsichtbar,
    die auf dem Bildschirm sehr wohl zu sehen sind.
    """
    from datetime import timedelta

    erster = datetime(year, month, 1, tzinfo=UTC)
    naechster = datetime(
        year + (1 if month == 12 else 0),
        1 if month == 12 else month + 1,
        1,
        tzinfo=UTC,
    )
    von = erster - timedelta(days=7)
    bis = naechster + timedelta(days=7)
    return (
        von.isoformat().replace("+00:00", "Z"),
        bis.isoformat().replace("+00:00", "Z"),
    )


def due_reminders(
    events: list[dict[str, Any]],
    now: datetime,
    minutes: int,
    schon_erinnert: set[str],
) -> list[dict[str, Any]]:
    """Für welche Termine jetzt eine Erinnerung fällig ist (rein, testbar).

    Ganztägige Termine bleiben aussen vor: «Ferien beginnen» eine
    Viertelstunde vorher zu melden, hilft niemandem - und um Mitternacht
    schon gar nicht.

    Erinnert wird nur einmal je Termin. Ohne dieses Gedächtnis käme bei
    jeder Abfrage eine neue Nachricht, bis der Termin beginnt.
    """
    from datetime import timedelta

    if minutes <= 0:
        return []
    faellig = []
    grenze = now + timedelta(minutes=minutes)
    for event in events:
        if event.get("all_day") or event.get("birthday"):
            continue
        kennung = str(event.get("id") or event.get("start") or "")
        if not kennung or kennung in schon_erinnert:
            continue
        roh = event.get("start")
        if not roh:
            continue
        try:
            beginn = datetime.fromisoformat(str(roh).replace("Z", "+00:00"))
        except ValueError:
            continue
        if beginn.tzinfo is None:
            beginn = beginn.replace(tzinfo=UTC)
        if now <= beginn <= grenze:
            faellig.append(event)
    return faellig


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
                # Kennung und Herkunft: Ohne beide lässt sich ein Termin
                # weder ändern noch löschen - Google verlangt zu jeder
                # Kennung den Kalender, in dem sie gilt.
                "id": event.get("id"),
                "calendar": event.get("_calendar"),
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
            state={"state": "frei", "events": [], "calendars": self._calendar_ids},
            commands=["create_event", "update_event", "delete_event"],
            available=False,
        )
        # Wie lange vor einem Termin gemeldet wird. 0 schaltet es ab.
        self._remind = int(self.config.get("remind_minutes", 0))
        self._reminded: set[str] = set()
        await self._refresh()
        self.start_task(self._poll_loop())

    def _token_file(self) -> Path:
        return tokenstore.token_file(self.hub.config.data_file, self.config, "google")

    def _load_token(self) -> str | None:
        return tokenstore.value(self._token_file(), "refresh_token")

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
                    "&maxResults=25&singleEvents=true&orderBy=startTime"
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
                    item["_calendar"] = calendar_id
                    if birthday:
                        item["_birthday"] = True
                    merged.append(item)
        except Exception as err:
            self.log.warning("Google Calendar nicht erreichbar: %s", err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return

        zustand = parse_events(merged, now)
        await self.hub.registry.update_state(entity_id, zustand, available=True)
        await self._remind_soon(zustand.get("events") or [], now)

    async def _remind_soon(self, events: list[dict[str, Any]], now: datetime) -> None:
        """Kurz vor dem Termin Bescheid geben.

        Der Hub kennt die Termine ohnehin - eine Erinnerung daraus kostet
        nichts als diese paar Zeilen, und sie erreicht auch das Telefon,
        auf dem niemand den Kalender eingerichtet hat.
        """
        faellig = due_reminders(events, now, self._remind, self._reminded)
        if not faellig:
            return
        for event in faellig:
            self._reminded.add(str(event.get("id") or event.get("start")))
        # Das Gedächtnis nicht wachsen lassen: Was nicht mehr in der
        # Terminliste steht, ist vorbei und darf vergessen werden.
        aktuell = {str(e.get("id") or e.get("start")) for e in events}
        self._reminded &= aktuell
        try:
            tokens = self.hub.push.recipients(self.hub.users.users, category="calendar")
            if not tokens:
                return
            for event in faellig:
                wann = str(event.get("start") or "")[11:16]
                ort = event.get("location")
                await self.hub.push.send(
                    tokens,
                    "Gleich ein Termin",
                    f"{event.get('summary')} um {wann}"
                    + (f" – {ort}" if ort else ""),
                    data={"kind": "calendar"},
                    category="calendar",
                )
        except Exception as err:  # eine Nachricht ist kein Grund zu scheitern
            self.log.warning("Termin-Erinnerung fehlgeschlagen: %s", err)

    async def events_between(self, von: str, bis: str) -> list[dict[str, Any]]:
        """Termine eines Zeitraums – für die Monatsansicht.

        Der Zustand der Entität trägt nur die nächsten zwölf Termine; das
        ist für eine Kachel richtig und für ein Monatsraster zu wenig. Wer
        einen Monat zurückblättert, sah dort bisher ein leeres Raster und
        musste glauben, es sei nichts gewesen.
        """
        token = await self._ensure_token()
        merged: list[dict[str, Any]] = []
        for calendar_id in self._calendar_ids:
            url = (
                f"{API}/calendars/{quote(calendar_id)}/events"
                f"?timeMin={quote(von)}&timeMax={quote(bis)}"
                "&maxResults=250&singleEvents=true&orderBy=startTime"
            )
            async with self._session.get(
                url, headers={"Authorization": f"Bearer {token}"}
            ) as response:
                if response.status == 404:
                    continue
                response.raise_for_status()
                payload = await response.json()
            birthday = is_birthday_calendar(calendar_id)
            for item in payload.get("items", []):
                item["_calendar"] = calendar_id
                if birthday:
                    item["_birthday"] = True
                merged.append(item)
        # Dieselbe Übersetzung wie sonst, aber ohne den Filter «nur was
        # noch kommt» - ein Rückblick ist hier ja der Zweck.
        umgesetzt = []
        for event in merged:
            start, end, all_day = _event_bounds(event)
            umgesetzt.append(
                {
                    "id": event.get("id"),
                    "calendar": event.get("_calendar"),
                    "summary": event.get("summary") or "(ohne Titel)",
                    "start": start,
                    "end": end,
                    "all_day": all_day,
                    "location": event.get("location"),
                    "birthday": bool(event.get("_birthday")),
                }
            )
        umgesetzt.sort(key=lambda event: event.get("start") or "")
        return umgesetzt


    async def handle_command(self, entity: Any, command: str, data: dict[str, Any]) -> None:
        token = await self._ensure_token()
        kopf = {"Authorization": f"Bearer {token}"}

        if command == "create_event":
            body = build_event(
                str(data.get("summary", "")),
                str(data.get("date", "")),
                str(data.get("time", "")),
                int(data.get("duration", 60)),
            )
            # Immer in den Hauptkalender – Geburtstags- u.ä. Kalender sind
            # von Google verwaltet und nicht beschreibbar.
            target = next(
                (c for c in self._calendar_ids if not is_birthday_calendar(c)), "primary"
            )
            async with self._session.post(
                f"{API}/calendars/{quote(target)}/events", headers=kopf, json=body
            ) as response:
                await self._raise_for(response, "angelegt")

        elif command in ("update_event", "delete_event"):
            event_id = str(data.get("id") or "").strip()
            if not event_id:
                raise ConfigError("Dazu fehlt die Kennung des Termins")
            # Der Kalender gehört zur Kennung: Dieselbe Kennung in einem
            # anderen Kalender gibt es schlicht nicht.
            calendar_id = str(data.get("calendar") or "").strip() or next(
                (c for c in self._calendar_ids if not is_birthday_calendar(c)), "primary"
            )
            if is_birthday_calendar(calendar_id):
                raise ConfigError(
                    "Geburtstage kommen aus den Google-Kontakten und lassen "
                    "sich hier nicht ändern"
                )
            ziel = f"{API}/calendars/{quote(calendar_id)}/events/{quote(event_id)}"
            if command == "delete_event":
                async with self._session.delete(ziel, headers=kopf) as response:
                    await self._raise_for(response, "gelöscht")
            else:
                body = build_event(
                    str(data.get("summary", "")),
                    str(data.get("date", "")),
                    str(data.get("time", "")),
                    int(data.get("duration", 60)),
                )
                async with self._session.put(
                    ziel, headers=kopf, json=body
                ) as response:
                    await self._raise_for(response, "geändert")
        else:
            raise ConfigError(f"Kalender kennt das Kommando '{command}' nicht")

        await self._refresh()

    @staticmethod
    async def _raise_for(response: Any, was: str) -> None:
        if response.status < 400:
            return
        detail = await response.text()
        raise ConnectionError(
            f"Termin konnte nicht {was} werden ({response.status}): {detail[:200]}"
        )


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

    token_file = tokenstore.token_file(
        config.data_file, blocks[0] if blocks else None, "google"
    )
    tokenstore.save(token_file, {"refresh_token": refresh_token})
    print(f"\n✓ Token gespeichert in {token_file} – jetzt den Hub (neu) starten.")
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Google-Calendar-Anmeldung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    args = parser.parse_args()
    sys.exit(asyncio.run(_login_main(args.config)))
