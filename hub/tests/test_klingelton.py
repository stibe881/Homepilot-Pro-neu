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
    assert klingelton.einstellung_lesen(None) == {
        "sound": klingelton.STANDARD,
        "speakers": [],
    }
    assert klingelton.einstellung_lesen([]) == {
        "sound": klingelton.STANDARD,
        "speakers": [],
    }


def test_einstellung_lesen_reads_stored_choice():
    rows = [{"sound": "hupe", "speakers": ["demo.kueche", "demo.wohnzimmer"]}]
    assert klingelton.einstellung_lesen(rows) == {
        "sound": "hupe",
        "speakers": ["demo.kueche", "demo.wohnzimmer"],
    }


def test_einstellung_lesen_falls_back_on_unknown_sound():
    """Ein späterer Umbau, der einen Klang umbenennt oder entfernt, soll
    niemanden mit einer kaputten Einstellung zurücklassen."""
    rows = [{"sound": "verschwunden", "speakers": ["demo.kueche"]}]
    assert klingelton.einstellung_lesen(rows)["sound"] == klingelton.STANDARD


def test_einstellung_lesen_ignores_garbage_speakers():
    rows = [{"sound": "dingdong", "speakers": "demo.kueche"}]
    assert klingelton.einstellung_lesen(rows)["speakers"] == []


def test_abklingen_makes_the_tone_fade_out():
    """Ein anschlagender Ton ist am Ende deutlich leiser als am Anfang -
    ohne das klingt jede Glocke wie ein Piepton."""
    werte = klingelton.ton_samples(440.0, 1.0, samplerate=8000, abklingen=True)
    anfang = max(abs(wert) for wert in werte[:2000])
    ende = max(abs(wert) for wert in werte[-2000:])
    assert ende < anfang / 4


def test_without_abklingen_the_tone_keeps_its_level():
    """Die Gegenprobe: Hupe und Sirene sollen stehen bleiben, sonst
    misst der Test oben nur die Ausblendung am Schluss."""
    werte = klingelton.ton_samples(440.0, 1.0, samplerate=8000)
    anfang = max(abs(wert) for wert in werte[:2000])
    mitte = max(abs(wert) for wert in werte[3000:5000])
    assert mitte > anfang * 0.9


def test_klang_wav_uses_the_decay_flag_of_the_sound():
    """Der Schalter am Klang muss bis in die Bytes durchschlagen - er
    stand einmal im Katalog, ohne dass ihn jemand las."""
    mit = klingelton.klang_wav("glocke")
    ohne = klingelton.wav_bytes(
        klingelton.noten_zu_samples(klingelton.BY_KEY["glocke"]["noten"])
    )
    assert mit != ohne


def test_catalog_offers_enough_choice():
    """Sechs Töne waren zu wenig, um einen zu finden, den man mag."""
    assert len(klingelton.KLAENGE) >= 12


def test_every_catalog_sound_has_a_label_and_notes():
    for klang in klingelton.KLAENGE:
        assert klang["label"].strip()
        assert klang["noten"]
        assert all(dauer > 0 for _, dauer in klang["noten"])


def test_no_catalog_sound_is_longer_than_a_doorbell_should_be():
    """An der Haustür wartet niemand fünf Sekunden - und der Ton legt
    die laufende Musik so lange leise (core/ton.py)."""
    for klang in klingelton.KLAENGE:
        dauer = sum(dauer for _, dauer in klang["noten"])
        assert dauer <= 4.0, klang["key"]


def test_the_original_six_sounds_stay_in_the_catalog():
    """Wer einen dieser Klänge gewählt hat, soll ihn behalten: Ein
    entfernter Schlüssel fällt still auf die Vorgabe zurück
    (``einstellung_lesen``) - die Wahl wäre weg, ohne dass es jemand
    merkt. Beim Erweitern des Katalogs ist genau das einmal passiert:
    «Kuckuck» verschwand beim Umschreiben der Liste.
    """
    for key in ("dingdong", "dreiklang", "kuckuck", "hupe", "quietscheente", "tusch"):
        assert key in klingelton.BY_KEY, key
