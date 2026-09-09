"""Die Live-Bild-Prüfung liest die Wiedergabeliste richtig.

Der Fall dahinter ist ein falscher Freispruch: Die Prüfung holte aus
einer fMP4-Liste die *erste* Adresse - und das ist die Initialisierung
(`EXT-X-MAP`), ein paar hundert Bytes gross. Die kam mit 200 zurück,
worauf die Prüfung «alles 200, die Kette liefert» meldete. Der Player
scheiterte kurz darauf an den Video-Häppchen und zeigte eine schwarze
Fläche - gemeldet als «wenn die Kamera auf live schaltet, wird nur ein
schwarzer Bildschirm angezeigt».

Deshalb unterscheidet sie jetzt drei Dinge, und deshalb steht das hier
in einem Test: Init, Häppchen und Bruchstück sind drei verschiedene
Zeilenarten, und wer sie verwechselt, misst am Fehler vorbei.
"""

from homepilot.livecheck import bruchstueck, first_url, luecken, medienstueck

LOW_LATENCY = b"""#EXTM3U
#EXT-X-VERSION:10
#EXT-X-MAP:URI="614f_video1_init.mp4?session=abc"
#EXT-X-PART:DURATION=0.2,URI="614f_video1_part7.mp4?session=abc"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="614f_video1_part8.mp4?session=abc"
#EXTINF:1.000000,
614f_video1_seg3.mp4?session=abc
"""


def test_das_erste_stueck_ist_die_initialisierung_und_kein_bild():
    """`first_url` liefert weiterhin den Init - er wird auch gebraucht."""
    assert first_url(LOW_LATENCY) == "614f_video1_init.mp4?session=abc"


def test_das_video_haeppchen_wird_getrennt_gesucht():
    """Und *das* ist die Adresse, an der ein schwarzer Bildschirm hängt."""
    assert medienstueck(LOW_LATENCY) == "614f_video1_seg3.mp4?session=abc"


def test_das_bruchstueck_ist_das_dritte_und_gehoert_dem_browser():
    """hls.js holt die Teile, nicht die ganzen Häppchen."""
    assert bruchstueck(LOW_LATENCY) == "614f_video1_part7.mp4?session=abc"


def test_eine_liste_ohne_haeppchen_gibt_nichts_vor():
    """Steht in der Liste kein Häppchen, läuft der Strom noch nicht.

    Das ist eine Antwort und keine Panne - die Prüfung sagt es dann so,
    statt eine Adresse zu erfinden.
    """
    nur_kopf = b"#EXTM3U\n#EXT-X-VERSION:10\n#EXT-X-MAP:URI=\"init.mp4\"\n"
    assert medienstueck(nur_kopf) is None
    assert bruchstueck(nur_kopf) is None


MIT_LUECKEN = b"""#EXTM3U
#EXT-X-MEDIA-SEQUENCE:1
#EXT-X-MAP:URI="cb30_video1_init.mp4"
#EXT-X-GAP
#EXTINF:1.00000,
gap.mp4
#EXTINF:1.00000,
cb30_video1_seg7.mp4
"""


def test_ein_platzhalter_ist_kein_haeppchen():
    """Sonst misst die Prüfung einen 404 und hält ihn für den Fehler.

    «gap.mp4» gibt es nie zu holen - `#EXT-X-GAP` heisst «hier ist mit
    Absicht nichts». Gesucht ist das erste echte Häppchen dahinter.
    """
    assert medienstueck(MIT_LUECKEN) == "cb30_video1_seg7.mp4"
    assert luecken(MIT_LUECKEN) == 1
    assert luecken(LOW_LATENCY) == 0
