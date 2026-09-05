"""Lautsprechergruppen: was der Player mit ihnen anders machen muss.

Drei Dinge aus dem Betrieb, alle an derselben Wurzel – eine Gruppe ist
für Google ein eigenes Cast-Gerät auf der Adresse einer ihrer Boxen, mit
einem **eigenen Port**. Wer den Port vergisst, spricht die Einzelbox an,
die die Gruppe beherbergt: Es spielt eine statt aller.
"""

import types

from homepilot.integrations.google_cast import (
    DEFAULT_PORT,
    cast_media_state,
    cast_object_id,
    ist_gruppe,
)


def test_the_port_is_what_makes_a_group_a_group():
    """Am Port hängt alles - auch die Bibliothek entscheidet daran."""
    # Verbunden weiss es das Gerät selbst.
    assert ist_gruppe("group") is True
    assert ist_gruppe("audio") is False
    assert ist_gruppe("cast") is False
    # Vorher genügt der Port: 8009 ist eine Box, alles andere eine Gruppe.
    assert ist_gruppe(None, 8009) is False
    assert ist_gruppe(None, 32123) is True
    # Und die Kennung trägt ihn mit, sonst hiessen Gruppe und
    # Gastgeberbox gleich.
    assert cast_object_id("192.168.1.36") == "192_168_1_36"
    assert cast_object_id("192.168.1.36", 32123) == "192_168_1_36_32123"
    assert cast_object_id("192.168.1.36", DEFAULT_PORT) == "192_168_1_36"


def test_the_tile_says_whether_it_is_a_group():
    """Ohne diese Auskunft sieht eine falsch eingetragene Gruppe aus wie
    eine Box - und man sucht den Fehler beim Abspielen statt in der
    Konfiguration."""
    gruppe = cast_media_state("PLAYING", "Titel", "Band", "Spotify", 0.4, is_group=True)
    assert gruppe["is_group"] is True
    box = cast_media_state("PLAYING", "Titel", "Band", "Spotify", 0.4, is_group=False)
    assert box["is_group"] is False
    # Solange nichts bekannt ist, steht das Feld nicht da - der Hub
    # behauptet nichts, was er nicht weiss.
    assert "is_group" not in cast_media_state("IDLE", None, None, None, None)


# ── Die Lautstärke einer Gruppe ──────────────────────────────────────────
# Spotify beantwortet `PUT /me/player/volume` für Google-Boxen und erst
# recht für Gruppen mit «VOLUME_CONTROL_DISALLOWED». Der Regler bewegte
# sich, und niemand wurde lauter.


class _FakeCast:
    """Die google_cast-Integration, so weit spotify sie braucht."""

    def __init__(self, namen: dict[str, int]) -> None:
        self.namen = namen
        self.gesetzt: list[tuple[str, float]] = []

    async def lautstaerke_setzen(self, name: str, prozent: float) -> bool:
        if name not in self.namen:
            return False
        self.namen[name] = int(prozent)
        self.gesetzt.append((name, prozent))
        return True

    def lautstaerke_von(self, name: str):
        return self.namen.get(name)


def spotify(cast, geraet: str):
    from homepilot.integrations.spotify import SpotifyIntegration

    integration = object.__new__(SpotifyIntegration)
    integration.log = types.SimpleNamespace(
        debug=lambda *a, **k: None,
        info=lambda *a, **k: None,
        warning=lambda *a, **k: None,
    )
    integration.hub = types.SimpleNamespace(
        integrations=types.SimpleNamespace(get=lambda name: cast if name == "google_cast" else None)
    )
    entity = types.SimpleNamespace(state={"device": geraet, "volume": 20})
    return integration, entity


async def test_volume_for_a_cast_group_goes_through_cast_not_spotify():
    cast = _FakeCast({"Ganze Wohnung": 40})
    integration, entity = spotify(cast, "Ganze Wohnung")
    assert await integration._cast_lautstaerke(entity, 55) is True
    assert cast.gesetzt == [("Ganze Wohnung", 55)]


async def test_a_phone_still_goes_through_spotify():
    """Nicht alles ist eine Cast-Box. Ein Telefon oder ein Rechner kann
    Spotify sehr wohl leiser stellen - dort bleibt der alte Weg."""
    cast = _FakeCast({"Ganze Wohnung": 40})
    integration, entity = spotify(cast, "iPhone von Stefan")
    assert await integration._cast_lautstaerke(entity, 55) is False
    assert cast.gesetzt == []


async def test_without_the_cast_integration_nothing_breaks():
    integration, entity = spotify(None, "Ganze Wohnung")
    assert await integration._cast_lautstaerke(entity, 55) is False


async def test_moving_to_a_group_uses_the_groups_own_volume():
    """Spotify nimmt beim Umziehen die Lautstärke des bisherigen Geräts
    mit. Wer die Küchenbox auf 15 % hatte und auf «Ganze Wohnung»
    wechselt, bekam die ganze Wohnung auf 15 %."""
    cast = _FakeCast({"Ganze Wohnung": 40, "Küche": 15})
    integration, _ = spotify(cast, "Küche")
    await integration._gruppen_lautstaerke_wiederherstellen("Ganze Wohnung")
    assert cast.gesetzt == [("Ganze Wohnung", 40)]


async def test_an_unknown_target_is_left_alone():
    """Ein Telefon hat keine Cast-Lautstärke - da gibt es nichts
    wiederherzustellen, und ein Griff ins Leere wäre schlimmer als
    nichts."""
    cast = _FakeCast({"Ganze Wohnung": 40})
    integration, _ = spotify(cast, "Küche")
    await integration._gruppen_lautstaerke_wiederherstellen("iPhone von Stefan")
    assert cast.gesetzt == []


# ── Eine genannte Box ist eine Ansage, keine Anregung ────────────────────
# Der Fehler aus dem Betrieb: Kannte Spotify die Gruppe im Moment des
# Starts nicht, spielte die Musik kommentarlos auf der Box weiter, die
# ohnehin schon lief - also gerade nicht auf denen, die in Google Home in
# der Gruppe stehen.


class _Spotify:
    """Die spotify-Integration, so weit play_playlist sie braucht."""

    def __init__(self, sichtbar: dict[str, str], weckbar: set[str]) -> None:
        self._device_ids = dict(sichtbar)
        self._weckbar = weckbar
        self._playlists = [{"name": "Party", "uri": "spotify:playlist:party"}]
        self.gestartet: list[tuple[str, str]] = []
        self.log = types.SimpleNamespace(
            debug=lambda *a, **k: None,
            info=lambda *a, **k: None,
            warning=lambda *a, **k: None,
        )
        self.hub = types.SimpleNamespace(
            integrations=types.SimpleNamespace(get=lambda _n: None)
        )

    async def _load_devices(self):
        return self._device_ids

    async def _wake_and_find(self, name):
        if name in self._weckbar:
            self._device_ids[name] = f"id-{name}"
            return self._device_ids[name]
        return None

    async def _call(self, method, path, json=None, **kw):
        if "/play" in path:
            self.gestartet.append((path.split("device_id=")[-1], (json or {}).get("context_uri", "")))
        return {}

    async def _shuffle(self, on, device_id=None):
        return None

    async def _announce(self, _daten):
        return None

    def _device_name(self, device_id):
        for name, kennung in self._device_ids.items():
            if kennung == device_id:
                return name
        return None


def _als_integration(fake):
    """Die echte handle_command auf dem Doppel laufen lassen."""
    from homepilot.integrations.spotify import SpotifyIntegration

    fake.handle_command = SpotifyIntegration.handle_command.__get__(fake)
    # Auch echt: die Namensübersetzung für umbenannte Boxen. Ohne
    # Cast-Integration (das Doppel liefert keine) bleibt sie leer.
    fake._anzeige_paare = SpotifyIntegration._anzeige_paare.__get__(fake)
    return fake


async def test_a_named_group_that_is_gone_raises_instead_of_playing_elsewhere():
    import pytest

    fake = _als_integration(_Spotify({"Küche": "id-kueche"}, weckbar=set()))
    entity = types.SimpleNamespace(state={"device": "Küche"})
    with pytest.raises(ValueError) as fehler:
        await fake.handle_command(
            entity, "play_playlist", {"name": "Party", "device": "Ganze Wohnung"}
        )
    assert "Ganze Wohnung" in str(fehler.value)
    # Und vor allem: Es lief nichts auf der Küchenbox.
    assert fake.gestartet == []


async def test_a_sleeping_group_is_woken_and_then_used():
    fake = _als_integration(
        _Spotify({"Küche": "id-kueche"}, weckbar={"Ganze Wohnung"})
    )
    entity = types.SimpleNamespace(state={"device": "Küche"})
    await fake.handle_command(
        entity, "play_playlist", {"name": "Party", "device": "Ganze Wohnung"}
    )
    assert fake.gestartet == [("id-Ganze Wohnung", "spotify:playlist:party")]


async def test_without_a_wish_the_active_speaker_still_wins():
    """Der Rückfall bleibt, wo er richtig ist: Wer keine Box nennt, will
    dort weiterhören, wo gerade etwas läuft."""
    fake = _als_integration(_Spotify({"Küche": "id-kueche"}, weckbar=set()))
    entity = types.SimpleNamespace(state={"device": "Küche"})
    await fake.handle_command(entity, "play_playlist", {"name": "Party"})
    assert fake.gestartet == [("id-kueche", "spotify:playlist:party")]


# ── Radio auf eine Box, die Spotify noch festhält ────────────────────────
# Der Fall aus dem Wohnzimmer: Spotify lief, wurde auf Pause gestellt,
# dann sollte Radio kommen - und es kam nichts. Eine pausierte
# Spotify-Sitzung hält den Empfänger der Box besetzt.


def test_only_a_foreign_app_needs_clearing():
    from homepilot.integrations.google_cast import (
        LEERLAUF_APPS,
        STANDARD_EMPFAENGER,
        fremde_app,
    )

    # Spotify, YouTube Music, Radio-Apps: die halten die Box fest.
    assert fremde_app("CC32E753") is True
    assert fremde_app("cc32e753") is True
    # Der Standardempfänger ist der, über den der Hub selbst abspielt -
    # ihn zu beenden hiesse, sich selbst den Boden wegzuziehen.
    assert fremde_app(STANDARD_EMPFAENGER) is False
    assert fremde_app(STANDARD_EMPFAENGER.lower()) is False
    # Eine leere Box und der Bildschirmschoner brauchen nichts. Ein
    # quit_app darauf kostet eine Sekunde für nichts.
    assert fremde_app(None) is False
    assert fremde_app("") is False
    assert fremde_app("   ") is False
    for leerlauf in LEERLAUF_APPS:
        assert fremde_app(leerlauf) is False


def test_a_stream_url_is_not_a_track_title():
    """Solange der Strom keine ICY-Angabe geschickt hat, reicht der
    Chromecast durch, was er abspielt - und auf der Kachel stand die
    nackte Adresse statt des Sendernamens."""
    from homepilot.integrations.tunein import titel_und_interpret

    assert titel_und_interpret("https://stream.srg.ch/srf3_96.mp3?ua=Chromecast") == (
        None,
        None,
    )
    assert titel_und_interpret("http://127.0.0.1:8190/srf3.mp3") == (None, None)
    # Ein echter Titel bleibt einer - auch einer mit Bindestrich.
    assert titel_und_interpret("Ed Sheeran - Shivers") == ("Shivers", "Ed Sheeran")
    assert titel_und_interpret("Nachrichten") == ("Nachrichten", None)
# ── Medienplayer: Fortschritt, Spulen, Zufall/Wiederholung ────────────────
#
# Punkte 1, 2, 3 und 19 der Medienplayer-Runde. Vorher wusste die Kachel
# nur «es läuft etwas» - nicht wie weit, nicht wie lang, und Zufall und
# Wiederholung gab es nur bei Spotify.


def test_fortschritt_kommt_in_sekunden_an():
    from homepilot.integrations.google_cast import cast_media_state

    state = cast_media_state(
        "PLAYING", "Titel", None, "Spotify", 0.4,
        position=63.4321, duration=210.0, position_at=1700.0,
    )
    assert state["position"] == 63.4
    assert state["duration"] == 210.0
    # Der Zeitstempel: Ohne ihn stünde der Balken zwischen zwei Meldungen
    # still, statt weiterzulaufen.
    assert state["position_at"] == 1700.0


def test_ohne_laenge_kein_leeres_feld():
    from homepilot.integrations.google_cast import cast_media_state

    # Radio hat kein Ende, und manche Apps schicken einen leeren String.
    state = cast_media_state("PLAYING", "SRF 3", None, "Radio", 0.4, duration="")
    assert "duration" not in state
    assert "position" not in state


def test_unsinnige_zeiten_werden_verworfen():
    from homepilot.integrations.google_cast import _sekunden

    assert _sekunden(-5) is None
    assert _sekunden(float("inf")) is None
    assert _sekunden(float("nan")) is None
    assert _sekunden(True) is None
    assert _sekunden("12.5") == 12.5


def test_wiederholung_spricht_dieselbe_sprache_wie_spotify():
    from homepilot.integrations.google_cast import repeat_name

    assert repeat_name("REPEAT_OFF") == "off"
    assert repeat_name("REPEAT_ALL") == "all"
    assert repeat_name("REPEAT_SINGLE") == "one"
    # Cast mischt Zufall in den Modus - für die Kachel bleibt es «alles».
    assert repeat_name("REPEAT_ALL_AND_SHUFFLE") == "all"
    assert repeat_name(None) is None
    # Unbekanntes lieber gar nicht behaupten.
    assert repeat_name("QUATSCH") is None


def test_zustaende_sind_ehrlich():
    from homepilot.integrations.google_cast import cast_state_name

    assert cast_state_name("PLAYING", "Spotify") == "playing"
    assert cast_state_name("PAUSED", "Spotify") == "paused"
    # Puffern ist nicht Pause - sonst zeigt die App den falschen Knopf.
    assert cast_state_name("BUFFERING", "Spotify") == "buffering"
    # Es liegt etwas an, es läuft nur gerade nicht.
    assert cast_state_name("IDLE", "Spotify") == "idle"
    # Nichts an, nur der Bildschirmschoner: Ruhe.
    assert cast_state_name("IDLE", "Backdrop") == "standby"
    assert cast_state_name(None, None) == "standby"


def test_queue_update_nachricht():
    from homepilot.integrations.google_cast import queue_update_nachricht

    assert queue_update_nachricht(7, shuffle=True) == {
        "type": "QUEUE_UPDATE",
        "mediaSessionId": 7,
        "shuffle": True,
    }
    assert queue_update_nachricht(7, repeat="one")["repeatMode"] == "REPEAT_SINGLE"
    # Ohne laufende Sitzung keine Kennung - der Empfänger nimmt es
    # trotzdem an, wenn nur eine Wiedergabe läuft.
    assert "mediaSessionId" not in queue_update_nachricht(None, shuffle=False)


def test_queue_update_lehnt_unbekannte_wiederholung_ab():
    import pytest

    from homepilot.core.errors import ConfigError
    from homepilot.integrations.google_cast import queue_update_nachricht

    with pytest.raises(ConfigError, match="off"):
        queue_update_nachricht(1, repeat="rueckwaerts")


async def test_a_renamed_box_is_found_under_its_app_name():
    """«Büro» in der App ist «Nest Küche» im Netz - beide Wege gehen.

    Der Fall dahinter: Wer eine Box auf der Lautsprecher-Seite umbenennt,
    drückt danach in der Musikkarte «Playlist auf Büro». Spotify kennt
    nur den Netz-Namen - ohne die Übersetzung an der Grenze hiesse es
    «'Büro' liess sich nicht erreichen», obwohl die Box dasteht.
    """
    fake = _als_integration(_Spotify({"Nest Küche": "id-kueche"}, weckbar=set()))
    # Das Doppel bekommt eine Cast-Integration, die die Umbenennung kennt.
    cast = types.SimpleNamespace(anzeige_paare=lambda: {"Nest Küche": "Büro"})
    fake.hub = types.SimpleNamespace(
        integrations=types.SimpleNamespace(get=lambda n: cast if n == "google_cast" else None)
    )
    entity = types.SimpleNamespace(state={"device": None})
    await fake.handle_command(
        entity, "play_playlist", {"name": "Party", "device": "Büro"}
    )
    assert fake.gestartet == [("id-kueche", "spotify:playlist:party")]
