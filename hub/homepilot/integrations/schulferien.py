"""Schulferien Luzern: «Wecker nur an Schultagen» wird baubar.

Konfiguration:
  - integration: schulferien
    region: CH-LU               # Kanton, Voreinstellung Luzern
    scan_interval: 86400        # einmal am Tag reicht

Die Termine kommen von openholidaysapi.org - offen, ohne Schlüssel,
gepflegt aus den kantonalen Ferienplänen. Geholt wird einmal am Tag und
in die Datendatei gelegt: Ob heute Schule ist, darf danach nicht an der
Internetleitung hängen; nach einem Ausfall gilt der letzte Stand.

Das Ergebnis ist ein Sensor mit drei Zuständen («schultag»,
«wochenende», «ferien») - bewusst ein Gerät und kein neuer
Bedingungstyp: Jeder Ablauf fragt ihn über die vorhandene
Zustands-Bedingung ab, und die Kachel sagt nebenbei, wann die nächsten
Ferien beginnen (core/schulferien.py).
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta

import aiohttp

from ..core import schulferien
from ..core.entity import EntityKind
from ..core.integration import Integration

API = "https://openholidaysapi.org/SchoolHolidays"


class SchulferienIntegration(Integration):
    name = "schulferien"

    async def setup(self) -> None:
        self._region = str(self.config.get("region") or "CH-LU")
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=30))

        rows = self.hub.data.get(schulferien.STORE_KEY)
        await self.add_entity(
            "heute",
            EntityKind.SENSOR,
            "Schulferien",
            state=schulferien.lage(rows, date.today()),
            # Mit dem letzten Stand aus der Datendatei ist der Sensor
            # sofort brauchbar - auch wenn das Netz gerade fehlt.
            available=bool(rows),
        )
        self.start_task(self._takt())

    async def _takt(self) -> None:
        while True:
            await self._aktualisieren()
            # Einmal am Tag nachladen, aber stündlich den Tag neu
            # bewerten: Um Mitternacht wechselt «ferien» zu «schultag»,
            # ohne dass jemand etwas geholt hätte.
            for _ in range(24):
                await self.hub.registry.update_state(
                    self.entity_id("heute"),
                    schulferien.lage(
                        self.hub.data.get(schulferien.STORE_KEY), date.today()
                    ),
                )
                await asyncio.sleep(3600)

    async def _aktualisieren(self) -> None:
        rows = self.hub.data.get(schulferien.STORE_KEY)
        heute = date.today()
        params = {
            "countryIsoCode": "CH",
            "subdivisionCode": self._region,
            "languageIsoCode": "DE",
            "validFrom": heute.isoformat(),
            # Anderthalb Jahre voraus: Der Sommer des nächsten Jahres
            # steht damit früh genug in der Ablage.
            "validTo": (heute + timedelta(days=540)).isoformat(),
        }
        try:
            async with self._session.get(API, params=params) as antwort:
                antwort.raise_for_status()
                payload = await antwort.json()
        except Exception as err:
            # Der letzte Stand gilt weiter - nur wenn er nicht mehr weit
            # genug reicht, ist das eine Warnung wert.
            if schulferien.veraltet(rows, heute):
                self.log.warning("Schulferien nicht abrufbar: %s", err)
            else:
                self.log.debug("Schulferien nicht abrufbar: %s", err)
            return
        neu = schulferien.aus_antwort(payload)
        if neu:
            self.hub.data.set(schulferien.STORE_KEY, neu)
            await self.hub.registry.update_state(
                self.entity_id("heute"),
                schulferien.lage(neu, heute),
                available=True,
            )
            self.log.info("%d Ferientermine für %s übernommen", len(neu), self._region)


INTEGRATION = SchulferienIntegration
