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
