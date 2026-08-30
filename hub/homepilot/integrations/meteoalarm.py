"""Unwetterwarnungen von MeteoAlarm (offizieller CAP/Atom-Feed).

Gefiltert wird nach dem Warnpolygon, nicht nach dem Gebietsnamen: Jede
Warnung bringt die Umrisse ihrer Warnregion mit, und der Hub prüft, ob der
eigene Standort (config.location) darin liegt. Namensfilter wie «Luzern»
klangen richtig, trafen aber die falsche Region – «Luzern» steckt auch in
«Luzern-Alpnach», und die liegt am Vierwaldstättersee, nicht in Zell.

Konfiguration:
  - integration: meteoalarm
    countries: [switzerland]
    # Standort für den Polygon-Vergleich. Weglassen = config.location.
    # latitude: 47.13844
    # longitude: 7.92059
    # Nur als Rückfallebene, wenn kein Standort bekannt ist oder eine
    # Warnung ohne Polygon kommt: Gebietsname muss einen Begriff enthalten.
    # areas: ["Entlebuch"]
    scan_interval: 900  # Sekunden
"""

from __future__ import annotations

import asyncio
import re
import xml.etree.ElementTree as ET
from datetime import datetime
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


def parse_polygon(text: str) -> list[tuple[float, float]]:
    """CAP-Polygon «lat,lon lat,lon …» in Koordinatenpaare (rein, testbar).

    Unlesbare Stücke werden übersprungen statt die ganze Warnung zu
    verwerfen – ein kaputter Punkt im Umriss ist kein Grund, eine
    Unwetterwarnung zu unterschlagen.
    """
    points = []
    for pair in (text or "").split():
        lat, _, lon = pair.partition(",")
        try:
            points.append((float(lat), float(lon)))
        except ValueError:
            continue
    return points


def parse_feed(xml_text: str) -> list[dict[str, Any]]:
    """Extrahiert Warnungen aus dem Atom-Feed (separat testbar)."""
    root = ET.fromstring(xml_text)
    alerts = []
    for entry in root.findall("atom:entry", NS):
        # Der Eintrag wird ausdrücklich gebunden. Ohne das griffe die
        # Funktion auf die Schleifenvariable zu - solange sie noch in
        # derselben Runde aufgerufen wird, geht das gut, und beim ersten
        # Verschieben nach unten stillschweigend nicht mehr.
        def text(path: str, eintrag: Any = entry) -> str | None:
            element = eintrag.find(path, NS)
            return element.text.strip() if element is not None and element.text else None

        polygons = [
            parse_polygon(element.text or "")
            for element in entry.findall("cap:polygon", NS)
        ]
        alerts.append(
            {
                "title": text("atom:title"),
                "event": text("cap:event"),
                "severity": text("cap:severity"),
                "onset": text("cap:onset") or text("cap:effective"),
                "expires": text("cap:expires"),
                "area": text("cap:areaDesc"),
                # Nur fürs Filtern – vor dem Veröffentlichen wird der
                # Umriss entfernt, die App braucht keine hundert Punkte.
                "polygons": [poly for poly in polygons if len(poly) >= 3],
            }
        )
    return alerts


def point_in_polygon(lat: float, lon: float, polygon: list[tuple[float, float]]) -> bool:
    """Liegt der Punkt im Umriss? (Strahl-Verfahren, rein, testbar)

    Der Klassiker: Ein gedachter Strahl vom Punkt nach Osten – schneidet er
    die Umrisskanten ungerade oft, liegt der Punkt innen. Randgenauigkeit
    ist hier egal: Wohnhäuser stehen nicht auf der Warnregionsgrenze.
    """
    inside = False
    for index in range(len(polygon)):
        lat1, lon1 = polygon[index - 1]
        lat2, lon2 = polygon[index]
        if (lat1 > lat) == (lat2 > lat):
            continue
        crossing = lon1 + (lat - lat1) / (lat2 - lat1) * (lon2 - lon1)
        if crossing > lon:
            inside = not inside
    return inside


def filter_by_location(
    alerts: list[dict[str, Any]],
    lat: float,
    lon: float,
    areas: list[str],
) -> list[dict[str, Any]]:
    """Behält Warnungen, deren Warnregion den Standort enthält (rein).

    Warnungen ganz ohne Polygon fallen auf den Namensfilter zurück – und
    ohne konfigurierte Begriffe werden sie behalten: lieber eine Warnung
    zu viel als eine unterschlagene.
    """
    kept = []
    for alert in alerts:
        polygons = alert.get("polygons") or []
        if polygons:
            if any(point_in_polygon(lat, lon, poly) for poly in polygons):
                kept.append(alert)
        elif not areas or filter_by_area([alert], areas):
            kept.append(alert)
    return kept


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


#: Woran eine Wind- oder Sturmwarnung zu erkennen ist. Der Feed
#: beschriftet dasselbe Ereignis je nach Sprachraum anders - der Schweizer
#: Feed liefert deutsche und französische Einträge nebeneinander -, und
#: eine Warnung, die nur «Vent» heisst, ist trotzdem eine, bei der die
#: Storen hochgehören.
WIND_WOERTER = (
    "wind",
    "sturm",
    "storm",
    "orkan",
    "böen",
    "boen",
    "gale",
    "squall",
    "vent",
    "tempête",
    "tempete",
    "burrasca",
    "vento",
)

#: Gesucht wird am *Wortanfang*, nicht irgendwo im Wort. Der Grund heisst
#: «Thunderstorm»: Darin steckt «storm», und mit einer Suche mitten im
#: Wort wäre jede Gewitterwarnung eine Sturmwarnung - die Storen führen
#: dann den halben Sommer grundlos hoch, und irgendwann schaltet jemand
#: den Ablauf ab. Deutsche Zusammensetzungen tragen die Art vorn
#: («Sturmwarnung», «Windböen», «Orkanböen»), also greift die Regel
#: genau dort, wo sie soll.
_WIND = re.compile(
    "(?<![a-zà-ÿ])(" + "|".join(WIND_WOERTER) + ")", re.IGNORECASE
)

#: Wie stark, auf Deutsch. Die Feed-Wörter stehen englisch drin und
#: gehören so in keine Push-Nachricht.
SCHWERE_WORT = {
    "Minor": "gering",
    "Moderate": "mässig",
    "Severe": "stark",
    "Extreme": "extrem",
}


def ist_wind(alerts: list[dict[str, Any]]) -> bool:
    """Ist eine Wind- oder Sturmwarnung dabei? (rein, testbar)

    Warum überhaupt unterschieden wird: Bei Hitze, Regen oder Glatteis
    ändert sich an den Storen nichts. Bei Wind schon - und zwar in die
    Richtung, die man zuerst nicht vermutet. Eine geschlossene Aussenstore
    ist eine Fläche, in die der Wind greift; hochgezogen ist sie im
    Kasten. «Sturmschutz» heisst deshalb hoch, nicht zu.

    Gesucht wird in Ereignis *und* Titel: Manche Länder tragen die Art
    nur im Titel ein, und dann stünde in `event` bloss «Warning».
    """
    for alert in alerts:
        text = f"{alert.get('event') or ''} {alert.get('title') or ''}"
        if _WIND.search(text):
            return True
    return False


def bis_wann(expires: Any) -> str:
    """Das Ende einer Warnung als Uhrzeit (rein, testbar).

    Der Feed schreibt es als ISO-Zeitstempel mit Zeitzone. In einer
    Nachricht will man «bis 18:00» lesen und nicht
    «2026-08-30T18:00:00+02:00»; ist der Wert unlesbar, bleibt die
    Angabe weg statt kaputt dazustehen.
    """
    roh = str(expires or "").strip()
    if not roh:
        return ""
    try:
        # Python 3.11 versteht auch «Z», ältere Feeds schreiben es so.
        zeit = datetime.fromisoformat(roh.replace("Z", "+00:00"))
    except ValueError:
        return ""
    if zeit.tzinfo is not None:
        zeit = zeit.astimezone()
    return zeit.strftime("%H:%M")


def schlagzeile(alerts: list[dict[str, Any]]) -> str:
    """Die stärkste laufende Warnung in einem Satz (rein, testbar).

    Damit ein Ablauf «Push mit dem Warntext» sagen kann, ohne dass jemand
    ihn bei jeder Warnung neu tippt: Der Text steht als `headline` am
    Gerät, und `{meldung}` im Ablauf holt ihn dort ab (core/kamera.py).

    Die stärkste und nicht die erste: Wenn gleichzeitig eine mässige
    Regen- und eine starke Sturmwarnung laufen, ist die Sturmwarnung
    die Nachricht.
    """
    if not alerts:
        return ""
    stark = max(
        alerts,
        key=lambda alert: SEVERITY_ORDER.index(alert.get("severity"))
        if alert.get("severity") in SEVERITY_ORDER
        else -1,
    )
    was = str(stark.get("event") or stark.get("title") or "Unwetterwarnung").strip()
    teile = [was]
    wort = SCHWERE_WORT.get(str(stark.get("severity") or ""))
    if wort:
        teile.append(wort)
    ende = bis_wann(stark.get("expires"))
    if ende:
        teile.append(f"bis {ende}")
    return ", ".join(teile)


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
        # Standort für den Polygon-Vergleich: eigener Eintrag schlägt
        # config.location, und wie überall sonst ist Zell LU die Vorgabe -
        # so filtert auch eine Konfiguration ohne 'location' richtig.
        location = getattr(self.hub.config, "location", None) or {}
        try:
            self._lat = float(
                self.config.get("latitude", location.get("latitude", 47.13844))
            )
            self._lon = float(
                self.config.get("longitude", location.get("longitude", 7.92059))
            )
        except (TypeError, ValueError):
            self._lat = self._lon = None  # type: ignore[assignment]
        self._interval = self.scan_interval()

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

        if self._lat is not None and self._lon is not None:
            alerts = filter_by_location(alerts, self._lat, self._lon, self._areas)
        else:
            alerts = filter_by_area(alerts, self._areas)
        # Die Umrisse haben ihren Dienst getan – in den Zustand gehören
        # sie nicht, die App zeigt nur Titel, Gebiet und Zeiten.
        alerts = [
            {key: value for key, value in alert.items() if key != "polygons"}
            for alert in alerts
        ]

        await self.hub.registry.update_state(
            entity_id,
            {
                "state": "alert" if alerts else "ok",
                "count": len(alerts),
                "max_severity": max_severity(alerts),
                # Zwei abgeleitete Felder für die Abläufe. Ohne sie
                # müsste ein Ablauf «nur bei Sturm» die Liste der
                # Warnungen durchsuchen - das kann er nicht, er
                # vergleicht einzelne Werte.
                "wind": "on" if ist_wind(alerts) else "off",
                "headline": schlagzeile(alerts),
                "alerts": alerts[:20],
            },
            available=True,
        )


INTEGRATION = MeteoAlarmIntegration
