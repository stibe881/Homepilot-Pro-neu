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
