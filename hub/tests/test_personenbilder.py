"""Personenbilder: ein eigener Ordner, sonst dieselbe Mechanik wie Räume."""

from homepilot.core import personenbilder, raumbilder


def test_der_ordner_heisst_anders_als_bei_raumbildern(tmp_path):
    data_file = str(tmp_path / "homepilot-data.json")
    assert personenbilder.ordner(data_file) == tmp_path / "personenbilder"
    assert raumbilder.ordner(data_file) == tmp_path / "raumbilder"


def test_ohne_datendatei_gibt_es_keinen_ort():
    assert personenbilder.ordner(None) is None
    assert personenbilder.ordner("") is None


def test_eine_person_und_ein_zimmer_gleichen_namens_teilen_sich_nichts(tmp_path):
    data_file = str(tmp_path / "homepilot-data.json")
    personen_ordner = personenbilder.ordner(data_file)
    raum_ordner = raumbilder.ordner(data_file)
    daten, suffix = personenbilder.entpacke(
        "data:image/jpeg;base64," + "QQ==",  # ein Byte, reicht für den Test
    )
    personenbilder.schreiben(personen_ordner, "Küche", daten, suffix)
    assert personenbilder.pfad(personen_ordner, "Küche") is not None
    assert raumbilder.pfad(raum_ordner, "Küche") is None
