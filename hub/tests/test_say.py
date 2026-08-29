"""Der Durchsage-Vorrat und die reinen Teile von say.py.

Diese Datei war lange leer - eine 0-Byte-Testdatei ist schlimmer als
keine: Sie sieht in jeder Liste nach Abdeckung aus. Getestet wird hier,
was ohne Netz und ohne Boxen entscheidbar ist; das Sprechen selbst
prüfen test_ton.py und test_hold_and_restore.py mit.
"""

from homepilot.core import say
from homepilot.core.hub import Hub

from .conftest import make_config


def test_cache_file_names_survive_umlauts_and_slashes(tmp_path):
    """Der Dateiname ist ein Hash - der Satz selbst geht ihn nichts an."""
    a = say.cache_file(tmp_path, "Es hat geklingelt")
    b = say.cache_file(tmp_path, "Grüezi / Znacht isch parat!")
    assert a.parent == tmp_path
    assert a.suffix == ".mp3"
    assert "/" not in b.name and "ü" not in b.name
    # Derselbe Satz ergibt dieselbe Datei - sonst wäre der Vorrat keiner.
    assert say.cache_file(tmp_path, "Es hat geklingelt") == a


def test_store_and_read_back(tmp_path):
    assert say.cached_audio(tmp_path, "Hallo") is None
    say.store_audio(tmp_path, "Hallo", b"mp3-bytes")
    assert say.cached_audio(tmp_path, "Hallo") == b"mp3-bytes"
    # Ein anderer Satz bleibt ein anderer.
    assert say.cached_audio(tmp_path, "Tschüss") is None


def test_the_cache_evicts_the_oldest(tmp_path):
    """Der Vorrat ist eine Handvoll Standardsätze, kein Archiv."""
    import os

    for i in range(say.CACHE_LIMIT + 5):
        say.store_audio(tmp_path, f"Satz {i}", b"x")
        # mtime künstlich staffeln - auf schnellen Platten wäre sonst
        # alles gleich alt und die Auswahl der Ältesten Zufall.
        datei = say.cache_file(tmp_path, f"Satz {i}")
        os.utime(datei, (i, i))
    dateien = list(tmp_path.glob("*.mp3"))
    assert len(dateien) == say.CACHE_LIMIT
    # Die ältesten sind weg, die neuesten da.
    assert say.cached_audio(tmp_path, "Satz 0") is None
    assert say.cached_audio(tmp_path, f"Satz {say.CACHE_LIMIT + 4}") == b"x"


def test_store_audio_swallows_write_errors(tmp_path):
    """Der Vorrat ist eine Zugabe - ein unlesbarer Ordner darf die
    Durchsage nicht verhindern."""
    datei = tmp_path / "kein-ordner"
    datei.write_text("ich bin eine Datei, kein Ordner")
    say.store_audio(datei, "Hallo", b"x")  # darf nicht werfen


def test_cache_dir_needs_a_data_file():
    """Ohne Datendatei (Tests, Demo im Speicher) auch kein Vorrat."""
    hub = Hub(make_config())
    assert say.cache_dir(hub) is None
    hub2 = Hub(make_config(data_file="/tmp/x/daten.json"))
    assert say.cache_dir(hub2) is not None
    assert say.cache_dir(hub2).name == "say-cache"


def test_remember_base_writes_only_on_change(tmp_path):
    """Jede App-Anfrage trägt die Adresse - schriebe jede die Datendatei
    neu, wäre das Dauerfeuer auf die SD-Karte."""
    hub = Hub(make_config(data_file=str(tmp_path / "daten.json")))
    hub.data.load()
    assert say.base_url(hub) is None

    say.remember_base(hub, "http://10.0.0.5:8123/")
    assert say.base_url(hub) == "http://10.0.0.5:8123"

    stand = hub.data.get("hub_base")
    say.remember_base(hub, "http://10.0.0.5:8123")  # unverändert
    assert hub.data.get("hub_base") == stand

    say.remember_base(hub, "")  # Leeres ändert nichts
    assert say.base_url(hub) == "http://10.0.0.5:8123"


def test_piper_command_writes_wav_to_stdout():
    assert say.piper_kommando("/stimmen/de.onnx") == [
        "piper", "--model", "/stimmen/de.onnx", "--output_file", "-",
    ]
    assert say.piper_kommando("v", bin_path="/opt/piper")[0] == "/opt/piper"


def test_piper_speaks_only_when_asked_explicitly():
    """Eine Stimme allein schaltet nicht um - der Block muss
    `engine: piper` sagen."""
    def hub_mit(speech):
        hub = Hub(make_config())
        hub.config.speech = speech
        return hub

    assert say.spricht_piper(hub_mit(None)) is None
    assert say.spricht_piper(hub_mit({"voice": "/de.onnx"})) is None
    assert say.spricht_piper(hub_mit({"engine": "piper", "voice": "/de.onnx"})) == "/de.onnx"
    assert say.spricht_piper(hub_mit({"engine": "Piper", "voice": "/de.onnx"})) == "/de.onnx"
    # Piper ohne Stimme kann nichts sagen.
    assert say.spricht_piper(hub_mit({"engine": "piper"})) is None


def test_synthesize_piper_rejects_an_empty_answer(tmp_path):
    """Ein Piper, das nichts liefert, ist ein Fehler - keine leere
    Durchsage."""
    import pytest

    from homepilot.core.errors import HomePilotError

    stummes_piper = tmp_path / "piper"
    stummes_piper.write_text("#!/bin/sh\nexit 0\n")
    stummes_piper.chmod(0o755)
    with pytest.raises(HomePilotError):
        say.synthesize_piper("Hallo", "/stimme", bin_path=str(stummes_piper))


def test_synthesize_piper_returns_stdout(tmp_path):
    lautes_piper = tmp_path / "piper"
    lautes_piper.write_text("#!/bin/sh\nprintf 'WAV-DATEN'\n")
    lautes_piper.chmod(0o755)
    assert say.synthesize_piper("Hallo", "/stimme", bin_path=str(lautes_piper)) == b"WAV-DATEN"
