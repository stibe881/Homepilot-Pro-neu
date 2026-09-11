"""Den Text aus einem angehängten Gutschein-Beleg ziehen.

Seit Punkt 266 hängt am Gutschein die Datei aus der Bestätigungsmail -
meist ein PDF. Abgetippt hat man Betrag, Nummer und Ablaufdatum
trotzdem von Hand, und genau dort passieren die Zahlendreher, die man
erst an der Kasse merkt.

Hier steht nur das Herausholen des Textes; *gelesen* wird er in der App
(`lib/gutscheinlesen.ts`), und zwar aus zwei Gründen: Dort steht das
Formular, das der Vorschlag füllt, und dort lässt sich das Raten ohne
laufenden Hub prüfen.

`pypdf` ist ein Extra und kein Grundbestand (core/extras.py): Wer nie
einen Beleg anhängt, soll die Bibliothek nicht mitschleppen. Fehlt sie,
bleibt der Knopf dunkel - von Hand eintragen geht weiterhin.
"""

from __future__ import annotations

from importlib.util import find_spec

#: So viele Zeichen gehen höchstens zur App. Ein Beleg ist eine halbe
#: Seite; wer ein zwanzigseitiges PDF anhängt, hat den falschen Anhang
#: erwischt, und die App soll daran nicht ersticken.
HOECHSTENS = 20_000

#: So viele Seiten werden gelesen. Was auf Seite vier steht, sind die
#: Allgemeinen Geschäftsbedingungen.
SEITEN = 3


def verfuegbar() -> bool:
    """Ist das Extra installiert? (rein, testbar)"""
    return find_spec("pypdf") is not None


def ocr_verfuegbar() -> bool:
    """Kann der Hub fotografierte Belege lesen? (Punkt 444)

    Drei Teile, alle drei nötig: das Python-Paket `pytesseract`, `Pillow`
    zum Öffnen des Bilds und das Programm `tesseract` selbst (im Abbild
    über apt, samt deutschem Sprachpaket). Fehlt eines, bleibt der Knopf
    für Bilder dunkel - und die Systemseite sagt, welches.
    """
    import shutil

    try:
        return (
            find_spec("pytesseract") is not None
            and find_spec("PIL") is not None
            and shutil.which("tesseract") is not None
        )
    except (ImportError, ValueError):
        return False


def kuerzen(text: str) -> str:
    """Auf ein Mass bringen, das durch eine Antwort passt (rein, testbar).

    Und Leerzeilenwüsten zusammenziehen: PDF-Text kommt oft mit einer
    Leerzeile je Zeilenumbruch heraus, und das Raten in der App arbeitet
    zeilenweise - jede leere Zeile wäre ein Durchgang ohne Erkenntnis.
    """
    zeilen = [zeile.strip() for zeile in str(text or "").splitlines()]
    sauber = "\n".join(zeile for zeile in zeilen if zeile)
    return sauber[:HOECHSTENS]


def aus_pdf(daten: bytes) -> str:
    """Den Text eines PDF (leer, wenn es nicht geht).

    Fehler werden geschluckt: Ein PDF, das sich nicht lesen lässt - ein
    Scan ohne Textebene, eine kaputte Datei -, ist kein Grund für eine
    Fehlermeldung. Der Vorschlag bleibt dann eben aus, und man tippt.
    """
    if not verfuegbar():
        return ""
    try:
        import io

        from pypdf import PdfReader

        leser = PdfReader(io.BytesIO(daten))
        teile = [seite.extract_text() or "" for seite in leser.pages[:SEITEN]]
        return kuerzen("\n".join(teile))
    except Exception:  # noqa: BLE001 - jeder Fehler heisst hier «kein Text»
        return ""


def aus_bild(daten: bytes) -> str:
    """Den Text eines fotografierten Belegs - per Tesseract (Punkt 444).

    Auf dem Hub und nicht auf dem Telefon: Ein natives OCR-Modul in der
    App hiesse eine neue Hülle für alle Telefone; Tesseract im Abbild
    kostet ein apt-Paket. Deutsch und Englisch zusammen - Schweizer
    Belege mischen beides («Gutschein», «Voucher», «valid until»).
    Jeder Fehler heisst «kein Text»: Ein unscharfes Foto ist kein Grund
    für eine Fehlermeldung, man tippt dann eben.
    """
    if not ocr_verfuegbar():
        return ""
    try:
        import io

        import pytesseract
        from PIL import Image

        bild = Image.open(io.BytesIO(daten))
        return kuerzen(pytesseract.image_to_string(bild, lang="deu+eng"))
    except Exception:  # noqa: BLE001 - jeder Fehler heisst hier «kein Text»
        return ""


def aus_datei(daten: bytes, mime: str) -> str:
    """Den Text eines Anhangs - PDF, Bild oder Klartext (rein genug, testbar).

    Reiner Text braucht keine Bibliothek: Wer die Bestätigungsmail als
    .txt anhängt, soll denselben Vorschlag bekommen wie mit dem PDF.
    Ein Bild geht durch Tesseract (aus_bild), wenn es das Extra gibt.
    """
    art = str(mime or "").lower()
    if art.startswith("text/"):
        try:
            return kuerzen(daten.decode("utf-8", errors="replace"))
        except Exception:  # noqa: BLE001
            return ""
    if "pdf" in art:
        return aus_pdf(daten)
    if art.startswith("image/"):
        return aus_bild(daten)
    return ""
