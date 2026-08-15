"""Reine Übersetzungslogik von UniFi Protect, Hue Sync Box und Spotify."""

import json
import struct
import zlib

import pytest

from homepilot.integrations.hue_sync import parse_state
from homepilot.integrations.spotify import parse_playback
from homepilot.integrations.unifi_protect import camera_state, decode_ws_message

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
