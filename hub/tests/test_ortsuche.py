"""Einen Laden erfassen, ohne davorzustehen.

Vor dem Laden zu stehen und einen Knopf zu drücken ist der genaueste
Weg. Aber wer am Küchentisch fünf Läden erfassen will, fährt dafür nicht
fünfmal los - also muss auch «Coop Willisau» oder eine eingefügte
Koordinate genügen.
"""

from homepilot.core.ortsuche import (
    MAX_TREFFER,
    anfrage,
    koordinaten_aus_text,
    treffer,
)


# ── Koordinaten, die jemand eingefügt hat ────────────────────────────────


def test_coordinates_copied_from_maps_are_understood():
    # Langer Tipp in Google Maps → «47.13844, 7.92059» in der
    # Zwischenablage. Das ist der zweite Griff, den jeder macht.
    assert koordinaten_aus_text("47.13844, 7.92059") == (47.13844, 7.92059)
    assert koordinaten_aus_text(" 47.13844 ,7.92059 ") == (47.13844, 7.92059)
    # Auch mit Komma als Dezimaltrennzeichen und Semikolon dazwischen.
    assert koordinaten_aus_text("47,13844; 7,92059") == (47.13844, 7.92059)


def test_a_maps_url_gives_up_its_coordinates():
    # Die Adresszeile enthält weitere Zahlen (Zoomstufe, Kacheln) - es
    # zählt nur das Paar hinter @ bzw. hinter !3d/!4d.
    assert koordinaten_aus_text(
        "https://www.google.com/maps/@47.1381,7.9228,17z"
    ) == (47.1381, 7.9228)
    assert koordinaten_aus_text(
        "https://www.google.com/maps/place/Coop/data=!3d47.1381!4d7.9228"
    ) == (47.1381, 7.9228)


def test_text_without_coordinates_stays_a_search():
    # Sonst würde «Coop Willisau 6130» als Koordinate gelesen und der Ort
    # läge im Meer - und niemand sucht den Fehler dort.
    assert koordinaten_aus_text("Coop Willisau") is None
    assert koordinaten_aus_text("") is None
    # Zahlen ausserhalb des Gültigen sind keine Koordinaten.
    assert koordinaten_aus_text("200.0, 7.9") is None
    assert koordinaten_aus_text("47.1, 999.0") is None


# ── Die Suche selbst ─────────────────────────────────────────────────────


def test_the_search_stays_in_the_country_unless_told_otherwise():
    # «Coop» gibt es weltweit, gemeint ist der um die Ecke.
    assert anfrage("Coop Willisau")["countrycodes"] == "ch"
    # Wer über die Grenze einkauft, schreibt das Land dazu.
    assert "countrycodes" not in anfrage("Kaufland Lörrach Deutschland")
    assert "countrycodes" not in anfrage("Aldi Waldshut Germany")


def test_the_answer_keeps_the_full_address():
    """Daran erkennt man den richtigen von drei gleichnamigen Läden."""
    roh = [
        {
            "name": "Coop",
            "display_name": "Coop, Menznauerstrasse 1, Willisau, 6130, Schweiz",
            "lat": "47.1234",
            "lon": "7.9876",
        }
    ]
    assert treffer(roh) == [
        {
            "name": "Coop",
            "address": "Coop, Menznauerstrasse 1, Willisau, 6130, Schweiz",
            "latitude": 47.1234,
            "longitude": 7.9876,
        }
    ]


def test_unusable_answers_are_dropped_not_guessed():
    roh = [
        {"display_name": "Ohne Koordinaten"},
        {"lat": "keine", "lon": "zahl", "display_name": "Unsinn"},
        "gar kein Objekt",
        {"lat": "47.1", "lon": "7.9"},  # ohne Namen: display_name fehlt
    ]
    assert treffer(roh) == []
    assert treffer(None) == []
    assert treffer({}) == []


def test_the_list_stays_short_enough_to_read():
    roh = [
        {"name": f"Laden {i}", "display_name": f"Laden {i}, Ort", "lat": "47.1", "lon": "7.9"}
        for i in range(20)
    ]
    assert len(treffer(roh)) == MAX_TREFFER
