"""Aufnahmen zur Kamera-Zeitleiste: Fenster und Range-Auslegung."""

from homepilot.api.routes.entities import teilbereich
from homepilot.integrations.unifi_protect import clip_fenster


class TestClipFenster:
    def test_vorlauf_und_mindestlaenge(self) -> None:
        # Ein kurz gemeldetes Ereignis: zwei Sekunden Vorlauf, mindestens
        # sechs Sekunden Bild.
        anfang, ende = clip_fenster(100_000, 101_000, 999_999_999)
        assert anfang == 98_000
        assert ende == 104_000

    def test_ende_vor_start_zaehlt_nicht(self) -> None:
        anfang, ende = clip_fenster(100_000, 90_000, 999_999_999)
        assert (anfang, ende) == (98_000, 104_000)

    def test_hoechstens_neunzig_sekunden(self) -> None:
        anfang, ende = clip_fenster(100_000, 100_000 + 600_000, 999_999_999)
        assert ende - anfang == 90_000

    def test_nie_in_die_zukunft(self) -> None:
        # Das Ereignis läuft noch: exportiert wird nur bis jetzt.
        anfang, ende = clip_fenster(100_000, None, 101_000)
        assert anfang == 98_000
        assert ende == 101_000

    def test_eben_erst_begonnen_bleibt_eine_spanne(self) -> None:
        anfang, ende = clip_fenster(100_000, None, 97_000)
        assert ende > anfang


class TestTeilbereich:
    def test_ohne_header_die_ganze_datei(self) -> None:
        assert teilbereich(None, 100) is None
        assert teilbereich("", 100) is None

    def test_anfangsbereich_wie_avplayer_ihn_fragt(self) -> None:
        assert teilbereich("bytes=0-1", 100) == (0, 1)

    def test_offenes_ende(self) -> None:
        assert teilbereich("bytes=10-", 100) == (10, 99)

    def test_ende_wird_auf_die_groesse_gestutzt(self) -> None:
        assert teilbereich("bytes=10-500", 100) == (10, 99)

    def test_suffix_form(self) -> None:
        assert teilbereich("bytes=-20", 100) == (80, 99)

    def test_unsinn_ergibt_die_ganze_datei(self) -> None:
        # Lieber vollständig ausliefern als 416 - der Player bliebe schwarz.
        assert teilbereich("bytes=abc-def", 100) is None
        assert teilbereich("bytes=200-", 100) is None
        assert teilbereich("bytes=5-2", 100) is None
        assert teilbereich("bytes=-0", 100) is None
        assert teilbereich("bytes=0-1", 0) is None
