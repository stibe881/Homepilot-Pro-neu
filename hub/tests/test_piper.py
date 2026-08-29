"""Piper statt gTTS: die Durchsage-Stimme, die ohne Wolke spricht."""

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.say import piper_kommando, spricht_piper


def hub_mit(speech: dict) -> Hub:
    return Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            automations=[],
            speech=speech,
        )
    )


def test_ohne_ausdrueckliches_engine_bleibt_gtts():
    """Eine Stimme allein schaltet nicht um - wer Piper will, sagt es."""
    assert spricht_piper(hub_mit({})) is None
    assert spricht_piper(hub_mit({"voice": "/config/stimme.onnx"})) is None


def test_mit_engine_piper_und_stimme_spricht_piper():
    hub = hub_mit({"engine": "piper", "voice": "/config/de_DE-thorsten.onnx"})
    assert spricht_piper(hub) == "/config/de_DE-thorsten.onnx"
    # Und ohne Stimme gibt es nichts zu sprechen.
    assert spricht_piper(hub_mit({"engine": "piper"})) is None


def test_der_aufruf_schreibt_wav_nach_stdout():
    assert piper_kommando("/config/stimme.onnx") == [
        "piper",
        "--model",
        "/config/stimme.onnx",
        "--output_file",
        "-",
    ]
