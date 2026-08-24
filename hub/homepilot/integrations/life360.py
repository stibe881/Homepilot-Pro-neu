"""Life360: Standorte aus der Familien-App, für Telefone ohne HomePilot.

Der eigene Weg bleibt der bessere: Die App meldet den Übertritt einer
Zonengrenze selbst, in dem Moment, in dem er passiert – ohne fremde
Wolke, ohne Konto, ohne Sperre nach zu vielen Abfragen (siehe
`geofence`). Diese Integration ist für die Telefone, auf denen HomePilot
nicht läuft und nie laufen wird: das Telefon der Grosseltern, ein
Kindergerät, auf dem die Familie ohnehin schon Life360 benutzt.

**Eine Quelle je Person.** Wer hier eingetragen ist, meldet über
Life360; wer die App hat, über die App. Zwei Quellen auf dieselbe Frage
widersprechen sich früher oder später, und dann weiss niemand, welcher
zu glauben ist – genau daran ist die WLAN-Anwesenheit gescheitert.

**Life360 hat keine offene Schnittstelle.** Was hier benutzt wird, ist
die App-Schnittstelle. Sie war 2024 für Fremde dicht (Home Assistant hat
seine eingebaute Integration deshalb entfernt), und sie kann jederzeit
wieder dichtmachen. Darum:

  - Fehlerhafte Antworten (403/429) führen nicht zu schnellerem
    Nachfragen, sondern zu einer wachsenden Pause bis zu zwanzig
    Minuten. Wer gegen eine Sperre anrennt, verlängert sie.
  - Bleibt die Wolke weg, meldet der Hub nichts Falsches: Die Person
    verstummt, und nach zwölf Stunden führt der Geofence sie als
    «unbekannt» statt als «weg» (core/presence.py). Ein leerer Akku ist
    kein «niemand zuhause».
  - Der Kreis wird einmal beim Start geholt und dann gemerkt. Genau
    diese Abfrage ist am schärfsten begrenzt.

Konfiguration – Zugangsdaten gehören in die secrets.env, nie in die
config.yaml und schon gar nicht ins Repo:

  - integration: life360
    token: ${LIFE360_TOKEN}
    # Der Token ist der Normalfall: Life360 kennt keine Passwörter mehr,
    # die Anmeldung läuft über einen SMS-/Mail-Code. Also im Browser bei
    # life360.com anmelden (Code eingeben), dann in den
    # Entwicklerwerkzeugen unter Netzwerk bei einer api-Anfrage den Wert
    # hinter «Authorization: Bearer» kopieren - das ist der Token.
    # Nur noch für alte Konten, die ein Passwort haben:
    # username: ${LIFE360_USER}
    # password: ${LIFE360_PASSWORD}
    scan_interval: 60
    members:                        # Name bei Life360 → Zone im Hub
      Oma: oma
      Levin: levin

Die Zonen selbst stehen bei der geofence-Integration; ohne sie kann
diese hier nichts melden und sagt das beim Start.

Gespeicherte Orte von Life360 kommen mit: Wer bei «Tanners Home» steht,
steht auch in der App dort und nicht bloss «unterwegs». Die eigenen Orte
des Hubs behalten Vorrang – wer im Hausradius steht, ist «zuhause», auch
wenn der Ort drüben anders heisst.
"""

from __future__ import annotations

import asyncio
import math
import time
from typing import Any

import aiohttp

from ..core.errors import ConfigError
from ..core.integration import Integration

BASE = "https://api-cloudfront.life360.com/v3"
TOKEN_URL = f"{BASE}/oauth2/token"
CIRCLES_URL = f"{BASE}/circles"

# Der Wert steht seit Jahren in jeder App-Fassung und ist kein Geheimnis;
# ohne ihn beantwortet der Anmelde-Endpunkt gar nichts.
BASIC = (
    "Basic cFJFcXVnYWJSZXRyZTRFc3RldGhlcnVmcmVQdW1hbUV4dWNyRUh1YzptM2ZydXBSZX"
    "RSZXN3ZXJFQ2hBUHJFOTZxYWtFZHI0Vg=="
)

# Wie lange nach einem Fehlschlag pausiert wird, in Sekunden. Life360
# antwortet auf zu viele Abfragen mit 429/403, und die Sperre löst sich
# erst nach Minuten - wer weiter im Sekundentakt klopft, verlängert sie.
PAUSEN = (60.0, 120.0, 300.0, 600.0, 1200.0)

# Ab hier gilt eine Ortsmeldung als zu alt, um daraus etwas zu schliessen.
# Life360 liefert den Zeitpunkt der letzten Messung mit; ein Telefon im
# Flugmodus schickt sonst stundenlang denselben alten Punkt.
MAX_ALTER = 3600.0


def parse_members(raw: Any) -> dict[str, str]:
    """Zuordnung «Name bei Life360» → Zone im Hub (rein, testbar).

    Ohne Zuordnung meldet niemand: Der Hub soll nicht raten, welche
    Person hinter «Mama» steckt, und schon gar nicht jeden Kreis-Eintrag
    automatisch zu einer Anwesenheit machen.
    """
    zuordnung: dict[str, str] = {}
    for name, zone in (raw or {}).items():
        klar = " ".join(str(name or "").split()).casefold()
        ziel = str(zone or "").strip()
        if klar and ziel:
            zuordnung[klar] = ziel
    return zuordnung


def zone_fuer_mitglied(mitglied: dict[str, Any], zuordnung: dict[str, str]) -> str | None:
    """Welche Zone gehört zu diesem Life360-Mitglied? (rein, testbar)

    Verglichen wird über den Vornamen und über «Vorname Nachname» - so
    passt «Levin» auch dann, wenn Life360 den Nachnamen mitführt.
    """
    vorname = " ".join(str(mitglied.get("firstName") or "").split())
    nachname = " ".join(str(mitglied.get("lastName") or "").split())
    for kandidat in (f"{vorname} {nachname}".strip(), vorname):
        treffer = zuordnung.get(kandidat.casefold())
        if treffer:
            return treffer
    return None


def parse_position(mitglied: dict[str, Any]) -> dict[str, Any] | None:
    """Ort, Zeitpunkt und Akkustand eines Mitglieds (rein, testbar).

    Life360 liefert Zahlen als Text und den Akku als Prozentzahl im
    selben Format. Fehlt der Ort, gibt es nichts zu melden - ein Punkt
    bei 0/0 wäre der Atlantik.
    """
    ort = mitglied.get("location") or {}
    try:
        lat = float(ort.get("latitude") or "nan")
        lon = float(ort.get("longitude") or "nan")
    except (TypeError, ValueError):
        return None
    if math.isnan(lat) or math.isnan(lon):
        return None
    if lat == 0.0 and lon == 0.0:
        return None
    try:
        gemessen = float(ort.get("timestamp") or 0)
    except (TypeError, ValueError):
        gemessen = 0.0
    akku: int | None
    try:
        akku = int(float(ort.get("battery") or "nan"))
    except (TypeError, ValueError):
        akku = None
    return {
        "latitude": lat,
        "longitude": lon,
        "timestamp": gemessen,
        "battery": akku,
        # Life360 hängt den Namen des gespeicherten Ortes an, sobald
        # jemand darin steht («Tanners Home», «Schule»). Genau das will
        # man in der App lesen statt eines nichtssagenden «unterwegs».
        "place": " ".join(str(ort.get("name") or "").split()) or None,
    }


def ortsschluessel(name: str) -> str:
    """Aus «Tanners Home» wird `tanners_home` (rein, testbar).

    Die Kennung ist das, worauf ein Ablauf hört, und sie steht neben
    `home` und `quartier` – also dieselbe Machart: klein, ohne
    Leerzeichen, ohne Sonderzeichen. Der Name selbst reist getrennt mit
    und ist das, was in der App steht.

    Was nach dem Aussieben leer bleibt (ein Ort, der nur aus Emoji
    besteht), gibt eine leere Kennung: Der Aufrufer lässt ihn dann weg,
    statt einen Ort ohne Namen zu melden.
    """
    sauber = []
    for zeichen in " ".join(str(name or "").split()).casefold():
        if zeichen.isalnum():
            sauber.append(zeichen)
        elif zeichen in " -_/":
            sauber.append("_")
    schluessel = "_".join(part for part in "".join(sauber).split("_") if part)
    return schluessel


def abstand_meter(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Abstand zweier Punkte in Metern (rein, testbar)."""
    r = 6_371_000.0
    rad = math.pi / 180.0
    d_lat = (lat2 - lat1) * rad
    d_lon = (lon2 - lon1) * rad
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lon / 2) ** 2
    )
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def meldungen_fuer(
    places: list[dict[str, Any]], lat: float, lon: float
) -> list[tuple[str, str]]:
    """Je Ort «enter» oder «leave» (rein, testbar).

    Auch das Verlassen gehört gemeldet: Der Geofence führt je Zone eine
    Liste der Orte, in denen sie steckt, und ein alter Eintrag bliebe
    sonst stehen, bis jemand den Hub neu startet.
    """
    meldungen = []
    for ort in places:
        try:
            drin = abstand_meter(lat, lon, float(ort["latitude"]), float(ort["longitude"]))
            radius = float(ort.get("radius") or 0)
        except (TypeError, ValueError, KeyError):
            continue
        meldungen.append((str(ort["id"]), "enter" if drin <= radius else "leave"))
    return meldungen


def pause_nach(fehler: int) -> float:
    """Wie lange nach dem n-ten Fehlschlag gewartet wird (rein, testbar)."""
    if fehler <= 0:
        return 0.0
    return PAUSEN[min(fehler, len(PAUSEN)) - 1]


def zu_alt(gemessen: float, jetzt: float, grenze: float = MAX_ALTER) -> bool:
    """Ist diese Ortsmeldung zu alt, um etwas zu bedeuten? (rein, testbar)"""
    if gemessen <= 0:
        return False
    return jetzt - gemessen > grenze


class Life360Integration(Integration):
    name = "life360"

    async def setup(self) -> None:
        self._members = parse_members(self.config.get("members"))
        if not self._members:
            raise ConfigError(
                "life360 braucht 'members' - eine Zuordnung «Name bei Life360: "
                "Zone im Hub». Ohne sie wüsste der Hub nicht, wer da kommt."
            )
        self._token = str(self.config.get("token") or "").strip()
        self._username = str(self.config.get("username") or "").strip()
        self._password = str(self.config.get("password") or "").strip()
        if not self._token and not (self._username and self._password):
            raise ConfigError(
                "life360 braucht entweder 'token' oder 'username' und "
                "'password' (beides gehört in die secrets.env)."
            )
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=20))
        self._interval = self.scan_interval()
        self._fehler = 0
        # Der Kreis wird einmal geholt und gemerkt: Genau diese Abfrage
        # ist am schärfsten begrenzt.
        self._circles: list[str] = []
        # Je Zone der zuletzt gemeldete Life360-Ort. Ohne dieses
        # Gedächtnis bliebe «Tanners Home» stehen, nachdem jemand
        # weitergefahren ist: Der Geofence führt eine Liste der Orte, in
        # denen eine Zone steckt, und räumt sie nur auf Meldung.
        self._letzter_ort: dict[str, str] = {}
        self.start_task(self._poll_loop())

    # ── Die Schleife ───────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        while True:
            pause = await self._runde()
            await asyncio.sleep(pause)

    async def _runde(self) -> float:
        """Eine Abfrage. Gibt zurück, wie lange bis zur nächsten gewartet wird."""
        geofence = self.hub.integrations.get("geofence")
        if geofence is None:
            # Kein Startfehler: Die Integration kann nachträglich
            # dazukommen, und ein Hub, der deswegen nicht hochfährt,
            # nimmt einem das ganze Haus.
            self.log.warning(
                "life360: keine geofence-Integration - ohne Zonen gibt es "
                "nichts zu melden."
            )
            return max(self._interval, 300.0)
        try:
            mitglieder = await self._mitglieder()
        except aiohttp.ClientResponseError as err:
            self._fehler += 1
            pause = pause_nach(self._fehler)
            self.log.warning(
                "life360 antwortet mit %s - nächste Abfrage in %.0f s. "
                "Bei 403/429 sperrt Life360 Fremdzugriffe; häufiger fragen "
                "verlängert die Sperre.",
                err.status,
                pause,
            )
            return pause
        except Exception as err:
            self._fehler += 1
            pause = pause_nach(self._fehler)
            self.log.warning("life360 nicht erreichbar (%s) - Pause %.0f s", err, pause)
            return pause

        self._fehler = 0
        jetzt = time.time()
        for mitglied in mitglieder:
            await self._melden(geofence, mitglied, jetzt)
        return self._interval

    async def _melden(self, geofence: Any, mitglied: dict[str, Any], jetzt: float) -> None:
        zone = zone_fuer_mitglied(mitglied, self._members)
        if zone is None:
            return
        position = parse_position(mitglied)
        if position is None:
            return
        if zu_alt(position["timestamp"], jetzt):
            self.log.info(
                "life360: letzte Ortsmeldung für %s ist über eine Stunde alt - "
                "nicht übernommen.",
                zone,
            )
            return
        eigene = getattr(geofence, "places", [])
        meldungen = meldungen_fuer(
            eigene, position["latitude"], position["longitude"]
        )
        # Nur das eigene Zuhause entscheidet vor Life360: Steht jemand im
        # Hausradius, heisst das «zuhause», auch wenn der Ort drüben
        # anders heisst – sonst hinge die Alarmanlage an einem Namen aus
        # einer fremden App.
        #
        # Die weiten Zonen dagegen nicht. «Quartier» ist drei Kilometer
        # weit und ein Vorlauf, kein Aufenthaltsort; es verschluckte
        # sonst jeden benannten Ort im Dorf, und in der App stand
        # «Quartier», wo «Tanners Home» hingehört.
        drinnen = any(
            ereignis == "enter" and ort == "home" for ort, ereignis in meldungen
        )
        fremder = self._fremder_ort(position, eigene) if not drinnen else None

        # Reihenfolge: erst das Verlassen, dann das Ankommen. Andersherum
        # gewänne ein Ort, den die Person längst verlassen hat - der
        # Geofence nimmt den engsten aus seiner Liste.
        alt = self._letzter_ort.get(zone)
        if alt and alt != (fremder or {}).get("id"):
            meldungen.append((alt, "leave"))
        for ort, ereignis in sorted(meldungen, key=lambda m: m[1] != "leave"):
            if not await self._sagen(geofence, zone, ereignis, ort, position):
                return
        if fremder:
            if not await self._sagen(
                geofence, zone, "enter", fremder["id"], position, fremder["name"]
            ):
                return
            self._letzter_ort[zone] = fremder["id"]
        else:
            self._letzter_ort.pop(zone, None)

    def _fremder_ort(
        self, position: dict[str, Any], eigene: list[dict[str, Any]]
    ) -> dict[str, str] | None:
        """Der gespeicherte Ort von Life360, wenn er etwas Neues sagt.

        Life360 nennt den Ort beim Namen («Tanners Home»), sobald jemand
        darin steht. Das ist die Antwort, die man auf der Familienseite
        lesen will – «unterwegs» ist dort die halbe Wahrheit.

        Nichts, was der Hub selbst kennt: Die Kennung wurde eben gegen
        die eigenen Orte geprüft und lag ausserhalb. Käme sie hier
        trotzdem durch, widerspräche sie der Messung von einer Zeile
        vorher.
        """
        name = str(position.get("place") or "").strip()
        if not name:
            return None
        schluessel = ortsschluessel(name)
        if not schluessel:
            return None
        if any(schluessel == str(ort.get("id")) for ort in eigene):
            return None
        return {"id": schluessel, "name": name}

    async def _sagen(
        self,
        geofence: Any,
        zone: str,
        ereignis: str,
        ort: str,
        position: dict[str, Any],
        name: str | None = None,
    ) -> bool:
        """Eine Meldung weitergeben. False heisst «Zone fehlt, aufhören»."""
        try:
            await geofence.report(
                zone,
                ereignis,
                place=ort,
                battery=position.get("battery"),
                # Sonst stünde in der Diagnose «geofence», und man sähe
                # der Zeile nicht an, ob Life360 überhaupt liefert – die
                # eine Frage, die man dort stellt.
                source="life360",
                place_name=name,
            )
        except KeyError:
            self.log.warning(
                "life360: Zone '%s' gibt es beim geofence nicht - unter "
                "'zones' anlegen.",
                zone,
            )
            return False
        return True

    # ── Die Schnittstelle ──────────────────────────────────────────────────

    async def _kopf(self) -> dict[str, str]:
        if not self._token:
            self._token = await self._anmelden()
        return {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
            # Ohne erkennbaren Client antwortet die Gegenseite gar nicht.
            "User-Agent": "com.life360.android.safetymapd/KOKO/24.0.0 android/13",
        }

    async def _anmelden(self) -> str:
        async with self._session.post(
            TOKEN_URL,
            data={
                "grant_type": "password",
                "username": self._username,
                "password": self._password,
            },
            headers={"Authorization": BASIC, "Accept": "application/json"},
        ) as antwort:
            antwort.raise_for_status()
            daten = await antwort.json()
        token = str(daten.get("access_token") or "")
        if not token:
            raise ConfigError(
                "life360: Anmeldung ohne Token zurückgekommen. Konten mit "
                "bestätigter Telefonnummer brauchen den Cookie-Wert "
                "LIFE360_AUTH_TOKEN aus dem Browser (siehe 'token')."
            )
        return token

    async def _mitglieder(self) -> list[dict[str, Any]]:
        kopf = await self._kopf()
        if not self._circles:
            async with self._session.get(CIRCLES_URL, headers=kopf) as antwort:
                antwort.raise_for_status()
                daten = await antwort.json()
            self._circles = [
                str(kreis.get("id")) for kreis in daten.get("circles") or [] if kreis.get("id")
            ]
        mitglieder: list[dict[str, Any]] = []
        for kreis in self._circles:
            async with self._session.get(
                f"{CIRCLES_URL}/{kreis}/members", headers=kopf
            ) as antwort:
                antwort.raise_for_status()
                daten = await antwort.json()
            mitglieder.extend(daten.get("members") or [])
        return mitglieder


INTEGRATION = Life360Integration
