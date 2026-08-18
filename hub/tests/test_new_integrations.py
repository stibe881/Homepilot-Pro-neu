"""Reine Übersetzungslogik von UniFi Protect, Hue Sync Box und Spotify."""

import json
import struct
import zlib

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
            },
            "device": {"name": "Wohnzimmer"},
        }
    )
    assert state == {
        "state": "playing",
        "track": "Yesterday",
        "artist": "The Beatles",
        "device": "Wohnzimmer",
        # Ohne «context» in der Antwort läuft der Song einzeln, nicht aus
        # einer Playlist.
        "context_uri": None,
        # Fehlende Felder heissen «aus», nicht «unbekannt».
        "shuffle": False,
        "repeat": "off",
    }


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
        "app": "Spotify",
        "volume": 45,
    }


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


# ── Google Calendar ──────────────────────────────────────────────────────


def test_calendar_next_event():
    from datetime import datetime, timezone

    from homepilot.integrations.google_calendar import parse_events

    now = datetime(2026, 8, 15, 8, 0, tzinfo=timezone.utc)
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
    from datetime import datetime, timezone

    from homepilot.integrations.google_calendar import parse_events

    now = datetime(2026, 8, 15, 12, 0, tzinfo=timezone.utc)
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
    from datetime import datetime, timezone

    from homepilot.integrations.google_calendar import parse_events

    state = parse_events([], datetime.now(timezone.utc))
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
    from datetime import datetime, timezone

    from homepilot.integrations.google_calendar import is_birthday_calendar, parse_events

    now = datetime(2026, 8, 16, 8, 0, tzinfo=timezone.utc)
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
    assert minutes_until("", noon) is None
    assert minutes_until("kaputt", noon) is None


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
    assert "minutes_left" not in idle


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
        }
    )
    assert parsed["Entspannen"] == "aaa"
    # Der zweite gleichnamige bekommt einen Zusatz, statt den ersten zu
    # überschreiben.
    assert any(key.startswith("Entspannen (") for key in parsed)
    assert parsed["Hell"] == "ccc"
    assert len(parsed) == 3


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
