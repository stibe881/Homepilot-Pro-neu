"""V-ZUG-Geräte über die lokale Home-API.

Konfiguration:
  - integration: vzug
    scan_interval: 60
    devices:
      - host: 192.168.1.40
        name: Geschirrspüler
        username: "${VZUG_USER}"      # optional, nur bei aktivierter Anmeldung
        password: "${VZUG_PASSWORD}"

Die Geräte liefern unter /ai?command=getDeviceStatus ihren Zustand. Die API
ist lesend – Programme lassen sich damit nicht starten, was für Geschirr-
spüler und Backofen auch gut so ist.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import aiohttp

from ..core.entity import EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


def minutes_until(end_text: str, now_minutes: int) -> int | None:
    """Restminuten aus dem 'End'-Feld (rein, testbar).

    AdoraDish/AdoraWash liefern das Programmende je nach Firmware als
    Uhrzeit «18:05», als Dauer «1h05» / «0h47» oder als Minutenzahl.
    ``now_minutes`` ist die aktuelle Uhrzeit in Minuten seit Mitternacht.
    """
    text = str(end_text).strip().lower()
    if not text:
        return None
    if "h" in text:
        hours, _, minutes = text.partition("h")
        try:
            return int(hours or 0) * 60 + int(minutes or 0)
        except ValueError:
            return None
    if ":" in text:
        try:
            hours, minutes = text.split(":", 1)
            end = int(hours) * 60 + int(minutes)
        except ValueError:
            return None
        # Endet das Programm «vor jetzt», ist Mitternacht dazwischen.
        return end - now_minutes if end >= now_minutes else end + 24 * 60 - now_minutes
    try:
        return int(text)
    except ValueError:
        return None


def parse_device_status(
    payload: dict[str, Any], now_minutes: int | None = None
) -> dict[str, Any]:
    """Übersetzt die Antwort von getDeviceStatus in Entitäts-Attribute.

    'Inactive' kommt als String "true"/"false" – daraus wird der Hauptwert
    idle/running. Aus dem Programmende wird, wo möglich, die Restzeit in
    Minuten berechnet (minutes_left) – die zeigt die App auf der Startseite.
    """
    inactive = str(payload.get("Inactive", "true")).strip().lower() == "true"
    program_end = payload.get("ProgramEnd") or {}
    end_text = (
        (program_end.get("End") or None) if isinstance(program_end, dict) else None
    )
    program = payload.get("Program") or None
    status_text = payload.get("Status") or None
    # «Inactive: false» heisst nur: Die Anzeige ist an. Ohne Programm und
    # ohne Statustext läuft nichts - eine Maschine im Standby (Türe zu,
    # Display wach) stand sonst dauerhaft als «läuft» auf der Startseite.
    laeuft = not inactive and bool(program or status_text)
    result: dict[str, Any] = {
        "state": "running" if laeuft else "idle",
        "program": program,
        "status": status_text,
        "program_end": end_text,
        "serial": payload.get("Serial") or None,
    }
    if laeuft and end_text:
        if now_minutes is None:
            from datetime import datetime

            local = datetime.now()
            now_minutes = local.hour * 60 + local.minute
        minutes = minutes_until(end_text, now_minutes)
        if minutes is not None and 0 <= minutes <= 24 * 60:
            result["minutes_left"] = minutes
    return result


def unfrozen_status(
    status: dict[str, Any],
    merker: dict[str, tuple[int, float]],
    entity_id: str,
    jetzt: float,
    grenze: float = 300.0,
) -> dict[str, Any]:
    """Eine stehengebliebene Restzeit-Anzeige entlarven (rein, testbar).

    Der Fall aus dem Betrieb: Waschmaschine und Geschirrspüler zeigten
    tagelang «noch 1 min», obwohl sie längst fertig waren - manche
    Firmware lässt am Programmende «Inactive: false» samt letzter
    End-Angabe einfach stehen.

    Die Physik hilft: Eine Maschine, die wirklich läuft, zählt runter.
    Meldet ein Gerät über mehr als fünf Minuten dieselbe Restzeit, ist
    das keine Restzeit, sondern eine eingefrorene Anzeige - sie fliegt
    raus, und steht sie auf ≤ 1 Minute, ist das Programm durch und das
    Gerät gilt als fertig.

    ``merker`` hält je Gerät (Minutenzahl, seit wann) und wird hier
    fortgeschrieben - hinein gehört immer dasselbe dict.
    """
    minutes = status.get("minutes_left")
    if not isinstance(minutes, int) or status.get("state") != "running":
        merker.pop(entity_id, None)
        return status
    bisher = merker.get(entity_id)
    if bisher is None or bisher[0] != minutes:
        merker[entity_id] = (minutes, jetzt)
        return status
    if jetzt - bisher[1] <= grenze:
        return status
    result = {key: value for key, value in status.items() if key != "minutes_left"}
    if minutes <= 1:
        result["state"] = "idle"
    return result


class VZugIntegration(Integration):
    name = "vzug"

    async def setup(self) -> None:
        devices = self.config.get("devices") or []
        if not devices:
            raise ConfigError("vzug braucht mindestens ein Gerät unter 'devices'")
        self._interval = self.scan_interval()
        self._session = self.http_session()

        # entity_id → (host, auth)
        self._devices: dict[str, tuple[str, aiohttp.BasicAuth | None]] = {}
        # Je Gerät: welche Restzeit zuletzt gemeldet wurde und seit wann -
        # für die Eingefroren-Erkennung (siehe unfrozen_status).
        self._countdown: dict[str, tuple[int, float]] = {}
        # Geräte, die gerade nicht antworten. V-ZUG-Geräte schlafen im
        # Standby und melden dann 503 – bei jedem Abruf eine Warnung zu
        # schreiben flutet das Log und begräbt alles Wichtige darunter.
        self._down: set[str] = set()
        for device in devices:
            host = device.get("host")
            if not host:
                raise ConfigError("vzug: jedes Gerät braucht einen 'host'")
            username, password = device.get("username"), device.get("password")
            auth = (
                aiohttp.BasicAuth(username, password) if username and password else None
            )
            entity = await self.add_entity(
                str(host).replace(".", "_"),
                EntityKind.APPLIANCE,
                device.get("name", f"V-ZUG {host}"),
                state={"state": "unknown"},
                available=False,
            )
            self._devices[entity.id] = (host, auth)

        await self._refresh_all()
        self.start_task(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh_all()

    async def _refresh_all(self) -> None:
        for entity_id, (host, auth) in self._devices.items():
            await self._refresh(entity_id, host, auth)

    async def _refresh(
        self, entity_id: str, host: str, auth: aiohttp.BasicAuth | None
    ) -> None:
        try:
            async with self._session.get(
                f"http://{host}/ai",
                params={"command": "getDeviceStatus"},
                auth=auth,
            ) as response:
                response.raise_for_status()
                # Die Geräte senden JSON teils als text/plain.
                payload = await response.json(content_type=None)
        except Exception as err:
            # Nur beim Übergang warnen, danach still bleiben: Ein Gerät im
            # Standby wäre sonst jede Minute eine Zeile.
            if entity_id not in self._down:
                self._down.add(entity_id)
                self.log.warning("V-ZUG %s nicht erreichbar: %s", host, err)
            else:
                self.log.debug("V-ZUG %s weiterhin nicht erreichbar: %s", host, err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return

        if entity_id in self._down:
            self._down.discard(entity_id)
            self.log.info("V-ZUG %s wieder erreichbar", host)
        status = unfrozen_status(
            parse_device_status(payload), self._countdown, entity_id, time.time()
        )
        await self.hub.registry.update_state(entity_id, status, available=True)


INTEGRATION = VZugIntegration
