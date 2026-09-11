"""Der Klingelton: Klangkatalog, WAV-Erzeugung, gespeicherte Wahl."""

import struct
import wave
from io import BytesIO

from homepilot.core import klingelton


def test_ton_samples_length_matches_duration():
    werte = klingelton.ton_samples(440.0, 0.5, samplerate=1000)
    assert len(werte) == 500


def test_ton_samples_stay_within_range():
    werte = klingelton.ton_samples(440.0, 0.2, samplerate=2000)
    assert all(-1.0 <= wert <= 1.0 for wert in werte)


def test_silence_note_is_zero():
    """0 Hz ist eine Pause - keine Frequenz, aber die richtige Länge."""
    werte = klingelton.ton_samples(0.0, 0.1, samplerate=1000)
    assert werte == [0.0] * 100


def test_fade_avoids_a_click_at_start_and_end():
    """Die ersten und letzten Werte liegen nahe bei Null, nicht am Anschlag -
    sonst knackt jeder Ton beim Einsetzen und Enden."""
    werte = klingelton.ton_samples(440.0, 0.3, samplerate=22050)
    assert abs(werte[0]) < 0.05
    assert abs(werte[-1]) < 0.05


def test_noten_zu_samples_concatenates_in_order():
    noten = [(440.0, 0.1), (0.0, 0.1), (880.0, 0.1)]
    samples = klingelton.noten_zu_samples(noten, samplerate=1000)
    einzeln = sum(
        len(klingelton.ton_samples(f, d, samplerate=1000)) for f, d in noten
    )
    assert len(samples) == einzeln


def test_wav_bytes_produce_a_readable_wav_file():
    """Das von Hand gebaute WAV muss ein echter Reader auch lesen können -
    nicht nur unser eigener Code."""
    samples = klingelton.ton_samples(440.0, 0.1, samplerate=8000)
    audio = klingelton.wav_bytes(samples, samplerate=8000)
    with wave.open(BytesIO(audio), "rb") as datei:
        assert datei.getnchannels() == 1
        assert datei.getsampwidth() == 2
        assert datei.getframerate() == 8000
        assert datei.getnframes() == len(samples)


def test_wav_bytes_clip_out_of_range_values():
    """Ein Wert ausserhalb von -1..1 darf nicht überlaufen (16-Bit-Wrap),
    sondern wird gekappt - sonst würde aus zu laut ein Knacken."""
    audio = klingelton.wav_bytes([2.0, -2.0], samplerate=1000)
    frames = audio[44:]
    werte = struct.unpack("<2h", frames)
    assert werte == (32767, -32767)


def test_every_catalog_sound_renders_to_a_valid_wav():
    """Jeder eingebaute Klang muss tatsächlich abspielbar sein - nicht
    nur syntaktisch als Notenliste dastehen."""
    for klang in klingelton.KLAENGE:
        audio = klingelton.klang_wav(klang["key"])
        with wave.open(BytesIO(audio), "rb") as datei:
            assert datei.getnframes() > 0


def test_klang_wav_falls_back_to_standard_for_unknown_key():
    assert klingelton.klang_wav("nie-gehört") == klingelton.klang_wav(klingelton.STANDARD)


def test_catalog_keys_are_unique():
    schluessel = [klang["key"] for klang in klingelton.KLAENGE]
    assert len(schluessel) == len(set(schluessel))


def test_einstellung_lesen_defaults_to_standard_and_silence():
    """Ohne gespeicherte Wahl: der Standardton, aber keine Box - ein
    Klingelton soll erst losgehen, wenn ihn jemand eingerichtet hat."""
    for leer in (None, []):
        stand = klingelton.einstellung_lesen(leer)
        assert stand["sound"] == klingelton.STANDARD
        assert stand["speakers"] == []


def test_einstellung_lesen_reads_stored_choice():
    rows = [{"sound": "hupe", "speakers": ["demo.kueche", "demo.wohnzimmer"]}]
    stand = klingelton.einstellung_lesen(rows)
    assert stand["sound"] == "hupe"
    assert stand["speakers"] == ["demo.kueche", "demo.wohnzimmer"]
    # Ohne Eintrag gelten die Vorgaben für Nacht und Ansage (Punkt 429/430).
    assert stand["night"] == klingelton.NACHT_STANDARD
    assert stand["announce"] is False


def test_einstellung_lesen_falls_back_on_unknown_sound():
    """Ein späterer Umbau, der einen Klang umbenennt oder entfernt, soll
    niemanden mit einer kaputten Einstellung zurücklassen."""
    rows = [{"sound": "verschwunden", "speakers": ["demo.kueche"]}]
    assert klingelton.einstellung_lesen(rows)["sound"] == klingelton.STANDARD


def test_einstellung_lesen_ignores_garbage_speakers():
    rows = [{"sound": "dingdong", "speakers": "demo.kueche"}]
    assert klingelton.einstellung_lesen(rows)["speakers"] == []


# ── Nacht und Ansage (Punkt 429/430) ───────────────────────────────────────


def test_nacht_lesen_falls_back_to_the_default_on_nonsense():
    from homepilot.core.klingelton import NACHT_STANDARD, nacht_lesen

    assert nacht_lesen(None) == NACHT_STANDARD
    assert nacht_lesen({"mode": "laut", "from": 99, "to": "x"}) == NACHT_STANDARD
    assert nacht_lesen({"mode": "leise", "from": 21, "to": 6}) == {
        "mode": "leise",
        "from": 21,
        "to": 6,
    }


def test_lautstaerke_jetzt_dims_or_silences_at_night():
    import time as _time

    from homepilot.core.klingelton import (
        LAUTSTAERKE,
        NACHT_LAUTSTAERKE,
        einstellung_lesen,
        lautstaerke_jetzt,
    )

    # 23 Uhr und 14 Uhr, Ortszeit - wie nachtruhe.still rechnet.
    nacht = _time.mktime((2026, 9, 11, 23, 0, 0, 0, 0, -1))
    tag = _time.mktime((2026, 9, 11, 14, 0, 0, 0, 0, -1))
    normal = einstellung_lesen([{"sound": "dingdong"}])
    assert lautstaerke_jetzt(normal, nacht) == LAUTSTAERKE
    leise = einstellung_lesen([{"night": {"mode": "leise"}}])
    assert lautstaerke_jetzt(leise, nacht) == NACHT_LAUTSTAERKE
    assert lautstaerke_jetzt(leise, tag) == LAUTSTAERKE
    still = einstellung_lesen([{"night": {"mode": "still"}}])
    assert lautstaerke_jetzt(still, nacht) is None
    assert lautstaerke_jetzt(still, tag) == LAUTSTAERKE


def test_einstellung_lesen_carries_the_announcement():
    from homepilot.core.klingelton import ANSAGE_STANDARD, einstellung_lesen

    stand = einstellung_lesen([{"announce": True, "announce_text": "  Besuch!  "}])
    assert stand["announce"] is True
    assert stand["announce_text"] == "Besuch!"
    assert einstellung_lesen([{"announce_text": ""}])["announce_text"] == ANSAGE_STANDARD
    assert einstellung_lesen(None)["announce"] is False
