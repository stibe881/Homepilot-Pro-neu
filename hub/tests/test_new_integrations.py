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
    assert state == {"state": "offline", "recording": None, "motion": "off"}


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

    # Overkiz: closure 30 = 70 % offen; Lamellen 45.
    state = cover_state(
        {
            "core:ClosureState": 30,
            "core:SlateOrientationState": 45,
            "core:OpenClosedState": "open",
        }
    )
    assert state["position"] == 70
    assert state["tilt"] == 45
    assert state["state"] == "partial"


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
