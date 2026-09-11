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
    """Die alte Speicherform - nur Kennungen - bleibt lesbar.

    Sie liegt im Haus schon auf der Platte. Wer sie liest, bekommt die
    Vorgaben dazu: so laut wie bisher, den ganzen Tag. Nichts wird
    stiller oder lauter, nur weil eine Auslieferung dazwischenlag.
    """
    rows = [{"sound": "hupe", "speakers": ["demo.kueche", "demo.wohnzimmer"]}]
    stand = klingelton.einstellung_lesen(rows)
    assert stand["sound"] == "hupe"
    assert [box["id"] for box in stand["speakers"]] == ["demo.kueche", "demo.wohnzimmer"]
    assert all(box["volume"] == klingelton.LAUTSTAERKE for box in stand["speakers"])
    assert all((box["from"], box["to"]) == ("00:00", "24:00") for box in stand["speakers"])
    # Ohne Eintrag gelten die Vorgaben für Nacht und Ansage (Punkt 518/430).
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


# ── Je Box: wie laut, und wann überhaupt ─────────────────────────────────
#
# Gewünscht im Haus: «Bei jedem Lautsprecher, den man aktiviert, soll man
# die Lautstärke einzeln definieren» und «die Zeit, wann es da klingelt».
# Beides hat nur je Box eine Antwort: Die Küchenbox steht neben dem
# Esstisch, im Keller hört man sonst nichts - und im Kinderzimmer soll es
# abends still bleiben, während der Flur weiter klingelt.


def test_eine_box_mit_eigener_lautstaerke_und_spanne():
    rows = [{
        "sound": "hupe",
        "speakers": [{"id": "demo.kind", "volume": 20, "from": "07:00", "to": "20:00"}],
    }]
    box = klingelton.einstellung_lesen(rows)["speakers"][0]
    assert box == {"id": "demo.kind", "volume": 20, "from": "07:00", "to": "20:00"}


def test_eine_unlesbare_uhrzeit_macht_die_box_nicht_stumm():
    """Eine kaputte Einstellung darf dazu führen, dass es zu oft klingelt -
    nicht dass es nie klingelt. Wer nichts hört, sucht den Fehler nicht."""
    rows = [{"speakers": [{"id": "demo.flur", "from": "sieben", "to": "25:99"}]}]
    box = klingelton.einstellung_lesen(rows)["speakers"][0]
    assert box["from"] == "00:00"
    assert box["to"] == "24:00"


def test_eine_lautstaerke_ausserhalb_der_skala_wird_geklemmt():
    rows = [{"speakers": [
        {"id": "a", "volume": 400}, {"id": "b", "volume": -5}, {"id": "c", "volume": "laut"},
    ]}]
    boxen = klingelton.einstellung_lesen(rows)["speakers"]
    assert [box["volume"] for box in boxen] == [100, 0, klingelton.LAUTSTAERKE]


def test_uhrzeit_lesen_fuellt_auf():
    assert klingelton.uhrzeit_lesen("7:5", "00:00") == "07:05"
    assert klingelton.uhrzeit_lesen("23:59", "00:00") == "23:59"
    assert klingelton.uhrzeit_lesen("24:00", "00:00") == "24:00"
    assert klingelton.uhrzeit_lesen("", "08:00") == "08:00"


def test_eine_spanne_ueber_mitternacht_gilt_abends_und_morgens():
    """Der Fall, der ohne eigene Zeile falsch herauskommt - und genau der,
    den man für ein Kinderzimmer einstellt."""
    assert klingelton.in_spanne("23:00", "22:00", "07:00") is True
    assert klingelton.in_spanne("03:00", "22:00", "07:00") is True
    assert klingelton.in_spanne("12:00", "22:00", "07:00") is False


def test_eine_gewoehnliche_spanne_gilt_dazwischen():
    assert klingelton.in_spanne("08:00", "07:00", "20:00") is True
    assert klingelton.in_spanne("06:59", "07:00", "20:00") is False
    assert klingelton.in_spanne("20:00", "07:00", "20:00") is False


def test_der_ganze_tag_gilt_immer():
    for uhrzeit in ("00:00", "12:00", "23:59"):
        assert klingelton.in_spanne(uhrzeit, "00:00", "24:00") is True


def test_gleiche_zeiten_heissen_keine_einschraenkung():
    """«07:00 bis 07:00» ist keine Minute, sondern kein Fenster. Wer beide
    Felder gleich stellt, meint nicht «nie»."""
    assert klingelton.in_spanne("03:00", "07:00", "07:00") is True


def test_nur_die_boxen_deren_zeit_gerade_laeuft():
    boxen = [
        {"id": "flur", "volume": 55, "from": "00:00", "to": "24:00"},
        {"id": "kind", "volume": 20, "from": "07:00", "to": "20:00"},
    ]
    assert [b["id"] for b in klingelton.aktive_boxen(boxen, "12:00")] == ["flur", "kind"]
    assert [b["id"] for b in klingelton.aktive_boxen(boxen, "22:30")] == ["flur"]


def test_die_lautstaerken_kommen_als_zuordnung():
    """So nimmt say.play_audio sie entgegen - eine Zahl je Box statt einer
    fürs ganze Haus."""
    boxen = [{"id": "flur", "volume": 70}, {"id": "kind", "volume": 20}]
    assert klingelton.lautstaerken(boxen) == {"flur": 70, "kind": 20}
# ── Nacht und Ansage (Punkt 518/430) ───────────────────────────────────────


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
