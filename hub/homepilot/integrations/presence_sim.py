"""Anwesenheitssimulation: schaltet abends zufällig Lichter, wenn niemand da ist.

Ist der Auslöse-Schalter an (z.B. ein Helfer 'Abwesend' oder
geofence.anyone_home auf 'off'), wird nach Einbruch der Dunkelheit in
unregelmässigen Abständen ein zufälliges Licht ein- oder ausgeschaltet – das
Haus wirkt bewohnt.

Nicht unifi.anyone_home: Das sagt «kein verfolgtes Gerät im Netz» und geht
schon aus, wenn das Telefon im Garten den Funk verliert – dann spielt das
Haus Bewohner, während jemand darin sitzt.

Konfiguration:
  - integration: presence_sim
    switch: helpers.abwesend       # aktiv, wenn dieser Schalter 'on' ist …
    switch_active: "on"            # … auf diesem Wert (bei geofence: 'off')
    lights: [hue.wohnzimmer, hue.buero, hue.kueche]
    min_interval: 600              # kürzester Abstand (Sekunden)
    max_interval: 1800             # längster Abstand
    only_after_dark: true          # nur wenn die Sonne unter dem Horizont ist

Standort für die Dunkelheit kommt aus config.location (Standard Zell LU).
"""

from __future__ import annotations

import asyncio
import random
from datetime import datetime

from ..core import astro
from ..core.integration import Integration
from ..core.source import as_source

DEFAULT_LAT = 47.1445
DEFAULT_LON = 8.0675

# Damit der Verlauf in der App «· Anwesenheitssimulation» zeigt statt gar
# nichts: Ohne Quelle sähe der Schaltvorgang aus, als hätte jemand am
# Gerät gedrückt - und die Frage «warum ging das Licht an?» bliebe offen.
SOURCE = {"kind": "simulation", "label": "Anwesenheitssimulation"}


class PresenceSimIntegration(Integration):
    name = "presence_sim"

    async def setup(self) -> None:
        self._switch = self.config.get("switch")
        self._active = str(self.config.get("switch_active", "on"))
        self._lights = [str(x) for x in (self.config.get("lights") or [])]
        self._min = float(self.config.get("min_interval", 600))
        self._max = float(self.config.get("max_interval", 1800))
        self._after_dark = bool(self.config.get("only_after_dark", True))
        self._rng = random.Random()
        if not self._switch or not self._lights:
            self.log.warning("presence_sim: 'switch' und 'lights' nötig – inaktiv")
            return
        self.start_task(self._loop())

    def _dark(self) -> bool:
        if not self._after_dark:
            return True
        loc = getattr(self.hub.config, "location", None) or {}
        try:
            lat = float(loc.get("latitude", DEFAULT_LAT))
            lon = float(loc.get("longitude", DEFAULT_LON))
        except (TypeError, ValueError):
            lat, lon = DEFAULT_LAT, DEFAULT_LON
        now = datetime.now()
        rise = astro.sun_event(now.date(), lat, lon, sunset=False)
        set_ = astro.sun_event(now.date(), lat, lon, sunset=True)
        if rise is None or set_ is None:
            return True
        return not (rise <= now <= set_)

    def _armed(self) -> bool:
        entity = self.hub.registry.get(str(self._switch))
        return entity is not None and str(entity.state.get("state")) == self._active

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._rng.uniform(self._min, self._max))
            if not self._armed() or not self._dark():
                continue
            light_id = self._rng.choice(self._lights)
            entity = self.hub.registry.get(light_id)
            if entity is None:
                continue
            command = "turn_off" if entity.state.get("state") == "on" else "turn_on"
            try:
                with as_source(SOURCE):
                    await self.hub.integrations.dispatch_command(light_id, command)
                self.log.info("Anwesenheitssimulation: %s %s", light_id, command)
            except Exception as err:
                self.log.debug("presence_sim: %s (%s)", light_id, err)


INTEGRATION = PresenceSimIntegration
