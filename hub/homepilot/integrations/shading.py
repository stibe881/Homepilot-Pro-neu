"""Beschattung: Storen zu, wenn die Sonne aufs Fenster brennt.

Warum eine eigene Integration und kein Ablauf: Ein Ablauf kennt nur
Auslöser und Bedingungen. Beschattung braucht dagegen einen Zustand – ob
*dieses* Fenster gerade beschattet ist – und die Regel, dass die Store erst
wieder aufgeht, wenn die Sonne wirklich weg ist und nicht bei jeder Wolke.
Beides in einem Ablauf nachzubauen hiesse, für jedes Fenster drei Abläufe
zu pflegen, die sich gegenseitig ins Gehege kommen.

Je Fenster wird angegeben, in welchem Himmelsrichtungsbereich die Sonne
hineinscheint, ab welcher Sonnenhöhe und ab welcher Aussentemperatur. Alle
drei müssen zusammen zutreffen:

  - Richtung allein genügt nicht: Im Winter steht die Sonne so flach, dass
    sie willkommen ist.
  - Höhe allein genügt nicht: Mittags brennt sie auf die Südseite, nicht
    auf die Ostseite.
  - Temperatur allein genügt nicht: Ein kalter, klarer Wintertag blendet,
    heizt aber nicht.

Und eine Sperre nach oben: Wer die Store von Hand öffnet, will sie offen
haben. Die Automatik hält sich dann bis zum nächsten Tag zurück.

  - integration: shading
    temperature: hm.temp_aussen      # Entität mit der Aussentemperatur
    windows:
      - cover: overkiz.wohnzimmer
        azimuth: [90, 200]           # von Ost bis Süd-Süd-West
        elevation: 15                # erst, wenn die Sonne hoch genug steht
        temperature: 22              # ab dieser Aussentemperatur
        position: 30                 # wie weit zu (0 = ganz zu)
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from ..core import astro
from ..core.errors import ConfigError
from ..core.integration import Integration

# Wie oft der Sonnenstand geprüft wird. Die Sonne wandert 15 Grad je
# Stunde – alle fünf Minuten ist mehr als genug und schont die Storen.
INTERVAL = 300.0
# So lange muss die Sonne weg sein, bevor wieder geöffnet wird. Ohne diese
# Beruhigung fährt die Store bei jeder Wolke auf und zu, und das hört man
# im ganzen Haus.
RELEASE_DELAY = 900.0

DEFAULT_ELEVATION = 15.0
DEFAULT_TEMPERATURE = 22.0
DEFAULT_POSITION = 30


def parse_windows(raw: Any) -> list[dict[str, Any]]:
    """Die Fensterliste einlesen (rein, testbar).

    Ein Eintrag ohne Store oder ohne Richtungsbereich fliegt raus: Ohne
    beides liesse sich nicht entscheiden, wann beschattet werden soll – und
    eine Store, die auf Verdacht zufährt, ärgert mehr als sie hilft.
    """
    windows: list[dict[str, Any]] = []
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        cover = str(entry.get("cover") or "")
        arc = entry.get("azimuth")
        if not cover or not isinstance(arc, (list, tuple)) or len(arc) != 2:
            continue
        try:
            start, end = float(arc[0]), float(arc[1])
        except (TypeError, ValueError):
            continue
        windows.append(
            {
                "cover": cover,
                "azimuth": (start, end),
                "elevation": float(entry.get("elevation", DEFAULT_ELEVATION)),
                "temperature": float(entry.get("temperature", DEFAULT_TEMPERATURE)),
                "position": int(entry.get("position", DEFAULT_POSITION)),
            }
        )
    return windows


def should_shade(
    window: dict[str, Any], elevation: float, azimuth: float, temperature: float | None
) -> bool:
    """Brennt die Sonne gerade auf dieses Fenster? (rein, testbar)

    Eine unbekannte Temperatur zählt als zu kalt: Lieber keine Beschattung
    als eine, die im Februar die Stube verdunkelt, weil der Fühler nichts
    meldet.
    """
    if elevation < window["elevation"]:
        return False
    if not astro.within_arc(azimuth, *window["azimuth"]):
        return False
    if temperature is None:
        return False
    return temperature >= window["temperature"]


class ShadingIntegration(Integration):
    name = "shading"

    async def setup(self) -> None:
        self._windows = parse_windows(self.config.get("windows"))
        if not self._windows:
            raise ConfigError(
                "shading: keine brauchbaren Fenster – jeder Eintrag braucht "
                "'cover' und 'azimuth: [von, bis]'"
            )
        self._temperature_id = str(self.config.get("temperature") or "")
        # Je Store: seit wann beschattet, und seit wann die Sonne weg ist.
        self._shaded: dict[str, bool] = {}
        self._clear_since: dict[str, float] = {}
        # Von Hand geöffnet: Tag, an dem die Automatik sich zurückhält.
        self._released: dict[str, str] = {}
        self._unsubscribe = self.hub.bus.subscribe("state_changed", self._on_state_changed)
        self.start_task(self._loop())

    async def teardown(self) -> None:
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None
        await super().teardown()

    def _on_state_changed(self, _event_type: str, data: dict[str, Any]) -> None:
        """Eine von Hand geöffnete Store bleibt offen.

        Sonst führen sich Mensch und Automatik gegenseitig vor: Man macht
        auf, fünf Minuten später fährt sie wieder zu, und niemand versteht
        warum.
        """
        entity_id = data.get("entity_id")
        if not self._shaded.get(entity_id):
            return
        source = data.get("source") or {}
        if source.get("kind") not in ("user", "app"):
            return
        state = (data.get("new_state") or {}).get("state")
        position = (data.get("new_state") or {}).get("position")
        opened = state == "open" or (isinstance(position, (int, float)) and position > 60)
        if opened:
            self._released[entity_id] = datetime.now().strftime("%Y-%m-%d")
            self._shaded[entity_id] = False
            self.log.info(
                "%s von Hand geöffnet – Beschattung ruht bis morgen", entity_id
            )

    async def _loop(self) -> None:
        import asyncio

        while True:
            try:
                await self.check()
            except Exception:
                self.log.exception("Beschattung fehlgeschlagen")
            await asyncio.sleep(INTERVAL)

    def _temperature(self) -> float | None:
        if not self._temperature_id:
            return None
        entity = self.hub.registry.get(self._temperature_id)
        if entity is None:
            return None
        for key in ("temperature", "state", "value"):
            try:
                return float(entity.state.get(key))
            except (TypeError, ValueError):
                continue
        return None

    def _location(self) -> tuple[float, float]:
        location = self.hub.config.location or {}
        return (
            float(location.get("latitude", 47.1445)),
            float(location.get("longitude", 8.0675)),
        )

    async def check(self) -> None:
        now = datetime.now()
        today = now.strftime("%Y-%m-%d")
        lat, lon = self._location()
        elevation, azimuth = astro.sun_position(now, lat, lon)
        temperature = self._temperature()

        for window in self._windows:
            cover = window["cover"]
            # Die Sperre gilt nur für den laufenden Tag – morgen früh fängt
            # die Automatik von vorne an.
            if self._released.get(cover) == today:
                continue
            self._released.pop(cover, None)

            wanted = should_shade(window, elevation, azimuth, temperature)
            if wanted:
                self._clear_since.pop(cover, None)
                if not self._shaded.get(cover):
                    await self._set(cover, window["position"])
                    self._shaded[cover] = True
                continue

            if not self._shaded.get(cover):
                continue
            since = self._clear_since.setdefault(cover, time.monotonic())
            if time.monotonic() - since >= RELEASE_DELAY:
                await self._set(cover, 100)
                self._shaded[cover] = False
                self._clear_since.pop(cover, None)

    async def _set(self, cover: str, position: int) -> None:
        """Die Store fahren – über den üblichen Weg, damit die Quelle stimmt.

        Ein Fehlschlag wird gemeldet und sonst geschluckt: Eine Store, die
        klemmt, darf die anderen nicht aufhalten.
        """
        try:
            entity = self.hub.registry.get(cover)
            if entity is None:
                self.log.warning("Beschattung: %s gibt es nicht", cover)
                return
            if "set_position" in entity.commands:
                await self.hub.integrations.dispatch_command(
                    cover, "set_position", {"position": position}
                )
            else:
                await self.hub.integrations.dispatch_command(
                    cover, "open" if position >= 100 else "close", {}
                )
        except Exception as err:
            self.log.warning("Beschattung: %s liess sich nicht fahren: %s", cover, err)

INTEGRATION = ShadingIntegration
