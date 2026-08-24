"""Was gerade läuft – und woraus.

Spotify meldet beim Abspielen nur eine Kontext-URI. Erst wer die
Playlists des Kontos kennt, kann daraus einen Namen machen.
"""

from homepilot.integrations.spotify import (
    REPEAT_MODES,
    next_repeat,
    parse_playback,
    playlist_name,
)

PLAYLISTS = [
    {"name": "Reaggae", "uri": "spotify:playlist:AAA"},
    {"name": "Dark Country", "uri": "spotify:playlist:BBB"},
]


def test_parse_playback_reports_the_context_uri():
    payload = {
        "is_playing": True,
        "item": {"name": "Song", "artists": [{"name": "Band"}]},
        "device": {"name": "Terrasse", "volume_percent": 40},
        "context": {"uri": "spotify:playlist:AAA", "type": "playlist"},
    }
    state = parse_playback(payload)
    assert state["state"] == "playing"
    assert state["context_uri"] == "spotify:playlist:AAA"


def test_parse_playback_without_context():
    # Ein einzeln gestarteter Song hat keinen Kontext – das ist normal.
    state = parse_playback({"is_playing": True, "item": {"name": "Song"}})
    assert state["context_uri"] is None


def test_parse_playback_idle():
    assert parse_playback(None)["context_uri"] is None


def test_playlist_name_resolves_the_uri():
    assert playlist_name("spotify:playlist:BBB", PLAYLISTS) == "Dark Country"


def test_playlist_name_is_none_for_albums_and_radio():
    # Ein Album ist keine Playlist – lieber nichts anzeigen als etwas
    # Falsches behaupten.
    assert playlist_name("spotify:album:XYZ", PLAYLISTS) is None
    assert playlist_name(None, PLAYLISTS) is None
    assert playlist_name("spotify:playlist:AAA", []) is None


def test_parse_playback_reads_shuffle_and_repeat():
    state = parse_playback(
        {
            "is_playing": True,
            "item": {"name": "Song"},
            "device": {"name": "Terrasse"},
            "shuffle_state": True,
            "repeat_state": "context",
        }
    )
    assert state["shuffle"] is True
    assert state["repeat"] == "context"


def test_parse_playback_defaults_shuffle_and_repeat():
    # Fehlen die Felder, ist beides aus – nicht «unbekannt».
    state = parse_playback({"is_playing": True, "item": {"name": "Song"}})
    assert state["shuffle"] is False
    assert state["repeat"] == "off"
    assert parse_playback(None)["repeat"] == "off"


def test_next_repeat_cycles_through_the_modes():
    # aus → alles → ein Titel → aus
    assert next_repeat("off") == "context"
    assert next_repeat("context") == "track"
    assert next_repeat("track") == "off"


def test_next_repeat_recovers_from_nonsense():
    # Ein unbekannter Wert darf nicht in einer Sackgasse enden.
    assert next_repeat("quatsch") in REPEAT_MODES


# ── Befehle sollen nicht auf Spotifys Rückmeldung warten ───────────────────

import asyncio

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.integrations.spotify import SpotifyIntegration

CONFIG = {
    "integration": "spotify",
    "client_id": "id",
    "client_secret": "secret",
    "refresh_token": "refresh",
    "scan_interval": 3600,
}


class FakeApi:
    """Spotify-Ersatz, der mitschreibt, was der Hub aufruft."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    # Wird als gebundene Methode gesetzt – deshalb ohne das self der
    # Integration in der Signatur.
    async def call(self, method, path, json=None):
        self.calls.append((method, path))
        if path.startswith("/me/playlists"):
            return {"items": [{"name": "Reaggae", "uri": "spotify:playlist:AAA"}]}
        if path == "/me/player/devices":
            return {"devices": [{"id": "dev1", "name": "Terrasse", "is_active": False}]}
        return None  # /me/player: es läuft gerade nichts


@pytest.fixture
def spotify_hub(tmp_path, monkeypatch):
    api = FakeApi()
    monkeypatch.setattr(SpotifyIntegration, "_call", api.call)
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[CONFIG],
            users=[{"name": "Stefan", "role": "besitzer", "token": "t"}],
            data_file=str(tmp_path / "daten.json"),
        )
    )
    yield hub, api


def test_starting_a_playlist_reports_at_once(spotify_hub):
    """Der gemeldete Fall: Das Abspielen dauerte gefühlt ewig.

    Der Befehl wartete auf eine Abfrage, die den neuen Zustand meist noch
    gar nicht kannte – die Kachel blieb «wird geschaltet», obwohl die Musik
    schon lief.
    """
    hub, api = spotify_hub

    async def run():
        await hub.start()
        api.calls.clear()
        entity = await hub.integrations.dispatch_command(
            "spotify.player", "play_playlist", {"name": "Reaggae", "device": "Terrasse"}
        )
        state = dict(entity.state)
        calls = list(api.calls)
        await hub.stop()
        return state, calls

    state, calls = asyncio.run(run())

    assert ("PUT", "/me/player/play?device_id=dev1") in calls
    # Sofort und ohne Rückfrage: Das steht schon fest, sobald Spotify den
    # Befehl angenommen hat.
    assert state["state"] == "playing"
    assert state["playlist"] == "Reaggae"
    assert state["device"] == "Terrasse"
    # Und nach dem Start wird nicht mehr gewartet – das Nachhaken läuft im
    # Hintergrund.
    after = calls[calls.index(("PUT", "/me/player/play?device_id=dev1")) + 1 :]
    assert after == []


def test_the_device_list_is_refreshed_before_waking(spotify_hub):
    """Wecken kostet Sekunden, nachfragen Millisekunden.

    Die gemerkte Liste ist bis zu einem Poll-Intervall alt – eine längst
    wache Box würde sonst unnötig über Cast geweckt.
    """
    hub, api = spotify_hub

    async def run():
        await hub.start()
        service = hub.integrations.get("spotify")
        # Die Box ist wach, der Hub weiss es nur noch nicht.
        service._device_ids = {}
        api.calls.clear()
        await hub.integrations.dispatch_command(
            "spotify.player", "play_on", {"device": "Terrasse"}
        )
        calls = list(api.calls)
        await hub.stop()
        return calls

    calls = asyncio.run(run())
    assert ("GET", "/me/player/devices") in calls
    assert ("PUT", "/me/player") in calls


# ── Was als Nächstes kommt ───────────────────────────────────────────────
# Die Musikkarte zeigt den laufenden Titel. «Und danach?» stand nirgends,
# obwohl Spotify die Warteschlange längst liefert.


def test_the_queue_becomes_a_list_of_titles():
    from homepilot.integrations.spotify import parse_queue

    titel = parse_queue(
        {
            "currently_playing": {"name": "Läuft gerade", "artists": [{"name": "A"}]},
            "queue": [
                {"name": "Danach", "artists": [{"name": "B"}, {"name": "C"}]},
                {"name": "Und dann", "artists": []},
            ],
        }
    )
    assert titel == [
        {"track": "Danach", "artist": "B, C"},
        {"track": "Und dann", "artist": None},
    ]


def test_the_running_title_is_not_in_the_queue():
    """Spotify nennt ihn dort noch einmal – er läuft aber schon."""
    from homepilot.integrations.spotify import parse_queue

    titel = parse_queue(
        {"currently_playing": {"name": "Läuft gerade"}, "queue": [{"name": "Danach"}]}
    )
    assert [t["track"] for t in titel] == ["Danach"]


def test_titles_without_a_name_fall_out():
    from homepilot.integrations.spotify import parse_queue

    titel = parse_queue({"queue": [{"name": ""}, {"artists": []}, {"name": "Echt"}]})
    assert [t["track"] for t in titel] == ["Echt"]


def test_a_very_long_queue_is_cut_off():
    """Zwanzig Titel bei jedem Zustands-Abruf sind zu viel für eine
    Liste, auf die man selten schaut."""
    from homepilot.integrations.spotify import WARTESCHLANGE_MAX, parse_queue

    viele = {"queue": [{"name": f"Titel {i}"} for i in range(40)]}
    assert len(parse_queue(viele)) == WARTESCHLANGE_MAX


def test_no_answer_means_no_queue():
    from homepilot.integrations.spotify import parse_queue

    assert parse_queue(None) == []
    assert parse_queue({}) == []
    assert parse_queue({"queue": None}) == []


# ── «Zufällig oder der Reihe nach?» am Playlist-Start ────────────────────
#
# Eine Szene «Party» soll nicht jeden Abend mit demselben Titel anfangen.
# Die Angabe reist als Zusatzdatum mit play_playlist mit – und darf, wenn
# sie fehlt, nichts umstellen.


def test_shuffle_wunsch_reads_the_three_answers():
    from homepilot.integrations.spotify import shuffle_wunsch

    assert shuffle_wunsch({"shuffle": True}) is True
    assert shuffle_wunsch({"shuffle": False}) is False
    # Ohne Angabe bleibt die Einstellung des Hauses, wie sie ist.
    assert shuffle_wunsch({}) is None
    assert shuffle_wunsch({"shuffle": None}) is None
    assert shuffle_wunsch({"shuffle": ""}) is None


def test_shuffle_wunsch_understands_a_handwritten_config():
    from homepilot.integrations.spotify import shuffle_wunsch

    # In der config.yaml schreibt niemand `true`, wenn «ja» gemeint ist.
    assert shuffle_wunsch({"shuffle": "ja"}) is True
    assert shuffle_wunsch({"shuffle": "an"}) is True
    assert shuffle_wunsch({"shuffle": "aus"}) is False
    assert shuffle_wunsch({"shuffle": "nein"}) is False
    # Und was niemand deuten kann, stellt lieber nichts um.
    assert shuffle_wunsch({"shuffle": "vielleicht"}) is None


# ── Der Titelwechsel soll nicht auf den Takt warten ──────────────────────
#
# Der gemeldete Fall: «Wenn der Medienplayer das Lied wechselt, dauert es
# ein paar Sekunden, bis das neue Cover und der neue Titel angezeigt
# werden.» Der Hub fragte in festem Takt und erfuhr vom Wechsel erst beim
# nächsten Mal. Spotify sagt aber, wie weit der Titel ist.


def test_die_spielposition_kommt_mit():
    from homepilot.integrations.spotify import parse_playback

    state = parse_playback(
        {
            "is_playing": True,
            "item": {"name": "Song", "duration_ms": 210_000},
            "progress_ms": 65_400,
        }
    )
    # In Sekunden – Spotify rechnet in Millisekunden.
    assert state["duration"] == 210
    assert state["progress"] == 65


def test_der_naechste_blick_liegt_auf_dem_titelwechsel():
    from homepilot.integrations.spotify import naechster_blick

    laeuft = {"state": "playing", "duration": 210, "progress": 200}
    # Zehn Sekunden Rest plus Puffer statt der vollen halben Minute.
    assert naechster_blick(laeuft, 30.0) == 11.5


def test_mitten_im_titel_bleibt_es_beim_normalen_takt():
    from homepilot.integrations.spotify import naechster_blick

    # Sonst würde der Hub die halbe Stunde über im Sekundentakt fragen.
    assert naechster_blick({"state": "playing", "duration": 210, "progress": 10}, 30.0) == 30.0


def test_was_steht_wechselt_nicht_von_selbst():
    from homepilot.integrations.spotify import naechster_blick

    for zustand in ("paused", "idle", ""):
        assert naechster_blick({"state": zustand, "duration": 210, "progress": 200}, 30.0) == 30.0


def test_ohne_laengenangabe_kein_kurzer_takt():
    from homepilot.integrations.spotify import naechster_blick

    # Ein Livestream hat keine Länge – daraus lässt sich nichts vorhersehen.
    assert naechster_blick({"state": "playing", "duration": None}, 30.0) == 30.0
    assert naechster_blick({"state": "playing", "duration": "acht"}, 30.0) == 30.0


def test_ein_ueberfaelliger_titel_wird_gleich_nachgefragt():
    from homepilot.integrations.spotify import naechster_blick

    # Rechnerisch vorbei, aber die Antwort war von eben: gleich nochmal,
    # nicht sofort – sonst dreht die Schleife durch.
    assert naechster_blick({"state": "playing", "duration": 210, "progress": 215}, 30.0) == 2.0
