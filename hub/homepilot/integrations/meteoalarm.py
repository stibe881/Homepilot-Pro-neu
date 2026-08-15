"""Unwetterwarnungen von MeteoAlarm (offizieller CAP/Atom-Feed).

Konfiguration:
  - integration: meteoalarm
    countries: [switzerland]
    # Nur Warnungen anzeigen, deren Gebiet einen dieser Begriffe enthält.
    # Für Zell LU passen die Kantons-/Regionsnamen, unter denen MeteoAlarm
    # Warnungen ausgibt. Weglassen = alle Warnungen des Landes.
    areas: ["Luzern", "Zentralschweiz"]
    scan_interval: 900  # Sekunden
"""

from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET
from typing import Any

import aiohttp

from ..core.entity import EntityKind
from ..core.integration import Integration

FEED_URL = "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-{country}"

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "cap": "urn:oasis:names:tc:emergency:cap:1.2",
}

SEVERITY_ORDER = ["Minor", "Moderate", "Severe", "Extreme"]


def parse_feed(xml_text: str) -> list[dict[str, Any]]:
    """Extrahiert Warnungen aus dem Atom-Feed (separat testbar)."""
    root = ET.fromstring(xml_text)
    alerts = []
    for entry in root.findall("atom:entry", NS):
        def text(path: str) -> str | None:
            element = entry.find(path, NS)
            return element.text.strip() if element is not None and element.text else None

        alerts.append(
            {
                "title": text("atom:title"),
                "event": text("cap:event"),
                "severity": text("cap:severity"),
                "onset": text("cap:onset") or text("cap:effective"),
                "expires": text("cap:expires"),
                "area": text("cap:areaDesc"),
            }
        )
    return alerts


def filter_by_area(
    alerts: list[dict[str, Any]], areas: list[str]
) -> list[dict[str, Any]]:
    """Behält nur Warnungen, deren Gebiet einen der Begriffe enthält.

    Leere Liste = kein Filter (rein, testbar). Der Vergleich ist
    unabhängig von Gross-/Kleinschreibung.
    """
    if not areas:
        return alerts
    needles = [area.lower() for area in areas]
    return [
        alert
        for alert in alerts
        if any(needle in (alert.get("area") or "").lower() for needle in needles)
    ]


def max_severity(alerts: list[dict[str, Any]]) -> str | None:
    best = None
    for alert in alerts:
        severity = alert.get("severity")
        if severity in SEVERITY_ORDER and (
            best is None or SEVERITY_ORDER.index(severity) > SEVERITY_ORDER.index(best)
        ):
            best = severity
    return best


class MeteoAlarmIntegration(Integration):
    name = "meteoalarm"

    async def setup(self) -> None:
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=30))
        self._countries: list[str] = [
            str(country).lower() for country in self.config.get("countries", ["switzerland"])
        ]
        self._areas: list[str] = [str(area) for area in self.config.get("areas", [])]
        self._interval = float(self.config.get("scan_interval", 900))

        for country in self._countries:
            await self.add_entity(
                country,
                EntityKind.ALERT,
                f"MeteoAlarm {country.capitalize()}",
                state={"state": "unknown", "count": 0, "alerts": []},
            )
        self.start_task(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            for country in self._countries:
                await self._refresh(country)
            await asyncio.sleep(self._interval)

    async def _refresh(self, country: str) -> None:
        entity_id = self.entity_id(country)
        try:
            async with self._session.get(FEED_URL.format(country=country)) as response:
                response.raise_for_status()
                alerts = parse_feed(await response.text())
        except Exception as err:
            self.log.warning("MeteoAlarm-Feed für %s nicht erreichbar: %s", country, err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return

        alerts = filter_by_area(alerts, self._areas)

        await self.hub.registry.update_state(
            entity_id,
            {
                "state": "alert" if alerts else "ok",
                "count": len(alerts),
                "max_severity": max_severity(alerts),
                "alerts": alerts[:20],
            },
            available=True,
        )


INTEGRATION = MeteoAlarmIntegration
