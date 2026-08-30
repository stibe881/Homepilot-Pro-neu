"""Das neustartfeste Gedächtnis der Offen-Mahnungen (watchrules)."""

from homepilot.core.watchrules import (
    offene_meldungen_lesen,
    offene_meldungen_zeilen,
    schon_gemahnt,
)


class TestLesen:
    def test_geschlossene_fliegen_heraus(self) -> None:
        rows = [
            {"entity_id": "tuer", "seit": 100.0},
            {"entity_id": "fenster", "seit": 200.0},
        ]
        assert offene_meldungen_lesen(rows, {"tuer"}) == {"tuer": 100.0}

    def test_kaputte_ablage_wird_verworfen(self) -> None:
        assert offene_meldungen_lesen(None, {"tuer"}) == {}
        assert offene_meldungen_lesen("kaputt", {"tuer"}) == {}
        assert offene_meldungen_lesen(
            [{"entity_id": "tuer", "seit": "text"}, {"entity_id": "ok", "seit": 5}],
            {"tuer", "ok"},
        ) == {"ok": 5.0}
        # bool ist in Python ein int - aber kein Zeitstempel.
        assert offene_meldungen_lesen([{"entity_id": "tuer", "seit": True}], {"tuer"}) == {}

    def test_zeilen_sind_das_gegenstueck(self) -> None:
        zeilen = offene_meldungen_zeilen({"b": 2.0, "a": 1.0})
        assert zeilen == [
            {"entity_id": "a", "seit": 1.0},
            {"entity_id": "b", "seit": 2.0},
        ]
        assert offene_meldungen_lesen(zeilen, {"a", "b"}) == {"a": 1.0, "b": 2.0}


class TestSchonGemahnt:
    def test_dieselbe_oeffnung_mahnt_nicht_erneut(self) -> None:
        assert schon_gemahnt({"tuer": 1000.0}, "tuer", 1000.0)
        # Protokoll und eigene Zählung dürfen um Sekunden auseinanderliegen.
        assert schon_gemahnt({"tuer": 1000.0}, "tuer", 1090.0)

    def test_eine_neue_oeffnung_mahnt_wieder(self) -> None:
        assert not schon_gemahnt({"tuer": 1000.0}, "tuer", 5000.0)
        assert not schon_gemahnt({}, "tuer", 1000.0)
