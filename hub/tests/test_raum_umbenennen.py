"""Einen Raum umbenennen (Punkt 495 der Werkbank).

Der Fall: In der config.yaml heisst «Büro» plötzlich «Arbeitszimmer» -
und danach hat das Zimmer kein Foto mehr, keine Kachel-Reihenfolge und
seine Szenen gehören niemandem. Nichts schlägt dabei fehl; der Hub
überspringt still, was er nicht kennt.
"""

from homepilot.core import replace


def test_die_geraete_und_szenen_ziehen_mit():
    meta = [{"entity_id": "a", "room": "Büro"}, {"entity_id": "b", "room": "Küche"}]
    assert replace.swap_room_in_rows(meta, "Büro", "Arbeitszimmer") == 1
    assert meta[0]["room"] == "Arbeitszimmer"
    assert meta[1]["room"] == "Küche"


def test_die_kachelreihenfolge_zieht_mit():
    order = {"room:Büro": ["a", "b"], "room:Küche": ["c"]}
    assert replace.swap_room_in_order(order, "Büro", "Arbeitszimmer") == 1
    assert order["room:Arbeitszimmer"] == ["a", "b"]
    assert "room:Büro" not in order


def test_wer_auf_ein_bestehendes_zimmer_umbenennt_behaelt_dessen_reihenfolge():
    """Dann wurde vermutlich zusammengelegt - und man hat das Ziel vor Augen."""
    order = {"room:Büro": ["a"], "room:Küche": ["c"]}
    assert replace.swap_room_in_order(order, "Büro", "Küche") == 1
    assert order["room:Küche"] == ["c"]
    assert "room:Büro" not in order


def test_die_raumreihenfolge_bekommt_keine_doppelten():
    raeume = ["Büro", "Küche"]
    assert replace.swap_room_in_values(raeume, "Büro", "Arbeitszimmer") == 1
    assert raeume == ["Arbeitszimmer", "Küche"]
    # Steht der neue Name schon drin, fällt der alte einfach weg.
    beides = ["Büro", "Küche"]
    assert replace.swap_room_in_values(beides, "Büro", "Küche") == 1
    assert beides == ["Küche"]


def test_ohne_treffer_wird_nichts_angefasst():
    order = {"room:Küche": ["c"]}
    assert replace.swap_room_in_order(order, "Büro", "X") == 0
    assert order == {"room:Küche": ["c"]}
    assert replace.swap_room_in_values(None, "Büro", "X") == 0
    assert replace.swap_room_in_order(None, "Büro", "X") == 0


def test_das_raumfoto_zieht_mit(tmp_path):
    from homepilot.core import raumbilder

    ordner = tmp_path
    (ordner / raumbilder.dateiname("Büro", ".png")).write_bytes(b"bild")
    assert raumbilder.umbenennen(ordner, "Büro", "Arbeitszimmer") is True
    assert (ordner / raumbilder.dateiname("Arbeitszimmer", ".png")).exists()
    assert not (ordner / raumbilder.dateiname("Büro", ".png")).exists()
    # Ohne Bild gibt es nichts zu tun - und ein bestehendes Foto am Ziel
    # wird nicht überschrieben: Das wäre ein Verlust ohne Rückweg.
    assert raumbilder.umbenennen(ordner, "Büro", "Arbeitszimmer") is False
    (ordner / raumbilder.dateiname("Keller", ".png")).write_bytes(b"x")
    assert raumbilder.umbenennen(ordner, "Keller", "Arbeitszimmer") is False
