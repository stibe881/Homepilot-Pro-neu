"""Der Platzhalter {termin}: der laufende Kalendertermin in Nachrichten."""

from datetime import datetime

from homepilot.core.terminkontext import laufender_termin, platzhalter_fuellen


def um(stunde: int, minute: int = 0) -> datetime:
    return datetime(2026, 8, 30, stunde, minute)


class TestLaufenderTermin:
    def test_ein_laufender_termin_wird_gefunden(self) -> None:
        events = [{"summary": "Raymond zu Besuch", "start": "2026-08-30T14:00:00", "end": "2026-08-30T18:00:00"}]
        assert laufender_termin(events, um(15)) == "Raymond zu Besuch"

    def test_der_vorlauf_zaehlt_mit(self) -> None:
        # Besuch klingelt gern eine Viertelstunde zu früh.
        events = [{"summary": "Raymond", "start": "2026-08-30T14:00:00", "end": "2026-08-30T18:00:00"}]
        assert laufender_termin(events, um(13, 45)) == "Raymond"
        assert laufender_termin(events, um(13, 30)) is None

    def test_ohne_ende_gelten_zwei_stunden(self) -> None:
        events = [{"summary": "Kaffee", "start": "2026-08-30T14:00:00"}]
        assert laufender_termin(events, um(15, 30)) == "Kaffee"
        assert laufender_termin(events, um(16, 30)) is None

    def test_ganztaegige_und_geburtstage_zaehlen_nicht(self) -> None:
        events = [
            {"summary": "Elternabend", "start": "2026-08-30", "all_day": True},
            {"summary": "Flo hat Geburtstag", "start": "2026-08-30T00:00:00", "birthday": True},
        ]
        assert laufender_termin(events, um(15)) is None

    def test_bei_mehreren_gewinnt_der_spaeter_begonnene(self) -> None:
        events = [
            {"summary": "Nachmittag", "start": "2026-08-30T13:00:00", "end": "2026-08-30T19:00:00"},
            {"summary": "Abendgäste", "start": "2026-08-30T18:00:00", "end": "2026-08-30T22:00:00"},
        ]
        assert laufender_termin(events, um(18, 30)) == "Abendgäste"

    def test_kaputtes_bleibt_still(self) -> None:
        assert laufender_termin(None, um(15)) is None
        assert laufender_termin([{"summary": "x", "start": "kaputt"}], um(15)) is None


class TestPlatzhalter:
    def test_ersetzt_den_platzhalter(self) -> None:
        events = [{"summary": "Raymond", "start": "2026-08-30T14:00:00", "end": "2026-08-30T18:00:00"}]
        assert (
            platzhalter_fuellen("Das ist wohl {termin}.", events, um(15))
            == "Das ist wohl Raymond."
        )

    def test_ohne_termin_steht_besuch_da(self) -> None:
        # «Das ist wohl Besuch» stimmt an der Klingel immer.
        assert platzhalter_fuellen("Das ist wohl {termin}.", [], um(15)) == "Das ist wohl Besuch."

    def test_ohne_platzhalter_bleibt_der_text_unangetastet(self) -> None:
        assert platzhalter_fuellen("Es klingelt.", None, um(15)) == "Es klingelt."
