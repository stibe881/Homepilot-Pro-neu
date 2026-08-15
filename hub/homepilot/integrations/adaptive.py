"""Adaptive Beleuchtung: Farbtemperatur folgt dem Sonnenstand.

Mittags kühl-weiss, morgens und abends warm, nachts am wärmsten – ganz von
selbst. Es werden nur Lichter angepasst, die gerade an sind; nichts wird
ein- oder ausgeschaltet.

Konfiguration:
  - integration: adaptive
    lights: [hue.buero, hue.wohnzimmer]
    interval: 300          # Sekunden zwischen den Angleichungen
    warm: 400              # Mirek nachts / am Horizont (~2500 K)
    cool: 220              # Mirek zur Mittagssonne (~4500 K)

Standort kommt aus config.location (Standard Zell LU).
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from ..core import astro
from ..core.entity import Entity
from ..core.integration import Integration

DEFAULT_LAT = 47.1445
DEFAULT_LON = 8.0675


def target_mirek(now: datetime, rise: datetime | None, set_: datetime | None,
                 warm: float, cool: float) -> int:
    """Ziel-Farbtemperatur (Mirek) für den Moment – rein und testbar.

    Vor Aufgang / nach Untergang: warm. Tagsüber zwischen warm (am Horizont)
    und cool (zur Sonnenmitte) interpoliert.
    """
    if rise is None or set_ is None or now < rise or now > set_:
        return round(warm)
    noon = rise + (set_ - rise) / 2
    half = (set_ - rise).total_seconds() / 2 or 1
    # 0 am Horizont, 1 zur Sonnenmitte.
    factor = 1 - abs((now - noon).total_seconds()) / half
    factor = max(0.0, min(1.0, factor))
    return round(warm - factor * (warm - cool))


class AdaptiveIntegration(Integration):
    name = "adaptive"

    async def setup(self) -> None:
        self._lights = [str(x) for x in (self.config.get("lights") or [])]
        self._interval = float(self.config.get("interval", 300))
        self._warm = float(self.config.get("warm", 400))
        self._cool = float(self.config.get("cool", 220))
        if not self._lights:
            self.log.warning("adaptive: keine 'lights' angegeben – nichts zu tun")
            return
        self.start_task(self._loop())

    def _location(self) -> tuple[float, float]:
        loc = getattr(self.hub.config, "location", None) or {}
        try:
            return float(loc.get("latitude", DEFAULT_LAT)), float(
                loc.get("longitude", DEFAULT_LON)
            )
        except (TypeError, ValueError):
            return DEFAULT_LAT, DEFAULT_LON

    async def _loop(self) -> None:
        while True:
            await self._apply()
            await asyncio.sleep(self._interval)

    async def _apply(self) -> None:
        now = datetime.now()
        lat, lon = self._location()
        rise = astro.sun_event(now.date(), lat, lon, sunset=False)
        set_ = astro.sun_event(now.date(), lat, lon, sunset=True)
        mirek = target_mirek(now, rise, set_, self._warm, self._cool)
        for light_id in self._lights:
            entity = self.hub.registry.get(light_id)
            if entity is None or entity.state.get("state") != "on":
                continue
            if "set_color_temp" not in entity.commands:
                continue
            # Nur schalten, wenn nennenswert anders – spart Funkverkehr.
            current = entity.state.get("color_temp")
            if isinstance(current, (int, float)) and abs(current - mirek) < 8:
                continue
            try:
                await self.hub.integrations.dispatch_command(
                    light_id, "set_color_temp", {"color_temp": mirek}
                )
            except Exception as err:
                self.log.debug("adaptive: %s nicht anpassbar (%s)", light_id, err)


INTEGRATION = AdaptiveIntegration
