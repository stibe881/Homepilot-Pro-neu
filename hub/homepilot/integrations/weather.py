"""Wetterlage, Mehrtagesvorhersage und Regen-Vorwarnung über Open-Meteo.

Konfiguration:
  - integration: weather
    latitude: 47.13844        # Zell LU
    longitude: 7.92059
    name: Zell LU
    scan_interval: 1800

Open-Meteo ist kostenlos und braucht keinen Schlüssel. Geliefert werden
der aktuelle Wert und die nächsten sieben Tage – die App zeigt heute plus
die Woche.

Dazu die Viertelstundenwerte der nächsten Stunden: Daraus wird die
einzige Zahl gerechnet, die man am Fenster braucht - in wie vielen
Minuten es anfängt (core/regen.py). «60 % heute» beantwortet die Frage
«muss ich die Wäsche jetzt hereinholen?» nicht.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

import aiohttp

from ..core import regen
from ..core.entity import EntityKind
from ..core.integration import Integration

API = "https://api.open-meteo.com/v1/forecast"

# WMO-Wettercodes → (Kurztext, Ionicons-Symbol). Bewusst zusammengefasst:
# die App braucht ein erkennbares Bild, keine 28 Feinabstufungen.
WMO = {
    0: ("Klar", "sunny-outline"),
    1: ("Meist klar", "partly-sunny-outline"),
    2: ("Bewölkt", "partly-sunny-outline"),
    3: ("Bedeckt", "cloud-outline"),
    45: ("Nebel", "cloud-outline"),
    48: ("Reifnebel", "cloud-outline"),
    51: ("Leichter Niesel", "rainy-outline"),
    53: ("Niesel", "rainy-outline"),
    55: ("Starker Niesel", "rainy-outline"),
    56: ("Gefrierender Niesel", "rainy-outline"),
    57: ("Gefrierender Niesel", "rainy-outline"),
    61: ("Leichter Regen", "rainy-outline"),
    63: ("Regen", "rainy-outline"),
    65: ("Starker Regen", "rainy-outline"),
    66: ("Gefrierender Regen", "rainy-outline"),
    67: ("Gefrierender Regen", "rainy-outline"),
    71: ("Leichter Schnee", "snow-outline"),
    73: ("Schnee", "snow-outline"),
    75: ("Starker Schnee", "snow-outline"),
    77: ("Schneegriesel", "snow-outline"),
    80: ("Regenschauer", "rainy-outline"),
    81: ("Regenschauer", "rainy-outline"),
    82: ("Heftige Schauer", "thunderstorm-outline"),
    85: ("Schneeschauer", "snow-outline"),
    86: ("Schneeschauer", "snow-outline"),
    95: ("Gewitter", "thunderstorm-outline"),
    96: ("Gewitter mit Hagel", "thunderstorm-outline"),
    99: ("Schweres Gewitter", "thunderstorm-outline"),
}


def describe_code(code: Any) -> tuple[str, str]:
    """WMO-Code → (Text, Symbol); Unbekanntes bleibt neutral."""
    try:
        return WMO[int(code)]
    except (KeyError, TypeError, ValueError):
        return ("—", "cloud-outline")


def parse_forecast(
    payload: dict[str, Any], jetzt: datetime | None = None
) -> dict[str, Any]:
    """Übersetzt die Open-Meteo-Antwort in Entitäts-Attribute (rein, testbar)."""
    current = payload.get("current") or {}
    text, icon = describe_code(current.get("weather_code"))
    # Die Uhr der Antwort, nicht die des Hubs: Open-Meteo liefert seine
    # Zeiten in der angefragten Zone (Europe/Zurich), und ein Hub, der
    # in einem Container auf UTC läuft, läge damit zwei Stunden daneben -
    # jeder Schauer sähe aus, als käme er in zwei Stunden.
    if jetzt is None:
        jetzt = _zeitpunkt(current.get("time")) or datetime.now()
    daily = payload.get("daily") or {}
    days_out = []
    times = daily.get("time") or []
    codes = daily.get("weather_code") or []
    highs = daily.get("temperature_2m_max") or []
    lows = daily.get("temperature_2m_min") or []
    rain = daily.get("precipitation_probability_max") or []
    for index, day in enumerate(times):
        day_text, day_icon = describe_code(codes[index] if index < len(codes) else None)
        days_out.append(
            {
                "date": day,
                "code": codes[index] if index < len(codes) else None,
                "text": day_text,
                "icon": day_icon,
                "high": _round(highs[index] if index < len(highs) else None),
                "low": _round(lows[index] if index < len(lows) else None),
                "rain": rain[index] if index < len(rain) else None,
            }
        )
    return {
        "state": text,
        "icon": icon,
        "temperature": _round(current.get("temperature_2m")),
        "days": days_out,
        # Die Vorwarnung fährt am selben Zustand mit: Die App zeigt sie
        # auf der Wetterkarte, der Wächter meldet sie, wenn dabei ein
        # Fenster offen steht - beide lesen dieselbe Entität.
        "rain": {
            **regen.analyse(payload.get("minutely_15"), jetzt),
            # Die Reihe hinter dem Satz: acht Viertelstunden für die
            # kleine Grafik auf der Wetterkarte.
            "bars": regen.balken(payload.get("minutely_15"), jetzt),
        },
    }


def _zeitpunkt(wert: Any) -> datetime | None:
    """«2026-08-27T22:15» → datetime; alles andere → None (rein)."""
    try:
        return datetime.fromisoformat(str(wert))
    except (TypeError, ValueError):
        return None


def _round(value: Any) -> Any:
    return round(float(value)) if isinstance(value, (int, float)) else None


class WeatherIntegration(Integration):
    name = "weather"

    async def setup(self) -> None:
        self._lat = float(self.config.get("latitude", 47.13844))
        self._lon = float(self.config.get("longitude", 7.92059))
        self._interval = self.scan_interval()
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=30))

        await self.add_entity(
            "forecast",
            EntityKind.WEATHER,
            self.config.get("name", "Wetter"),
            state={"state": "—", "days": []},
            available=False,
        )
        await self._refresh()
        self.start_task(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh()

    async def _refresh(self) -> None:
        entity_id = self.entity_id("forecast")
        params = {
            "latitude": self._lat,
            "longitude": self._lon,
            "current": "temperature_2m,weather_code",
            # Viertelstundenwerte für die Vorwarnung; feiner gibt es
            # bei Open-Meteo nicht, und feiner tun als die Quelle wäre
            # eine erfundene Zahl (core/regen.py).
            "minutely_15": "precipitation",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,"
            "precipitation_probability_max",
            "timezone": "Europe/Zurich",
            "forecast_days": 7,
        }
        try:
            async with self._session.get(API, params=params) as response:
                response.raise_for_status()
                payload = await response.json()
        except Exception as err:
            self.log.warning("Open-Meteo nicht erreichbar: %s", err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return
        await self.hub.registry.update_state(
            entity_id, parse_forecast(payload), available=True
        )


INTEGRATION = WeatherIntegration
