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

Die Zonen entstehen aus der Benutzerliste des Hubs: Wer in der App als
Benutzer angelegt ist, bekommt seine Zone (`geofence.<vorname>`) von
selbst - ohne Neustart und ohne Eintrag in der config.yaml. Gäste, das
Wandtablet und das Systemtoken bleiben draussen. `zones:` gibt es
weiterhin, für abweichende Namen oder für ein Telefon, das keinem
Benutzer gehört; dort Eingetragenes sticht.

Konfiguration – Orte mit Koordinaten, Personen mit Namen:

  - integration: geofence
    places:                       # weglassen = aus config.location
      - id: home
        name: Zuhause
        latitude: 47.13844
        longitude: 7.92059
        radius: 150
      - id: quartier              # der Vorlauf für die Heizung
        name: Quartier
        radius: 3000
      - id: schule
        name: Schule
        latitude: 47.1502
        longitude: 8.0641
        radius: 200
    zones:                        # optional – sonst aus der Benutzerliste
      - id: stefan
        name: Stefan
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
  - **Das WLAN entscheidet nichts.** Es gab einmal eine Option `wifi:`
    je Zone, die eine UniFi-Anmeldung über die Ortsmeldung stellte. Sie
    ist weg: «Gerät im Netz» ist nicht «Mensch zuhause» – das iPad liegt
    auch im Netz, wenn alle weg sind, und das Telefon fällt heraus, wenn
    man im Garten sitzt. Herausgekommen sind zwei Anzeigen, die sich
    widersprachen. Steht `wifi:` noch in einer alten config.yaml, wird
    es überlesen und einmal ins Protokoll geschrieben.
"""

from __future__ import annotations

import time
from typing import Any

from ..core import ortsuche, presence
from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Zustände, die eine Zone kennt. Die Namen bleiben hier, weil Abläufe und
# Tests sie seit je von hier importieren.
HOME = presence.HOME
AWAY = presence.AWAY

# Standort des Hauses, falls weder places noch config.location etwas sagen.
DEFAULT_LAT = 47.13844
DEFAULT_LON = 7.92059
# Der enge und der weite Ort, wenn niemand eigene Orte hinterlegt hat.
DEFAULT_RADIUS = 150.0
WIDE_RADIUS = 3000.0

# Wie oft geprüft wird, ob jemand verstummt ist.
SETTLE_INTERVAL = 60.0


def parse_zones(raw: Any) -> list[dict[str, str]]:
    """Zonenliste einlesen (rein, testbar).

    Ohne Kennung kein Eintrag: Die Kennung ist die Adresse, unter der das
    Telefon später meldet – geraten werden kann sie nicht.

    Ein `wifi:` aus einer älteren config.yaml landet hier bewusst nicht
    mehr im Ergebnis. Wer es entfernt haben will, findet den Hinweis im
    Protokoll; ein Fehler ist es nicht, sonst startet der Hub nach einem
    Update nicht mehr.
    """
    zones = []
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        zone_id = str(entry.get("id") or "").strip()
        if not zone_id:
            continue
        zones.append({"id": zone_id, "name": str(entry.get("name") or zone_id)})
    return zones


#: Umlaute und Zubehör, damit aus «Björn» dieselbe Kennung wird wie in
#: der App. Beide Seiten müssen zeichenweise dasselbe rechnen - sonst
#: meldet das Telefon an eine Zone, die es nicht gibt.
UMSCHRIFT = {
    "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
    "à": "a", "á": "a", "â": "a", "ã": "a", "å": "a",
    "è": "e", "é": "e", "ê": "e", "ë": "e",
    "ì": "i", "í": "i", "î": "i", "ï": "i",
    "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ø": "o",
    "ù": "u", "ú": "u", "û": "u",
    "ç": "c", "ñ": "n",
}

#: Rollen, die keine eigene Zone bekommen. Für Gäste ist die Ortung in
#: der App ohnehin aus - eine Zone, in die nie jemand meldet, stünde nur
#: als ewiges «unbekannt» in der Übersicht.
OHNE_ZONE_ROLLEN = ("gast",)


def zonenkennung(name: str) -> str:
    """Die Zonenkennung einer Person aus ihrem Namen (rein, testbar).

    Der Vorname genügt: «Stefan Gross» meldet als `stefan`. So heissen
    die Zonen seit je, und die App rechnet dieselbe Kennung aus - ändert
    man das hier allein, meldet jedes Telefon ins Leere.
    """
    erstes = str(name or "").strip().split(" ")[0].lower()
    umgeschrieben = "".join(UMSCHRIFT.get(zeichen, zeichen) for zeichen in erstes)
    return "".join(z for z in umgeschrieben if z.isalnum() or z == "_")


def zonen_aus_benutzern(benutzer: list[Any]) -> list[dict[str, str]]:
    """Je Mensch eine Zone (rein, testbar).

    Bis hierher musste jede Person zusätzlich von Hand in die config.yaml
    unter `zones:` - anlegen in der App genügte nicht, und wer das nicht
    wusste, bekam beim Melden «Der Hub kennt keine Zone». Zwei Listen
    derselben Menschen an zwei Orten zu pflegen ist eine Aufgabe, die
    niemand gewinnt.

    Draussen bleiben: Gäste (für die ist die Ortung aus), das Wandtablet
    und andere geteilte Geräte (kein Mensch, kein Weg) und das
    Systemtoken.
    """
    zonen: list[dict[str, str]] = []
    gesehen: set[str] = set()
    for person in benutzer or []:
        if getattr(person, "system", False) or getattr(person, "shared", False):
            continue
        if str(getattr(person, "role", "")).lower() in OHNE_ZONE_ROLLEN:
            continue
        name = str(getattr(person, "name", "") or "")
        kennung = zonenkennung(name)
        if not kennung or kennung in gesehen:
            continue
        gesehen.add(kennung)
        zonen.append({"id": kennung, "name": name})
    return zonen


def zonen_zusammenfuehren(
    aus_config: list[dict[str, str]], aus_benutzern: list[dict[str, str]]
) -> list[dict[str, str]]:
    """Beide Quellen zu einer Liste (rein, testbar).

    Die config.yaml sticht: Wer dort einen Namen oder eine abweichende
    Kennung hinterlegt hat, hat das mit Absicht getan. Alles andere
    kommt aus der Benutzerliste und muss nirgends doppelt stehen.
    """
    zusammen = list(aus_config)
    bekannt = {zone["id"] for zone in aus_config}
    for zone in aus_benutzern:
        if zone["id"] not in bekannt:
            zusammen.append(zone)
            bekannt.add(zone["id"])
    return zusammen


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
    # Ein selbst gesetzter Standort bringt seinen eigenen Radius mit -
    # ein Bauernhof braucht mehr als eine Wohnung im Block.
    try:
        eng = float(loc.get("radius") or DEFAULT_RADIUS)
    except (TypeError, ValueError):
        eng = DEFAULT_RADIUS
    return presence.parse_places(
        [
            {
                "id": HOME,
                "name": "Zuhause",
                "latitude": lat,
                "longitude": lon,
                "radius": eng,
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
        self._config_zonen = parse_zones(self.config.get("zones"))
        # Welche Zonen aus der Benutzerliste stammen. Nur die dürfen
        # wieder verschwinden - was in der config.yaml steht, bleibt.
        self._aus_benutzern: set[str] = set()
        zones = zonen_zusammenfuehren(self._config_zonen, self.benutzer_zonen())
        if not zones:
            raise ConfigError(
                "geofence hat niemanden zum Orten: weder Zonen unter "
                "'zones' noch Benutzer im Hub"
            )
        self._eigene_places = presence.parse_places(self.config.get("places"))
        # Erst beim ersten Suchen angelegt: Wer nie einen Laden erfasst,
        # soll dafür keine Verbindung offen haben.
        self._suchsession = None
        self._orte_bauen()
        # Kennung → Entitäts-ID, und je Person die Orte, in denen sie steckt.
        self._zones: dict[str, str] = {}
        self._inside: dict[str, list[str]] = {}
        # Einmal sagen, dass hier etwas nicht mehr gilt – still zu
        # überlesen wäre schlimmer als ein Fehler: Man sucht sonst
        # tagelang, warum das WLAN die Ortung nicht mehr überstimmt.
        veraltet = [
            str(entry.get("id"))
            for entry in (self.config.get("zones") or [])
            if isinstance(entry, dict) and entry.get("wifi")
        ]
        if veraltet:
            self.log.warning(
                "Geofence: 'wifi:' bei %s wird überlesen – die Anwesenheit "
                "kommt nur noch vom Telefon, nicht mehr aus dem WLAN",
                ", ".join(veraltet),
            )
        # Ein Neustart ändert nichts daran, wo jemand ist – das Telefon
        # meldet aber nur Übertritte. Ohne das Gedächtnis stand nach
        # jedem Update wieder «Hat sich noch nie gemeldet», bis die
        # Person das nächste Mal eine Zonengrenze kreuzte. Wer zuhause
        # sitzt, tut das nicht.
        gemerkt = self.hub.data.get("presence_last")
        jetzt = time.time()
        for zone in zones:
            stand = presence.wieder_aufnehmen(gemerkt, zone["id"], jetzt)
            entity = await self.add_entity(
                zone["id"],
                EntityKind.BINARY_SENSOR,
                zone["name"],
                # Ohne gemerkten Stand: unbekannt. Das ist ehrlich – bis
                # das Telefon das erste Mal meldet, weiss der Hub es
                # wirklich nicht.
                state=stand,
                available=True,
            )
            self._zones[zone["id"]] = entity.id
            # Auch die Orte zurückholen, in denen die Zone steckt: Sonst
            # rechnete die nächste Meldung gegen eine leere Liste und
            # machte aus «zuhause und im Quartier» ein blosses «Quartier».
            self._inside[zone["id"]] = [stand["place"]] if stand.get("place") else []
        self._aus_benutzern = {
            zone["id"]
            for zone in zones
            if zone["id"] not in {c["id"] for c in self._config_zonen}
        }
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

    def benutzer_zonen(self) -> list[dict[str, str]]:
        """Die Zonen, die sich aus der Benutzerliste des Hubs ergeben."""
        verzeichnis = getattr(self.hub, "users", None)
        return zonen_aus_benutzern(getattr(verzeichnis, "users", []))

    async def _zonen_abgleichen(self) -> list[str]:
        """Neue Benutzer bekommen eine Zone, gelöschte verlieren sie.

        Der Punkt der ganzen Übung: Wer in der App einen Mitbewohner
        anlegt, soll ihn orten können, ohne zusätzlich die config.yaml
        anzufassen. Läuft im Minutentakt mit und zusätzlich in dem
        Moment, in dem ein Telefon an eine noch unbekannte Zone meldet -
        dann ist sie da, bevor die Meldung abgewiesen wird.
        """
        soll = zonen_zusammenfuehren(self._config_zonen, self.benutzer_zonen())
        soll_ids = {zone["id"] for zone in soll}
        neue: list[str] = []
        for zone in soll:
            if zone["id"] in self._zones:
                continue
            stand = presence.wieder_aufnehmen(
                self.hub.data.get("presence_last"), zone["id"], time.time()
            )
            entity = await self.add_entity(
                zone["id"],
                EntityKind.BINARY_SENSOR,
                zone["name"],
                state=stand,
                available=True,
            )
            self._zones[zone["id"]] = entity.id
            self._inside[zone["id"]] = [stand["place"]] if stand.get("place") else []
            self._aus_benutzern.add(zone["id"])
            neue.append(zone["id"])
            self.log.info("Geofence: Zone %s angelegt (%s)", zone["id"], zone["name"])
        # Gegangene Benutzer: Ihre Zone bliebe sonst für immer stehen -
        # und stünde sie auf «zuhause», hörte «niemand mehr zuhause» nie
        # wieder auf. Zonen aus der config.yaml bleiben unberührt.
        for zone_id in [z for z in self._aus_benutzern if z not in soll_ids]:
            entity_id = self._zones.pop(zone_id, None)
            self._inside.pop(zone_id, None)
            self._aus_benutzern.discard(zone_id)
            if entity_id:
                await self.hub.registry.remove(entity_id)
            self.log.info("Geofence: Zone %s entfernt - der Benutzer ist weg", zone_id)
        if neue or soll_ids != set(self._zones):
            await self._update_anyone()
        return neue

    def _orte_bauen(self) -> None:
        """Die Ortsliste aus Konfiguration, Hausstandort und App.

        Orte ohne eigene Koordinaten (z.B. nur `radius`) fallen beim
        Einlesen weg - dann gilt der Hausstandort. Das ist die häufigste
        Konfiguration und soll ohne Zutun stimmen.

        Dazu kommen die Orte, die in der App entstanden sind - ein Laden
        etwa, vor dem jemand stand und einen Knopf gedrückt hat.
        """
        self.places = presence.alle_orte(
            self._eigene_places or default_places(self.heimat()),
            self.hub.data.get(presence.PLACES_KEY),
        )

    async def ort_setzen(
        self,
        name: str,
        latitude: float,
        longitude: float,
        radius: float = 150.0,
        ort_id: str = "",
    ) -> list[dict[str, Any]]:
        """Einen Ort von der aktuellen Position übernehmen.

        Derselbe Weg wie beim Hausstandort: Wer davorsteht, drückt einen
        Knopf. Koordinaten abzutippen bringt niemand fehlerfrei zustande,
        und ein Ort, der 300 m danebenliegt, meldet sich nie.
        """
        self.hub.data.set(
            presence.PLACES_KEY,
            presence.ort_setzen(
                self.hub.data.get(presence.PLACES_KEY),
                ort_id or name,
                name,
                latitude,
                longitude,
                radius,
            ),
        )
        self._orte_bauen()
        self.log.info("Ort '%s' gesetzt: %.5f, %.5f (%.0f m)", name, latitude, longitude, radius)
        return self.places

    async def ort_suchen(self, text: str) -> list[dict[str, Any]]:
        """Orte zu einer Adresse oder einem Namen vorschlagen.

        Damit man nicht bei jedem Laden vorbeifahren muss, um ihn zu
        erfassen. Wer Koordinaten einfügt (Google Maps, langer Tipp auf
        den Punkt), bekommt genau die zurück - dafür braucht es niemanden
        zu fragen.
        """
        koordinaten = ortsuche.koordinaten_aus_text(text)
        if koordinaten:
            lat, lon = koordinaten
            return [
                {
                    "name": f"{lat:.5f}, {lon:.5f}",
                    "address": "aus eingefügten Koordinaten",
                    "latitude": lat,
                    "longitude": lon,
                }
            ]
        if not str(text or "").strip():
            return []
        session = self._suchsession or self.http_session(
            headers={"User-Agent": ortsuche.USER_AGENT}
        )
        self._suchsession = session
        async with session.get(
            ortsuche.NOMINATIM_URL, params=ortsuche.anfrage(text)
        ) as antwort:
            antwort.raise_for_status()
            return ortsuche.treffer(await antwort.json(content_type=None))

    async def ort_entfernen(self, ort_id: str) -> list[dict[str, Any]]:
        """Einen in der App angelegten Ort löschen.

        Was in der config.yaml steht, bleibt - dort hat es jemand von Hand
        hingeschrieben, und ein Knopf in der App darf das nicht stillos
        wegräumen.
        """
        self.hub.data.set(
            presence.PLACES_KEY,
            presence.ort_entfernen(self.hub.data.get(presence.PLACES_KEY), ort_id),
        )
        self._orte_bauen()
        return self.places

    def heimat(self) -> dict[str, Any]:
        """Wo der Hub das Zuhause vermutet - und woher er das weiss.

        Die Herkunft gehört dazu: «11 km entfernt» ist erst dann eine
        Auskunft, wenn man sieht, wovon.
        """
        return presence.home_location(
            self.hub.data.get(presence.HOME_KEY),
            getattr(self.hub.config, "location", None),
        )

    async def set_heimat(self, latitude: float, longitude: float, radius: float = 150.0) -> dict[str, Any]:
        """Den Hausstandort von der aktuellen Position übernehmen.

        Der einzige Weg, bei dem sich niemand vertippen kann: Wer zuhause
        steht, drückt einen Knopf.
        """
        self.hub.data.set(
            presence.HOME_KEY,
            presence.store_home(latitude, longitude, radius, time.time()),
        )
        self._orte_bauen()
        self.log.info(
            "Hausstandort gesetzt: %.5f, %.5f (Radius %.0f m)", latitude, longitude, radius
        )
        return self.heimat()

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
        source: str = "geofence",
        place_name: str | None = None,
    ) -> str:
        """Einen gemeldeten Wechsel übernehmen. Gibt den neuen Zustand zurück.

        `place` ist die Kennung des Ortes; ohne Angabe gilt «home» – so
        funktionieren die alten Kurzbefehle unverändert weiter.

        `place_name` ist der Klarname eines Ortes, den der Hub selbst
        nicht kennt: Life360 meldet «Tanners Home», und ohne diesen Weg
        stünde in der App die nackte Kennung `tanners_home`. Für die
        eigenen Orte bleibt er leer – deren Namen stehen in der
        config.yaml.

        `source` sagt, wer gemeldet hat. Voreingestellt ist «geofence» –
        das Telefon selbst, über App oder Kurzbefehl. Life360 meldet
        durch dieselbe Türe und trägt sich als «life360» ein: In der
        Diagnose stand sonst bei allen «geofence», und die Frage «kommt
        das jetzt von Life360 oder nicht?» war genau die, die man dort
        stellt.
        """
        entity_id = self._zones.get(zone_id)
        if entity_id is None:
            # Vielleicht ist die Person neu. Erst nachsehen, dann
            # ablehnen - sonst muss man den Hub neu starten, nur weil man
            # einen Mitbewohner angelegt hat.
            await self._zonen_abgleichen()
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
        await self._publish(
            zone_id, entity_id, state, engster, battery, source, place_name
        )
        self.log.info("Geofence: %s ist jetzt %s (%s)", zone_id, state, ort)
        return state

    async def _publish(
        self,
        zone_id: str,
        entity_id: str,
        state: str,
        place: str | None,
        battery: Any = None,
        source: str = "geofence",
        place_name: str | None = None,
    ) -> None:
        jetzt = time.time()
        # Der mitgereichte Klarname zuerst: Ein Ort von Life360 steht
        # nicht in `self.places`, und ohne ihn läse man die Kennung.
        name = place_name or next(
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
            "source": source or "geofence",
            "stale": False,
        }
        if battery is not None:
            try:
                neu["battery"] = max(0, min(100, int(battery)))
            except (TypeError, ValueError):
                neu["battery"] = None
        await self.hub.registry.update_state(entity_id, neu, available=True)
        # Das Gedächtnis über den Neustart hinweg. Getrennt vom Verlauf:
        # Der ist ein Protokoll des Kommens und Gehens, das hier ist der
        # letzte Stand, je Zone eine Zeile.
        self.hub.data.set(
            "presence_last",
            presence.merke_stand(
                self.hub.data.get("presence_last"),
                zone_id,
                {
                    "state": state,
                    "place": place,
                    "place_name": name,
                    "source": neu["source"],
                    "changed_at": jetzt,
                    "battery": neu.get("battery"),
                },
            ),
        )
        self.hub.data.set(
            "presence_history",
            presence.remember(
                self.hub.data.get("presence_history"), zone_id, state, jetzt, place
            ),
        )
        await self._update_anyone()

    def merged(self, zone_id: str) -> dict[str, Any]:
        """Der Zustand einer Person, wie ihn die App liest (Punkt 200).

        Hiess einmal so, weil hier Zonenmeldung und WLAN zusammenkamen.
        Das WLAN ist weg (siehe Kopf der Datei), übrig bleibt die
        Ortsmeldung – durch `settle` geschickt, damit aus zwölf Stunden
        Funkstille kein «weg» wird, auf das «alles aus» hört.

        Der Name bleibt: Die App und die Diagnose rufen ihn seit je so,
        und eine Umbenennung ändert nichts an der Antwort.
        """
        entity_id = self._zones.get(zone_id)
        entity = self.hub.registry.get(entity_id) if entity_id else None
        if entity is None:
            return {"state": presence.UNKNOWN, "source": "none", "place": None}
        zustand = dict(entity.state)
        zustand.setdefault("source", "geofence")
        return presence.settle(zustand, time.time())

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
            # Aus dem zusammengeführten Zustand, nicht aus der Entität:
            # Wer verstummt ist, soll keinen Ort mehr tragen.
            zeile["place_name"] = zusammen.get("place_name")
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
        await self._zonen_abgleichen()
        jetzt = time.time()
        for zone_id, entity_id in list(self._zones.items()):
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
