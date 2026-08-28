"""Sprachnotiz: was der Hub annimmt und wie er sie den Boxen ansagt."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from homepilot.api.routes.haus import _lautstaerke
from homepilot.api.server import create_app
from homepilot.core import sprachnotiz
from homepilot.core.errors import HomePilotError
from homepilot.core.hub import Hub

from .conftest import make_config

WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 2000


def test_webm_is_not_announced_as_mp3() -> None:
    # Eine Box, die einer falschen Typangabe glaubt, spielt Rauschen
    # oder gar nichts.
    assert sprachnotiz.medientyp(WEBM) == "audio/webm"


def test_wav_from_piper_stays_wav() -> None:
    assert sprachnotiz.medientyp(b"RIFF....WAVEfmt ") == "audio/wav"


def test_mp3_from_gtts_stays_mp3() -> None:
    assert sprachnotiz.medientyp(b"ID3\x03\x00\x00\x00") == "audio/mpeg"
    assert sprachnotiz.medientyp(b"\xff\xfb\x90\x00") == "audio/mpeg"


def test_m4a_is_recognised_behind_its_offset() -> None:
    assert sprachnotiz.medientyp(b"\x00\x00\x00\x20ftypM4A \x00\x00") == "audio/mp4"


def test_unknown_audio_falls_back_to_mp3() -> None:
    # Die wahrscheinlichste Annahme und die, mit der die meisten Boxen
    # etwas anfangen.
    assert sprachnotiz.medientyp(b"\x01\x02\x03\x04rest") == "audio/mpeg"


def test_a_slipped_button_is_rejected() -> None:
    with pytest.raises(HomePilotError, match="zu kurz"):
        sprachnotiz.pruefen(b"\x1a\x45\xdf\xa3short")


def test_a_lecture_is_rejected() -> None:
    with pytest.raises(HomePilotError, match="zu lang"):
        sprachnotiz.pruefen(b"\x00" * (sprachnotiz.HOECHSTENS + 1))


def test_a_normal_recording_passes() -> None:
    assert sprachnotiz.pruefen(WEBM) is None


def test_nonsense_volume_falls_back_to_the_default() -> None:
    assert _lautstaerke("laut") is None
    assert _lautstaerke(None) is None


def test_volume_is_forced_into_its_range() -> None:
    assert _lautstaerke("150") == 100
    assert _lautstaerke("-3") == 0
    assert _lautstaerke("55") == 55


def test_the_route_rejects_a_slipped_button() -> None:
    with TestClient(create_app(Hub(make_config()))) as client:
        antwort = client.post("/api/broadcast/voice", content=b"kurz")
        assert antwort.status_code == 400
        assert "zu kurz" in antwort.json()["detail"]


def test_the_recording_goes_to_the_speakers_unchanged() -> None:
    """Der Hub wandelt nichts um - er reicht durch, was ankommt."""
    with TestClient(create_app(Hub(make_config()))) as client:
        antwort = client.post("/api/broadcast/voice?volume=40", content=WEBM)
        assert antwort.status_code == 200
        assert antwort.json()["sent"]


def test_the_played_recording_keeps_its_type() -> None:
    """Die Adresse endet auf .mp3, der Inhalt ist aber WebM - die Box
    richtet sich nach dem Content-Type, nicht nach der Endung."""
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        token = hub.snapshots.put(WEBM)
        antwort = client.get(f"/api/broadcast/{token}.mp3")
        assert antwort.status_code == 200
        assert antwort.headers["content-type"] == "audio/webm"
