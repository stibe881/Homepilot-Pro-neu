"""Life360: Standorte aus der Familien-App - für einzelne oder für alle.

Zwei Wege führen zum selben Ziel, und beide haben ihren Preis. Die App
meldet den Übertritt einer Zonengrenze selbst, im Moment, in dem er
passiert - ohne fremde Wolke, ohne Konto, ohne Sperre. Dafür hängt sie
daran, dass iOS die App im Hintergrund weckt, und das tut es nicht
zuverlässig: Wer heimkommt und minutenlang weiter als «unterwegs»
dasteht, hat genau das erlebt.

Benutzt der ganze Haushalt ohnehin Life360, ist es deshalb die bessere
Wahl - **auch für die Telefone, auf denen HomePilot läuft.** Dann
stehen alle unter `members`, und die Ortung der App gehört auf jedem
Gerät ausgeschaltet (Einstellungen → Ortung).

**Eine Quelle je Person, und der Hub setzt es durch.** Wer hier
eingetragen ist, wird von hier geführt: Der Geofence überhört für diese
Person jedes fremde «weg» (``zonen_beanspruchen``). Vorher gewann, wer
zuletzt sprach - Life360 meldete «zuhause», ein vergessener Schalter auf
einem alten Telefon schob «weg» nach, und auf dem Schirm stand
«unterwegs», während die Person in der Küche sass. Zwei Quellen auf
dieselbe Frage widersprechen sich früher oder später; daran ist schon
die WLAN-Anwesenheit gescheitert.

Ein **Ankommen** darf dagegen jeder melden: Das Telefon sieht den
Übertritt sofort, diese Integration erst bei der nächsten Abfrage. Die
App-Ortung darf also eingeschaltet bleiben - sie beschleunigt das
Heimkommen, und was sie verschläft, rückt die nächste Runde hier gerade
(``presence.meldung_annehmen``).

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

**Die gespeicherten Orte von Life360 kommen mit** - Schule, Arbeit,
Grosseltern. Der Hub holt sie einmal je Stunde beim Kreis ab und führt
sie als eigene Orte weiter: Von da an rechnet er den Übertritt selbst,
aus Koordinaten und Radius, und die Orte stehen in Abläufen zur
Auswahl («wenn Livia bei der Schule ankommt»). Früher kannte er einen
solchen Ort erst, wenn jemand darin stand - für die Anzeige genügte
das, für einen Ablauf nicht.

Die eigenen Orte des Hubs behalten Vorrang, und «zuhause» sticht alles:
Wer im Hausradius steht, ist zuhause, auch wenn der Ort drüben anders
heisst. Daran hängen Alarmanlage und Abläufe.
"""

from __future__ import annotations

import asyncio
import math
import time
from typing import Any

import aiohttp

from ..core import presence
from ..core.errors import ConfigError
from ..core.integration import Integration

BASE = "https://api-cloudfront.life360.com/v3"
TOKEN_URL = f"{BASE}/oauth2/token"
CIRCLES_URL = f"{BASE}/circles"

# Kleinster Radius, mit dem ein Ort überhaupt zuverlässig auslöst. Life360
# erlaubt engere; eine Handy-Ortung ist auf freiem Feld selten besser als
# 30 m, und im Dorf zwischen Häusern schlechter.
MIN_RADIUS = 60.0

# Orte ändern sich selten - ein Abruf je Stunde genügt, und jede
# zusätzliche Abfrage zählt gegen dieselbe Sperre wie die Positionen.
ORTE_INTERVALL = 3600.0

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

# Ab wie vielen Fehlschlägen in Folge die Diagnose von einer Störung
# spricht. Einer ist Alltag - die Wolke ist kurz weg, die nächste Abfrage
# holt es nach. Zwei heissen: Es liegt nicht am Zufall.
STOERUNG_AB = 2

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


def namen_je_zone(raw: Any) -> dict[str, str]:
    """Zur Zone der Name, unter dem bei Life360 gesucht wird (rein, testbar).

    Nur für die Diagnose. «oma» sagt nicht, wonach im Kreis gesucht wird,
    und genau daran scheitert die Zuordnung: ein Nachname zu viel, eine
    andere Schreibweise - die Person meldet nie, und niemand sieht warum.
    """
    namen: dict[str, str] = {}
    for name, zone in (raw or {}).items():
        klar = " ".join(str(name or "").split())
        ziel = str(zone or "").strip()
        if klar and ziel:
            namen[ziel] = klar
    return namen


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


def parse_orte(raw: Any) -> list[dict[str, Any]]:
    """Die gespeicherten Orte eines Life360-Kreises (rein, testbar).

    Bisher kannte der Hub einen fremden Ort erst, wenn jemand darin
    stand: Life360 schreibt den Namen dann in die Positionsmeldung. Das
    genügt für die Anzeige und für nichts sonst - ein Ablauf «wenn Livia
    bei der Schule ankommt» braucht die Orte **vorher**, sonst gibt es
    nichts zum Auswählen.

    Also holt der Hub sie beim Kreis ab und übergibt sie dem Geofence als
    ganz gewöhnliche Orte. Von da an rechnet er den Übertritt selbst,
    aus Koordinaten und Radius - unabhängig davon, ob Life360 den Namen
    gerade mitschickt.

    Die Kennung entsteht aus dem Namen, nicht aus der Life360-Kennung:
    Ein Ablauf trägt sie sichtbar («schule»), und Orte, die früher über
    die Positionsmeldung hereinkamen, tragen bereits dieselbe.

    Life360 liefert Zahlen als Zeichenketten; Orte ohne brauchbare
    Koordinate oder ohne Namen fallen weg, statt später stumm nie
    auszulösen.
    """
    orte: list[dict[str, Any]] = []
    gesehen: set[str] = set()
    for eintrag in (raw or {}).get("places") or []:
        name = " ".join(str(eintrag.get("name") or "").split())
        schluessel = ortsschluessel(name)
        if not schluessel or schluessel in gesehen:
            continue
        try:
            lat = float(eintrag["latitude"])
            lon = float(eintrag["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        try:
            radius = float(eintrag.get("radius") or 0)
        except (TypeError, ValueError):
            radius = 0.0
        # Life360 lässt Radien bis hinunter zu wenigen Metern zu. So eng
        # trifft keine Ortung zuverlässig, und der Ort meldete sich nie.
        orte.append(
            {
                "id": schluessel,
                "name": name,
                "latitude": lat,
                "longitude": lon,
                "radius": max(radius, MIN_RADIUS),
            }
        )
        gesehen.add(schluessel)
    return orte


#: Der Abstand wird an zwei Stellen gebraucht - hier und für die
#: Positionsmeldung des Telefons. Er steht deshalb in `core/presence.py`
#: und wird hier nur weitergereicht: Zwei Rechnungen für denselben
#: Abstand wären zwei Stellen, an denen sich ein Vorzeichen versteckt.
abstand_meter = presence.abstand_meter


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


def health_detail(
    personen: int,
    gemeldet: int,
    *,
    unbekannt: list[str] | None = None,
    still: list[str] | None = None,
    fehler: int = 0,
    grund: str | None = None,
    geofence: bool = True,
    abgefragt: bool = True,
) -> str:
    """Was im System-Bildschirm über Life360 steht (rein, testbar).

    Diese Integration legt keine eigenen Entitäten an - die Personen
    gehören dem Geofence, hierher kommen nur die Meldungen. In der
    Diagnose stand deshalb «0 Geräte»: wahr, aber es sieht aus wie eine
    Störung und beantwortet die eine Frage nicht, für die man dort
    hinschaut - kommt von Life360 gerade etwas an?

    Die Reihenfolge ist die der Ursachen. Ohne Geofence ist alles andere
    gegenstandslos, und wenn die Wolke sperrt, sind die Zahlen von der
    letzten geglückten Abfrage und sagen nichts über jetzt.
    """
    if not geofence:
        return (
            "Keine geofence-Integration - ohne Zonen gibt es nichts zu melden."
        )
    if fehler > 0:
        warum = f" ({grund})" if grund else ""
        return (
            f"Letzte Abfrage fehlgeschlagen{warum} - nächster Versuch in "
            f"{pause_nach(fehler):.0f} s. Bei 403/429 sperrt Life360 "
            "Fremdzugriffe; häufiger fragen verlängert die Sperre."
        )
    if not abgefragt:
        return "Erste Abfrage steht noch aus."
    teile = [f"{gemeldet} von {personen} {'Person' if personen == 1 else 'Personen'} gemeldet"]
    if unbekannt:
        # Der häufigste Fehler überhaupt, und von aussen unsichtbar: Der
        # Name in 'members' muss der bei Life360 sein, nicht der im Haus.
        teile.append(
            f"im Kreis nicht gefunden: {', '.join(sorted(unbekannt))} - "
            "Schreibweise unter 'members' prüfen"
        )
    if still:
        # Kein Fehler der Integration: ein leerer Akku, ein Flugmodus. Der
        # Geofence führt die Person nach zwölf Stunden als «unbekannt».
        teile.append(f"ohne frische Ortsmeldung: {', '.join(sorted(still))}")
    return " · ".join(teile)


class Life360Integration(Integration):
    name = "life360"

    # Vorbelegt, weil health() auch dann eine Antwort schuldet, wenn
    # setup() an einer fehlenden Zugangsangabe gescheitert ist - sonst
    # wirft ausgerechnet die Diagnose, die den Fehlschlag erklären soll.
    _members: dict[str, str] = {}
    _namen: dict[str, str] = {}
    _fehler = 0
    _grund: str | None = None
    _letzte_abfrage: float | None = None
    _geofence_da = True
    _gesehen: set[str] = set()
    _gemeldet: set[str] = set()
    _orte: list[dict[str, Any]] = []
    _orte_geholt: float | None = None

    async def setup(self) -> None:
        self._members = parse_members(self.config.get("members"))
        self._namen = namen_je_zone(self.config.get("members"))
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
        # Die gespeicherten Orte des Kreises, samt Zeitpunkt des Abrufs.
        self._orte: list[dict[str, Any]] = []
        self._orte_geholt: float | None = None
        # Was die Diagnose später auszusagen hat. Ohne Zahlen von einer
        # geglückten Abfrage wäre jede Aussage über die Zuordnung geraten.
        self._grund = None
        self._letzte_abfrage = None
        self._geofence_da = True
        self._gesehen = set()
        self._gemeldet = set()
        self.start_task(self._poll_loop())

    # ── Die Schleife ───────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        while True:
            pause = await self._runde()
            await asyncio.sleep(pause)

    async def _runde(self) -> float:
        """Eine Abfrage. Gibt zurück, wie lange bis zur nächsten gewartet wird."""
        geofence = self.hub.integrations.get("geofence")
        self._geofence_da = geofence is not None
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
            self._grund = f"Life360 antwortet mit {err.status}"
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
            self._grund = f"nicht erreichbar: {err}"
            pause = pause_nach(self._fehler)
            self.log.warning("life360 nicht erreichbar (%s) - Pause %.0f s", err, pause)
            return pause

        self._fehler = 0
        self._grund = None
        jetzt = time.time()
        # Vor den Positionen, nicht danach: Ein Ort, den der Geofence noch
        # nicht kennt, führte in derselben Runde zu einer Meldung auf eine
        # Kennung, die es nirgends gibt.
        await self._orte_abgleichen(geofence, jetzt)
        # Wer hier eingetragen ist, wird von hier geführt - und nur von
        # hier. Sonst schiebt die Ortung der App auf einem Telefon, auf
        # dem der Schalter noch steht, aus dem Hintergrund ein «weg»
        # nach, und auf dem Schirm steht «unterwegs», während die Person
        # in der Küche sitzt.
        beanspruchen = getattr(geofence, "zonen_beanspruchen", None)
        if beanspruchen is not None:
            beanspruchen(sorted(set(self._members.values())), "life360")
        # Wer im Kreis steht, ist noch nicht, wer gemeldet hat: Ein
        # Telefon im Flugmodus schickt seit Stunden denselben Punkt. Die
        # Diagnose unterscheidet beides, weil die Abhilfe verschieden ist
        # - Schreibweise korrigieren oder Akku laden.
        gesehen: set[str] = set()
        gemeldet: set[str] = set()
        for mitglied in mitglieder:
            zone = zone_fuer_mitglied(mitglied, self._members)
            if zone is None:
                continue
            gesehen.add(zone)
            if await self._melden(geofence, mitglied, jetzt):
                gemeldet.add(zone)
        self._gesehen = gesehen
        self._gemeldet = gemeldet
        self._letzte_abfrage = jetzt
        return self._interval

    async def _orte_abgleichen(self, geofence: Any, jetzt: float) -> None:
        """Die Orte des Kreises holen und dem Geofence übergeben.

        Fehlschläge sind hier ausdrücklich harmlos: Ohne die Orte meldet
        der Hub weiterhin «zuhause» und «unterwegs», nur die benannten
        Orte fehlen. Das ist kein Grund, die Positionen mitfallen zu
        lassen - und schon gar keiner, die Pause hochzuzählen und damit
        auch die Anwesenheit zu verzögern.
        """
        if self._orte_geholt is not None and jetzt - self._orte_geholt < ORTE_INTERVALL:
            return
        try:
            orte = await self._orte_holen()
        except Exception as err:
            self.log.warning(
                "life360: gespeicherte Orte nicht abrufbar (%s) - Anwesenheit "
                "läuft weiter, benannte Orte fehlen vorerst.",
                err,
            )
            # Erst beim nächsten Anlauf wieder versuchen, nicht in jeder
            # Runde: Die Ortsabfrage zählt gegen dieselbe Sperre.
            self._orte_geholt = jetzt
            return
        self._orte_geholt = jetzt
        if orte == self._orte:
            return
        self._orte = orte
        uebernehmen = getattr(geofence, "orte_uebernehmen", None)
        if uebernehmen is None:
            return
        uebernehmen(orte, "life360")
        self.log.info(
            "life360: %d gespeicherte Orte übernommen (%s)",
            len(orte),
            ", ".join(ort["name"] for ort in orte) or "keine",
        )

    async def _orte_holen(self) -> list[dict[str, Any]]:
        kopf = await self._kopf()
        orte: list[dict[str, Any]] = []
        bekannt: set[str] = set()
        for kreis in self._circles:
            async with self._session.get(
                f"{CIRCLES_URL}/{kreis}/places", headers=kopf
            ) as antwort:
                antwort.raise_for_status()
                daten = await antwort.json()
            for ort in parse_orte(daten):
                if ort["id"] in bekannt:
                    continue
                orte.append(ort)
                bekannt.add(ort["id"])
        return orte

    async def _melden(
        self, geofence: Any, mitglied: dict[str, Any], jetzt: float
    ) -> bool:
        """Eine Person weitergeben. True heisst «es ging etwas hinaus»."""
        zone = zone_fuer_mitglied(mitglied, self._members)
        if zone is None:
            return False
        position = parse_position(mitglied)
        if position is None:
            return False
        if zu_alt(position["timestamp"], jetzt):
            self.log.info(
                "life360: letzte Ortsmeldung für %s ist über eine Stunde alt - "
                "nicht übernommen.",
                zone,
            )
            return False
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
        gesagt = False
        for ort, ereignis in sorted(meldungen, key=lambda m: m[1] != "leave"):
            if not await self._sagen(geofence, zone, ereignis, ort, position):
                return gesagt
            gesagt = True
        if fremder:
            if not await self._sagen(
                geofence, zone, "enter", fremder["id"], position, fremder["name"]
            ):
                return gesagt
            gesagt = True
            self._letzter_ort[zone] = fremder["id"]
        else:
            self._letzter_ort.pop(zone, None)
        return gesagt

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

    # ── Was die Diagnose zu sehen bekommt ──────────────────────────────────

    def health(self) -> dict[str, Any]:
        """Liefert Life360 gerade etwas? Die Gerätezahl sagt es nicht.

        Sie steht auf null und bleibt es: Diese Integration führt keine
        eigenen Entitäten, die Personen gehören dem Geofence. Ohne diese
        Auskunft ist eine gesperrte Wolke von «es ist halt niemand
        gegangen» nicht zu unterscheiden - und genau so hat es sich in
        der App auch gelesen.
        """
        zonen = set(self._members.values())
        # Erst nach einer geglückten Abfrage steht fest, wen der Kreis
        # kennt. Vorher wäre jeder Name «nicht gefunden».
        unbekannt = sorted(zonen - self._gesehen) if self._letzte_abfrage else []
        still = sorted(self._gesehen - self._gemeldet)
        return {
            # Eine misslungene Abfrage ist Alltag; erst die zweite in
            # Folge ist eine Störung. Wer nirgends im Kreis steht, meldet
            # nie - das ist eine, auch wenn die Verbindung steht.
            "ok": (
                self._geofence_da
                and self._fehler < STOERUNG_AB
                and not unbekannt
                and (self._letzte_abfrage is None or bool(self._gemeldet))
            ),
            "detail": health_detail(
                len(zonen),
                len(self._gemeldet),
                unbekannt=[self._namen.get(zone, zone) for zone in unbekannt],
                still=[self._namen.get(zone, zone) for zone in still],
                fehler=self._fehler,
                grund=self._grund,
                geofence=self._geofence_da,
                abgefragt=self._letzte_abfrage is not None,
            ),
            "last_event": self._letzte_abfrage,
        }

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
