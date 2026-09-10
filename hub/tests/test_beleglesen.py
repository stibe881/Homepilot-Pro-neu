"""Den Text aus einem Gutschein-Beleg ziehen (Punkt 298 der Werkbank)."""

from homepilot.core import beleglesen


def test_klartext_braucht_kein_extra():
    """Wer die Bestätigungsmail als .txt anhängt, soll denselben
    Vorschlag bekommen wie mit dem PDF - dafür braucht es keine
    Bibliothek."""
    text = beleglesen.aus_datei(b"Gutschein ueber CHF 50.00\n", "text/plain")
    assert "CHF 50.00" in text


def test_leerzeilen_fallen_weg():
    """PDF-Text kommt oft mit einer Leerzeile je Umbruch heraus, und das
    Raten in der App arbeitet zeilenweise - jede leere Zeile wäre ein
    Durchgang ohne Erkenntnis."""
    assert beleglesen.kuerzen("a\n\n\n  b  \n\n") == "a\nb"


def test_der_text_wird_gedeckelt():
    """Ein Beleg ist eine halbe Seite. Wer ein zwanzigseitiges PDF
    anhängt, hat den falschen Anhang erwischt."""
    lang = beleglesen.kuerzen("x" * (beleglesen.HOECHSTENS + 500))
    assert len(lang) == beleglesen.HOECHSTENS


def test_ein_bild_liefert_keinen_text():
    """Ein Foto der Karte ist kein Beleg zum Lesen - und ein leerer
    Vorschlag ist besser als ein geratener."""
    assert beleglesen.aus_datei(b"\x89PNG", "image/png") == ""


def test_kaputtes_pdf_ist_kein_fehler():
    """Ein Scan ohne Textebene oder eine kaputte Datei sind kein Grund
    für eine Fehlermeldung - der Vorschlag bleibt eben aus."""
    assert beleglesen.aus_pdf(b"keine gueltige PDF-Datei") == ""
