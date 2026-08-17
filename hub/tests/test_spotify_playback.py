"""Was gerade läuft – und woraus.

Spotify meldet beim Abspielen nur eine Kontext-URI. Erst wer die
Playlists des Kontos kennt, kann daraus einen Namen machen.
"""

from homepilot.integrations.spotify import parse_playback, playlist_name

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
