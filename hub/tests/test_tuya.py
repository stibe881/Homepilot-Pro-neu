"""Tuya: die Übersetzung zwischen nummerierten Datenpunkten und Entitäten.

Was ein Tuya-Gerät kann, steht nicht in einem Namen, sondern in Nummern -
und die Werte darunter sind in eigenen Skalen geschrieben. Genau dort
entstehen die Fehler, die man später an der Lampe sieht: Helligkeit, die
bei 10 % ausgeht, oder eine Farbe, die grün statt orange leuchtet.
"""

from homepilot.core.entity import EntityKind
from homepilot.integrations.tuya import (
    DEFAULT_DPS,
    LEGACY_DPS,
    brightness_range,
    decode_color,
    dps_map,
    encode_color,
    from_mired,
    from_percent,
    hex_to_hsv,
    hsv_to_hex,
    light_commands,
    light_state,
    to_mired,
    to_percent,
)


def test_dps_map_defaults_and_overrides():
    assert dps_map({}) == DEFAULT_DPS
    assert dps_map({"legacy": True}) == LEGACY_DPS
    # Einzelne Nummern überschreiben, der Rest bleibt.
    eigen = dps_map({"dps": {"switch": 101}})
    assert eigen["switch"] == 101
    assert eigen["brightness"] == DEFAULT_DPS["brightness"]
    # null schaltet eine Eigenschaft ab – für Geräte, die die Nummer zwar
    # belegen, aber Unsinn darunter führen.
    ohne = dps_map({"dps": {"color": None}})
    assert "color" not in ohne


def test_brightness_never_reaches_zero():
    """Bei Tuya ist Helligkeit 0 kein «ganz dunkel», sondern ein Fehler.

    Deshalb beginnt der Bereich bei 10 – und 0 % ist «aus», was der
    Kommandoteil als Schalter behandelt, nicht als Helligkeit.
    """
    bereich = brightness_range({})
    assert bereich == (10, 1000)
    assert from_percent(0, bereich) == 10
    assert from_percent(100, bereich) == 1000
    assert to_percent(1000, bereich) == 100
    assert to_percent(10, bereich) == 0
    # Hin und zurück soll dasselbe ergeben.
    for prozent in (5, 25, 50, 75, 99):
        assert abs(to_percent(from_percent(prozent, bereich), bereich) - prozent) <= 1


def test_brightness_range_for_older_devices():
    bereich = brightness_range({"legacy": True})
    assert bereich == (25, 255)
    assert from_percent(100, bereich) == 255
    # Ausdrücklich gesetzter Bereich schlägt beides.
    assert brightness_range({"brightness_range": [0, 100]}) == (0, 100)


def test_color_temperature_runs_from_warm_to_cold():
    """Tuya zählt 0 (warm) bis 1000 (kalt), der Hub rechnet in Mired."""
    assert to_mired(0) == 370
    assert to_mired(1000) == 153
    assert from_mired(370) == 0
    assert from_mired(153) == 1000
    # Werte ausserhalb werden eingefangen, nicht durchgereicht.
    assert from_mired(1000) == 0
    assert from_mired(50) == 1000


def test_color_survives_the_round_trip():
    for farbe in ("#FF0000", "#00FF00", "#0000FF", "#FF8800", "#FFFFFF"):
        codiert = encode_color(farbe)
        assert len(codiert) == 12
        assert decode_color(codiert) == farbe


def test_color_reads_both_formats():
    """Zwölf Zeichen bei neueren Geräten, vierzehn bei älteren."""
    # Rot: Farbwinkel 0, volle Sättigung, volle Helligkeit.
    assert decode_color("000003e803e8") == "#FF0000"
    assert decode_color("FF0000" + "0000" + "ff" + "ff") == "#FF0000"
    # Unsinn ergibt keine Farbe statt einer falschen.
    assert decode_color("") is None
    assert decode_color("abc") is None
    assert decode_color("zzzzzzzzzzzz") is None


def test_hsv_helpers():
    assert hsv_to_hex(0, 1, 1) == "#FF0000"
    assert hsv_to_hex(120, 1, 1) == "#00FF00"
    assert hsv_to_hex(240, 1, 1) == "#0000FF"
    h, s, v = hex_to_hsv("#00FF00")
    assert round(h) == 120 and s == 1 and v == 1
    # Kurzform mit drei Zeichen.
    assert hex_to_hsv("#F00")[0] == 0


def test_light_state_only_reports_what_the_device_sent():
    """Tuya meldet bei einer Änderung oft nur den einen geänderten Punkt.

    Entstünde hier für jeden fehlenden ein Standardwert, überschriebe die
    nächste Meldung «heller» die Farbe mit Weiss.
    """
    nummern = dps_map({})
    bereich = brightness_range({})
    voll = light_state(
        {"20": True, "21": "colour", "22": 505, "23": 0, "24": "000003e803e8"},
        nummern,
        bereich,
    )
    assert voll["state"] == "on"
    assert voll["brightness"] == 50
    assert voll["color"] == "#FF0000"
    assert voll["color_temp"] == 370
    assert voll["mode"] == "colour"

    nur_hell = light_state({"22": 1000}, nummern, bereich)
    assert nur_hell == {"brightness": 100}


def test_light_commands_promise_only_what_exists():
    voll = light_commands(dps_map({}), EntityKind.LIGHT)
    assert "set_color" in voll and "set_brightness" in voll

    # Eine Steckdose kann nur schalten.
    steckdose = light_commands(dps_map({}), EntityKind.SWITCH)
    assert steckdose == ["turn_on", "turn_off", "toggle"]

    # Eine Lampe ohne Farbe bietet keinen Farbknopf an.
    weiss = light_commands(dps_map({"dps": {"color": None}}), EntityKind.LIGHT)
    assert "set_color" not in weiss
    assert "set_brightness" in weiss


def test_tuya_error_numbers_become_sentences():
    """«Err 914» ist keine Auskunft, sondern eine Suchaufgabe."""
    from homepilot.integrations.tuya import error_hint

    hinweis = error_hint({"Error": "Check device key or version", "Err": "914"})
    assert hinweis and "Schlüssel" in hinweis and "--scan" in hinweis
    assert error_hint({"Err": "905"})
    # Unbekannte Nummern und Nicht-Fehler ergeben keinen erfundenen Satz.
    assert error_hint({"Err": "4711"}) is None
    assert error_hint({"dps": {"20": True}}) is None
    assert error_hint(None) is None


def test_an_error_answer_is_not_a_state():
    """tinytuya wirft nicht, es antwortet – und zwar sofort.

    Der Unterschied ist der zwischen «Gerät meldet nichts Neues» und
    «Gerät weist uns ab». Wer beides gleich behandelt, dreht sich in der
    Empfangsschleife tausendmal je Sekunde im Kreis und legt damit den
    ganzen Hub lahm - genau so geschehen.
    """
    from homepilot.integrations.tuya import error_text, is_error

    fehler = {"Error": "Check device key or version", "Err": "914", "Payload": None}
    assert is_error(fehler) is True
    assert "Schlüssel" in error_text(fehler)

    # Ein echter Zustand ist kein Fehler.
    assert is_error({"dps": {"20": True}}) is False
    # Und eine leere Antwort auch nicht - die heisst «nichts Neues».
    assert is_error(None) is False
    assert is_error({}) is False

    # Unbekannte Nummern ergeben trotzdem einen brauchbaren Text.
    assert error_text({"Error": "Irgendwas", "Err": "4711"}) == "Irgendwas"


def test_a_half_written_address_is_caught_at_the_start():
    """«10.10.23» sieht wie eine Adresse aus und ist keine.

    Der Systemaufruf darunter macht daraus klaglos 10.10.0.23. Ohne diese
    Prüfung redet der Hub mit dem falschen Gerät, und die Kachel sagt
    «nie gesehen» - was nach einem Netzproblem aussieht und keines ist.
    """
    import pytest

    from homepilot.core.errors import ConfigError
    from homepilot.integrations.tuya import check_address

    assert check_address("10.10.1.23") == "10.10.1.23"
    # Keine Angabe ist in Ordnung – dann sucht der Hub selbst.
    assert check_address(None) is None
    assert check_address("  ") is None

    with pytest.raises(ConfigError) as fehler:
        check_address("10.10.23")
    assert "10.10.23" in str(fehler.value)
    assert "--scan" in str(fehler.value)

    with pytest.raises(ConfigError):
        check_address("Sternenprojektor")
