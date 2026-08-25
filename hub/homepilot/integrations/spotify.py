"""Spotify – was gerade läuft, plus Wiedergabesteuerung.

Konfiguration:
  - integration: spotify
    client_id: "${SPOTIFY_CLIENT_ID}"
    client_secret: "${SPOTIFY_CLIENT_SECRET}"
    refresh_token: "${SPOTIFY_REFRESH_TOKEN}"
    scan_interval: 30

Einmalige Einrichtung (~5 Minuten):
  1. developer.spotify.com → Dashboard → Create App; als Redirect-URI exakt
     http://127.0.0.1:8888/callback eintragen. Client-ID und Client-Secret
     als SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in die Umgebung
     (Portainer-Stack), dann den Stack neu deployen.
  2. Anmelden:  docker exec -it homepilot-hub \
                  python -m homepilot.integrations.spotify -c /config/config.yaml
     Der Helfer zeigt eine Spotify-Adresse; dort zustimmen und die komplette
     Adresse aus der Adresszeile (die «Seite nicht erreichbar»-Seite) zurück
     in den Helfer kopieren. Der refresh_token landet in spotify-token.json
     neben der homepilot-data.json – 'refresh_token' in der Konfiguration
     ist damit optional (und hat Vorrang, falls gesetzt).

Der Hub tauscht den refresh_token selbstständig gegen kurzlebige
Zugriffstokens; er läuft nicht ab.

Google-/Cast-Boxen: Schlafende Lautsprecher stehen trotzdem in der
Geräteliste (aus der google_cast-Integration). Beim Playlist-Start weckt
der Hub die Box übers Cast-Protokoll und meldet sie bei Spotify an –
dieselbe Mechanik wie «Spotcast» in Home Assistant. Dafür braucht der
refresh_token die Scopes streaming/user-read-email/user-read-private
(im Anmelde-Helfer enthalten) und Spotify Premium.

`play_playlist` nimmt drei Zusatzdaten: `name` (die Playlist), `device`
(auf welcher Box) und `shuffle` (zufällig oder der Reihe nach). Fehlt
`shuffle`, bleibt die Reihenfolge, wie sie ist – eine Szene soll die
Einstellung des Kontos nicht heimlich umstellen.

`play_queue` springt an einen Titel der Warteschlange (`uri`). Die App
zeigt die Liste seit Längerem an; man konnte sie nur lesen, nicht
antippen. Spotify kennt keinen Sprung «an Position 5» – wohl aber den
Sprung an eine Stelle im laufenden Kontext, und genau der wird benutzt
(siehe `play_body`).
"""

from __future__ import annotations

import asyncio
import json as jsonlib
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit

import aiohttp

from ..core import tokenstore
from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

ACCOUNTS = "https://accounts.spotify.com/api/token"
AUTHORIZE = "https://accounts.spotify.com/authorize"
API = "https://api.spotify.com/v1"
REDIRECT = "http://127.0.0.1:8888/callback"

# Wie oft die Playlisten des Kontos neu geholt werden. Eine halbe Stunde:
# Neue Listen tauchen so ohne Neustart auf, ohne dass es jemand merkt.
PLAYLIST_TAKT = 1800.0
SCOPES = (
    "user-read-playback-state user-modify-playback-state "
    "playlist-read-private playlist-read-collaborative"
)


def merge_device_names(connect: list[str], cast: list[str]) -> list[str]:
    """Connect-Geräte plus (schlafende) Cast-Boxen, ohne Duplikate (rein).

    Die Cast-Namen hängen hinten an: So bleibt eine Box wählbar, auch wenn
    sie bei Spotify gerade nicht registriert ist – beim Playlist-Start wird
    sie geweckt.
    """
    result = list(connect)
    for name in cast:
        if name not in result:
            result.append(name)
    return result


def extract_code(text: str) -> str:
    """Holt den OAuth-Code aus einer ganzen Redirect-Adresse oder gibt die
    Eingabe unverändert zurück, wenn sie schon der Code ist (rein, testbar)."""
    text = text.strip()
    if "code=" in text:
        query = urlsplit(text).query or text.split("?", 1)[-1]
        values = parse_qs(query).get("code")
        if values:
            return values[0]
    return text


def parse_devices(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Übersetzt /me/player/devices in eine Geräteliste (rein, testbar).

    Google-Home-Lautsprecher, Fernseher usw. tauchen hier als
    Spotify-Connect-Ziele auf; 'play_on' zieht die Wiedergabe dorthin um.
    """
    devices = []
    for device in (payload or {}).get("devices") or []:
        if not device.get("name") or not device.get("id"):
            continue
        devices.append(
            {
                "id": device["id"],
                "name": device["name"],
                "active": bool(device.get("is_active")),
            }
        )
    return devices


def parse_playlists(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Übersetzt /me/playlists in [{name, uri}] (rein, testbar)."""
    result = []
    for item in (payload or {}).get("items") or []:
        uri = item.get("uri")
        name = item.get("name")
        if uri and name:
            result.append({"name": str(name), "uri": str(uri)})
    return result


def pick_device(
    requested: str, active: str | None, device_ids: dict[str, str]
) -> str | None:
    """Ziel-Lautsprecher für den Start einer Playlist (rein, testbar).

    Reihenfolge: ausdrücklich gewünscht → gerade aktiv → der erste
    sichtbare. So startet eine Playlist auch aus völliger Stille, ohne dass
    Spotify mit «kein aktives Gerät» abwinkt.
    """
    if requested and requested in device_ids:
        return device_ids[requested]
    if active and active in device_ids:
        return device_ids[active]
    return next(iter(device_ids.values()), None)


def shuffle_wunsch(data: dict[str, Any]) -> bool | None:
    """Steht in den Zusatzdaten ein Wunsch zur Reihenfolge? (rein, testbar)

    Drei Antworten, nicht zwei: `None` heisst «nicht angerührt». Eine
    Szene, die bloss eine Playlist startet, soll die Einstellung des
    Hauses nicht heimlich umstellen – wer am Abend zuvor auf Zufall
    gestellt hat, findet es sonst am Morgen anders vor, ohne zu wissen,
    warum.

    Wahrheitswerte kommen aus zwei Richtungen: von der App als echtes
    `true`/`false`, aus einer von Hand geschriebenen config.yaml auch
    einmal als «ja» oder «an».
    """
    if "shuffle" not in data:
        return None
    wert = data.get("shuffle")
    if wert is None or wert == "":
        return None
    if isinstance(wert, bool):
        return wert
    text = str(wert).strip().lower()
    if text in ("true", "1", "on", "an", "ja", "yes", "zufall", "zufaellig"):
        return True
    if text in ("false", "0", "off", "aus", "nein", "no", "reihe"):
        return False
    return None


def album_image(images: list[dict[str, Any]]) -> str | None:
    """Die passende Cover-Grösse für eine Kachel (rein, testbar).

    Bevorzugt wird das kleinste Bild ab 200 Pixel Breite; gibt es nur
    kleinere, das grösste davon - Hauptsache, es gibt überhaupt eines.
    """
    with_url = [img for img in images if img.get("url")]
    if not with_url:
        return None
    big_enough = [img for img in with_url if (img.get("width") or 0) >= 200]
    if big_enough:
        chosen = min(big_enough, key=lambda img: img.get("width") or 0)
    else:
        chosen = max(with_url, key=lambda img: img.get("width") or 0)
    return str(chosen["url"])


def kuenstler(item: dict[str, Any]) -> str | None:
    """Die Künstler eines Titels als eine Zeile (rein, testbar)."""
    namen = ", ".join(
        artist.get("name", "") for artist in item.get("artists") or [] if artist.get("name")
    )
    return namen or None


# So viele Titel der Warteschlange gehen an die App. Spotify liefert bis
# zu zwanzig; wer wissen will, was als Nächstes kommt, schaut auf die
# ersten paar - und eine lange Liste kostet bei jedem Zustands-Abruf.
WARTESCHLANGE_MAX = 15


def parse_queue(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Übersetzt /me/player/queue in die Liste dessen, was als Nächstes
    kommt (rein, testbar).

    Der gerade laufende Titel steht dort noch einmal davor; er gehört
    nicht in die Liste, denn er läuft ja schon. Titel ohne Namen fallen
    weg - eine leere Zeile ist keine Auskunft.

    Die URI reist mit: Ohne sie ist die Liste nur zum Lesen da, und ein
    Tipp auf eine Zeile kann nichts auslösen. Genau das hat gefehlt.
    """
    if not payload:
        return []
    titel = []
    for item in payload.get("queue") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        titel.append(
            {
                "track": name,
                "artist": kuenstler(item),
                # Podcast-Folgen haben keine, und was keine URI hat, lässt
                # sich nicht anspringen - die Zeile bleibt dann unantastbar.
                "uri": str(item.get("uri") or "") or None,
            }
        )
        if len(titel) >= WARTESCHLANGE_MAX:
            break
    return titel


def play_body(
    uri: str, context_uri: str | None, folgende: list[str]
) -> dict[str, Any]:
    """Womit ein Titel aus der Warteschlange gestartet wird (rein, testbar).

    Der Weg über den Kontext ist der bessere: Spotify springt in der
    Playlist an die Stelle, und danach geht es weiter, wie es weiterging.
    Mit einer blossen Titelliste endet die Musik nach dem letzten
    mitgeschickten Titel - und mitgeschickt sind nur die fünfzehn, die in
    der App stehen.

    Ohne Kontext gibt es diesen Weg nicht: Wer einzelne Titel von Hand in
    die Schlange gestellt hat, spielt aus keiner Playlist. Dann geht der
    gewählte Titel samt allem, was danach kommt, als Liste hinaus - so
    bleibt wenigstens die Reihenfolge, die man vor sich sieht.
    """
    if context_uri:
        return {"context_uri": context_uri, "offset": {"uri": uri}}
    return {"uris": [uri, *folgende]}


def folgende_uris(queue: Any, uri: str) -> list[str]:
    """Was in der Warteschlange nach diesem Titel steht (rein, testbar).

    Steht derselbe Titel zweimal in der Schlange, zählt der erste - mehr
    weiss ein Tipp auf eine Zeile nicht, und der zweite kommt so oder so
    noch.
    """
    eintraege = [
        str(eintrag.get("uri") or "")
        for eintrag in (queue if isinstance(queue, list) else [])
        if isinstance(eintrag, dict) and eintrag.get("uri")
    ]
    if uri not in eintraege:
        return []
    return eintraege[eintraege.index(uri) + 1 :]


def parse_playback(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Übersetzt /me/player in Entitäts-Attribute.

    Kein Payload heisst: nirgends läuft etwas – das ist ein normaler
    Zustand, keine Störung.
    """
    if not payload:
        return {
            # Nichts läuft irgendwo - das ist kein «gleich geht es
            # weiter», sondern Ruhe. Dieselbe Unterscheidung wie bei Cast.
            "state": "standby",
            "track": None,
            "artist": None,
            "image": None,
            "device": None,
            "context_uri": None,
            "shuffle": False,
            "repeat": "off",
            "queue": [],
            "progress": None,
            "duration": None,
        }
    item = payload.get("item") or {}
    device = payload.get("device") or {}
    result = {
        "state": "playing" if payload.get("is_playing") else "paused",
        "track": item.get("name"),
        "artist": kuenstler(item),
        # Albumcover für die Player-Karte. Spotify liefert mehrere Grössen,
        # gross zuerst - die mittlere reicht für eine Kachel und spart Daten.
        "image": album_image((item.get("album") or {}).get("images") or []),
        "device": device.get("name"),
        # Woraus gerade gespielt wird. Spotify nennt hier nur die URI –
        # den Namen kennt erst, wer die Playlists des Kontos hat.
        "context_uri": (payload.get("context") or {}).get("uri"),
        "shuffle": bool(payload.get("shuffle_state")),
        # Spotify sagt «off», «track» oder «context»; die App und der
        # Cast-Player sprechen off/one/all. Übersetzt wird hier, damit
        # eine Kachel nicht je nach Quelle andere Wörter zeigt.
        "repeat": repeat_name(payload.get("repeat_state")),
        # Spotify kann in jedem Titel springen - Cast nicht immer.
        "can_seek": True,
    }
    # Wie weit der Titel ist und wie lang er dauert, in Sekunden – Spotify
    # rechnet in Millisekunden. Damit weiss der Hub, wann der nächste
    # Titel beginnt (siehe `naechster_blick`).
    def _sekunden(roh: Any) -> int | None:
        try:
            return int(roh) // 1000 if roh is not None else None
        except (TypeError, ValueError):
            return None

    result["progress"] = _sekunden(payload.get("progress_ms"))
    # Derselbe Wert unter dem Namen, den auch Cast benutzt. «progress»
    # bleibt, weil Abläufe und Szenen darauf zeigen können.
    result["position"] = result["progress"]
    result["duration"] = _sekunden(item.get("duration_ms"))
    if result["position"] is not None:
        # Wann gemessen wurde - sonst stünde der Balken zwischen zwei
        # Abfragen still, statt weiterzulaufen.
        result["position_at"] = round(time.time(), 1)
    volume = device.get("volume_percent")
    if volume is not None:
        result["volume"] = int(volume)
    return result


def naechster_blick(
    state: dict[str, Any],
    takt: float,
    mindestens: float = 2.0,
    puffer: float = 1.5,
) -> float:
    """Wann lohnt der nächste Blick auf Spotify? (rein, testbar)

    Der Fall: «Wenn der Medienplayer das Lied wechselt, dauert es ein
    paar Sekunden, bis das neue Cover und der neue Titel angezeigt
    werden.» Kein Wunder – der Hub fragte in festem Takt und erfuhr vom
    Wechsel erst beim nächsten Mal.

    Spotify sagt aber, wie weit der Titel ist und wie lang er dauert.
    Damit lässt sich der Wechsel vorhersehen: einmal genau dann
    nachfragen, wenn er passiert, statt den Takt für alle zu
    beschleunigen. Im Leerlauf ändert sich nichts, beim Hören kostet es
    eine Abfrage je Titel – etwa eine alle drei Minuten.

    Der Puffer ist Absicht: Genau auf die Sekunde gefragt, läuft der alte
    Titel manchmal noch. Anderthalb Sekunden später ist der neue da, und
    das ist immer noch ein Vielfaches schneller als der halbe Takt.

    Was pausiert oder still ist, bekommt den normalen Takt: Dort wechselt
    nichts von selbst.
    """
    if str(state.get("state") or "") != "playing":
        return takt
    try:
        dauer = float(state.get("duration") or 0)
        stand = float(state.get("progress") or 0)
    except (TypeError, ValueError):
        return takt
    if dauer <= 0:
        return takt
    rest = dauer - stand
    if rest <= 0:
        return mindestens
    return max(mindestens, min(takt, rest + puffer))


# Reihenfolge beim Durchtippen: aus → alles → ein Titel → aus. Das sind
# genau die Werte, die Spotify für /me/player/repeat annimmt.
REPEAT_MODES = ("off", "context", "track")

#: Spotifys Wörter ↔ die drei Namen, die App und Cast benutzen.
REPEAT_NAMEN = {"off": "off", "context": "all", "track": "one"}
REPEAT_API = {"off": "off", "all": "context", "one": "track"}


def repeat_name(wert: Any) -> str:
    """Spotifys Wiederholmodus auf off/all/one bringen (rein, testbar).

    Unbekanntes gilt als «aus»: Ein Knopf, der nichts anzeigt, ist
    ehrlicher als einer, der eine Vermutung anzeigt.
    """
    return REPEAT_NAMEN.get(str(wert or "off").strip().lower(), "off")


def repeat_api(wert: Any) -> str | None:
    """Rückweg: off/all/one → das Wort für /me/player/repeat.

    Nimmt auch Spotifys eigene Wörter an - so bricht ein Ablauf nicht,
    der noch «context» schickt.
    """
    name = str(wert or "").strip().lower()
    if name in REPEAT_MODES:
        return name
    return REPEAT_API.get(name)


def next_repeat(current: str) -> str:
    """Der nächste Wiederholmodus beim Antippen (rein, testbar).

    Läuft in den Namen der App - aus/alles/ein Titel -, nicht in denen
    von Spotify.
    """
    reihe = ("off", "all", "one")
    jetzt = repeat_name(current) if current in REPEAT_MODES else str(current or "off")
    try:
        return reihe[(reihe.index(jetzt) + 1) % len(reihe)]
    except ValueError:
        return reihe[1]


def playlist_name(
    context_uri: str | None, playlists: list[dict[str, Any]]
) -> str | None:
    """Die laufende Playlist benennen (rein, testbar).

    Spotify meldet beim Abspielen nur eine Kontext-URI. Ein Album oder die
    Songradio hat keinen Playlist-Namen – dann bleibt es bei None, statt
    irgendetwas zu behaupten.
    """
    if not context_uri:
        return None
    for entry in playlists:
        if entry.get("uri") == context_uri:
            return str(entry.get("name"))
    return None


class SpotifyIntegration(Integration):
    name = "spotify"

    async def setup(self) -> None:
        self._client_id = self.config.get("client_id")
        self._client_secret = self.config.get("client_secret")
        self._refresh_token = self.config.get("refresh_token")
        if not self._refresh_token:
            # Vom Anmelde-Helfer abgelegt (siehe Kopf dieser Datei).
            self._refresh_token = tokenstore.value(
                tokenstore.token_file(self.hub.config.data_file, self.config, "spotify"),
                "refresh_token",
            )
        if not (self._client_id and self._client_secret and self._refresh_token):
            raise ConfigError(
                "spotify braucht 'client_id' und 'client_secret'; den refresh_token "
                "erzeugt der Anmelde-Helfer: "
                "python -m homepilot.integrations.spotify -c config.yaml"
            )

        # sp_dc-Cookie (optional): nur fürs Wecken schlafender Cast-Boxen.
        self._sp_dc = self.config.get("sp_dc")
        if not self._sp_dc:
            token_file = Path(self.hub.config.data_file).parent / "spotify-token.json"
            if token_file.exists():
                self._sp_dc = jsonlib.loads(token_file.read_text()).get("sp_dc")
        self._webplayer = None
        if self._sp_dc:
            from .spotify_webplayer import WebPlayerAuth

            self._webplayer = WebPlayerAuth(self._sp_dc)

        self._interval = self.scan_interval()
        # Wie lange bis zum nächsten Blick. Wird nach jedem Abruf neu
        # gesetzt: Beim Hören genau auf den Titelwechsel, sonst der
        # normale Takt.
        self._naechster = self._interval
        # Wann die Playlisten zuletzt geholt wurden – nach der Uhr, nicht
        # nach Runden (siehe _takt).
        self._playlists_geholt = time.monotonic()
        self._session = self.http_session(timeout=aiohttp.ClientTimeout(total=15))
        self._access_token: str | None = None
        self._token_expires_at = 0.0

        await self.add_entity(
            "player",
            EntityKind.MEDIA_PLAYER,
            self.config.get("name", "Spotify"),
            state={"state": "idle"},
            commands=[
                "play", "pause", "toggle", "next", "previous", "play_on",
                "set_volume", "volume_up", "volume_down", "mute", "play_playlist",
                "shuffle", "repeat", "play_queue",
                # Springen im Titel - dieselbe Bedienung wie bei Cast.
                "seek",
            ],
            available=False,
        )
        # Gerätename → Spotify-Connect-ID, für play_on.
        self._device_ids: dict[str, str] = {}
        # Name → Playlist-URI, für play_playlist.
        self._playlists: list[dict[str, Any]] = []
        # Läuft nach einem Befehl kurz nach (siehe _settle).
        self._settle_task: asyncio.Task | None = None
        await self._load_playlists()
        await self._refresh()
        self.start_polling(self._takt, interval=lambda: self._naechster)

    async def teardown(self) -> None:
        if self._settle_task is not None:
            self._settle_task.cancel()
            self._settle_task = None
        await super().teardown()

    async def _load_playlists(self) -> None:
        """Alle Playlisten des Kontos holen (mehrere Seiten à 50)."""
        try:
            playlists: list[dict[str, Any]] = []
            offset = 0
            while offset < 200:
                payload = await self._call(
                    "GET", f"/me/playlists?limit=50&offset={offset}"
                )
                page = parse_playlists(payload)
                playlists.extend(page)
                if len(page) < 50:
                    break
                offset += 50
            self._playlists = playlists
            if not playlists:
                self.log.warning(
                    "Spotify meldet keine Playlisten – fehlen dem refresh_token "
                    "die playlist-read-Scopes? (Einrichtung im Kopf von spotify.py)"
                )
        except Exception as err:
            self.log.warning("Spotify-Playlisten nicht abrufbar: %s", err)

    # ── Anmeldung ──────────────────────────────────────────────────────────

    async def _ensure_token(self) -> str:
        loop = asyncio.get_running_loop()
        if self._access_token and loop.time() < self._token_expires_at:
            return self._access_token
        async with self._session.post(
            ACCOUNTS,
            data={"grant_type": "refresh_token", "refresh_token": self._refresh_token},
            auth=aiohttp.BasicAuth(self._client_id, self._client_secret),
        ) as response:
            if response.status >= 400:
                raise ConnectionError(
                    f"Spotify-Token-Erneuerung fehlgeschlagen ({response.status})"
                )
            payload = await response.json()
        self._access_token = payload["access_token"]
        # Etwas vor Ablauf erneuern, damit kein Aufruf ins Leere läuft.
        self._token_expires_at = loop.time() + float(payload.get("expires_in", 3600)) * 0.9
        return self._access_token

    async def _call(
        self, method: str, path: str, json: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        token = await self._ensure_token()
        async with self._session.request(
            method, f"{API}{path}", headers={"Authorization": f"Bearer {token}"}, json=json
        ) as response:
            # 204: nichts läuft. 404: kein aktives Gerät – beim Steuern
            # möglich, wenn überall Stille ist.
            if response.status in (204, 404):
                return None
            response.raise_for_status()
            if response.content_type == "application/json":
                return await response.json()
            return None

    # ── Spotify → Hub ──────────────────────────────────────────────────────

    async def _takt(self) -> None:
        await self._refresh()
        # Neue Playlisten tauchen ohne Neustart auf (~halbstündlich).
        #
        # Nach der Uhr, nicht nach Runden: Seit der Takt beim Hören auf
        # den Titelwechsel springt, sind Runden verschieden lang – bei
        # drei Minuten je Titel kämen sie doppelt so schnell, und die
        # Playlisten würden öfter geholt als gedacht.
        jetzt = time.monotonic()
        if jetzt - self._playlists_geholt >= PLAYLIST_TAKT:
            self._playlists_geholt = jetzt
            await self._load_playlists()

    async def _refresh(self) -> None:
        entity_id = self.entity_id("player")
        try:
            # Nebenläufig: Die beiden Abfragen wissen nichts voneinander,
            # nacheinander wären sie schlicht doppelt so langsam – und das
            # bei jedem einzelnen Befehl.
            payload, device_payload = await asyncio.gather(
                self._call("GET", "/me/player"),
                self._call("GET", "/me/player/devices"),
            )
            devices = parse_devices(device_payload)
        except Exception as err:
            self.log.warning("Spotify nicht erreichbar: %s", err)
            # Zurück zum normalen Takt: Stand der nächste Blick gerade auf
            # zwei Sekunden (kurz vor einem Titelwechsel), liefe der Hub
            # sonst im Sekundentakt gegen einen Dienst, der ohnehin nicht
            # antwortet.
            self._naechster = self._interval
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return
        self._device_ids = {device["name"]: device["id"] for device in devices}
        state = parse_playback(payload)
        state["devices"] = merge_device_names(
            [device["name"] for device in devices], self._cast_names()
        )
        # Welche davon echte Google-Gruppen sind. Die App setzt die
        # Marke daneben; ohne sie sieht eine Gruppe aus wie eine Box.
        state["device_groups"] = self._cast_groups()
        state["playlists"] = [p["name"] for p in self._playlists]
        state["playlist"] = playlist_name(state.get("context_uri"), self._playlists)
        state["queue"] = await self._warteschlange(state.get("state"))
        # Den nächsten Blick auf den Titelwechsel legen: Sonst steht das
        # alte Cover noch, bis der feste Takt wieder herumkommt.
        self._naechster = naechster_blick(state, self._interval)
        await self.hub.registry.update_state(entity_id, state, available=True)

    async def _warteschlange(self, zustand: Any) -> list[dict[str, Any]]:
        """Was als Nächstes kommt – nur solange etwas läuft.

        Ein dritter Abruf bei jedem Takt, und das rund um die Uhr, wäre
        für eine Liste, die niemand ansieht, zu viel. Steht die Musik,
        gibt es auch keine Warteschlange.

        Scheitert der Abruf, bleibt die Liste leer statt den ganzen
        Zustand mitzureissen: Manche Konten geben den Endpunkt nicht her,
        und dann soll immer noch stehen, was gerade läuft.
        """
        if zustand not in ("playing", "paused"):
            return []
        try:
            return parse_queue(await self._call("GET", "/me/player/queue"))
        except Exception as err:
            self.log.debug("Spotify-Warteschlange nicht abrufbar: %s", err)
            return []

    async def _load_devices(self) -> dict[str, str]:
        """Die Connect-Geräte frisch holen. Ein Aufruf, wenige hundert
        Millisekunden – und deutlich billiger als voreilig zu wecken."""
        devices = parse_devices(await self._call("GET", "/me/player/devices"))
        self._device_ids = {device["name"]: device["id"] for device in devices}
        return self._device_ids

    # Nach einem Befehl mehrfach nachfragen statt einmal: Spotify meldet den
    # neuen Zustand nicht sofort – /me/player nennt direkt nach dem Start oft
    # noch den alten Titel. Ohne Nachhaken stünde in der App bis zum nächsten
    # Poll (30 s) der falsche Zustand.
    SETTLE_DELAYS = (0.5, 1.5, 4.0)

    async def _settle(self) -> None:
        for delay in self.SETTLE_DELAYS:
            await asyncio.sleep(delay)
            await self._refresh()

    def _start_settle(self) -> None:
        """Nachhaken im Hintergrund anstossen – der Befehl ist damit fertig.

        Der Aufrufer wartet nicht mehr auf Spotifys Rückmeldung: Die Kachel
        zeigt sofort, was gleich läuft, und wird korrigiert, sobald Spotify
        so weit ist."""
        if self._settle_task is not None and not self._settle_task.done():
            self._settle_task.cancel()
        self._settle_task = asyncio.create_task(self._settle())

    async def _shuffle(self, on: bool, device_id: str | None = None) -> None:
        """Die Reihenfolge umstellen, notfalls auf einer bestimmten Box.

        Die Box mitzugeben ist der Unterschied zwischen «geht» und «404»:
        Ohne `device_id` meint Spotify das gerade aktive Gerät – und wenn
        eine Szene aus der Stille heraus startet, gibt es keins.
        """
        ziel = f"&device_id={device_id}" if device_id else ""
        await self._call("PUT", f"/me/player/shuffle?state={'true' if on else 'false'}{ziel}")

    async def _announce(self, state: dict[str, Any]) -> None:
        """Melden, was gleich läuft – und die Wahrheit nachreichen.

        Ein Befehl gilt damit als erledigt, sobald Spotify ihn angenommen
        hat. Vorher wartete der Aufrufer noch auf eine Abfrage, die den
        neuen Zustand ohnehin meist noch nicht kannte: In der App blieb die
        Kachel «wird geschaltet», obwohl die Musik längst lief.
        """
        await self.hub.registry.update_state(
            self.entity_id("player"), state, available=True
        )
        self._start_settle()

    def _device_name(self, device_id: str) -> str | None:
        return next(
            (name for name, value in self._device_ids.items() if value == device_id), None
        )

    async def _cast_lautstaerke(self, entity: Entity, prozent: int) -> bool:
        """Die Lautstärke über Cast setzen, wenn das Ziel eine Cast-Box ist.

        Rückgabe: ob es dieser Weg war. False heisst «nicht zuständig» –
        dann geht es wie bisher über Spotify (Telefon, Rechner, Sonos).
        """
        name = str(entity.state.get("device") or "")
        cast = self.hub.integrations.get("google_cast")
        if not name or cast is None or not hasattr(cast, "lautstaerke_setzen"):
            return False
        try:
            return bool(await cast.lautstaerke_setzen(name, prozent))
        except Exception as err:
            self.log.debug("Lautstärke über Cast misslungen (%s): %s", name, err)
            return False

    async def _gruppen_lautstaerke_wiederherstellen(self, name: str) -> None:
        """Nach dem Umziehen die Lautstärke des **Ziels** durchsetzen.

        Spotify nimmt beim Umziehen die Lautstärke des bisherigen Geräts
        mit. Das ist bei zwei Telefonen egal und bei einer Gruppe falsch:
        Wer die Küchenbox auf 15 % laufen hatte und dann auf «Ganze
        Wohnung» wechselt, bekam die ganze Wohnung auf 15 %, obwohl die
        Gruppe auf 40 % stand. Was das Ziel selbst sagt, gilt.
        """
        cast = self.hub.integrations.get("google_cast")
        if cast is None or not hasattr(cast, "lautstaerke_von"):
            return
        try:
            eigene = cast.lautstaerke_von(name)
            if eigene is not None:
                await cast.lautstaerke_setzen(name, eigene)
        except Exception as err:
            self.log.debug("Lautstärke von %s nicht wiederhergestellt: %s", name, err)

    def _cast_groups(self) -> list[str]:
        cast = self.hub.integrations.get("google_cast")
        if cast is None or not hasattr(cast, "group_names"):
            return []
        try:
            return list(cast.group_names())
        except Exception:
            return []

    def _cast_names(self) -> list[str]:
        cast = self.hub.integrations.get("google_cast")
        if cast is None or not hasattr(cast, "device_names"):
            return []
        try:
            return cast.device_names()
        except Exception:
            return []

    async def _wake_and_find(self, name: str) -> str | None:
        """Weckt eine schlafende Cast-Box und wartet, bis Spotify sie kennt."""
        cast = self.hub.integrations.get("google_cast")
        if cast is None or not hasattr(cast, "spotify_wake"):
            return None
        if self._webplayer is None:
            self.log.warning(
                "Box '%s' schläft, aber ohne sp_dc-Cookie lässt sie sich nicht "
                "wecken. Cookie eintragen: docs/spotify-boxen-wecken.md",
                name,
            )
            return None
        try:
            token = await self._webplayer.token(self._session)
        except Exception as err:
            self.log.warning("Web-Player-Token fürs Wecken nicht erhältlich: %s", err)
            return None
        try:
            woken = await cast.spotify_wake(name, token)
        except Exception as err:
            # Ein Fehler beim Wecken darf nie als roher Traceback in der App
            # landen – der Grund steht im Log der Cast-Integration.
            self.log.warning("Wecken von %s fehlgeschlagen: %s", name, err)
            return None
        if not woken:
            return None
        # Sofort nachsehen und dann eng nachfassen: Die Box meldet sich meist
        # innerhalb einer Sekunde bei Spotify an. Eine feste Sekunde Pause vor
        # dem ersten Blick hat diese Zeit früher verschenkt.
        deadline = asyncio.get_running_loop().time() + 12
        while True:
            try:
                if name in await self._load_devices():
                    return self._device_ids[name]
            except Exception:
                pass
            if asyncio.get_running_loop().time() >= deadline:
                return None
            await asyncio.sleep(0.3)

    # ── Hub → Spotify ──────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        if command == "play_on":
            name = str(data.get("device", ""))
            device_id = self._device_ids.get(name)
            # Schlafende Cast-Box: Sie taucht in Spotify erst auf, wenn sie
            # geweckt ist. Ohne diesen Schritt liess sich die Musik auf jede
            # Box umziehen – ausser auf eine, die gerade still ist, also
            # meistens genau die gewünschte.
            if device_id is None and name:
                # Vorher einmal frisch nachfragen: Die gemerkte Liste ist bis
                # zu einem Poll-Intervall alt, die Box also womöglich längst
                # wach. Das kostet Millisekunden, das Wecken kostet Sekunden.
                device_id = (await self._load_devices()).get(name)
            if device_id is None and name:
                device_id = await self._wake_and_find(name)
            if device_id is None:
                raise ValueError(
                    f"'{name}' ist nicht erreichbar. Sichtbar sind: "
                    f"{', '.join(self._device_ids) or 'keine'}"
                )
            # Spotify Connect zieht die Wiedergabe nahtlos um. «play» folgt
            # dem bisherigen Zustand: Was lief, läuft weiter; was pausiert
            # war, bleibt pausiert und startet dort, wo man es erwartet.
            keep_playing = bool(data.get("play", True))
            await self._call(
                "PUT", "/me/player", json={"device_ids": [device_id], "play": keep_playing}
            )
            ziel = self._device_name(device_id) or name
            await self._gruppen_lautstaerke_wiederherstellen(ziel)
            await self._announce({"device": ziel})
            return
        if command == "play_playlist":
            name = str(data.get("name", ""))
            uri = data.get("uri") or next(
                (p["uri"] for p in self._playlists if p["name"] == name), None
            )
            if not uri:
                raise ValueError(f"Unbekannte Playlist '{name}'")
            body: dict[str, Any] = {"context_uri": uri}
            # Ziel: gewünschte Box → gerade aktive → erste sichtbare. Ohne
            # Ziel würde Spotify aus der Stille heraus mit 404 abwinken.
            requested = str(data.get("device", ""))
            if requested:
                # Eine ausdrücklich genannte Box ist eine Ansage, keine
                # Anregung. Hier stand ein Rückfall auf «gerade aktiv»
                # oder «die erste sichtbare», und genau daran hing der
                # Fehler mit den Lautsprechergruppen: Kannte Spotify die
                # Gruppe im Moment des Starts nicht, spielte die Musik
                # kommentarlos auf der Box weiter, die ohnehin schon lief
                # - also gerade nicht auf denen, die in Google Home in
                # der Gruppe stehen. Ein Fehler, den man sieht, ist
                # besser als Musik im falschen Zimmer.
                device_id = self._device_ids.get(requested)
                if device_id is None:
                    # Erst die frische Geräteliste – wecken nur, wenn sie
                    # die Box wirklich nicht kennt (siehe play_on).
                    device_id = (await self._load_devices()).get(requested)
                if device_id is None:
                    device_id = await self._wake_and_find(requested)
                if device_id is None:
                    raise ValueError(
                        f"'{requested}' liess sich nicht erreichen – Musik "
                        "läuft darum nirgends, statt im falschen Zimmer. "
                        "Sichtbar sind: "
                        f"{', '.join(self._device_ids) or 'keine'}. Details im "
                        "Hub-Log (docker logs homepilot-hub | grep -i spotify)"
                    )
            else:
                device_id = pick_device(
                    requested, entity.state.get("device"), self._device_ids
                )
            if device_id is None:
                raise ValueError(
                    "Keine Spotify-Lautsprecher sichtbar. Google-Lautsprecher "
                    "erscheinen, wenn in der Google-Home-App Spotify verknüpft "
                    "ist; sonst einmal die Spotify-App im selben Netz öffnen."
                )
            mischen = shuffle_wunsch(data)
            if mischen is not None:
                # Zweimal, und das mit Absicht. Vor dem Start gilt der
                # Wunsch für die Playlist selbst – sonst beginnt «Party»
                # jeden Abend mit demselben Titel. Schläft die Box aber
                # noch, kennt Spotify sie nicht als aktiv und antwortet
                # mit 404 (`_call` gibt dann None zurück, kein Fehler).
                # Darum nach dem Start noch einmal: Dann ist sie wach,
                # und wenigstens ab dem zweiten Titel stimmt es.
                await self._shuffle(mischen, device_id)
            await self._call("PUT", f"/me/player/play?device_id={device_id}", json=body)
            if mischen is not None:
                await self._shuffle(mischen, device_id)
            await self._announce(
                {
                    "state": "playing",
                    "context_uri": uri,
                    "playlist": playlist_name(uri, self._playlists) or name or None,
                    "device": self._device_name(device_id) or requested or None,
                    **({"shuffle": mischen} if mischen is not None else {}),
                }
            )
            return

        if command == "play_queue":
            uri = str(data.get("uri") or "").strip()
            if not uri:
                raise ValueError("play_queue braucht die 'uri' des Titels")
            # Ohne Zielgerät antwortet Spotify aus der Stille heraus mit
            # 404 - und das nur, wenn gerade wirklich nichts läuft.
            device_id = pick_device("", entity.state.get("device"), self._device_ids)
            ziel = f"?device_id={device_id}" if device_id else ""
            folgende = folgende_uris(entity.state.get("queue"), uri)
            context = str(entity.state.get("context_uri") or "")
            try:
                await self._call(
                    "PUT", f"/me/player/play{ziel}", json=play_body(uri, context, folgende)
                )
            except Exception as err:
                if not context:
                    raise
                # Der Titel steht in der Schlange, aber nicht in der
                # Playlist - von Hand dazugestellt oder von Spotifys
                # Autoplay angehängt. Dann weist der Kontext-Weg ihn ab,
                # und die Titelliste ist das, was bleibt.
                self.log.info(
                    "Spotify: '%s' liegt nicht in der laufenden Playlist (%s) - "
                    "als Titelliste gestartet",
                    uri,
                    err,
                )
                await self._call(
                    "PUT", f"/me/player/play{ziel}", json=play_body(uri, None, folgende)
                )
            # Wie der Titel heisst, weiss die Warteschlange schon - so
            # steht der neue Name in der Karte, bevor Spotify antwortet.
            gewaehlt = next(
                (
                    eintrag
                    for eintrag in (entity.state.get("queue") or [])
                    if isinstance(eintrag, dict) and eintrag.get("uri") == uri
                ),
                {},
            )
            await self._announce(
                {
                    "state": "playing",
                    "track": gewaehlt.get("track") or entity.state.get("track"),
                    "artist": gewaehlt.get("artist"),
                }
            )
            return

        if command == "shuffle":
            # Ohne Angabe umschalten – so genügt ein Tipp in der App.
            target = data.get("on")
            on = (not bool(entity.state.get("shuffle"))) if target is None else bool(target)
            await self._shuffle(on)
            await self._announce({"shuffle": on})
            return

        if command == "repeat":
            gewuenscht = str(
                data.get("mode")
                or data.get("repeat")
                or next_repeat(str(entity.state.get("repeat") or "off"))
            )
            mode = repeat_api(gewuenscht)
            if mode is None:
                raise ValueError(f"Unbekannter Wiederholmodus '{gewuenscht}'")
            await self._call("PUT", f"/me/player/repeat?state={mode}")
            await self._announce({"repeat": repeat_name(mode)})
            return

        if command == "seek":
            # Springen im laufenden Titel. Spotify rechnet in
            # Millisekunden und lehnt Werte hinter dem Ende ab.
            try:
                ziel = float(data.get("position"))
            except (TypeError, ValueError):
                raise ValueError("seek braucht eine 'position' in Sekunden") from None
            laenge = entity.state.get("duration")
            if laenge:
                ziel = min(ziel, max(0.0, float(laenge) - 1))
            ziel = max(0.0, ziel)
            await self._call("PUT", f"/me/player/seek?position_ms={int(ziel * 1000)}")
            await self._announce({"position": round(ziel, 1), "position_at": round(time.time(), 1)})
            return

        if command == "toggle":
            command = "pause" if entity.state.get("state") == "playing" else "play"

        if command in ("set_volume", "volume_up", "volume_down", "mute"):
            current = int(entity.state.get("volume", 50) or 0)
            if command == "set_volume":
                target = int(data.get("volume", current))
            elif command == "volume_up":
                target = current + int(data.get("step", 10))
            elif command == "volume_down":
                target = current - int(data.get("step", 10))
            else:  # mute: auf 0 bzw. zurück auf die gemerkte Lautstärke
                if current > 0:
                    self._volume_before_mute = current
                    target = 0
                else:
                    target = getattr(self, "_volume_before_mute", 30)
            target = max(0, min(100, target))
            # Erst über Cast, dann über Spotify: Für Google-Boxen und
            # erst recht für Gruppen antwortet Spotify auf
            # `PUT /me/player/volume` mit «VOLUME_CONTROL_DISALLOWED».
            # Der Regler bewegte sich, und niemand wurde lauter.
            if not await self._cast_lautstaerke(entity, target):
                await self._call("PUT", f"/me/player/volume?volume_percent={target}")
            await self._announce({"volume": target})
            return

        routes = {
            "play": ("PUT", "/me/player/play"),
            "pause": ("PUT", "/me/player/pause"),
            "next": ("POST", "/me/player/next"),
            "previous": ("POST", "/me/player/previous"),
        }
        method, path = routes[command]
        await self._call(method, path)
        # Bei Titelwechseln kennt der Hub den neuen Titel noch nicht – da
        # bleibt nur das Nachhaken. Play/Pause dagegen sind sofort klar.
        known = {"play": {"state": "playing"}, "pause": {"state": "paused"}}
        await self._announce(known.get(command, {}))


INTEGRATION = SpotifyIntegration


# ── Anmelde-Helfer ─────────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.spotify -c config.yaml
# Fragt nach dem Zustimmen im Browser nach der Redirect-Adresse und legt den
# refresh_token in spotify-token.json neben der homepilot-data.json ab.


async def _login_main(config_path: str) -> int:
    import aiohttp

    from ..core.config import load_config
    from ..core.errors import ConfigError as _ConfigError

    blocks: list[dict[str, Any]] = []
    data_dir = Path(config_path).parent
    try:
        config = load_config(config_path)
        data_dir = Path(config.data_file).parent
        blocks = [
            b for b in config.integrations if b.get("integration") == "spotify"
        ]
    except _ConfigError as err:
        # Z.B. weil ${SPOTIFY_CLIENT_ID} noch nicht gesetzt ist – dann eben
        # von Hand eintippen statt abzubrechen.
        print(f"(Konfiguration nicht lesbar: {err} – Werte bitte eingeben)")

    client_id = (blocks[0].get("client_id") if blocks else None) or input(
        "Spotify Client-ID: "
    ).strip()
    client_secret = (blocks[0].get("client_secret") if blocks else None) or input(
        "Spotify Client-Secret: "
    ).strip()
    if not client_id or not client_secret:
        print("✗ Client-ID und Client-Secret sind nötig (developer.spotify.com).")
        return 1

    auth_url = (
        f"{AUTHORIZE}?client_id={quote(client_id)}&response_type=code"
        f"&redirect_uri={quote(REDIRECT)}&scope={quote(SCOPES)}"
    )
    print("\n1. Diese Adresse im Browser öffnen und zustimmen:\n")
    print(f"   {auth_url}\n")
    print(
        "2. Danach erscheint «Seite nicht erreichbar» – das ist richtig so.\n"
        "   Die KOMPLETTE Adresse aus der Adresszeile kopieren und hier einfügen\n"
        "   (der Code darin gilt nur wenige Minuten):"
    )
    code = extract_code(input("\nAdresse oder Code: "))

    async with aiohttp.ClientSession() as session, session.post(
        ACCOUNTS,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT,
        },
        auth=aiohttp.BasicAuth(client_id, client_secret),
    ) as response:
        payload = await response.json(content_type=None)

    error = payload.get("error")
    if error == "invalid_client":
        print(
            "✗ Spotify lehnt Client-ID/Secret ab (invalid_client).\n"
            "  Im Dashboard (developer.spotify.com) unter Settings das Secret\n"
            "  mit «View client secret» frisch kopieren – oder rotieren, wenn\n"
            "  es irgendwo geteilt wurde – und den Helfer erneut starten."
        )
        return 1
    if error == "invalid_grant":
        print("✗ Der Code war abgelaufen oder schon benutzt – bitte nochmals "
              "bei Schritt 1 beginnen und zügig einfügen.")
        return 1
    refresh_token = payload.get("refresh_token")
    if not refresh_token:
        print(f"✗ Kein refresh_token erhalten: {payload}")
        return 1

    stored: dict[str, str] = {"refresh_token": refresh_token}

    # Optionaler dritter Schritt: das sp_dc-Cookie fürs Wecken schlafender
    # Google-/Cast-Boxen (ohne offene Spotify-App).
    print(
        "\n3. (Optional) Google-/Cast-Boxen aus dem Ruhezustand starten:\n"
        "   Dafür braucht der Hub das Cookie 'sp_dc' aus einer Browser-\n"
        "   Sitzung. In Chrome: open.spotify.com öffnen und einloggen → F12\n"
        "   → «Application» → «Cookies» → open.spotify.com → Zeile 'sp_dc' →\n"
        "   den Wert kopieren. Leer lassen und Enter, wenn nicht gewünscht."
    )
    sp_dc = input("\nsp_dc (optional): ").strip()
    if sp_dc:
        stored["sp_dc"] = sp_dc

    token_file = data_dir / "spotify-token.json"
    tokenstore.save(token_file, stored)
    print(f"\n✓ Angemeldet. Token gespeichert in {token_file}.")
    if sp_dc:
        print("  Mit sp_dc: schlafende Boxen werden beim Playlist-Start geweckt.")
    print("  Jetzt den Hub neu starten – die Spotify-Kachel erscheint mit "
          "Playlists und Lautsprechern.")
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Spotify-Anmeldung für HomePilot")
    parser.add_argument(
        "-c", "--config", default="config.yaml", help="Pfad zur config.yaml des Hubs"
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(_login_main(args.config)))
