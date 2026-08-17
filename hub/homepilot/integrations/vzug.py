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
    result: dict[str, Any] = {
        "state": "idle" if inactive else "running",
        "program": payload.get("Program") or None,
        "status": payload.get("Status") or None,
        "program_end": end_text,
        "serial": payload.get("Serial") or None,
    }
    if not inactive and end_text:
        if now_minutes is None:
            from datetime import datetime

            local = datetime.now()
            now_minutes = local.hour * 60 + local.minute
        minutes = minutes_until(end_text, now_minutes)
        if minutes is not None and 0 <= minutes <= 24 * 60:
            result["minutes_left"] = minutes
    return result


class VZugIntegration(Integration):
    name = "vzug"

    async def setup(self) -> None:
        devices = self.config.get("devices") or []
        if not devices:
            raise ConfigError("vzug braucht mindestens ein Gerät unter 'devices'")
        self._interval = float(self.config.get("scan_interval", 60))
        self._session = self.http_session()

        # entity_id → (host, auth)
        self._devices: dict[str, tuple[str, aiohttp.BasicAuth | None]] = {}
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
        await self.hub.registry.update_state(
            entity_id, parse_device_status(payload), available=True
        )


INTEGRATION = VZugIntegration
