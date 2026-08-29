"""Ein Foto je Zimmer.

Getestet wird das, was ohne Bilddatei entscheidbar ist: wie aus einem
Raumnamen ein Dateiname wird, was die App schicken darf, und dass ein
umbenanntes Zimmer sein Foto nicht für immer liegen lässt.
"""

import base64

import pytest

from homepilot.core import raumbilder

# Ein winziges gültiges JPEG-Präfix reicht - der Hub sieht sich das Bild
# nicht an, er legt es ab. Was drin steht, entscheidet das Telefon.
BILD = base64.b64encode(b"\xff\xd8\xff\xe0 kein echtes Foto").decode()
URI = f"data:image/jpeg;base64,{BILD}"


def test_der_dateiname_uebersteht_jeden_raumnamen():
    # Ein Schrägstrich im Namen wäre sonst ein Verzeichnis, und ein
    # Zimmer aus lauter Emoji hätte gar keinen Namen.
    for name in ("Büro/Werkstatt", "🛋️", "Küche", "  Bad  "):
        datei = raumbilder.dateiname(name, ".jpg")
        assert "/" not in datei
        assert datei.endswith(".jpg")
        assert len(datei) == 20


def test_gross_und_kleinschreibung_meinen_dasselbe_zimmer():
    assert raumbilder.dateiname("Küche", ".jpg") == raumbilder.dateiname("küche", ".jpg")
    assert raumbilder.dateiname(" Küche ", ".jpg") == raumbilder.dateiname("Küche", ".jpg")
    # Zwei verschiedene Zimmer bleiben zwei Dateien.
    assert raumbilder.dateiname("Küche", ".jpg") != raumbilder.dateiname("Bad", ".jpg")


def test_ein_bild_wird_zu_bytes_und_endung():
    daten, suffix = raumbilder.entpacke(URI)
    assert daten.startswith(b"\xff\xd8")
    assert suffix == ".jpg"


def test_was_nicht_durchkommt_sagt_warum():
    # Jede Absage trägt einen Satz, den die App zeigen kann - ein blosses
    # «400» schickt sonst jemanden auf die Suche im eigenen Telefon.
    with pytest.raises(raumbilder.BildFehler, match="data-URI"):
        raumbilder.entpacke("https://example.com/foto.jpg")
    with pytest.raises(raumbilder.BildFehler, match="nicht unterstützt"):
        raumbilder.entpacke("data:image/gif;base64,AAAA")
    with pytest.raises(raumbilder.BildFehler, match="leer"):
        raumbilder.entpacke("data:image/jpeg;base64,")


def test_ein_zu_grosses_bild_nennt_beide_zahlen():
    riesig = base64.b64encode(b"x" * (raumbilder.MAX_BYTES + 1)).decode()
    with pytest.raises(raumbilder.BildFehler) as fehler:
        raumbilder.entpacke(f"data:image/png;base64,{riesig}")
    text = str(fehler.value)
    assert "2000 KB" in text
    assert "KB gross" in text


def test_schreiben_ersetzt_die_andere_endung(tmp_path):
    """Erst PNG, dann JPEG: Es darf nur ein Bild je Zimmer geben.

    Sonst entschiede die Reihenfolge im Ordner, welches die Kachel zeigt -
    und die ist keine, auf die man sich verlassen kann.
    """
    raumbilder.schreiben(tmp_path, "Küche", b"png-daten", ".png")
    assert raumbilder.pfad(tmp_path, "Küche").suffix == ".png"

    raumbilder.schreiben(tmp_path, "Küche", b"jpeg-daten", ".jpg")
    assert raumbilder.pfad(tmp_path, "Küche").suffix == ".jpg"
    assert len(list(tmp_path.iterdir())) == 1


def test_der_stand_nennt_nur_zimmer_mit_bild(tmp_path):
    raumbilder.schreiben(tmp_path, "Küche", b"daten", ".jpg")
    stand = raumbilder.stand(tmp_path, ["Küche", "Bad"])
    assert set(stand) == {"Küche"}
    # Die Zeit reist mit: Die App hängt sie an die Adresse, sonst zeigte
    # ein Telefon nach dem Wechseln wochenlang das alte Foto.
    assert stand["Küche"] > 0


def test_ohne_datendatei_gibt_es_keinen_ort():
    # Tests und die Demo laufen ohne Datendatei - dann eben ohne Bilder,
    # statt irgendwo im Dateisystem etwas anzulegen.
    assert raumbilder.ordner(None) is None
    assert raumbilder.stand(None, ["Küche"]) == {}
    assert raumbilder.loeschen(None, "Küche") is False


def test_ein_umbenanntes_zimmer_laesst_sein_bild_nicht_liegen(tmp_path):
    raumbilder.schreiben(tmp_path, "Küche", b"daten", ".jpg")
    raumbilder.schreiben(tmp_path, "Bad", b"daten", ".jpg")

    weg = raumbilder.aufraeumen(tmp_path, ["Bad"])

    assert weg == 1
    assert raumbilder.pfad(tmp_path, "Küche") is None
    assert raumbilder.pfad(tmp_path, "Bad") is not None


def test_loeschen_ist_still_wenn_es_nichts_zu_loeschen_gibt(tmp_path):
    assert raumbilder.loeschen(tmp_path, "Küche") is False
    raumbilder.schreiben(tmp_path, "Küche", b"daten", ".jpg")
    assert raumbilder.loeschen(tmp_path, "Küche") is True
    assert raumbilder.pfad(tmp_path, "Küche") is None
