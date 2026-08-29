"""Radio über TuneIn: vom Suchtreffer bis zum Ton auf der Box.

Die Antworten in diesem Test sind gekürzte, aber echte Antworten von
opml.radiotime.com (SRF 3, Radio Pilatus). Das ist der Punkt: Zwei Dinge
daran sind überraschend, und beide fielen ohne Test erst im Wohnzimmer
auf – dass eine Suche auch Sendungen zurückgibt, die man nicht abspielen
kann, und dass die «Sendeadresse» meistens eine Wiedergabeliste ist.
"""

from typing import Any

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.tunein import (
    ANSPRUCH_SEKUNDEN,
    Station,
    Stream,
    TuneInIntegration,
    claim_haelt,
    content_type_for,
    ist_wiedergabeliste,
    merge_stations,
    parse_playlist,
    parse_search,
    parse_stations,
    parse_tune,
    pick_speaker,
    titel_und_interpret,
)

# Gekürzte echte Antwort auf Search.ashx?query=SRF 3
SUCHE = {
    "head": {"title": "Search Results: srf 3", "status": "200"},
    "body": [
        {
            "element": "outline",
            "type": "audio",
            "text": "SRF 3",
            "guide_id": "s24862",
            "subtext": "Sounds!",
            "item": "station",
            "image": "http://cdn-profiles.tunein.com/s24862/images/logoq.png",
            "bitrate": "128",
        },
        {
            "element": "outline",
            "type": "link",
            "text": "Ein Fall fur SRF 3",
            "guide_id": "p3338171",
            "item": "show",
            "image": "http://cdn-profiles.tunein.com/p3338171/images/logoq.png",
        },
        {
            # Gesperrt: TuneIn liefert dafür eine MP3, die vorliest, dass
            # der Sender im eigenen Land nicht verfügbar sei.
            "element": "outline",
            "type": "audio",
            "text": "Bandit Ballads - Not Supported",
            "URL": "http://cdn-cms.tunein.com/service/Audio/georestricted.enUS.mp3",
            "guide_id": "s307993",
            "subtext": "Not available in your country",
            "key": "unavailable",
            "item": "station",
        },
        {
            "element": "outline",
            "text": "Weitere Ergebnisse",
            "children": [
                {
                    "element": "outline",
                    "type": "audio",
                    "text": "SRF 3 (Digital)",
                    "guide_id": "s99999",
                    "item": "station",
                }
            ],
        },
    ],
}

# Gekürzte echte Antwort auf Tune.ashx?id=s24862
TUNE = {
    "head": {"status": "200"},
    "body": [
        {
            "element": "audio",
            "url": "https://stream.srg-ssr.ch/drs3/mp3_128.m3u",
            "reliability": 65,
            "bitrate": 128,
            "media_type": "mp3",
            "playlist_type": "m3u",
            "is_direct": False,
        },
        {
            "element": "audio",
            "url": "http://stream.srg-ssr.ch/drs3/mp3_128.m3u",
            "reliability": 99,
            "bitrate": 128,
            "media_type": "mp3",
            "playlist_type": "m3u",
            "is_direct": False,
        },
    ],
}


def test_search_returns_stations_and_not_shows():
    """Eine Suche nach «SRF 3» findet den Sender, eine Sendung gleichen
    Namens, einen gesperrten Sender und eine Rubrik. Nur zwei davon
    lassen sich abspielen."""
    treffer = parse_search(SUCHE)
    assert [station.name for station in treffer] == ["SRF 3", "SRF 3 (Digital)"]
    assert treffer[0].id == "s24862"
    assert treffer[0].subtext == "Sounds!"
    # Der zweite steckt in 'children' – wer nur die oberste Ebene liest,
    # hält eine Rubrik für leer.
    assert treffer[1].id == "s99999"
    # Der gesperrte fehlt: Wer darauf tippt, bekommt Ton – nur nicht den
    # gewünschten, sondern die Ansage «not available in your country».
    assert not any("Not Supported" in station.name for station in treffer)


def test_search_survives_an_empty_answer():
    assert parse_search(None) == []
    assert parse_search({"head": {"status": "200"}}) == []
    assert parse_search({"body": [{"text": "Ohne Kennung"}]}) == []


def test_most_reliable_stream_wins_not_the_fattest():
    """Ein 320er, der zu einem Drittel ausfällt, ist abends schlechter als
    ein 128er, der immer läuft."""
    streams = parse_tune(TUNE)
    assert streams[0].reliability == 99
    assert streams[0].url.startswith("http://")

    gemischt = parse_tune(
        {
            "body": [
                {"url": "a", "reliability": 90, "bitrate": 320},
                {"url": "b", "reliability": 99, "bitrate": 128},
                {"url": "c", "reliability": 99, "bitrate": 192},
            ]
        }
    )
    assert [s.url for s in gemischt] == ["c", "b", "a"]


def test_a_playlist_is_recognised_as_one():
    """Genau hier bleibt eine Box sonst stumm, ohne einen Fehler zu
    melden: Sie lädt eine Textdatei und wartet auf Musik."""
    liste = parse_tune(TUNE)[0]
    assert ist_wiedergabeliste(liste) is True
    # Radio Pilatus liefert die Adresse direkt – dann gibt es nichts
    # aufzulösen.
    direkt = Stream(url="http://stream.streambase.ch/radiopilatus/mp3-192/", is_direct=True)
    assert ist_wiedergabeliste(direkt) is False
    # Ohne Angabe entscheidet die Endung.
    assert ist_wiedergabeliste(Stream(url="http://x/y.pls")) is True
    assert ist_wiedergabeliste(Stream(url="http://x/y.mp3")) is False
    # HLS ist keine Wiedergabeliste in diesem Sinn: Ein Chromecast spielt
    # sie selbst ab, Auflösen würde sie kaputtmachen.
    assert ist_wiedergabeliste(Stream(url="http://x/y.m3u8")) is False


def test_playlist_yields_the_first_stream():
    """Echte .m3u von SRF 3 – eine Zeile, eine Adresse."""
    assert (
        parse_playlist("http://stream.srg-ssr.ch/srgssr/srf3/mp3/128\n")
        == "http://stream.srg-ssr.ch/srgssr/srf3/mp3/128"
    )
    # .m3u mit Kommentaren
    assert parse_playlist("#EXTM3U\n#EXTINF:-1,SRF 3\nhttp://a/b\nhttp://c/d") == "http://a/b"
    # .pls
    pls = "[playlist]\nNumberOfEntries=2\nFile1=http://a/b\nTitle1=SRF 3\nFile2=http://c/d\n"
    assert parse_playlist(pls) == "http://a/b"
    # Nichts Brauchbares drin – dann lieber None als eine erfundene Adresse.
    assert parse_playlist("[playlist]\nNumberOfEntries=0\n") is None
    assert parse_playlist("") is None


def test_content_type_defaults_to_mp3():
    """Ein Chromecast rät nicht selbst; ohne Angabe verweigert er."""
    assert content_type_for("mp3") == "audio/mpeg"
    assert content_type_for("aac") == "audio/aac"
    assert content_type_for("", "http://x/y.m3u8") == "application/x-mpegURL"
    assert content_type_for("", "http://x/stream") == "audio/mpeg"


def test_stations_from_config_read_both_spellings():
    """Der blosse Name für alles, was TuneIn kennt – die ausführliche Form
    für den eigenen Icecast im Keller."""
    stations = parse_stations(
        [
            "SRF 3",
            {"name": "Radio Pilatus", "id": "s2482"},
            {"name": "Hauskanal", "url": "http://192.168.1.9:8000/stream"},
            {"ohne": "Namen"},
            42,
        ]
    )
    assert [s.name for s in stations] == ["SRF 3", "Radio Pilatus", "Hauskanal"]
    assert stations[0].id == ""
    assert stations[2].url == "http://192.168.1.9:8000/stream"


def test_config_wins_over_a_remembered_station():
    """Wer einen Sender in die Datei schreibt, hat sich etwas dabei
    gedacht – etwa eine feste Adresse, die er der Suche vorzieht."""
    zusammen = merge_stations(
        [Station(name="SRF 3", url="http://eigener/strom")],
        [Station(name="srf 3", id="s24862"), Station(name="Radio Pilatus", id="s2482")],
    )
    assert [s.name for s in zusammen] == ["SRF 3", "Radio Pilatus"]
    assert zusammen[0].url == "http://eigener/strom"


def test_speaker_choice_prefers_the_wish_then_the_last_one():
    boxen = [("cast.kueche", "Küche"), ("cast.stube", "Stube")]
    assert pick_speaker("Stube", boxen) == "cast.stube"
    assert pick_speaker("cast.stube", boxen) == "cast.stube"
    # Kein Wunsch: dort, wo es zuletzt lief.
    assert pick_speaker(None, boxen, "cast.stube") == "cast.stube"
    # Die zuletzt benutzte Box ist weg – dann die erste, nicht nichts.
    assert pick_speaker(None, boxen, "cast.weg") == "cast.kueche"
    # Gar keine Box: keine Antwort, damit der Fehler lesbar wird.
    assert pick_speaker("Küche", []) is None


def test_radio_stops_claiming_the_box_when_something_else_starts():
    """Sobald jemand Spotify startet, ist das Radio Geschichte – ein
    Player, der weiter «läuft» behauptet, wäre eine Lüge."""
    assert claim_haelt({"state": "playing", "app": "Default Media Receiver"}) is True
    # Ohne App-Angabe: im Zweifel läuft es noch.
    assert claim_haelt({"state": "playing"}) is True
    assert claim_haelt({"state": "playing", "app": "Spotify"}) is False
    # Fremde App schlägt jede Frist: Wer Spotify startet, hat entschieden.
    assert claim_haelt({"state": "playing", "app": "YouTube"}, alter=1) is False


def test_a_station_that_is_still_loading_does_not_lose_its_claim():
    """Der Fall, der die Kachel leer räumte.

    Ein Radiostrom braucht bis zum ersten Ton mehrere Sekunden. In dieser
    Zeit meldet die Box BUFFERING, was der Hub als «idle» führt – und der
    Sender verschwand genau dann, wenn die Musik anfing. Danach kam er
    nie wieder: Der Anspruch war gelöscht.
    """
    laedt = {"state": "idle", "app": "Default Media Receiver"}
    assert claim_haelt(laedt, alter=5) is True
    # Meldet die Box das Laden selbst, braucht es die Frist gar nicht.
    assert claim_haelt({"state": "buffering"}, alter=999) is True
    # Pause ist unsere Pause – wer anhält, hat den Sender nicht verlassen.
    assert claim_haelt({"state": "paused"}, alter=999) is True
    # Bleibt es dauerhaft still, ist es vorbei.
    assert claim_haelt(laedt, alter=ANSPRUCH_SEKUNDEN + 1) is False


def test_the_stream_text_becomes_title_and_artist():
    """Radioströme tragen alles in einem Feld: «Interpret - Titel».

    Ungetrennt stünde die ganze Zeile als Titel da, und die Zeile für den
    Interpreten bliebe leer.
    """
    assert titel_und_interpret("Ed Sheeran - Shivers") == ("Shivers", "Ed Sheeran")
    # Gedankenstrich statt Bindestrich – dieselbe Absicht.
    assert titel_und_interpret("Adele – Hello") == ("Hello", "Adele")
    # Ohne Trenner bleibt die Zeile, wie sie ist: Einen Interpreten zu
    # erfinden wäre schlimmer als eine Zeile weniger.
    assert titel_und_interpret("Nachrichten") == ("Nachrichten", None)
    assert titel_und_interpret("  ") == (None, None)
    assert titel_und_interpret(None) == (None, None)
    # Ein Titel mit Bindestrich im Namen: Der erste Trenner zählt.
    assert titel_und_interpret("AC/DC - T.N.T. - live") == ("T.N.T. - live", "AC/DC")


# ── Der ganze Weg, mit Hub und einer Box, aber ohne Netz ─────────────────


async def _fertig(wert):
    """Ein fertiges Ergebnis als Coroutine – für Lambdas als Ersatz."""
    return wert


class FakeBox:
    """Eine Box, die play_url kann – wie ein Chromecast, nur ohne Netz."""

    name = "google_cast"

    def __init__(self) -> None:
        self.gespielt: list[dict[str, Any]] = []

    async def teardown(self) -> None:
        return None

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        self.gespielt.append({"command": command, **data})


async def _hub_mit_box() -> tuple[Hub, TuneInIntegration, FakeBox]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    box = FakeBox()
    hub.integrations._integrations["google_cast"] = box
    await hub.registry.add(
        Entity(
            id="google_cast.kueche",
            kind=EntityKind.MEDIA_PLAYER,
            name="Küche",
            integration="google_cast",
            state={"state": "idle"},
            commands=["play", "pause", "set_volume", "play_url"],
        )
    )
    radio = TuneInIntegration(hub, {"stations": [{"name": "SRF 3", "id": "s24862"}]})
    hub.integrations._integrations["tunein"] = radio
    return hub, radio, box


async def test_playing_a_station_resolves_the_playlist_and_hands_over_a_stream():
    """Der Fall, um den es geht: An die Box geht die Adresse des Tons –
    nicht die der Wiedergabeliste, mit der sie nichts anfangen kann."""
    hub, radio, box = await _hub_mit_box()
    try:
        await radio.setup()

        async def opml(url: str) -> dict[str, Any]:
            assert "Tune.ashx" in url
            return TUNE

        async def playlist(url: str) -> str:
            assert url == "http://stream.srg-ssr.ch/drs3/mp3_128.m3u"
            return "http://stream.srg-ssr.ch/srgssr/srf3/mp3/128\n"

        radio._opml = opml  # type: ignore[method-assign]
        radio._playlist_text = playlist  # type: ignore[method-assign]

        await hub.integrations.dispatch_command(
            "tunein.radio", "play_radio", {"station": "SRF 3"}
        )
        assert box.gespielt == [
            {
                "command": "play_url",
                "url": "http://stream.srg-ssr.ch/srgssr/srf3/mp3/128",
                "content_type": "audio/mpeg",
            }
        ]
    finally:
        await hub.stop()


async def test_an_unknown_station_says_which_ones_exist():
    """In einem Ablauf sieht man sonst nur, dass nichts kam."""
    hub, radio, _ = await _hub_mit_box()
    try:
        await radio.setup()
        try:
            await hub.integrations.dispatch_command(
                "tunein.radio", "play_radio", {"station": "Radio Eriwan"}
            )
        except Exception as err:
            assert "Radio Eriwan" in str(err) and "SRF 3" in str(err)
        else:
            raise AssertionError("Ein unbekannter Sender hätte auffallen müssen")
    finally:
        await hub.stop()


def test_a_television_is_the_last_resort_not_the_first():
    """Radio auf dem Fernseher will niemand aus Versehen. Aber ein Haus,
    dessen einziges Cast-Gerät am Fernseher hängt, hatte sonst gar keine
    Box: Der Sender liess sich antippen, und es passierte nichts."""
    from homepilot.integrations.tunein import waehlbare_boxen

    kueche = ("cast.kueche", "Küche", False)
    tv = ("cast.stube", "Wohnzimmer TV", True)
    # Gibt es eine echte Box, bleibt der Fernseher draussen.
    assert waehlbare_boxen([kueche, tv]) == [("cast.kueche", "Küche")]
    # Gibt es keine, ist der Fernseher besser als Stille.
    assert waehlbare_boxen([tv]) == [("cast.stube", "Wohnzimmer TV")]
    assert waehlbare_boxen([]) == []


async def test_radio_does_not_offer_the_television_as_a_speaker():
    """Solange es eine echte Box gibt, steht der Fernseher nicht zur
    Wahl."""
    hub, radio, _ = await _hub_mit_box()
    try:
        await radio.setup()
        await hub.registry.add(
            Entity(
                id="google_cast.stube_tv",
                kind=EntityKind.MEDIA_PLAYER,
                name="Wohnzimmer TV",
                integration="google_cast",
                # Er kennt weder Steuerkreuz noch App-Start – nur das
                # Gerät selbst weiss, dass ein Bild daran hängt.
                state={"state": "idle", "has_screen": True},
                commands=["play", "pause", "set_volume", "play_url"],
            )
        )
        assert [name for _, name in radio.speakers()] == ["Küche"]
    finally:
        await hub.stop()


async def test_choosing_a_box_before_a_station_is_remembered_not_refused():
    """«Das Radio soll in der Küche spielen» ist eine sinnvolle Ansage,
    auch bevor ein Sender gewählt ist – in der Kopfzeile der Musikkarte
    ist es sogar die Reihenfolge, in der man tippt."""
    hub, radio, box = await _hub_mit_box()

    async def opml(url: str) -> dict[str, Any]:
        return TUNE

    async def playlist(url: str) -> str:
        return "http://stream.srg-ssr.ch/srgssr/srf3/mp3/128\n"

    try:
        await radio.setup()
        radio._opml = opml  # type: ignore[method-assign]
        radio._playlist_text = playlist  # type: ignore[method-assign]

        await hub.integrations.dispatch_command(
            "tunein.radio", "play_on", {"device": "Küche"}
        )
        assert box.gespielt == []  # nichts gestartet, nur gemerkt
        assert hub.registry.get("tunein.radio").state["device"] == "Küche"

        # Der nächste Sender landet dann dort.
        await hub.integrations.dispatch_command(
            "tunein.radio", "play_radio", {"station": "SRF 3"}
        )
        assert len(box.gespielt) == 1
    finally:
        await hub.stop()


async def test_without_a_speaker_the_error_names_the_missing_piece():
    """«Geht nicht» ist keine Antwort, wenn eine Voraussetzung fehlt."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    radio = TuneInIntegration(hub, {"stations": ["SRF 3"]})
    hub.integrations._integrations["tunein"] = radio
    try:
        await radio.setup()
        try:
            await hub.integrations.dispatch_command(
                "tunein.radio", "play_radio", {"station": "SRF 3"}
            )
        except Exception as err:
            assert "Lautsprecher" in str(err)
        else:
            raise AssertionError("Ohne Box hätte es einen Fehler geben müssen")
    finally:
        await hub.stop()


async def test_the_player_mirrors_the_box_and_lets_go_when_spotify_takes_over():
    """Der Zustand steht auf der Box – der Player liest ihn ab."""
    hub, radio, _ = await _hub_mit_box()
    try:
        await radio.setup()
        radio._box = "google_cast.kueche"
        radio._station = Station(name="SRF 3", id="s24862", subtext="Sounds!")

        await hub.registry.update_state(
            "google_cast.kueche",
            {"state": "playing", "app": "Default Media Receiver", "volume": 40},
        )
        await radio.refresh_now()
        player = hub.registry.get("tunein.radio")
        assert player.state["state"] == "playing"
        assert player.state["track"] == "SRF 3"
        assert player.state["artist"] == "Sounds!"
        assert player.state["device"] == "Küche"
        assert player.state["volume"] == 40
        assert player.state["stations"] == ["SRF 3"]

        await hub.registry.update_state("google_cast.kueche", {"app": "Spotify"})
        await radio.refresh_now()
        player = hub.registry.get("tunein.radio")
        assert player.state["state"] == "idle"
        assert player.state["track"] is None
    finally:
        await hub.stop()


# ── Die Routen ───────────────────────────────────────────────────────────


def test_radio_routes_say_plainly_when_no_radio_is_set_up():
    """Ohne 'integration: tunein' soll die App eine leere Liste bekommen
    und nicht einen Fehler, den sie als Ausfall anzeigt."""
    from fastapi.testclient import TestClient

    from homepilot.api import create_app

    from .conftest import make_config

    with TestClient(create_app(Hub(make_config()))) as client:
        antwort = client.get("/api/radio/stations")
        assert antwort.status_code == 200
        assert antwort.json() == {"stations": [], "speakers": [], "reason": "kein Radio eingerichtet"}
        # Suchen und Merken hingegen sind ein echter Fehlgriff.
        assert client.get("/api/radio/search?q=srf").status_code == 404
        assert client.post("/api/radio/stations", json={"name": "SRF 3"}).status_code == 404


def test_remembered_stations_survive_and_can_be_removed():
    """Wer abends einen Sender findet, soll ihn behalten können, ohne eine
    Datei auf dem Hub zu bearbeiten."""
    from fastapi.testclient import TestClient

    from homepilot.api import create_app
    from homepilot.core.config import ApiConfig, HubConfig

    config = HubConfig(
        api=ApiConfig(),
        integrations=[{"integration": "tunein", "stations": ["SRF 3"]}],
        automations=[],
    )
    with TestClient(create_app(Hub(config))) as client:
        assert [s["name"] for s in client.get("/api/radio/stations").json()["stations"]] == [
            "SRF 3"
        ]

        antwort = client.post(
            "/api/radio/stations", json={"name": "Radio Pilatus", "id": "s2482"}
        )
        assert antwort.status_code == 200
        assert [s["name"] for s in antwort.json()["stations"]] == ["SRF 3", "Radio Pilatus"]

        # Was in der config.yaml steht, lässt sich hier nicht löschen –
        # ein Knopf, der die Datei stillschweigend nicht ändert, wäre eine
        # Attrappe.
        assert client.delete("/api/radio/stations/SRF 3").status_code == 404

        assert client.delete("/api/radio/stations/Radio Pilatus").status_code == 200
        assert [s["name"] for s in client.get("/api/radio/stations").json()["stations"]] == [
            "SRF 3"
        ]



async def test_the_station_survives_the_seconds_before_the_first_sound():
    """Der gemeldete Fehler, ganz durchgespielt.

    «Wenn ich einen Sender anklicke, wird das Cover und der Sender
    angezeigt, es dauert aber lange, bis die Musik kommt. Sobald die
    Musik kommt, verschwindet das Cover und der Sender wieder.»

    Genau so war es: Die ladende Box meldet «idle», der Hub löschte den
    Anspruch – und was danach an Musik kam, sah für ihn aus wie fremde.
    """
    hub, radio, _ = await _hub_mit_box()
    try:
        await radio.setup()

        async def opml(url: str) -> dict[str, Any]:
            return TUNE

        async def playlist(url: str) -> str:
            return "http://stream.srg-ssr.ch/srgssr/srf3/mp3/128\n"

        radio._opml = opml  # type: ignore[method-assign]
        radio._playlist_text = playlist  # type: ignore[method-assign]

        await hub.integrations.dispatch_command(
            "tunein.radio", "play_radio", {"station": "SRF 3"}
        )
        player = hub.registry.get("tunein.radio")
        assert player is not None
        assert player.state["station"] == "SRF 3"

        # Die Box lädt: kein Ton, keine Angaben – aber unsere App.
        await hub.registry.update_state(
            "google_cast.kueche", {"state": "idle", "app": "Default Media Receiver"}
        )
        await radio.refresh_now()
        zustand = hub.registry.get("tunein.radio").state
        assert zustand["station"] == "SRF 3"
        # Und die Kachel sagt, warum noch nichts zu hören ist.
        assert zustand["buffering"] is True

        # Und jetzt kommt der Ton, mit dem Text aus dem Strom.
        await hub.registry.update_state(
            "google_cast.kueche",
            {
                "state": "playing",
                "app": "Default Media Receiver",
                "track": "Ed Sheeran - Shivers",
            },
        )
        await radio.refresh_now()
        zustand = hub.registry.get("tunein.radio").state
        assert zustand["state"] == "playing"
        assert zustand["station"] == "SRF 3"
        assert zustand["track"] == "Shivers"
        assert zustand["artist"] == "Ed Sheeran"
        assert zustand["buffering"] is False

        # Jemand startet Spotify: Jetzt ist es vorbei, sofort.
        await hub.registry.update_state(
            "google_cast.kueche", {"state": "playing", "app": "Spotify"}
        )
        await radio.refresh_now()
        zustand = hub.registry.get("tunein.radio").state
        assert zustand["state"] == "idle"
        assert zustand["station"] is None
        assert zustand["track"] is None
    finally:
        await hub.stop()


async def test_a_station_without_stream_text_shows_its_own_name():
    """Eine Kachel ohne Zeile sähe aus wie «nichts läuft»."""
    hub, radio, _ = await _hub_mit_box()
    try:
        await radio.setup()
        radio._opml = lambda url: _fertig(TUNE)  # type: ignore[method-assign]
        radio._playlist_text = lambda url: _fertig(  # type: ignore[method-assign]
            "http://stream.srg-ssr.ch/srgssr/srf3/mp3/128\n"
        )
        await hub.integrations.dispatch_command(
            "tunein.radio", "play_radio", {"station": "SRF 3"}
        )
        await hub.registry.update_state(
            "google_cast.kueche", {"state": "playing", "app": "Default Media Receiver"}
        )
        await radio.refresh_now()
        zustand = hub.registry.get("tunein.radio").state
        assert zustand["track"] == "SRF 3"
        assert zustand["artist"] == "Radio"
    finally:
        await hub.stop()


async def test_the_same_station_twice_does_not_ask_tunein_twice():
    """Sekunden beim Umschalten sind genau das, was stört.

    Die zweite Runde bringt dieselbe Adresse – für zwei Anfragen ans Netz
    und eine heruntergeladene Wiedergabeliste gibt es keinen Grund.
    """
    hub, radio, box = await _hub_mit_box()
    try:
        await radio.setup()
        aufrufe: list[str] = []

        async def opml(url: str) -> dict[str, Any]:
            aufrufe.append(url)
            return TUNE

        async def playlist(url: str) -> str:
            aufrufe.append(url)
            return "http://stream.srg-ssr.ch/srgssr/srf3/mp3/128\n"

        radio._opml = opml  # type: ignore[method-assign]
        radio._playlist_text = playlist  # type: ignore[method-assign]

        for _ in range(3):
            await hub.integrations.dispatch_command(
                "tunein.radio", "play_radio", {"station": "SRF 3"}
            )
        # Drei, nicht zwei: Einmal Tune, einmal die Wiedergabeliste - und
        # genau EINE Suche, mit der sich der Sender sein fehlendes Logo
        # nachholt (mit_logo). Sie darf nicht je Start wiederkehren.
        assert len(aufrufe) == 3, aufrufe
        assert len(box.gespielt) == 3
        assert {eintrag["url"] for eintrag in box.gespielt} == {
            "http://stream.srg-ssr.ch/srgssr/srf3/mp3/128"
        }
    finally:
        await hub.stop()


# ── Das nachgeladene Senderlogo ──────────────────────────────────────────
#
# Ein Sender mit Kennung wird beim Abspielen nie mehr über die Suche
# aufgelöst - sein Logo kam deshalb nie nach, und die Radiokachel blieb
# ohne Cover, während frisch gesuchte Sender eines hatten.


def test_das_logo_kommt_vom_treffer_mit_derselben_kennung():
    from homepilot.integrations.tunein import Station, mit_logo

    alt = Station(name="SRF 3", id="s24862")
    treffer = [
        Station(name="SRF 3 (andere)", id="s99999", image="http://falsch.png"),
        Station(name="SRF 3", id="s24862", image="https://cdn.tunein.com/srf3.png"),
    ]
    neu = mit_logo(alt, treffer)
    assert neu.image == "https://cdn.tunein.com/srf3.png"
    # Name und Kennung bleiben, was sie waren.
    assert (neu.name, neu.id) == ("SRF 3", "s24862")


def test_ohne_passende_kennung_bleibt_es_beim_leeren_bild():
    from homepilot.integrations.tunein import Station, mit_logo

    # Die Namenssuche darf dem eigenen Icecast im Keller nicht das Logo
    # eines fremden gleichnamigen Senders anheften.
    alt = Station(name="Kellerradio", id="eigene")
    treffer = [Station(name="Kellerradio", id="s123", image="http://fremd.png")]
    assert mit_logo(alt, treffer).image == ""


def test_ein_vorhandenes_bild_wird_nicht_ueberschrieben():
    from homepilot.integrations.tunein import Station, mit_logo

    alt = Station(name="SRF 3", id="s24862", image="https://schon.da.png")
    treffer = [Station(name="SRF 3", id="s24862", image="https://neu.png")]
    assert mit_logo(alt, treffer).image == "https://schon.da.png"


def test_ohne_kennung_wird_nicht_geraten():
    from homepilot.integrations.tunein import Station, mit_logo

    alt = Station(name="Nur Name")
    treffer = [Station(name="Nur Name", id="s1", image="http://x.png")]
    assert mit_logo(alt, treffer).image == ""


async def test_pausing_a_radio_that_is_not_running_is_not_an_error():
    """«Radio aus», wenn kein Radio läuft, ist ein erfüllter Wunsch.

    Als Fehler hielt es einen ganzen Ablauf an: «Niemand mehr zuhause»
    stellt der Reihe nach ein Dutzend Boxen ab, und die erste, auf der
    ohnehin nichts lief, brachte den Rest zum Stehen - samt Türschloss
    am Ende der Liste.
    """
    hub, radio, box = await _hub_mit_box()
    try:
        await radio.setup()
        entity = next(e for e in hub.registry.all() if e.integration == "tunein")
        await radio.handle_command(entity, "pause", {})
        # Nichts an die Box geschickt, aber auch kein Fehler geworfen.
        assert box.gespielt == []
    finally:
        await hub.stop()


async def test_other_commands_still_say_that_no_radio_runs():
    """Lauter stellen, wo nichts läuft, ist dagegen eine Frage ohne
    Antwort - und die soll man erfahren."""
    from homepilot.core.errors import HomePilotError

    hub, radio, _ = await _hub_mit_box()
    try:
        await radio.setup()
        entity = next(e for e in hub.registry.all() if e.integration == "tunein")
        with pytest.raises(HomePilotError, match="kein Radio"):
            await radio.handle_command(entity, "set_volume", {"volume": 40})
    finally:
        await hub.stop()
