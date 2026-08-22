"""Zimmerformen aus der Saugerkarte.

Der Fall, um den es geht: eine diagonal geschnittene Wohnung. Dort
überlappen sich die achsenparallelen Hüllen der Zimmer so stark, dass
ein Tipp auf den Gang in vier davon liegt.
"""

from __future__ import annotations

import pytest

from homepilot.core import kartenform


def maske(zeilen: list[str]) -> list[list[bool]]:
    """«##..» → [[True, True, False, False]] – Testdaten zum Ansehen."""
    return [[zeichen == "#" for zeichen in zeile] for zeile in zeilen]


def test_a_rectangular_room_is_one_rectangle():
    assert kartenform.rechtecke_aus_maske(maske(["###", "###"])) == [(0, 0, 3, 2)]


def test_an_l_shaped_room_is_two():
    formen = kartenform.rechtecke_aus_maske(maske(["##..", "##..", "####"]))
    assert formen == [(0, 0, 2, 2), (0, 2, 4, 1)]


def test_a_room_with_a_niche_keeps_both_parts_of_the_row():
    # Eine Zeile mit Loch in der Mitte – etwa ein Durchgang mit Pfeiler.
    formen = kartenform.rechtecke_aus_maske(maske(["#.#"]))
    assert formen == [(0, 0, 1, 1), (2, 0, 1, 1)]


def test_nothing_in_nothing_out():
    assert kartenform.rechtecke_aus_maske(maske(["...", "..."])) == []
    assert kartenform.rechtecke_aus_maske([]) == []


def test_a_diagonal_room_becomes_a_staircase_not_a_box():
    """Der eigentliche Zweck: Eine schräge Wand bleibt schräg."""
    formen = kartenform.rechtecke_aus_maske(maske(["#...", "##..", "###.", "####"]))
    # Vier Stufen statt eines Rechtecks, das dreimal zu gross wäre.
    assert len(formen) == 4
    gedeckt = sum(w * h for _x, _y, w, h in formen)
    assert gedeckt == 10  # 1+2+3+4
    assert gedeckt < 4 * 4  # die Hülle wäre 16


def test_the_rectangles_are_sorted_top_down():
    formen = kartenform.rechtecke_aus_maske(maske(["..#", "#..", "..#"]))
    assert [rechteck[1] for rechteck in formen] == [0, 1, 2]


def test_shares_are_relative_to_the_whole_picture():
    # Eine Maske von 2×2 Zellen à 10 Pixel, ab (20, 40) in einem
    # Bild von 200×400.
    anteile = kartenform.als_anteile(
        [(0, 0, 2, 1)], ursprung=(20, 40), zelle=(10.0, 10.0), bild=(200, 400)
    )
    assert anteile == [[0.1, 0.1, 0.1, 0.025]]


def test_shares_of_an_empty_picture_are_no_shares():
    assert kartenform.als_anteile([(0, 0, 1, 1)], (0, 0), (1, 1), (0, 0)) == []


def test_area_adds_up():
    assert kartenform.flaeche([[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5]]) == pytest.approx(0.5)
    assert kartenform.flaeche([]) == 0


def test_a_painted_flat_survives_the_round_trip():
    """Vom gemalten Grundriss zur Antwort und zurück zur Fläche.

    Der Test, der den Zweck prüft und nicht die Mechanik: Ein
    L-förmiges Zimmer soll am Ende weniger Fläche belegen als seine
    Hülle - und zwar genau seine eigene.
    """
    grundriss = maske(
        [
            "#####...",
            "#####...",
            "#####...",
            "########",
            "########",
        ]
    )
    rechtecke = kartenform.rechtecke_aus_maske(grundriss)
    anteile = kartenform.als_anteile(rechtecke, (0, 0), (1.0, 1.0), (8, 5))
    # 15 Zellen oben + 16 unten von 40 – gut drei Viertel der Hülle.
    assert kartenform.flaeche(anteile) == pytest.approx(31 / 40)


# ── Aus dem echten Kartenbild (roborock.room_shapes) ─────────────────────


class _Bild:
    """Ein gemaltes Kartenbild, so wie der Parser es liefert."""

    def __init__(self, daten):
        self.data = daten
        self.is_empty = False


class _Karte:
    def __init__(self, image):
        self.image = image


def _grundriss():
    """Zwei Zimmer, eines diagonal – so sieht Zells Wohnung aus."""
    from PIL import Image

    bild = Image.new("RGB", (40, 20), (19, 87, 148))  # ausserhalb
    pixel = bild.load()
    # Zimmer 1: rechteckig, links.
    for y in range(2, 18):
        for x in range(2, 18):
            pixel[x, y] = (240, 178, 122)
    # Zimmer 2: dreieckig, rechts – seine Hülle deckt halb Zimmer 1 mit ab.
    for y in range(2, 18):
        for x in range(20, 20 + (y - 1)):
            if x < 40:
                pixel[x, y] = (133, 193, 233)
    return bild


def test_room_shapes_reads_the_real_outline_from_the_picture():
    pytest.importorskip("PIL")
    from homepilot.integrations.roborock import room_shapes

    karte = _Karte(_Bild(_grundriss()))
    boxes = {1: [2 / 40, 2 / 20, 18 / 40, 18 / 20], 2: [20 / 40, 2 / 20, 1.0, 18 / 20]}
    formen = room_shapes(karte, boxes)

    # Das rechteckige Zimmer bleibt ein Rechteck.
    assert len(formen[1]) == 1
    # Das diagonale wird zur Treppe – und deckt deutlich weniger als
    # seine Hülle, genau darum geht es.
    assert len(formen[2]) > 5
    huelle = (1.0 - 20 / 40) * (18 / 20 - 2 / 20)
    assert kartenform.flaeche(formen[2]) < huelle * 0.75


def test_room_shapes_gives_up_instead_of_guessing():
    """Ohne Bild, ohne Farbe, ohne Treffer: lieber nichts sagen."""
    pytest.importorskip("PIL")
    from PIL import Image

    from homepilot.integrations.roborock import room_shapes

    assert room_shapes(_Karte(None), {1: [0, 0, 1, 1]}) == {}
    # Ein Bild, in dem nur Wandfarben stehen – da gibt es kein Zimmer.
    leer = Image.new("RGB", (10, 10), (100, 196, 254))
    assert room_shapes(_Karte(_Bild(leer)), {1: [0, 0, 1, 1]}) == {}
