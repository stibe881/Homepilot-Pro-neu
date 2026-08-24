"""TuneIn – Internetradio auf den Boxen im Haus.

Konfiguration:
  - integration: tunein
    name: Radio                     # Name des Players in der App
    speaker: Küche Lautsprecher     # Vorgabe-Box, optional
    stations:
      - SRF 3                       # nur der Name: der Hub sucht ihn
      - {name: Radio Pilatus, id: s6717}
      - {name: Hauskanal, url: "http://192.168.1.9:8000/stream"}

**Warum OPML.** TuneIn hat keine offene Schnittstelle mehr. Was es gibt,
ist der OPML-Dienst unter opml.radiotime.com – dieselbe Adresse, die VLC
und Home Assistant benutzen, ohne Schlüssel und seit Jahren stabil. Zwei
Aufrufe genügen:

  Search.ashx?query=…&render=json    Sender suchen
  Tune.ashx?id=s24862&render=json    Sendeadresse holen

**Warum zwei Stufen.** Der zweite Aufruf liefert meistens keine
Sendeadresse, sondern eine *Wiedergabeliste* (.m3u/.pls) – erkennbar an
``is_direct: false``. Ein Chromecast kann damit nichts anfangen, er will
die Adresse des Tonstroms selbst. Deshalb löst der Hub eine Stufe weiter
auf (siehe `parse_playlist`). Ohne das bleibt die Box stumm, und zwar
ohne Fehlermeldung – sie lädt eine Textdatei und wartet.

**Radio ist kein Gerät, sondern eine Fernbedienung.** Gespielt wird auf
einer Box, die `play_url` kann (Chromecast, Google-Home-Lautsprecher).
Dieselbe Bauart wie Spotify: ein Player-Eintrag, der weiss, wo er
hinspielt. Der Musikplayer der App kennt diese Form schon.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import aiohttp

from ..core.entity import Entity, EntityKind
from ..core.errors import HomePilotError
from ..core.integration import Integration

SEARCH_URL = "https://opml.radiotime.com/Search.ashx"
TUNE_URL = "https://opml.radiotime.com/Tune.ashx"

#: Der Empfänger, den ein Chromecast für eine blosse Tonadresse startet.
DEFAULT_RECEIVER = "Default Media Receiver"

#: Wonach die Endung riecht, wenn TuneIn keine Art mitschickt.
CONTENT_TYPES = {
    "mp3": "audio/mpeg",
    "aac": "audio/aac",
    "aacp": "audio/aac",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
    "wma": "audio/x-ms-wma",
    "hls": "application/x-mpegURL",
}


@dataclass(frozen=True)
class Station:
    """Ein Sender – aus der Konfiguration, gespeichert oder gefunden."""

    name: str
    #: TuneIn-Kennung («s24862»). Leer, solange nur der Name bekannt ist.
    id: str = ""
    #: Feste Sendeadresse. Ist sie gesetzt, wird TuneIn gar nicht gefragt –
    #: für den eigenen Icecast im Keller, den TuneIn nicht kennt.
    url: str = ""
    #: Was TuneIn danebenschreibt: «Sounds!», «Pop · Luzern».
    subtext: str = ""
    image: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "id": self.id,
            "url": self.url,
            "subtext": self.subtext,
            "image": self.image,
        }


@dataclass(frozen=True)
class Stream:
    """Eine Sendeadresse, wie TuneIn sie zu einem Sender kennt."""

    url: str
    media_type: str = ""
    is_direct: bool = False
    playlist_type: str = ""
    bitrate: int = 0
    reliability: int = 0


def _zahl(wert: Any) -> int:
    try:
        return int(float(wert))
    except (TypeError, ValueError):
        return 0


def _outlines(body: Any) -> list[dict[str, Any]]:
    """Alle Einträge einer OPML-Antwort, auch die verschachtelten (rein).

    Die Suche antwortet flach, eine Rubrik («Lokale Sender») verschachtelt
    unter ``children``. Wer nur die oberste Ebene liest, bekommt dort eine
    leere Liste zurück und hält den Dienst für kaputt.
    """
    entries: list[dict[str, Any]] = []
    for entry in body if isinstance(body, list) else []:
        if not isinstance(entry, dict):
            continue
        entries.append(entry)
        entries.extend(_outlines(entry.get("children")))
    return entries


def parse_search(payload: dict[str, Any] | None) -> list[Station]:
    """Die Sender einer Such- oder Rubrikantwort (rein, testbar).

    Nur echte und spielbare Sender. In derselben Antwort stehen drei
    Dinge, die sich nicht abspielen lassen:

    * **Sendungen und Themen** (`item: show`/`topic`) – einzelne Folgen
      mit hübschem Namen.
    * **Verweise auf weitere Listen** (`item: link`).
    * **Gesperrte Sender** (`key: unavailable`). Die sind besonders
      hinterhältig: TuneIn hängt « - Not Supported» an den Namen und
      liefert als Adresse eine MP3, die vorliest, dass der Sender im
      eigenen Land nicht verfügbar sei. Wer darauf tippt, bekommt also
      Ton – nur nicht den gewünschten.

    Ein Treffer, der beim Antippen nichts tut, ist schlimmer als ein
    Treffer weniger.
    """
    stations: list[Station] = []
    gesehen: set[str] = set()
    for entry in _outlines((payload or {}).get("body")):
        guide_id = str(entry.get("guide_id") or "")
        name = str(entry.get("text") or "").strip()
        if not name or not guide_id or guide_id in gesehen:
            continue
        if entry.get("key") == "unavailable":
            continue
        ist_sender = entry.get("item") == "station" or (
            entry.get("type") == "audio" and guide_id.startswith("s")
        )
        if not ist_sender:
            continue
        gesehen.add(guide_id)
        stations.append(
            Station(
                name=name,
                id=guide_id,
                subtext=str(entry.get("subtext") or ""),
                image=str(entry.get("image") or ""),
            )
        )
    return stations


def parse_tune(payload: dict[str, Any] | None) -> list[Stream]:
    """Die Sendeadressen zu einem Sender, beste zuerst (rein, testbar).

    TuneIn nennt zu jedem Strom eine `reliability` – wie oft er in letzter
    Zeit erreichbar war. Danach wird sortiert und nicht nach der Bitrate:
    Ein 320er, der zu einem Drittel ausfällt, ist abends im Wohnzimmer
    schlechter als ein 128er, der immer läuft.
    """
    streams: list[Stream] = []
    for entry in (payload or {}).get("body") or []:
        if not isinstance(entry, dict):
            continue
        url = str(entry.get("url") or "").strip()
        if not url:
            continue
        streams.append(
            Stream(
                url=url,
                media_type=str(entry.get("media_type") or ""),
                # TuneIn schickt das als echtes Boolean *oder* als Text.
                is_direct=str(entry.get("is_direct")).lower() == "true",
                playlist_type=str(entry.get("playlist_type") or ""),
                bitrate=_zahl(entry.get("bitrate")),
                reliability=_zahl(entry.get("reliability")),
            )
        )
    return sorted(streams, key=lambda s: (-s.reliability, -s.bitrate))


def ist_wiedergabeliste(stream: Stream) -> bool:
    """Zeigt diese Adresse auf eine Liste statt auf den Ton? (rein, testbar)

    Genau hier bleibt eine Box sonst stumm, ohne einen Fehler zu melden:
    Sie lädt brav eine Textdatei mit einer Adresse darin und wartet, dass
    daraus Musik wird.
    """
    if stream.is_direct:
        return False
    if stream.playlist_type in ("m3u", "pls"):
        return True
    pfad = stream.url.split("?", 1)[0].lower()
    return pfad.endswith((".m3u", ".m3u8", ".pls")) and not pfad.endswith(".m3u8")


def parse_playlist(text: str) -> str | None:
    """Die erste Sendeadresse aus einer .m3u/.pls-Datei (rein, testbar).

    Die erste und nicht die beste: Wiedergabelisten von Sendern führen
    dieselbe Quelle mehrfach auf (verschiedene Server, dieselbe Musik),
    und die Reihenfolge ist die Empfehlung des Senders.
    """
    for zeile in (text or "").splitlines():
        zeile = zeile.strip()
        if not zeile or zeile.startswith("#"):
            continue
        # .pls schreibt «File1=http://…»; .m3u die Adresse blank.
        if "=" in zeile and not zeile.lower().startswith(("http://", "https://")):
            schluessel, _, wert = zeile.partition("=")
            if not schluessel.strip().lower().startswith("file"):
                continue
            zeile = wert.strip()
        if zeile.lower().startswith(("http://", "https://")):
            return zeile
    return None


def content_type_for(media_type: str, url: str = "") -> str:
    """Was für ein Ton das ist – für den Chromecast (rein, testbar).

    Er verlangt einen MIME-Typ und rät nicht selbst. Liegt keiner vor,
    ist MP3 die richtige Vermutung: Fast jeder Sender liefert es, und ein
    falsch angesagter AAC-Strom spielt trotzdem, während gar keine Angabe
    die Wiedergabe verweigert.
    """
    art = (media_type or "").strip().lower()
    if art in CONTENT_TYPES:
        return CONTENT_TYPES[art]
    if url.split("?", 1)[0].lower().endswith(".m3u8"):
        return CONTENT_TYPES["hls"]
    return CONTENT_TYPES["mp3"]


def parse_stations(entries: Any) -> list[Station]:
    """Sender aus der Konfiguration lesen (rein, testbar).

    Zwei Schreibweisen, weil beide gebraucht werden: der blosse Name für
    alles, was TuneIn kennt, und die ausführliche Form für den eigenen
    Icecast im Keller, den es dort nicht gibt.
    """
    stations: list[Station] = []
    for entry in entries if isinstance(entries, list) else []:
        if isinstance(entry, str):
            name = entry.strip()
            if name:
                stations.append(Station(name=name))
            continue
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        if not name:
            continue
        stations.append(
            Station(
                name=name,
                id=str(entry.get("id") or "").strip(),
                url=str(entry.get("url") or "").strip(),
                subtext=str(entry.get("subtext") or ""),
                image=str(entry.get("image") or ""),
            )
        )
    return stations


def merge_stations(aus_config: list[Station], gespeichert: list[Station]) -> list[Station]:
    """Sender der config.yaml plus die in der App gemerkten (rein, testbar).

    Die Datei gewinnt bei gleichem Namen: Wer einen Sender dort einträgt,
    hat sich etwas dabei gedacht – etwa eine feste Adresse, die er der
    Suche vorzieht.
    """
    zusammen = list(aus_config)
    bekannt = {station.name.casefold() for station in aus_config}
    for station in gespeichert:
        if station.name.casefold() in bekannt:
            continue
        bekannt.add(station.name.casefold())
        zusammen.append(station)
    return zusammen


def pick_speaker(
    wunsch: str | None, boxen: list[tuple[str, str]], zuletzt: str | None = None
) -> str | None:
    """Auf welcher Box das Radio spielt (rein, testbar).

    ``boxen`` sind Paare aus Entitäts-Kennung und Name. Die Reihenfolge
    der Wahl: was ausdrücklich gewünscht ist, sonst wo es zuletzt lief,
    sonst die erste. Ohne jede Box gibt es keine Antwort – dann fehlt eine
    Voraussetzung, und das soll man lesen können statt ins Leere zu
    tippen.
    """
    if wunsch:
        for entity_id, name in boxen:
            if wunsch in (entity_id, name):
                return entity_id
    if zuletzt and any(entity_id == zuletzt for entity_id, _ in boxen):
        return zuletzt
    return boxen[0][0] if boxen else None


def claim_haelt(box_state: dict[str, Any]) -> bool:
    """Läuft auf der Box noch unser Radio? (rein, testbar)

    Zwei Dinge beenden den Anspruch: Die Box spielt nichts mehr, oder
    jemand hat etwas anderes gestartet. Das Zweite steht in der App-Angabe
    der Box – eine blosse Tonadresse läuft im «Default Media Receiver».
    Sobald dort «Spotify» oder «YouTube» steht, ist das Radio Geschichte,
    und ein Player, der weiter «läuft» behauptet, wäre eine Lüge.
    """
    if str(box_state.get("state") or "") != "playing":
        return False
    app = str(box_state.get("app") or "")
    return not app or DEFAULT_RECEIVER.casefold() in app.casefold()


class TuneInIntegration(Integration):
    name = "tunein"

    #: Wo die in der App gemerkten Sender liegen.
    STORE_KEY = "radio_stations"

    async def setup(self) -> None:
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=15))
        self._config_stations = parse_stations(self.config.get("stations"))
        self._wunsch_box = str(self.config.get("speaker") or "") or None
        # Gefundene Kennungen zu Sendern, die nur mit Namen dastehen –
        # einmal gesucht, dann gemerkt.
        self._gefunden: dict[str, Station] = {}
        # Wo gerade gespielt wird und was.
        self._box: str | None = None
        self._station: Station | None = None

        await self.add_entity(
            "radio",
            EntityKind.MEDIA_PLAYER,
            str(self.config.get("name") or "Radio"),
            state={"state": "idle"},
            commands=[
                "play_radio",
                "play",
                "pause",
                "toggle",
                "play_on",
                "set_volume",
                "volume_up",
                "volume_down",
                "mute",
            ],
        )
        await self._refresh()
        self.start_polling(self._refresh)

    # ── Sender ─────────────────────────────────────────────────────────────

    def stations(self) -> list[Station]:
        """Alle wählbaren Sender – Konfiguration plus App."""
        gespeichert = parse_stations(self.hub.data.get(self.STORE_KEY))
        zusammen = merge_stations(self._config_stations, gespeichert)
        # Was schon einmal gesucht wurde, kommt mit Bild und Kennung
        # zurück statt nackt.
        return [self._gefunden.get(station.name.casefold(), station) for station in zusammen]

    def station_by_name(self, name: str) -> Station | None:
        gesucht = (name or "").strip().casefold()
        for station in self.stations():
            if station.name.casefold() == gesucht:
                return station
        return None

    async def search(self, query: str) -> list[Station]:
        """Sender bei TuneIn suchen – für die Auswahl in der App."""
        payload = await self._opml(f"{SEARCH_URL}?query={quote(query)}&render=json")
        return parse_search(payload)

    def speakers(self) -> list[tuple[str, str]]:
        """Die Boxen, auf denen sich Radio abspielen lässt.

        Das Kommando entscheidet, nicht die Integration: Was `play_url`
        kann, kann Radio – heute ein Chromecast, morgen etwas anderes.
        """
        return [
            (entity.id, entity.display_name or entity.name)
            for entity in self.hub.registry.all()
            if entity.kind == EntityKind.MEDIA_PLAYER
            and "play_url" in entity.commands
            and entity.available
        ]

    # ── Hub → Box ──────────────────────────────────────────────────────────

    async def _opml(self, url: str) -> dict[str, Any]:
        async with self._session.get(url) as response:
            response.raise_for_status()
            # Der Dienst antwortet als text/html, obwohl JSON drinsteht –
            # ohne content_type=None wirft aiohttp hier.
            payload: dict[str, Any] = await response.json(content_type=None)
            return payload

    async def _playlist_text(self, url: str) -> str:
        """Den Inhalt einer .m3u/.pls-Datei holen."""
        async with self._session.get(url) as response:
            response.raise_for_status()
            return await response.text()

    async def _resolve(self, station: Station) -> Station:
        """Zu einem Sender, der nur einen Namen hat, die Kennung suchen."""
        if station.id or station.url:
            return station
        treffer = await self.search(station.name)
        if not treffer:
            raise HomePilotError(
                f"TuneIn kennt keinen Sender namens '{station.name}'"
            )
        gefunden = treffer[0]
        self._gefunden[station.name.casefold()] = gefunden
        self.log.info("TuneIn: '%s' gefunden als %s", station.name, gefunden.id)
        return gefunden

    async def stream_for(self, station: Station) -> tuple[str, str]:
        """Sendeadresse und Tonart eines Senders – abspielfertig.

        Hier steckt die zweite Stufe: Was TuneIn nennt, ist meistens eine
        Wiedergabeliste. Sie wird aufgelöst, bevor die Adresse an die Box
        geht.
        """
        station = await self._resolve(station)
        if station.url:
            return station.url, content_type_for("", station.url)

        payload = await self._opml(f"{TUNE_URL}?id={quote(station.id)}&render=json")
        streams = parse_tune(payload)
        if not streams:
            raise HomePilotError(f"TuneIn liefert keine Adresse für '{station.name}'")

        letzter_fehler: Exception | None = None
        for stream in streams:
            try:
                url = stream.url
                if ist_wiedergabeliste(stream):
                    aufgeloest = parse_playlist(await self._playlist_text(url))
                    if not aufgeloest:
                        continue
                    url = aufgeloest
                return url, content_type_for(stream.media_type, url)
            except Exception as err:  # noqa: BLE001 – der nächste Strom darf es versuchen
                letzter_fehler = err
                self.log.debug("TuneIn: %s ging nicht (%s)", stream.url, err)
        raise HomePilotError(
            f"Keine der {len(streams)} Adressen von '{station.name}' liess sich "
            f"auflösen{f': {letzter_fehler}' if letzter_fehler else ''}"
        )

    async def _play(self, station: Station, wunsch_box: str | None) -> None:
        boxen = self.speakers()
        ziel = pick_speaker(wunsch_box or self._wunsch_box, boxen, self._box)
        if ziel is None:
            raise HomePilotError(
                "Keine Box zum Abspielen da. Radio braucht einen Lautsprecher, "
                "der eine Tonadresse abspielen kann (Chromecast, Google Home)."
            )
        url, content_type = await self.stream_for(station)
        await self.hub.integrations.dispatch_command(
            ziel, "play_url", {"url": url, "content_type": content_type}
        )
        self._box = ziel
        self._station = self._gefunden.get(station.name.casefold(), station)
        await self._refresh()

    # ── Box → Hub ──────────────────────────────────────────────────────────

    async def _refresh(self) -> None:
        """Den Player nachführen – der Zustand steht auf der Box.

        Ohne Netz und ohne TuneIn: Alles, was hier gebraucht wird, liegt
        schon in der Registry. Der Takt ist trotzdem nötig, weil die Box
        von sich aus nichts über *unseren* Eintrag sagt.
        """
        boxen = self.speakers()
        box = self.hub.registry.get(self._box) if self._box else None
        laeuft = box is not None and claim_haelt(box.state)
        if not laeuft:
            self._station = None

        zustand: dict[str, Any] = {
            "state": "playing" if laeuft else "idle",
            "track": self._station.name if self._station else None,
            "artist": (self._station.subtext or "Radio") if self._station else None,
            "image": self._station.image or None if self._station else None,
            "station": self._station.name if self._station else None,
            "stations": [station.name for station in self.stations()],
            "device": box.display_name or box.name if box is not None else None,
            "devices": [name for _, name in boxen],
        }
        if box is not None:
            if "volume" in box.state:
                zustand["volume"] = box.state["volume"]
            if "muted" in box.state:
                zustand["muted"] = box.state["muted"]
        await self.hub.registry.update_state(self.entity_id("radio"), zustand)

    async def refresh_now(self) -> None:
        """Den Player sofort nachführen – nach einer Änderung der Liste.

        Die Routen ändern die gemerkten Sender; ohne das hier stünde die
        neue Auswahl erst beim nächsten Takt im Player, und wer gerade
        einen Sender hinzugefügt hat, sucht ihn vergeblich.
        """
        await self._refresh()

    # ── Kommandos ──────────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        if command == "play_radio":
            name = str(data.get("station") or data.get("name") or "").strip()
            station = self.station_by_name(name) if name else self._station
            if station is None:
                # Ein Name, den niemand kennt: Die Liste dazuschreiben –
                # in einem Ablauf sieht man sonst nur, dass nichts kam.
                bekannt = ", ".join(s.name for s in self.stations()) or "keine"
                raise HomePilotError(
                    f"Unbekannter Sender '{name}'. Bekannt: {bekannt}"
                )
            await self._play(station, str(data.get("device") or "") or None)
            return

        if command == "play":
            # Live-Radio kennt kein «weiter»: Was während der Pause lief,
            # ist vorbei. Der Knopf stimmt deshalb neu ein, statt so zu
            # tun, als liesse sich fortsetzen.
            station = self._station or (self.stations()[0] if self.stations() else None)
            if station is None:
                raise HomePilotError("Kein Sender eingerichtet")
            await self._play(station, None)
            return

        if command == "toggle":
            command = "pause" if entity.state.get("state") == "playing" else "play"
            if command == "play":
                return await self.handle_command(entity, "play", data)

        if command == "play_on":
            ziel = str(data.get("device") or "")
            station = self._station
            if station is None:
                raise HomePilotError("Es läuft gerade kein Sender zum Umziehen")
            await self._play(station, ziel or None)
            return

        # Alles Übrige geht an die Box: Lautstärke und Pause kann sie
        # selbst, und zwei Regler für dieselbe Box wären einer zu viel.
        if self._box is None:
            raise HomePilotError("Es läuft gerade kein Radio")
        weiter = "pause" if command == "pause" else command
        await self.hub.integrations.dispatch_command(self._box, weiter, data)
        if weiter == "pause":
            self._station = None
        await self._refresh()


INTEGRATION = TuneInIntegration
