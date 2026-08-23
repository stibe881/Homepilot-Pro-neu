"""Geofence: Wer ist im Anflug, wer gerade weg.

Warum nicht über WLAN: Die Anwesenheit über UniFi merkt erst, dass jemand
kommt, wenn das Telefon sich einbucht – da steht man schon vor der Türe.
Ein Geofence meldet beim Verlassen des Quartiers, also Minuten vorher.
Genau diese Minuten braucht man, um die Heizung hochzufahren oder «alles
aus» anzubieten.

Das Telefon meldet den Wechsel selbst. Drei Wege, alle auf denselben
Endpunkt:

  1. Die App selbst (Region Monitoring, siehe `useOrtung`) – einmal
     erlaubt, danach ohne Bastelei.
  2. iOS-Kurzbefehle: Automation «Wenn ich ankomme/gehe» → «Inhalte von
     URL abrufen» → POST auf /api/presence/geofence.
  3. Android: Tasker, Home Assistant Companion o.ä. auf dieselbe Adresse.

Konfiguration – Orte mit Koordinaten, Personen mit Namen:

  - integration: geofence
    places:                       # weglassen = aus config.location
      - id: home
        name: Zuhause
        latitude: 47.1381
        longitude: 7.9228
        radius: 150
      - id: quartier              # der Vorlauf für die Heizung
        name: Quartier
        radius: 3000
      - id: schule
        name: Schule
        latitude: 47.1502
        longitude: 8.0641
        radius: 200
    zones:
      - id: stefan
        name: Stefan
        wifi: unifi.iphone_stefan  # optional, siehe unten
      - id: livia
        name: Livia

Die Entitäten heissen dann geofence.stefan usw. Ihr Zustand ist «home»,
«away» oder der Name eines Ortes («schule») – Abläufe können darauf
hören wie auf jeden anderen Zustand.

Dazu kommt `geofence.anyone_home`: die Sammelfrage «ist überhaupt noch
jemand da?». Ohne sie müsste ein Ablauf «alles aus» je Person einen
Auslöser tragen und zusätzlich prüfen, dass die anderen drei auch weg
sind – das schreibt niemand von Hand richtig auf, und beim fünften
Familienmitglied stimmt es nicht mehr. Sie steht auf «off», wenn alle
ausdrücklich weg sind; Nichtwissen zählt als «on».

Zwei Dinge, die man erst im Betrieb merkt und die darum hier eingebaut
sind:

  - **Ein leerer Akku ist kein «niemand zuhause».** Meldet ein Telefon
    zwölf Stunden nichts, wird aus «away» ein «unknown» – sonst schaltet
    «alles aus, wenn niemand da» irgendwann das Haus ab, während jemand
    darin sitzt.
  - **WLAN schlägt Geofence, solange es frisch ist.** Wer `wifi:` setzt,
    bekommt beide Quellen zusammengeführt; welche gerade gilt, steht als
    `source` am Zustand.
"""

from __future__ import annotations

import time
from typing import Any

from ..core import presence
from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Zustände, die eine Zone kennt. Die Namen bleiben hier, weil Abläufe und
# Tests sie seit je von hier importieren.
HOME = presence.HOME
AWAY = presence.AWAY

# Standort des Hauses, falls weder places noch config.location etwas sagen.
DEFAULT_LAT = 47.1381
DEFAULT_LON = 7.9228
# Der enge und der weite Ort, wenn niemand eigene Orte hinterlegt hat.
DEFAULT_RADIUS = 150.0
WIDE_RADIUS = 3000.0

# Wie oft geprüft wird, ob jemand verstummt ist.
SETTLE_INTERVAL = 60.0


def parse_zones(raw: Any) -> list[dict[str, str]]:
    """Zonenliste einlesen (rein, testbar).

    Ohne Kennung kein Eintrag: Die Kennung ist die Adresse, unter der das
    Telefon später meldet – geraten werden kann sie nicht.
    """
    zones = []
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        zone_id = str(entry.get("id") or "").strip()
        if not zone_id:
            continue
        zones.append(
            {
                "id": zone_id,
                "name": str(entry.get("name") or zone_id),
                # Die WLAN-Quelle derselben Person, falls es eine gibt.
                # Leer ist der Normalfall: Nicht jedes Telefon ist im
                # UniFi hinterlegt.
                "wifi": str(entry.get("wifi") or ""),
            }
        )
    return zones


def default_places(location: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Zuhause und Quartier aus dem Hausstandort (rein, testbar).

    Damit muss niemand Koordinaten doppelt pflegen: Der Standort steht
    für die Sonnenzeiten ohnehin schon in der config.yaml. Die weite
    Zone gibt es von Anfang an, weil sie den Vorlauf bringt, um den es
    beim Geofence eigentlich geht – zehn Minuten statt zwei.
    """
    loc = location or {}
    try:
        lat = float(loc.get("latitude", DEFAULT_LAT))
        lon = float(loc.get("longitude", DEFAULT_LON))
    except (TypeError, ValueError):
        lat, lon = DEFAULT_LAT, DEFAULT_LON
    return presence.parse_places(
        [
            {
                "id": HOME,
                "name": "Zuhause",
                "latitude": lat,
                "longitude": lon,
                "radius": DEFAULT_RADIUS,
            },
            {
                "id": "quartier",
                "name": "Quartier",
                "latitude": lat,
                "longitude": lon,
                "radius": WIDE_RADIUS,
            },
        ]
    )


def normalise_event(value: Any) -> str | None:
    """«enter», «arrive», «home», true → home; «leave», «exit» → away.

    Die Kurzbefehle-App und Tasker nennen dasselbe verschieden – hier
    einmal übersetzt, statt in jedem Ablauf (rein, testbar).
    """
    text = str(value).strip().lower()
    if text in ("enter", "entered", "arrive", "arrived", "home", "in", "true", "1"):
        return HOME
    if text in ("leave", "left", "exit", "exited", "away", "out", "false", "0"):
        return AWAY
    return None


class GeofenceIntegration(Integration):
    name = "geofence"

    async def setup(self) -> None:
        zones = parse_zones(self.config.get("zones"))
        if not zones:
            raise ConfigError(
                "geofence braucht mindestens eine Zone unter 'zones' "
                "(je mit 'id', z.B. der Person)"
            )
        eigene = presence.parse_places(self.config.get("places"))
        # Orte ohne eigene Koordinaten (z.B. nur `radius`) fallen beim
        # Einlesen weg - dann gilt der Hausstandort. Das ist die
        # häufigste Konfiguration und soll ohne Zutun stimmen.
        self.places = eigene or default_places(getattr(self.hub.config, "location", None))
        # Kennung → Entitäts-ID, und je Person die Orte, in denen sie steckt.
        self._zones: dict[str, str] = {}
        self._wifi: dict[str, str] = {}
        self._inside: dict[str, list[str]] = {}
        for zone in zones:
            entity = await self.add_entity(
                zone["id"],
                EntityKind.BINARY_SENSOR,
                zone["name"],
                # Unbekannt ist ehrlich: Bis das Telefon das erste Mal
                # meldet, weiss der Hub es wirklich nicht.
                state={
                    "state": presence.UNKNOWN,
                    "device_class": "presence",
                    "source": "none",
                    "place": None,
                },
                available=True,
            )
            self._zones[zone["id"]] = entity.id
            if zone["wifi"]:
                self._wifi[zone["id"]] = zone["wifi"]
            self._inside[zone["id"]] = []
        # Die Sammelfrage, auf die «alles aus» hört. Ohne sie müsste ein
        # Ablauf je Person einen Auslöser tragen und zusätzlich prüfen,
        # dass die anderen drei auch weg sind - das schreibt niemand von
        # Hand richtig auf, und beim fünften Familienmitglied stimmt es
        # nicht mehr.
        self._anyone = (
            await self.add_entity(
                "anyone_home",
                EntityKind.BINARY_SENSOR,
                "Jemand zuhause",
                state={"state": "on", "device_class": "presence", "away": []},
                available=True,
            )
        ).id
        self.start_polling(self._settle, interval=SETTLE_INTERVAL)

    async def _update_anyone(self) -> None:
        """Die Sammel-Entität aus den Einzelzuständen nachziehen."""
        zustaende = []
        weg = []
        for zone_id, entity_id in self._zones.items():
            entity = self.hub.registry.get(entity_id)
            zustand = str((entity.state if entity else {}).get("state") or presence.UNKNOWN)
            zustaende.append(zustand)
            if zustand != HOME:
                weg.append(entity.name if entity else zone_id)
        neu = presence.anyone_home_state(zustaende)
        alt_entity = self.hub.registry.get(self._anyone)
        if alt_entity is not None and alt_entity.state.get("state") == neu:
            # Nur echte Wechsel melden: Sonst löste jede Ortsmeldung
            # einer bereits abwesenden Person «alles aus» erneut aus.
            return
        await self.hub.registry.update_state(
            self._anyone,
            {"state": neu, "device_class": "presence", "away": weg},
            available=True,
        )
        self.log.info("Geofence: jemand zuhause = %s", neu)

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        raise ConfigError("Geofence-Zonen meldet das Telefon, sie lassen sich nicht schalten")

    def zone_entity(self, zone_id: str) -> str | None:
        return self._zones.get(zone_id)

    def zone_ids(self) -> list[str]:
        return list(self._zones)

    async def report(
        self,
        zone_id: str,
        event: str,
        place: str | None = None,
        battery: Any = None,
    ) -> str:
        """Einen gemeldeten Wechsel übernehmen. Gibt den neuen Zustand zurück.

        `place` ist die Kennung des Ortes; ohne Angabe gilt «home» – so
        funktionieren die alten Kurzbefehle unverändert weiter.
        """
        entity_id = self._zones.get(zone_id)
        if entity_id is None:
            raise KeyError(zone_id)
        richtung = normalise_event(event)
        if richtung is None:
            raise ValueError(
                f"Unbekanntes Ereignis '{event}' – erlaubt sind enter/leave"
            )
        ort = str(place or HOME).strip().lower()
        drin = [x for x in self._inside.get(zone_id, []) if x != ort]
        if richtung == HOME:
            drin.append(ort)
        self._inside[zone_id] = drin
        state, engster = presence.place_state(drin, self.places)
        await self._publish(zone_id, entity_id, state, engster, battery)
        self.log.info("Geofence: %s ist jetzt %s (%s)", zone_id, state, ort)
        return state

    async def _publish(
        self,
        zone_id: str,
        entity_id: str,
        state: str,
        place: str | None,
        battery: Any = None,
    ) -> None:
        jetzt = time.time()
        name = next(
            (ort["name"] for ort in self.places if ort["id"] == place), place
        )
        # Alle Felder ausdrücklich: Die Registry mischt Änderungen in den
        # alten Zustand: Was verschwinden können muss, gehört als None
        # hinein (siehe registry.update_state).
        neu: dict[str, Any] = {
            "state": state,
            "device_class": "presence",
            "changed_at": jetzt,
            "place": place,
            "place_name": name,
            "source": "geofence",
            "stale": False,
        }
        if battery is not None:
            try:
                neu["battery"] = max(0, min(100, int(battery)))
            except (TypeError, ValueError):
                neu["battery"] = None
        await self.hub.registry.update_state(entity_id, neu, available=True)
        self.hub.data.set(
            "presence_history",
            presence.remember(
                self.hub.data.get("presence_history"), zone_id, state, jetzt, place
            ),
        )
        await self._update_anyone()

    def merged(self, zone_id: str) -> dict[str, Any]:
        """Zonen- und WLAN-Meldung zusammengeführt (Punkt 200).

        Wird von der Diagnose und der App gelesen; die Entität selbst
        bleibt die reine Zonenmeldung, damit Abläufe nicht plötzlich auf
        etwas anderes hören als bisher.
        """
        entity_id = self._zones.get(zone_id)
        entity = self.hub.registry.get(entity_id) if entity_id else None
        geo = dict(entity.state) if entity else {}
        wifi_id = self._wifi.get(zone_id)
        wifi_entity = self.hub.registry.get(wifi_id) if wifi_id else None
        wifi = dict(wifi_entity.state) if wifi_entity else None
        zusammen = presence.merge_presence(geo, wifi, time.time())
        return presence.settle(zusammen, time.time())

    def diagnose(self) -> list[dict[str, Any]]:
        """Je Person eine Zeile: warum steht da, was da steht (Punkt 219)."""
        jetzt = time.time()
        zeilen = []
        for zone_id, entity_id in self._zones.items():
            entity = self.hub.registry.get(entity_id)
            state = dict(entity.state) if entity else {}
            zusammen = self.merged(zone_id)
            zeile = presence.diagnose(entity.name if entity else zone_id, state, jetzt)
            zeile["zone"] = zone_id
            zeile["combined"] = zusammen.get("state")
            zeile["combined_source"] = zusammen.get("source")
            zeile["since"] = presence.since(
                self.hub.data.get("presence_history"), zone_id
            )
            zeilen.append(zeile)
        return zeilen

    async def _settle(self) -> None:
        """Verstummte Telefone ehrlich machen (Punkt 202).

        Läuft im Minutentakt: Wer sich zwölf Stunden nicht gemeldet hat,
        steht nicht mehr auf «weg», sondern auf «unbekannt».
        """
        jetzt = time.time()
        for zone_id, entity_id in self._zones.items():
            entity = self.hub.registry.get(entity_id)
            if entity is None or entity.state.get("stale"):
                continue
            if not presence.is_stale(entity.state.get("changed_at"), jetzt):
                continue
            self.log.info("Geofence: %s meldet sich nicht mehr – Zustand unbekannt", zone_id)
            await self.hub.registry.update_state(
                entity_id,
                {
                    **entity.state,
                    "state": presence.UNKNOWN,
                    "place": None,
                    "place_name": None,
                    "stale": True,
                },
                available=True,
            )
            self._inside[zone_id] = []
            await self._update_anyone()


INTEGRATION = GeofenceIntegration
