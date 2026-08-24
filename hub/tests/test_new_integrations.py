"""Reine Übersetzungslogik von UniFi Protect, Hue Sync Box und Spotify."""

import json
import struct
import zlib
from datetime import UTC

import pytest

from homepilot.integrations.hue_sync import parse_state
from homepilot.integrations.spotify import parse_playback
from homepilot.integrations.unifi_protect import (
    camera_state,
    decode_ws_message,
    login_error,
    rtsp_alias,
    rtsp_url,
)

# ── UniFi Protect: Rahmenformat ──────────────────────────────────────────


def _frame(payload: dict, ptype: int, deflated: bool = True) -> bytes:
    body = json.dumps(payload).encode()
    if deflated:
        body = zlib.compress(body)
    return struct.pack(">BBBBI", ptype, 1, int(deflated), 0, len(body)) + body


def _message(action: dict, payload: dict, deflated: bool = True) -> bytes:
    return _frame(action, 1, deflated) + _frame(payload, 2, deflated)


def test_decode_ws_message_roundtrip():
    action = {"action": "update", "modelKey": "camera", "id": "abc123"}
    payload = {"isMotionDetected": True, "lastMotion": 1755200000000}
    decoded_action, decoded_payload = decode_ws_message(_message(action, payload))
    assert decoded_action == action
    assert decoded_payload == payload


def test_decode_ws_message_uncompressed():
    action = {"action": "update", "modelKey": "camera", "id": "x"}
    decoded_action, decoded_payload = decode_ws_message(
        _message(action, {"state": "CONNECTED"}, deflated=False)
    )
    assert decoded_action["id"] == "x"
    assert decoded_payload == {"state": "CONNECTED"}


def test_decode_ws_message_rejects_truncated_data():
    message = _message({"action": "update"}, {"x": 1})
    with pytest.raises(ValueError):
        decode_ws_message(message[:10])


# ── UniFi Protect: Kamera-Zustand ────────────────────────────────────────


def test_privacy_patch_round_trip():
    from homepilot.integrations.unifi_protect import (
        PRIVACY_ZONE,
        has_privacy_zone,
        privacy_patch,
    )

    camera = {
        "privacyZones": [{"name": "Eigene Zone", "points": [[0, 0], [0.5, 0.5]]}],
        "micVolume": 80,
        "recordingSettings": {"mode": "detections"},
    }
    on = privacy_patch(True, camera)
    # Fremde Zonen bleiben, unsere kommt dazu; Mikrofon stumm, Aufnahme aus.
    assert [zone["name"] for zone in on["privacyZones"]] == ["Eigene Zone", PRIVACY_ZONE]
    assert on["micVolume"] == 0
    assert on["recordingSettings"] == {"mode": "never"}

    with_zone = {**camera, "privacyZones": on["privacyZones"]}
    assert has_privacy_zone(with_zone) and not has_privacy_zone(camera)

    off = privacy_patch(False, with_zone, {"micVolume": 80, "mode": "detections"})
    assert [zone["name"] for zone in off["privacyZones"]] == ["Eigene Zone"]
    assert off["micVolume"] == 80
    assert off["recordingSettings"] == {"mode": "detections"}
    # Ohne gemerkte Werte: sinnvolle Standardwerte statt stumm zu bleiben.
    fallback = privacy_patch(False, with_zone)
    assert fallback["micVolume"] == 100
    assert fallback["recordingSettings"] == {"mode": "always"}


def test_camera_state_maps_connection_and_motion():
    state = camera_state(
        {
            "state": "CONNECTED",
            "isMotionDetected": True,
            "lastMotion": 1755200000000,
            "recordingSettings": {"mode": "always"},
        }
    )
    assert state["state"] == "online"
    assert state["motion"] == "on"
    assert state["recording"] == "always"
    assert state["last_motion"].startswith("2025-")


def test_camera_state_offline_without_motion():
    state = camera_state({"state": "DISCONNECTED"})
    assert state == {
        "state": "offline",
        "recording": None,
        "motion": "off",
        "privacy": "off",
        "stream": False,
    }


def test_doorbell_reports_last_ring():
    state = camera_state(
        {"state": "CONNECTED", "featureFlags": {"hasChime": True}, "lastRing": None}
    )
    assert "last_ring" in state
    assert state["last_ring"] is None


# ── Hue Sync Box ─────────────────────────────────────────────────────────


def test_sync_box_state_active():
    state = parse_state(
        {
            "execution": {
                "syncActive": True,
                "mode": "video",
                "hdmiSource": "input1",
                "brightness": 120,
            },
            "hdmi": {"input1": {"name": "Apple TV"}},
        }
    )
    assert state["state"] == "on"
    assert state["mode"] == "video"
    assert state["input"] == "Apple TV"


def test_sync_box_state_passthrough():
    state = parse_state({"execution": {"syncActive": False, "mode": "passthrough"}})
    assert state["state"] == "off"
    assert state["input"] is None


# ── Spotify ──────────────────────────────────────────────────────────────


def test_playback_playing():
    state = parse_playback(
        {
            "is_playing": True,
            "item": {
                "name": "Yesterday",
                "artists": [{"name": "The Beatles"}],
                "album": {
                    "images": [
                        {"url": "https://img.example/640.jpg", "width": 640},
                        {"url": "https://img.example/300.jpg", "width": 300},
                        {"url": "https://img.example/64.jpg", "width": 64},
                    ]
                },
            },
            "device": {"name": "Wohnzimmer"},
        }
    )
    assert state == {
        "state": "playing",
        "track": "Yesterday",
        "artist": "The Beatles",
        # Die mittlere Cover-Grösse: gross genug für die Kachel, klein
        # genug fürs Datenvolumen.
        "image": "https://img.example/300.jpg",
        "device": "Wohnzimmer",
        # Ohne «context» in der Antwort läuft der Song einzeln, nicht aus
        # einer Playlist.
        "context_uri": None,
        # Fehlende Felder heissen «aus», nicht «unbekannt».
        "shuffle": False,
        "repeat": "off",
    }


def test_album_image_picks_a_sensible_size():
    from homepilot.integrations.spotify import album_image

    # Ohne Bilder gibt es kein Cover - und keinen Fehler.
    assert album_image([]) is None
    assert album_image([{"width": 300}]) is None  # Eintrag ohne URL
    # Nur winzige Bilder: dann eben das grösste davon.
    assert (
        album_image([{"url": "a", "width": 64}, {"url": "b", "width": 160}]) == "b"
    )
    # Spotify ohne Grössenangabe: Hauptsache, es gibt überhaupt eines.
    assert album_image([{"url": "a"}]) == "a"


def test_playback_multiple_artists():
    state = parse_playback(
        {
            "is_playing": False,
            "item": {"name": "X", "artists": [{"name": "A"}, {"name": "B"}]},
        }
    )
    assert state["state"] == "paused"
    assert state["artist"] == "A, B"


def test_playback_nothing_running():
    # 204 vom /me/player: nirgends läuft etwas – normal, keine Störung.
    assert parse_playback(None)["state"] == "idle"


def test_devices_lists_connect_targets():
    from homepilot.integrations.spotify import parse_devices

    devices = parse_devices(
        {
            "devices": [
                {"id": "abc", "name": "Wohnzimmer Lautsprecher", "is_active": True},
                {"id": "def", "name": "Küche", "is_active": False},
                {"id": None, "name": "Geist"},  # ohne ID nicht ansteuerbar
            ]
        }
    )
    assert devices == [
        {"id": "abc", "name": "Wohnzimmer Lautsprecher", "active": True},
        {"id": "def", "name": "Küche", "active": False},
    ]


def test_devices_empty_payload():
    from homepilot.integrations.spotify import parse_devices

    assert parse_devices(None) == []


# ── Roborock ─────────────────────────────────────────────────────────────


class _Status:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def test_vacuum_state_cleaning():
    from homepilot.integrations.roborock import vacuum_state

    state = vacuum_state(
        _Status(
            state_name="cleaning",
            battery=76,
            error_code_name="none",
            clean_area=23_500_000,
            clean_time=1500,
        )
    )
    assert state["state"] == "cleaning"
    assert state["battery"] == 76
    assert "error" not in state
    # mm² der Bibliothek werden zu m² für die App.
    assert state["clean_area_m2"] == 23.5
    assert state["clean_minutes"] == 25


def test_vacuum_state_reports_errors():
    from homepilot.integrations.roborock import vacuum_state

    state = vacuum_state(_Status(state_name="error", battery=12, error_code_name="stuck"))
    assert state["error"] == "stuck"


def test_vacuum_state_survives_missing_fields():
    from homepilot.integrations.roborock import vacuum_state

    assert vacuum_state(_Status())["state"] == "unknown"


def test_vacuum_state_reports_fan_speed_from_code():
    from homepilot.integrations.roborock import vacuum_state

    assert vacuum_state(_Status(state_name="idle", fan_power=103))["fan_speed"] == "turbo"


def test_fan_speed_code_maps_names_and_numbers():
    from homepilot.integrations.roborock import fan_speed_code

    assert fan_speed_code("balanced") == 102
    assert fan_speed_code("max") == 104
    assert fan_speed_code(104) == 104
    assert fan_speed_code("104") == 104


def test_fan_speed_code_rejects_unknown():
    import pytest as _pytest

    from homepilot.integrations.roborock import fan_speed_code

    with _pytest.raises(ValueError):
        fan_speed_code("ultra")


class _Room:
    def __init__(self, segment_id, name):
        self.segment_id, self.name = segment_id, name


def test_parse_rooms_sorted_by_name():
    from homepilot.integrations.roborock import parse_rooms

    rooms = parse_rooms([_Room(18, "Wohnzimmer"), _Room(16, "Bad"), _Room(17, "Küche")])
    assert rooms == [
        {"id": 16, "name": "Bad"},
        {"id": 17, "name": "Küche"},
        {"id": 18, "name": "Wohnzimmer"},
    ]
    assert parse_rooms(None) == []


def test_segment_clean_params():
    import pytest as _pytest

    from homepilot.integrations.roborock import segment_clean_params

    assert segment_clean_params([16, 18]) == [{"segments": [16, 18], "repeat": 1}]
    # Leere Auswahl ist ein Bedienfehler und soll als solcher gemeldet werden.
    with _pytest.raises(ValueError):
        segment_clean_params([])


class _RoomBox:
    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1


class _Dimensions:
    """Bildet den Parser nach: to_img rechnet Kartenkoordinaten in Pixel um."""

    width, height, scale = 200, 100, 1.0

    def to_img(self, point):
        from types import SimpleNamespace

        # Y wird gespiegelt – genau wie ImageDimensions.to_img des Parsers.
        return SimpleNamespace(x=point.x, y=self.height - point.y)


class _Image:
    is_empty = False
    dimensions = _Dimensions()


class _MapData:
    image = _Image()
    rooms = {16: _RoomBox(20, 10, 60, 40), 17: _RoomBox(100, 50, 180, 90)}


def test_room_boxes_to_image_fractions():
    from homepilot.integrations.roborock import room_boxes

    boxes, size = room_boxes(_MapData())
    assert size == {"width": 200, "height": 100}
    # Raum 16: x 20..60 → 0.1..0.3; y 10..40 gespiegelt zu 60..90 → 0.6..0.9
    assert boxes[16] == [0.1, 0.6, 0.3, 0.9]
    assert boxes[17][0] == 0.5 and boxes[17][2] == 0.9


def test_room_boxes_without_image():
    from homepilot.integrations.roborock import room_boxes

    class _Empty:
        image = None
        rooms = {}

    assert room_boxes(_Empty()) == ({}, None)


def test_consumables_become_percent_left():
    from datetime import timedelta

    from homepilot.integrations.roborock import parse_consumables

    class _Consumable:
        main_brush_work_time = timedelta(hours=150)  # halbe Lebensdauer (300 h)
        side_brush_work_time = 720_000  # Sekunden: 200 h → aufgebraucht
        filter_work_time = None  # fehlt → weglassen
        sensor_dirty_time = 0

    parts = {entry["part"]: entry for entry in parse_consumables(_Consumable())}
    assert parts["main_brush_work_time"]["percent_left"] == 50
    assert parts["side_brush_work_time"]["percent_left"] == 0
    assert parts["sensor_dirty_time"]["percent_left"] == 100
    assert "filter_work_time" not in parts


def test_dock_state_collects_known_fields():
    from types import SimpleNamespace

    from homepilot.integrations.roborock import dock_state

    status = SimpleNamespace(
        dock_error_status_name="none",
        dock_type_name="empty_wash_fill_dry_dock",
        wash_phase=2,
        dry_status=1,
    )
    dock = dock_state(status)
    # «none» ist keine Störung und gehört nicht in die Anzeige.
    assert "error" not in dock
    assert dock["type"] == "empty_wash_fill_dry_dock"
    assert dock["wash_phase"] == 2 and dock["drying"] == 1


def test_robot_position_as_image_fractions():
    from homepilot.integrations.roborock import robot_position

    class _WithRobot(_MapData):
        from types import SimpleNamespace

        vacuum_position = SimpleNamespace(x=50, y=30)

    # x 50/200 → 0.25; y gespiegelt zu 70/100 → 0.7
    assert robot_position(_WithRobot()) == [0.25, 0.7]
    # Ohne Position (Sauger meldet keine): None statt geratener Werte.
    assert robot_position(_MapData()) is None


def test_zone_clean_params_inverts_the_map_projection():
    import pytest as _pytest

    from homepilot.integrations.roborock import map_calibration, zone_clean_params

    calibration = map_calibration(_MapData())
    assert calibration is not None
    # Die Bild-Zone von Raum 16 (siehe test_room_boxes_to_image_fractions)
    # muss zurück auf dessen Karten-Millimeter führen - die Umrechnung ist
    # die exakte Umkehrung, egal wie herum die Ecken angegeben sind.
    assert zone_clean_params([0.1, 0.6, 0.3, 0.9], calibration) == [[20, 10, 60, 40, 1]]
    assert zone_clean_params([0.3, 0.9, 0.1, 0.6], calibration) == [[20, 10, 60, 40, 1]]
    # Eine Zone ohne Fläche ist ein Bedienfehler.
    with _pytest.raises(ValueError):
        zone_clean_params([0.2, 0.5, 0.2, 0.9], calibration)
    with _pytest.raises(ValueError):
        zone_clean_params(None, calibration)


# ── Google Cast ──────────────────────────────────────────────────────────


def test_cast_state_playing():
    from homepilot.integrations.google_cast import cast_media_state

    state = cast_media_state("PLAYING", "Yesterday", "The Beatles", "Spotify", 0.45)
    assert state == {
        "state": "playing",
        "track": "Yesterday",
        "artist": "The Beatles",
        "image": None,
        "app": "Spotify",
        "volume": 45,
    }


def test_cast_passes_cover_art_through():
    from homepilot.integrations.google_cast import cast_media_state

    state = cast_media_state(
        "PLAYING", "X", None, "Spotify", 0.5, image="https://img.example/cover.jpg"
    )
    assert state["image"] == "https://img.example/cover.jpg"


def test_cast_backdrop_counts_as_idle_app():
    from homepilot.integrations.google_cast import cast_media_state

    state = cast_media_state("IDLE", None, None, "Backdrop", None)
    assert state["state"] == "idle"
    assert state["app"] is None


def test_cast_reports_mute():
    from homepilot.integrations.google_cast import cast_media_state

    state = cast_media_state("PLAYING", "X", None, "Spotify", 0.6, True)
    assert state["muted"] is True
    # Ohne Angabe bleibt 'muted' weg (Abwärtskompatibilität).
    assert "muted" not in cast_media_state("PLAYING", "X", None, "Spotify", 0.6)


def test_spotify_parse_playlists():
    from homepilot.integrations.spotify import parse_playlists

    result = parse_playlists(
        {
            "items": [
                {"name": "Chill", "uri": "spotify:playlist:1"},
                {"name": "Party", "uri": "spotify:playlist:2"},
                {"name": None, "uri": "spotify:playlist:3"},  # unvollständig → raus
            ]
        }
    )
    assert result == [
        {"name": "Chill", "uri": "spotify:playlist:1"},
        {"name": "Party", "uri": "spotify:playlist:2"},
    ]
    assert parse_playlists(None) == []


def test_spotify_playback_reports_volume():
    state = parse_playback(
        {
            "is_playing": True,
            "item": {"name": "X", "artists": [{"name": "A"}]},
            "device": {"name": "Wohnzimmer", "volume_percent": 42},
        }
    )
    assert state["volume"] == 42


# ── Android TV ───────────────────────────────────────────────────────────


class _Volume:
    def __init__(self, level, max, muted):  # noqa: A002 – Feldname der Bibliothek
        self.level, self.max, self.muted = level, max, muted


def test_tv_state_on_with_app_and_volume():
    from homepilot.integrations.androidtv import tv_state

    state = tv_state(True, "com.netflix.ninja", _Volume(12, 40, False))
    assert state["state"] == "on"
    assert state["app"] == "Netflix"
    assert state["track"] == "Netflix"  # Hauptzeile der Media-Kachel
    assert state["volume"] == 30
    assert state["muted"] is False


def test_tv_state_off_hides_app():
    from homepilot.integrations.androidtv import tv_state

    state = tv_state(False, "com.netflix.ninja", None)
    assert state == {"state": "off", "app": None, "track": None}


def test_app_name_launcher_counts_as_nothing():
    from homepilot.integrations.androidtv import app_name

    assert app_name("com.google.android.tvlauncher") is None
    assert app_name(None) is None
    # Unbekannte Pakete: lesbarer letzter Namensteil statt roher ID.
    assert app_name("tv.arte.plus7") == "Plus7"


def test_app_list_defaults_and_overrides():
    """Was auf den Knöpfen der Kachel steht.

    Das Protokoll kann Apps starten, aber nicht aufzählen - die Liste
    kommt also aus der Konfiguration. Drei Ebenen, und das Spezifischere
    gewinnt ganz: Wer für den Schlafzimmer-Fernseher nur Plex will, soll
    nicht die ganze Vorgabe daneben stehen haben.
    """
    from homepilot.integrations.androidtv import DEFAULT_APPS, app_list

    assert app_list({}, {}) == DEFAULT_APPS
    assert [app["name"] for app in DEFAULT_APPS][:3] == ["Plex", "Zattoo", "YouTube"]

    # Liste für alle Geräte des Blocks.
    alle = app_list({"apps": ["com.plexapp.android"]}, {})
    assert alle == [{"name": "Plex", "app": "com.plexapp.android"}]

    # Das Gerät sticht den Block.
    eigen = app_list(
        {"apps": ["com.plexapp.android"]},
        {"apps": [{"name": "Kino", "app": "com.beispiel.kino"}]},
    )
    assert eigen == [{"name": "Kino", "app": "com.beispiel.kino"}]


def test_app_list_never_shows_a_raw_package_id():
    """Auf einem Knopf soll kein «com.foo.bar» stehen."""
    from homepilot.integrations.androidtv import app_list

    apps = app_list({"apps": ["com.zattoo.player", "tv.arte.plus7", {"app": "x.y.kodi"}]}, {})
    assert [app["name"] for app in apps] == ["Zattoo", "Plus7", "Kodi"]

    # Unsinn fällt heraus, statt eine leere Schaltfläche zu erzeugen.
    assert app_list({"apps": [None, "", {"name": "Ohne Paket"}, 42]}, {}) == []


def test_sleep_left_counts_down_and_never_shows_zero():
    """Solange etwas läuft, soll auch etwas dastehen.

    Aufgerundet, damit in der letzten halben Minute «1 min» steht und
    nicht «0» - eine Null neben einem laufenden Timer liest sich wie ein
    Fehler. Abgelaufen heisst dagegen ausdrücklich «kein Timer».
    """
    from homepilot.integrations.androidtv import sleep_left

    assert sleep_left(None, 1000.0) is None
    assert sleep_left(1000.0 + 30 * 60, 1000.0) == 30
    assert sleep_left(1000.0 + 29 * 60 + 30, 1000.0) == 30
    assert sleep_left(1000.0 + 61, 1000.0) == 2
    assert sleep_left(1000.0 + 30, 1000.0) == 1
    assert sleep_left(1000.0, 1000.0) is None
    assert sleep_left(900.0, 1000.0) is None


def test_cert_paths_are_stable_and_shared():
    from homepilot.integrations.androidtv import cert_paths

    cert, key = cert_paths("/etc/homepilot", "192.168.1.50")
    assert cert == "/etc/homepilot/androidtv-192.168.1.50.pem"
    assert key == "/etc/homepilot/androidtv-192.168.1.50.key"


# ── Ring ─────────────────────────────────────────────────────────────────


def test_ring_device_state():
    from homepilot.integrations.ring import device_state

    assert device_state(85, None) == {"state": "online", "motion": "off", "battery": 85}
    assert device_state(None, "offline") == {"state": "offline", "motion": "off"}


def test_a_doorbell_has_its_ring_field_before_it_ever_rings():
    """Sonst lässt sich kein Ablauf darauf bauen.

    Ohne den Eintrag entsteht «ring» erst beim ersten Klingeln - und bis
    dahin sehen weder der Ablauf-Editor noch die Vorlagen, dass dieses
    Gerät klingeln kann. Wer eine Nachricht dafür einrichten will, müsste
    warten, bis jemand vor der Türe steht.
    """
    from homepilot.integrations.ring import device_state

    klingel = device_state(90, None, klingel=True)
    assert klingel["ring"] == "off"
    # Eine Kamera ohne Klingel bekommt das Feld nicht - sie kann nicht
    # klingeln, und ein Auslöser dafür wäre eine Attrappe.
    assert "ring" not in device_state(90, None)


def test_gast_sieht_tueroeffner_nicht_ohne_freigabe():
    from homepilot.core.users import Role, User

    gast = User(name="G", role=Role.GUEST, token="t")
    assert gast.may_see("ring.intercom", "lock") is False
    freigegeben = User(name="F", role=Role.GUEST, token="t", allow=["ring.intercom"])
    assert freigegeben.may_see("ring.intercom", "lock") is True


def test_ring_event_fields():
    from homepilot.integrations.ring import event_fields

    ding = event_fields("ding", 1755200000.0)
    assert ding["ring"] == "on"
    assert ding["last_ring"].startswith("2025-")
    motion = event_fields("motion", 1755200000.0)
    assert motion["motion"] == "on"
    assert "last_motion" in motion
    # Unbekannte Ereignisarten ändern nichts.
    assert event_fields("on_demand", 1755200000.0) == {}


class _Alert:
    """Eine aktive Meldung, so wie ring_doorbell sie liefert."""

    def __init__(self, doorbot_id, ident, kind, now, expires_in=180):
        self.doorbot_id = doorbot_id
        self.id = ident
        self.kind = kind
        self.now = now
        self.expires_in = expires_in


def test_ring_new_alerts_reports_each_ring_once():
    """Dieselbe Klingel bleibt bei Ring Minuten lang «aktiv».

    Ohne Gedächtnis käme sie bei jeder Abfrage erneut - alle zehn Sekunden
    eine Nachricht, bis sie abläuft.
    """
    from homepilot.integrations.ring import new_alerts

    klingel = _Alert(11, 5001, "ding", 1000.0)
    frisch, gemerkt = new_alerts([klingel], {}, 1005.0)
    assert [event.id for event in frisch] == [5001]

    # Zweite Abfrage, dieselbe Meldung – nichts Neues.
    frisch, gemerkt = new_alerts([klingel], gemerkt, 1015.0)
    assert frisch == []

    # Bewegung am selben Gerät ist etwas anderes.
    frisch, gemerkt = new_alerts(
        [klingel, _Alert(11, 5002, "motion", 1020.0)], gemerkt, 1025.0
    )
    assert [event.kind for event in frisch] == ["motion"]


def test_ring_new_alerts_forgets_what_has_expired():
    """Das Gedächtnis darf nicht mit jedem Besucher wachsen."""
    from homepilot.integrations.ring import new_alerts

    _, gemerkt = new_alerts([_Alert(11, 5001, "ding", 1000.0, 60)], {}, 1000.0)
    assert len(gemerkt) == 1
    _, gemerkt = new_alerts([], gemerkt, 1100.0)
    assert gemerkt == {}


def test_ring_retry_delay_grows_and_stops_growing():
    from homepilot.integrations.ring import RETRY_SECONDS, retry_delay

    assert retry_delay(1) == RETRY_SECONDS[0]
    assert retry_delay(2) == RETRY_SECONDS[1]
    assert retry_delay(99) == RETRY_SECONDS[-1]
    # Ein unsinniger Zähler soll keinen Absturz geben.
    assert retry_delay(0) == RETRY_SECONDS[0]


class _Empfaenger:
    def __init__(self, laeuft):
        self._laeuft = laeuft

    def is_started(self):
        return self._laeuft


class _Zuhoerer:
    def __init__(self, started=True, empfaenger=None):
        self.started = started
        self._receiver = empfaenger


def test_ring_channel_alive_sees_a_self_terminated_push_client():
    """«started» heisst nur: niemand hat ihn gestoppt.

    Der Fall aus dem Betrieb: firebase_messaging meldet «erfolgreich
    angemeldet» und schaltet sich eine Sekunde später wegen einer
    beschädigten Anmeldung selbst ab. Der Zuhörer darüber merkt davon
    nichts - von aussen sah alles gut aus, und es klingelte bloss nie.
    """
    from homepilot.integrations.ring import channel_alive

    assert channel_alive(_Zuhoerer(True, _Empfaenger(True))) is True
    assert channel_alive(_Zuhoerer(True, _Empfaenger(False))) is False
    # Gestoppt ist gestoppt.
    assert channel_alive(_Zuhoerer(False, _Empfaenger(True))) is False
    # Ohne Einblick gilt er als gesund – die Abfrage fängt den Fall auf.
    assert channel_alive(_Zuhoerer(True, None)) is True
    assert channel_alive(None) is False


def test_ring_retry_never_hammers_the_registration():
    """Ein Wiederanlauf ohne Pause ist kein Wiederanlauf, sondern eine Schleife.

    Der Fall aus dem Betrieb: Ein frisch aufgebauter Kanal galt sofort als
    tot - der Push-Client meldet sich erst Sekunden später als «läuft» -,
    und der Hub warf die Anmeldung weg und registrierte sich neu. Im
    Sekundentakt, bis Google mit PHONE_REGISTRATION_ERROR abwies.
    """
    from homepilot.integrations.ring import (
        QUICK_DEATH_SECONDS,
        RETRY_SECONDS,
        STARTUP_GRACE_SECONDS,
        retry_delay,
    )

    # Die Anlaufzeit muss kürzer sein als die Frist, ab der ein Abriss als
    # «sofort» gilt - sonst gälte jeder Kanal als beschädigt.
    assert 0 < STARTUP_GRACE_SECONDS < QUICK_DEATH_SECONDS
    # Und jeder weitere Anlauf wartet länger als der vorige.
    assert retry_delay(1) < retry_delay(2) <= retry_delay(99)
    assert retry_delay(99) == RETRY_SECONDS[-1]


def test_ring_health_detail_names_the_reason():
    """Die eine Störung, die man sonst nie bemerkt, steht im Klartext da."""
    from homepilot.integrations.ring import health_detail

    assert "verbunden" in health_detail(True, None)
    kaputt = health_detail(False, "Anmeldung beim Push-Dienst abgelehnt")
    assert "nicht verbunden" in kaputt
    assert "Anmeldung beim Push-Dienst abgelehnt" in kaputt
    # Auch ohne bekannten Grund eine brauchbare Auskunft.
    assert "nicht verbunden" in health_detail(False, None)


def test_ring_health_detail_off_by_choice_is_no_warning():
    """Wer Googles Push-Dienst bewusst aussperrt (events: false), hat
    keine Störung - die Abfrage ist dann der normale Weg, nicht der
    Ersatz. Kein «nicht verbunden», kein Warnton, dafür steht da, wie
    schnell die Klingel trotzdem ankommt."""
    from homepilot.integrations.ring import DING_POLL_SECONDS, health_detail

    ruhig = health_detail(False, None, abgeschaltet=True)
    assert "abgeschaltet" in ruhig
    assert f"{DING_POLL_SECONDS} s" in ruhig
    assert "nicht verbunden" not in ruhig
    assert "ersatzweise" not in ruhig


# ── Google Calendar ──────────────────────────────────────────────────────


def test_calendar_next_event():
    from datetime import datetime

    from homepilot.integrations.google_calendar import parse_events

    now = datetime(2026, 8, 15, 8, 0, tzinfo=UTC)
    state = parse_events(
        [
            {
                "summary": "Zahnarzt",
                "start": {"dateTime": "2026-08-15T10:00:00+02:00"},
                "end": {"dateTime": "2026-08-15T11:00:00+02:00"},
                "location": "Luzern",
            },
            {
                "summary": "Ferien",
                "start": {"date": "2026-08-16"},
                "end": {"date": "2026-08-20"},
            },
        ],
        now,
    )
    assert state["state"] == "Zahnarzt"
    assert state["next_all_day"] is False
    assert len(state["events"]) == 2
    assert state["events"][1]["all_day"] is True


def test_calendar_skips_finished_events():
    from datetime import datetime

    from homepilot.integrations.google_calendar import parse_events

    now = datetime(2026, 8, 15, 12, 0, tzinfo=UTC)
    state = parse_events(
        [
            {
                "summary": "Vorbei",
                "start": {"dateTime": "2026-08-15T08:00:00Z"},
                "end": {"dateTime": "2026-08-15T09:00:00Z"},
            }
        ],
        now,
    )
    assert state["state"] == "frei"
    assert state["events"] == []


def test_calendar_empty_means_free():
    from datetime import datetime

    from homepilot.integrations.google_calendar import parse_events

    state = parse_events([], datetime.now(UTC))
    assert state["state"] == "frei"
    assert state["next_start"] is None


# ── Wetter (Open-Meteo) ──────────────────────────────────────────────────


def test_weather_parse_forecast():
    from homepilot.integrations.weather import parse_forecast

    state = parse_forecast(
        {
            "current": {"temperature_2m": 32.5, "weather_code": 1},
            "daily": {
                "time": ["2026-08-15", "2026-08-16"],
                "weather_code": [3, 80],
                "temperature_2m_max": [33.2, 28.2],
                "temperature_2m_min": [18.1, 16.4],
                "precipitation_probability_max": [10, 60],
            },
        }
    )
    assert state["temperature"] == 32
    assert state["state"] == "Meist klar"
    assert len(state["days"]) == 2
    assert state["days"][0] == {
        "date": "2026-08-15",
        "code": 3,
        "text": "Bedeckt",
        "icon": "cloud-outline",
        "high": 33,
        "low": 18,
        "rain": 10,
    }
    assert state["days"][1]["text"] == "Regenschauer"


def test_weather_unknown_code_stays_neutral():
    from homepilot.integrations.weather import describe_code

    assert describe_code(999)[0] == "—"
    assert describe_code(None)[1] == "cloud-outline"


# ── MeteoAlarm-Gebietsfilter ─────────────────────────────────────────────


def test_meteoalarm_area_filter():
    from homepilot.integrations.meteoalarm import filter_by_area

    alerts = [
        {"event": "Gewitter", "area": "Kanton Luzern"},
        {"event": "Wind", "area": "Genferseeregion"},
        {"event": "Hitze", "area": "Zentralschweiz und Luzern"},
    ]
    zell = filter_by_area(alerts, ["Luzern", "Zentralschweiz"])
    assert [a["event"] for a in zell] == ["Gewitter", "Hitze"]
    # Ohne Filter bleibt alles.
    assert len(filter_by_area(alerts, [])) == 3


# ── Overkiz (Somfy-Storen) ───────────────────────────────────────────────


def test_overkiz_cover_state_position_and_tilt():
    from homepilot.integrations.overkiz import cover_state

    # Overkiz zählt Geschlossenheit: closure 30 = 70 % offen, Lamellen-
    # Orientierung 45 = 55 % offen - beides wird gedreht.
    state = cover_state(
        {
            "core:ClosureState": 30,
            "core:SlateOrientationState": 45,
            "core:OpenClosedState": "open",
        }
    )
    assert state["position"] == 70
    assert state["tilt"] == 55
    assert state["state"] == "partial"


def test_overkiz_learned_travel():
    from homepilot.integrations.overkiz import learned_travel

    # Volle Fahrt in 24 s: gelernt sind 24 s.
    assert learned_travel(None, 100, 0, 24) == 24
    # Halbe Fahrt in 15 s: hochgerechnet 30 s, gemittelt mit den alten 24 -> 27.
    assert learned_travel(24, 100, 50, 15) == 27
    # Zu kurze Fahrten lehren nichts.
    assert learned_travel(24, 50, 40, 2.5) is None
    assert learned_travel(24, 50, 60, 10) is None
    # Ausreisser werden eingefangen.
    assert learned_travel(None, 100, 0, 600) == 180


def test_overkiz_cover_state_open_and_closed():
    from homepilot.integrations.overkiz import cover_state

    assert cover_state({"core:ClosureState": 0})["state"] == "open"
    assert cover_state({"core:ClosureState": 100})["state"] == "closed"
    # Nur OpenClosed ohne Position.
    assert cover_state({"core:OpenClosedState": "closed"})["state"] == "closed"
    # Nichts Verwertbares → unknown, kein Absturz.
    assert cover_state({})["state"] == "unknown"


def test_calendar_marks_birthdays_and_sorts():
    from datetime import datetime

    from homepilot.integrations.google_calendar import is_birthday_calendar, parse_events

    now = datetime(2026, 8, 16, 8, 0, tzinfo=UTC)
    state = parse_events(
        [
            {
                "summary": "Livia",
                "_birthday": True,
                "start": {"date": "2026-08-28"},
                "end": {"date": "2026-08-29"},
            },
            {
                "summary": "Zahnarzt",
                "start": {"dateTime": "2026-08-17T14:30:00Z"},
                "end": {"dateTime": "2026-08-17T15:00:00Z"},
            },
        ],
        now,
    )
    # Sortiert nach Beginn: Zahnarzt (17.) vor Geburtstag (28.).
    assert [event["summary"] for event in state["events"]] == ["Zahnarzt", "Livia"]
    assert state["events"][1]["birthday"] is True
    # 'Nächster Termin' überspringt Geburtstage.
    assert state["state"] == "Zahnarzt"

    assert is_birthday_calendar("addressbook#contacts@group.v.calendar.google.com")
    assert not is_birthday_calendar("primary")


def test_calendar_build_event():
    import pytest as _pytest

    from homepilot.integrations.google_calendar import build_event

    timed = build_event("Zahnarzt", "17.08.2026", "14:30", 45)
    assert timed["start"]["dateTime"] == "2026-08-17T14:30:00"
    assert timed["end"]["dateTime"] == "2026-08-17T15:15:00"
    all_day = build_event("Ferien", "2026-10-01")
    assert all_day["start"] == {"date": "2026-10-01"}
    assert all_day["end"] == {"date": "2026-10-02"}
    with _pytest.raises(ValueError):
        build_event("   ", "17.08.2026")


# ── Nuki ─────────────────────────────────────────────────────────────────


def test_nuki_lock_state():
    from homepilot.integrations.nuki import lock_state

    state = lock_state(
        {
            "smartlockId": 1,
            "name": "Wohnungstüre",
            "state": {
                "state": 1,
                "batteryCharge": 78,
                "batteryCritical": False,
                "doorState": 2,
            },
        }
    )
    assert state == {"state": "locked", "battery": 78, "door": "closed"}

    open_state = lock_state({"state": {"state": 5, "batteryCritical": True, "doorState": 3}})
    assert open_state["state"] == "unlatched"
    assert open_state["battery_critical"] is True
    assert open_state["door"] == "open"

    assert lock_state({})["state"] == "unknown"


# ── V-ZUG: Restzeit ──────────────────────────────────────────────────────


def test_vzug_minutes_until():
    from homepilot.integrations.vzug import minutes_until

    noon = 12 * 60
    assert minutes_until("1h05", noon) == 65        # Dauer-Format
    assert minutes_until("0h47", noon) == 47
    assert minutes_until("13:30", noon) == 90       # Uhrzeit heute
    assert minutes_until("00:15", 23 * 60) == 75    # über Mitternacht
    assert minutes_until("42", noon) == 42          # rohe Minuten
    # Die Firmware wechselt die Schreibweise; alle müssen ankommen.
    assert minutes_until("1h 20min", noon) == 80
    assert minutes_until("1h", noon) == 60
    assert minutes_until("20min", noon) == 20
    assert minutes_until("", noon) is None
    assert minutes_until("kaputt", noon) is None
    assert minutes_until("1h kaputt", noon) is None


def test_vzug_status_reports_minutes_left():
    from homepilot.integrations.vzug import parse_device_status

    running = parse_device_status(
        {
            "Inactive": "false",
            "Program": "Eco",
            "Status": "Läuft",
            "ProgramEnd": {"End": "13:30", "EndType": "h"},
        },
        now_minutes=12 * 60,
    )
    assert running["state"] == "running"
    assert running["minutes_left"] == 90

    idle = parse_device_status({"Inactive": "true"}, now_minutes=0)
    assert idle["state"] == "idle"
    # Ausdrücklich None und nicht «Schlüssel weg»: Der Hub merged die
    # Zustände, ein fehlendes Feld behielte seinen alten Wert.
    assert idle["minutes_left"] is None


def test_vzug_standby_with_display_on_is_not_running():
    """«Inactive: false» heisst nur: Die Anzeige ist an. Ohne Programm und
    Status läuft nichts - sonst steht die Maschine dauerhaft als «läuft»
    auf der Startseite."""
    from homepilot.integrations.vzug import parse_device_status

    standby = parse_device_status(
        {"Inactive": "false", "Program": "", "Status": "", "ProgramEnd": {"End": "1"}},
        now_minutes=12 * 60,
    )
    assert standby["state"] == "idle"
    assert standby["minutes_left"] is None


def test_vzug_a_frozen_countdown_is_unmasked():
    """Der Fall aus dem Betrieb: tagelang «noch 1 min», obwohl längst
    fertig. Eine laufende Maschine zählt runter - dieselbe Restzeit über
    Minuten hinweg ist eine eingefrorene Anzeige."""
    from homepilot.integrations.vzug import unfrozen_status

    merker: dict[str, tuple[int, float]] = {}
    laufend = {"state": "running", "minutes_left": 1, "program": "Eco"}

    # Frisch gemeldet: alles gut, die Uhr beginnt zu laufen.
    assert unfrozen_status(dict(laufend), merker, "vzug.wama", 0.0) == laufend
    # Nach zwei Minuten unverändert: noch im Rahmen (Abfrage ist minütlich).
    assert unfrozen_status(dict(laufend), merker, "vzug.wama", 120.0) == laufend
    # Nach sechs Minuten immer noch «1 min»: Das ist keine Restzeit mehr.
    entlarvt = unfrozen_status(dict(laufend), merker, "vzug.wama", 360.0)
    assert entlarvt["minutes_left"] is None
    assert entlarvt["state"] == "idle"

    # Eine Maschine, die WIRKLICH zählt, bleibt unangetastet ...
    assert (
        unfrozen_status(
            {"state": "running", "minutes_left": 42}, merker, "vzug.gs", 0.0
        )["minutes_left"]
        == 42
    )
    assert (
        unfrozen_status(
            {"state": "running", "minutes_left": 41}, merker, "vzug.gs", 60.0
        )["minutes_left"]
        == 41
    )

    # ... und eine mittendrin pausierte verliert nur die stehende Restzeit,
    # gilt aber nicht als fertig.
    merker.clear()
    pausiert = {"state": "running", "minutes_left": 34}
    unfrozen_status(dict(pausiert), merker, "vzug.wama", 0.0)
    stehend = unfrozen_status(dict(pausiert), merker, "vzug.wama", 400.0)
    assert stehend["minutes_left"] is None
    assert stehend["state"] == "running"

    # Ist das Gerät fertig gemeldet, wird der Merker aufgeräumt.
    unfrozen_status({"state": "idle"}, merker, "vzug.wama", 500.0)
    assert "vzug.wama" not in merker


def test_vzug_the_countdown_really_disappears_from_the_entity():
    """Der eigentliche Fehler - und der Grund, warum die erste Korrektur
    nichts brachte: registry.update_state *merged* die Änderungen. Ein
    Feld, das die Integration einfach weglässt, behält seinen alten Wert.
    Die Waschmaschine stand deshalb weiter auf «noch 1 min», obwohl der
    Zustand längst auf «fertig» stand.

    Dieser Test geht durch die echte Registry, nicht nur durchs dict -
    genau dort war die Lücke."""
    import asyncio

    from homepilot.core.entity import Entity, EntityKind
    from homepilot.core.events import EventBus
    from homepilot.core.registry import EntityRegistry
    from homepilot.integrations.vzug import parse_device_status, unfrozen_status

    async def check():
        registry = EntityRegistry(EventBus())
        await registry.add(
            Entity(
                id="vzug.wama",
                kind=EntityKind.APPLIANCE,
                name="Waschmaschine",
                integration="vzug",
                state={"state": "unknown"},
                commands=[],
            )
        )
        merker: dict[str, tuple[int, float]] = {}
        laeuft = {
            "Inactive": "false",
            "Program": "Kochwäsche",
            "Status": "Läuft",
            "ProgramEnd": {"End": "1"},
        }

        # Die Maschine meldet «noch 1 min» - erst einmal geglaubt.
        for jetzt in (0.0, 60.0):
            await registry.update_state(
                "vzug.wama",
                unfrozen_status(parse_device_status(laeuft), merker, "vzug.wama", jetzt),
                available=True,
            )
        assert registry.get("vzug.wama").state["minutes_left"] == 1

        # Sechs Minuten später steht dieselbe Zahl - das ist keine
        # Restzeit mehr, und sie muss aus der Entität verschwinden.
        await registry.update_state(
            "vzug.wama",
            unfrozen_status(parse_device_status(laeuft), merker, "vzug.wama", 400.0),
            available=True,
        )
        zustand = registry.get("vzug.wama").state
        assert zustand["minutes_left"] is None
        assert zustand["state"] == "idle"

        # Und auch der ganz normale Weg zum Programmende räumt sie weg:
        # Das Gerät meldet «fertig», die Zahl darf nicht kleben bleiben.
        await registry.update_state(
            "vzug.wama",
            parse_device_status({"Inactive": "false", "Program": "Eco",
                                 "ProgramEnd": {"End": "5"}}),
            available=True,
        )
        assert registry.get("vzug.wama").state["minutes_left"] == 5
        await registry.update_state(
            "vzug.wama", parse_device_status({"Inactive": "true"}), available=True
        )
        assert registry.get("vzug.wama").state["minutes_left"] is None

    asyncio.run(check())


def test_login_error_names_the_real_cause():
    # 499 heisst «zweiter Faktor fehlt», nicht «Passwort falsch» – die
    # Meldung muss zur richtigen Abhilfe führen.
    assert "Zwei-Faktor" in login_error(499)
    assert "Local Access Only" in login_error(499)
    assert "Passwort" in login_error(401)
    assert "503" in login_error(503)


# ── UniFi Protect: Live-Bild ─────────────────────────────────────────────


CHANNELS = {
    "channels": [
        {"name": "High", "isRtspEnabled": False, "rtspAlias": None},
        {"name": "Medium", "isRtspEnabled": True, "rtspAlias": "abcMEDIUM"},
        {"name": "Low", "isRtspEnabled": True, "rtspAlias": "abcLOW"},
    ]
}


def test_rtsp_alias_prefers_wanted_quality():
    assert rtsp_alias(CHANNELS, "medium") == "abcMEDIUM"
    assert rtsp_alias(CHANNELS, "low") == "abcLOW"
    # High ist nicht freigeschaltet → die nächstbeste statt gar keine.
    assert rtsp_alias(CHANNELS, "high") == "abcMEDIUM"


def test_rtsp_alias_none_without_enabled_channel():
    assert rtsp_alias({"channels": []}) is None
    assert rtsp_alias({"channels": [{"name": "High", "isRtspEnabled": False}]}) is None
    # Ohne RTSP kein Live-Bild – und die App bietet auch keines an.
    assert camera_state({"state": "CONNECTED", "channels": []})["stream"] is False
    assert camera_state({"state": "CONNECTED", **CHANNELS})["stream"] is True


def test_rtsp_url_uses_the_plain_protect_port():
    # 7447 statt 7441: die TLS/SRTP-Variante versteht mediamtx nicht sauber.
    assert rtsp_url("10.10.1.1", "abcMEDIUM") == "rtsp://10.10.1.1:7447/abcMEDIUM"


def test_pick_device_prefers_requested_then_active_then_first():
    """Eine Playlist muss auch aus völliger Stille starten können – ohne
    Ziel würde Spotify mit «kein aktives Gerät» abwinken."""
    from homepilot.integrations.spotify import pick_device

    devices = {"Terrasse": "id-t", "Wohnzimmer": "id-w"}
    assert pick_device("Wohnzimmer", "Terrasse", devices) == "id-w"
    assert pick_device("", "Terrasse", devices) == "id-t"
    assert pick_device("", None, devices) == "id-t"          # erster sichtbarer
    assert pick_device("Unbekannt", None, devices) == "id-t" # Tippfehler → erster
    assert pick_device("", None, {}) is None


def test_extract_code_accepts_full_redirect_url_or_bare_code():
    """Der Anmelde-Helfer nimmt die ganze Adresszeile entgegen – niemand soll
    von Hand den Code zwischen 'code=' und '&' herausklauben müssen."""
    from homepilot.integrations.spotify import extract_code

    url = "http://127.0.0.1:8888/callback?code=AQAx95_ABC&state=x"
    assert extract_code(url) == "AQAx95_ABC"
    assert extract_code("  AQBBARE  ") == "AQBBARE"
    assert extract_code("callback?code=NUR_QUERY") == "NUR_QUERY"


def test_merge_device_names_appends_sleeping_cast_boxes():
    """Schlafende Cast-Boxen bleiben wählbar – beim Start werden sie geweckt."""
    from homepilot.integrations.spotify import merge_device_names

    assert merge_device_names(["iPhone", "Terrasse"], ["Terrasse", "Küche"]) == [
        "iPhone", "Terrasse", "Küche",
    ]
    assert merge_device_names([], ["Terrasse"]) == ["Terrasse"]
    assert merge_device_names(["Terrasse"], []) == ["Terrasse"]


def test_hue_scenes_keep_their_names():
    """«Entspannen» gibt es in jedem Zimmer – ohne Unterscheidung wäre die
    Auswahl ein Ratespiel."""
    from homepilot.integrations.hue import parse_scenes

    parsed = parse_scenes(
        {
            "data": [
                {
                    "id": "aaa",
                    "metadata": {"name": "Entspannen"},
                    "group": {"rid": "wohnzimmer-1234"},
                },
                {
                    "id": "bbb",
                    "metadata": {"name": "Entspannen"},
                    "group": {"rid": "buero-5678"},
                },
                {"id": "ccc", "metadata": {"name": "Hell"}},
                {"metadata": {"name": "Ohne Kennung"}},
            ]
        },
        {"wohnzimmer-1234": "Wohnzimmer", "buero-5678": "Büro"},
    )
    nach_name = {scene.label: scene.id for scene in parsed}
    # Beide gleichnamigen bekommen den Zusatz, nicht nur die zweite: Sonst
    # stünde «Entspannen» neben «Entspannen (Büro)», und welches Zimmer
    # das namenlose ist, stünde nirgends.
    assert nach_name["Entspannen (Wohnzimmer)"] == "aaa"
    assert nach_name["Entspannen (Büro)"] == "bbb"
    # Ein eindeutiger Name bleibt, wie er ist.
    assert nach_name["Hell"] == "ccc"
    assert len(parsed) == 3
    # Der Raum hängt an der Szene – die Entität landet später darin.
    assert parsed[0].room == "Wohnzimmer"
    assert parsed[2].room is None


def test_hue_scene_without_known_room_falls_back_to_its_id():
    """Kennt die Bridge den Raum nicht, muss der Name trotzdem eindeutig
    bleiben – sonst verschluckt das Wörterbuch eine der beiden Szenen."""
    from homepilot.integrations.hue import parse_scenes

    parsed = parse_scenes(
        {
            "data": [
                {"id": "a", "metadata": {"name": "Kino"}, "group": {"rid": "abcdefgh-1"}},
                {"id": "b", "metadata": {"name": "Kino"}, "group": {"rid": "ijklmnop-2"}},
                # Zwei gleichnamige im selben Zimmer gibt es auch.
                {"id": "c", "metadata": {"name": "Nacht"}, "group": {"rid": "raum"}},
                {"id": "d", "metadata": {"name": "Nacht"}, "group": {"rid": "raum"}},
            ]
        },
        {"raum": "Schlafzimmer"},
    )
    labels = [scene.label for scene in parsed]
    assert labels == [
        "Kino (abcdefgh)",
        "Kino (ijklmnop)",
        "Nacht (Schlafzimmer)",
        "Nacht (Schlafzimmer) 2",
    ]
    assert len(set(labels)) == 4


def test_hue_rooms_and_zones_share_one_lookup():
    """Eine Szene kann an einem Zimmer oder an einer Zone hängen – für
    ihren Namen ist der Unterschied ohne Belang."""
    from homepilot.integrations.hue import parse_rooms

    rooms = parse_rooms(
        {"data": [{"id": "r1", "metadata": {"name": "Küche"}}]},
        {"data": [{"id": "z1", "metadata": {"name": "Erdgeschoss"}}]},
        None,
    )
    assert rooms == {"r1": "Küche", "z1": "Erdgeschoss"}


def test_hue_scene_is_active_while_the_lamps_still_stand_that_way():
    """Verstellt jemand eine Lampe von Hand, gilt die Szene nicht mehr –
    ein Knopf, der dann noch leuchtet, wäre eine Lüge."""
    from homepilot.integrations.hue import scene_state

    assert scene_state({"status": {"active": "static"}}) == "active"
    assert scene_state({"status": {"active": "dynamic_palette"}}) == "active"
    assert scene_state({"status": {"active": "inactive"}}) == "idle"
    # Ältere Firmware meldet gar keinen Status – dann lieber «bereit» als
    # eine erfundene Behauptung.
    assert scene_state({}) == "idle"


def test_hue_room_is_only_taken_over_when_the_house_knows_it():
    """Die Bridge kennt ihre eigenen Zimmernamen. Übernähme man sie
    ungeprüft, stünden in der App Räume, die es im Haus nicht gibt."""
    from homepilot.integrations.hue import matching_room

    bekannt = ["Wohnzimmer", "Büro"]
    assert matching_room("Wohnzimmer", bekannt) == "Wohnzimmer"
    # Gross-/Kleinschreibung entscheidet nicht darüber, ob ein Zimmer
    # dasselbe ist.
    assert matching_room("wohnzimmer", bekannt) == "Wohnzimmer"
    assert matching_room("Living room", bekannt) is None
    assert matching_room(None, bekannt) is None


def test_storm_warning_only_fires_for_real_wind_alerts():
    """Somfy-Behänge nehmen im Wind Schaden – aber eine Vorwarnung soll
    nicht das halbe Haus aufreissen."""
    from homepilot.integrations.shading import DEFAULT_STORM_WORDS, storm_warning

    words = DEFAULT_STORM_WORDS
    assert storm_warning(
        {"alerts": [{"event": "Sturmböen", "severity": "Severe"}]}, words
    )
    # Andere Warnungen gehen die Storen nichts an.
    assert not storm_warning(
        {"alerts": [{"event": "Hitzewelle", "severity": "Severe"}]}, words
    )
    # Vorwarnstufe reicht nicht.
    assert not storm_warning(
        {"alerts": [{"event": "Wind", "severity": "Minor"}]}, words
    )
    assert not storm_warning({"alerts": []}, words)
    assert not storm_warning({}, words)


def test_frost_night_looks_at_today_and_tomorrow():
    from homepilot.core.watchdog import frost_night

    days = [
        {"date": "2026-04-10", "low": 6.0},
        {"date": "2026-04-11", "low": 1.5},
        {"date": "2026-04-12", "low": -3.0},
    ]
    # Heute mild, morgen Frost – gemeldet wird morgen.
    assert frost_night(days, "2026-04-10") == {"date": "2026-04-11", "low": 1.5}
    # Übermorgen ist zu weit weg, dafür gibt es die Wettervorhersage.
    assert frost_night(days[:1], "2026-04-10") is None
    assert frost_night([], "2026-04-10") is None


def test_geofence_normalises_the_many_names_for_the_same_thing():
    """Kurzbefehle und Tasker nennen dasselbe verschieden – einmal
    übersetzt statt in jedem Ablauf."""
    from homepilot.integrations.geofence import normalise_event

    for word in ("enter", "arrived", "home", "true", "IN"):
        assert normalise_event(word) == "home"
    for word in ("leave", "exited", "away", "false", "0"):
        assert normalise_event(word) == "away"
    assert normalise_event("vielleicht") is None


def test_geofence_zones_need_an_id():
    from homepilot.integrations.geofence import parse_zones

    zones = parse_zones([{"id": "stefan", "name": "Stefan"}, {"name": "ohne Kennung"}])
    assert zones == [{"id": "stefan", "name": "Stefan"}]


def test_protect_events_become_a_timeline():
    """«Letzte Bewegung um 16:45» beantwortet nur die halbe Frage."""
    from homepilot.integrations.unifi_protect import parse_events

    payload = [
        {"id": "1", "type": "motion", "start": 1_700_000_000_000, "camera": "cam1"},
        {
            "id": "2",
            "type": "smartDetectZone",
            "start": 1_700_000_600_000,
            "end": 1_700_000_620_000,
            "camera": "cam1",
            "smartDetectTypes": ["person"],
        },
        # Andere Kamera und Verwaltungskram bleiben draussen.
        {"id": "3", "type": "motion", "start": 1_700_000_100_000, "camera": "cam2"},
        {"id": "4", "type": "update", "start": 1_700_000_200_000, "camera": "cam1"},
        # Ohne Startzeit lässt sich nichts einordnen.
        {"id": "5", "type": "motion", "camera": "cam1"},
    ]
    rows = parse_events(payload, "cam1")
    assert [row["id"] for row in rows] == ["2", "1"]
    assert rows[0]["label"] == "Erkannt"
    assert rows[0]["detected"] == ["person"]


def test_nuki_errors_become_readable_sentences():
    """Nuki antwortet mit einem leeren Java-Stapelabbild. Das in die App
    zu reichen hilft niemandem - man liest es dreimal und weiss danach
    gleich viel. Der Statuscode dagegen sagt, woran es liegt."""
    from homepilot.integrations.nuki import action_error

    leer = '{"stackTrace":[],"suppressedExceptions":[]}'
    # Der Fall aus der Praxis: Lesen geht (aus Nukis Zwischenspeicher),
    # Schalten nicht - dafür braucht es eine lebende Verbindung.
    assert "nicht erreichbar" in action_error(423, leer)
    assert "Token" in action_error(401, leer)
    assert "smartlock.action" in action_error(403, leer)
    assert "kennt dieses Schloss nicht" in action_error(404, leer)
    assert "Zu viele" in action_error(429, leer)
    assert "Nuki-Dienst" in action_error(502, leer)

    # Unbekanntes bleibt lesbar, aber ohne das leere Stapelabbild - und
    # ohne die Kommas, die ein blosser Textersatz zurückliesse.
    with_detail = '{"stackTrace":[],"suppressedExceptions":[],"detail":"bad action"}'
    assert action_error(400, with_detail).endswith('{"detail": "bad action"}')
    assert action_error(400, leer).endswith("(HTTP 400).")
    # Auch wenn gar kein JSON kommt.
    assert "kein json" in action_error(418, "kein json")


def test_apple_rejections_say_what_to_do():
    """Apple lehnt mit «TopicDisallowed» ab und Expo reicht den Text durch.
    Lesbar ist er, hilfreich nicht - er sagt nicht, was zu tun wäre."""
    from homepilot.core.push import explain

    apple = (
        "The Apple Push Notification service failed to send the notification "
        "(reason: TopicDisallowed, status code: 400)."
    )
    hilfe = explain("", apple)
    assert "anderen App-Kennung" in hilfe
    assert "Push-Geräte" in hilfe

    # Expos eigene Codes gehen vor - sie sind genauer.
    assert "deinstalliert" in explain("DeviceNotRegistered", apple)
    # Und was wir nicht kennen, bleibt unverändert stehen.
    assert explain("", "etwas ganz anderes") == "etwas ganz anderes"


def test_push_devices_survive_a_restart():
    """Bisher lagen die Anmeldungen nur im Speicher: Nach jedem Update war
    niemand mehr erreichbar, bis alle ihre App wieder geöffnet hatten -
    und ausgerechnet dann will man Nachrichten am wenigsten missen."""
    from homepilot.core.push import PushService

    gespeichert: list[list[dict]] = []
    service = PushService()
    service.on_change = gespeichert.append

    service.register("ExponentPushToken[abc]", "Stefan", "iPhone")
    service.register("ExponentPushToken[def]", "Livia", "iPhone Livia")
    assert len(gespeichert[-1]) == 2

    # Nach dem Neustart: neuer Dienst, gespeicherte Zeilen zurück.
    danach = PushService()
    danach.restore(gespeichert[-1])
    assert {d.token for d in danach.devices} == {
        "ExponentPushToken[abc]",
        "ExponentPushToken[def]",
    }
    assert danach.devices[0].user in ("Stefan", "Livia")

    # Was kein Expo-Token ist, kommt gar nicht erst zurück - sonst
    # schleppte eine einmal kaputte Datei den Fehler ewig mit.
    frisch = PushService()
    frisch.restore([{"token": "unsinn", "user": "X"}, {"user": "ohne Token"}])
    assert frisch.devices == []

    # Abmelden wird ebenfalls gesichert, sonst käme das Gerät nach dem
    # nächsten Start wieder.
    service.unregister("ExponentPushToken[abc]")
    assert len(gespeichert[-1]) == 1


def test_calendar_month_window_reaches_into_the_neighbouring_weeks():
    """Die Monatsansicht zeigt die angeschnittenen Wochen mit.

    Ohne die Ränder blieben in der ersten und letzten Zeile Termine
    unsichtbar, die auf dem Bildschirm sehr wohl zu sehen sind.
    """
    from homepilot.integrations.google_calendar import month_window

    von, bis = month_window(2026, 3)
    assert von.startswith("2026-02-22")
    assert bis.startswith("2026-04-08")
    # Jahreswechsel darf nicht ins Leere laufen.
    von, bis = month_window(2026, 12)
    assert von.startswith("2026-11-24")
    assert bis.startswith("2027-01-08")


def test_calendar_reminders_are_due_once_and_skip_all_day():
    """«Ferien beginnen» eine Viertelstunde vorher zu melden hilft niemandem."""
    from datetime import UTC, datetime

    from homepilot.integrations.google_calendar import due_reminders

    jetzt = datetime(2026, 8, 21, 9, 0, tzinfo=UTC)
    events = [
        {"id": "a", "summary": "Zahnarzt", "start": "2026-08-21T09:10:00+00:00"},
        {"id": "b", "summary": "Später", "start": "2026-08-21T11:00:00+00:00"},
        {"id": "c", "summary": "Ferien", "start": "2026-08-21T09:05:00+00:00", "all_day": True},
        {"id": "d", "summary": "Lina", "start": "2026-08-21T09:05:00+00:00", "birthday": True},
        {"id": "e", "summary": "Vorbei", "start": "2026-08-21T08:00:00+00:00"},
    ]
    faellig = due_reminders(events, jetzt, 15, set())
    assert [event["id"] for event in faellig] == ["a"]

    # Einmal erinnert ist erinnert - sonst käme bei jeder Abfrage eine neue.
    assert due_reminders(events, jetzt, 15, {"a"}) == []
    # Abgeschaltet heisst abgeschaltet.
    assert due_reminders(events, jetzt, 0, set()) == []


def test_calendar_events_carry_their_id_and_origin():
    """Ohne beides lässt sich ein Termin weder ändern noch löschen."""
    from datetime import UTC, datetime

    from homepilot.integrations.google_calendar import parse_events

    zustand = parse_events(
        [
            {
                "id": "abc123",
                "_calendar": "primary",
                "summary": "Elternabend",
                "location": "Schulhaus Zell",
                "start": {"dateTime": "2026-08-22T19:00:00+00:00"},
                "end": {"dateTime": "2026-08-22T21:00:00+00:00"},
            }
        ],
        datetime(2026, 8, 21, tzinfo=UTC),
    )
    event = zustand["events"][0]
    assert event["id"] == "abc123"
    assert event["calendar"] == "primary"
    assert event["location"] == "Schulhaus Zell"


# ── Ring: warum der Ereigniskanal klemmt (Diagnose) ──────────────────────


def test_ring_diagnose_names_the_blocked_address_first():
    """Erst das, was man selbst ändern kann."""
    from homepilot.integrations.ring import push_diagnose

    text = push_diagnose(
        {
            "android.clients.google.com": True,
            "fcm.googleapis.com": True,
            "mtalk.google.com": False,
        },
        ["GCM register request attempt 2 out of 2 has failed with Error=PHONE_REGISTRATION_ERROR"],
    )
    assert "mtalk.google.com:5228" in text
    assert "Firewall" in text


def test_ring_diagnose_reads_the_library_log_when_the_way_is_open():
    from homepilot.integrations.ring import push_diagnose

    offen = {
        "android.clients.google.com": True,
        "fcm.googleapis.com": True,
        "mtalk.google.com": True,
    }
    text = push_diagnose(
        offen,
        ["GCM register request attempt 2 out of 2 has failed with Error=PHONE_REGISTRATION_ERROR"],
    )
    assert "PHONE_REGISTRATION_ERROR" in text
    assert "Googles Seite" in text


def test_ring_diagnose_falls_back_to_the_last_line():
    from homepilot.integrations.ring import push_diagnose

    offen = {host: True for host, _p, _z in __import__(
        "homepilot.integrations.ring", fromlist=["PUSH_ENDPOINTS"]
    ).PUSH_ENDPOINTS}
    assert push_diagnose(offen, ["irgendwas ging schief"]) == "irgendwas ging schief"
    # Und wenn gar nichts kam, ist auch das eine Auskunft.
    assert "Grund unbekannt" in push_diagnose(offen, [])


def test_ring_log_capture_only_listens_while_it_should():
    """Der Horchposten darf nicht liegen bleiben."""
    import logging

    from homepilot.integrations.ring import _LogMitschnitt

    logger = logging.getLogger("firebase_messaging")
    vorher = len(logger.handlers)
    mitschnitt = _LogMitschnitt("firebase_messaging")
    with mitschnitt:
        logger.warning("GCM checkin failed on attempt 1 out of 2")
        logger.info("das interessiert nicht")
    assert mitschnitt.zeilen == ["GCM checkin failed on attempt 1 out of 2"]
    assert len(logger.handlers) == vorher
    # Nach dem Ende schweigt er.
    logger.warning("danach")
    assert len(mitschnitt.zeilen) == 1


def test_ring_log_capture_has_a_ceiling():
    import logging

    from homepilot.integrations.ring import _LogMitschnitt

    logger = logging.getLogger("firebase_messaging")
    with _LogMitschnitt("firebase_messaging") as mitschnitt:
        for nummer in range(50):
            logger.warning("Zeile %s", nummer)
    assert len(mitschnitt.zeilen) == _LogMitschnitt.LIMIT


def test_protect_erkennungen_werden_zu_zustandsfeldern():
    """Person, Paket, Baby-Schreien – bisher nur Zeitleiste, nicht Ablauf.

    Zum Nachschauen taugte die Zeitleiste; automatisieren liess sich
    damit nichts, weil ein Ablauf nur auf einen Zustand hören kann.
    """
    from homepilot.integrations.unifi_protect import (
        camera_state,
        detect_key,
        detection_changes,
        supported_detections,
    )

    # Die API schreibt dieselbe Sache verschieden.
    assert detect_key("alrmBabyCry") == ("baby_cry", "Baby schreit")
    assert detect_key("smoke_cmonx") == ("co_alarm", "CO-Melder")
    assert detect_key("person") == ("person", "Person")
    assert detect_key("was auch immer") is None

    kamera = {
        "state": "CONNECTED",
        "featureFlags": {
            "smartDetectTypes": ["person", "vehicle"],
            "smartDetectAudioTypes": ["alrmBabyCry"],
        },
    }
    assert supported_detections(kamera) == [
        ("person", "Person"),
        ("vehicle", "Fahrzeug"),
        ("baby_cry", "Baby schreit"),
    ]

    # Was die Kamera kann, steht von Anfang an im Zustand - sonst liesse
    # sich der Ablauf erst bauen, nachdem das Baby geschrien hat.
    zustand = camera_state(kamera)
    assert zustand["detected_baby_cry"] == "off"
    assert zustand["detected_person"] == "off"
    assert "detected_package" not in zustand

    beginn = detection_changes(["alrmBabyCry"], "2026-08-23T21:15:00", beendet=False)
    assert beginn["detected_baby_cry"] == "on"
    assert beginn["last_baby_cry"] == "2026-08-23T21:15:00"
    assert beginn["detected"] == ["Baby schreit"]

    ende = detection_changes(["alrmBabyCry"], "2026-08-23T21:16:00", beendet=True)
    assert ende["detected_baby_cry"] == "off"
    assert "last_baby_cry" not in ende


def test_erkennungen_loesen_auch_beim_zweiten_mal_aus():
    """Zweimal Person hintereinander trägt beide Male «on».

    Ohne den Zeitstempel je Feld liesse die Änderungsprüfung den zweiten
    Ablauf still durchfallen – derselbe Fehler wie einst bei der Klingel.
    """
    from homepilot.core.automation import event_marker

    assert event_marker("detected_person") == "last_person"
    assert event_marker("detected_baby_cry") == "last_baby_cry"
    assert event_marker("ring") == "last_ring"
    assert event_marker("brightness") is None
