

def test_the_ring_survives_an_orderly_restart(tmp_path):
    """«Warum hat er neu gestartet?» – die Frage stellt man genau dann,
    wenn der Speicher sie gerade vergessen hat."""
    from homepilot.core.logbuffer import LogBuffer

    alt = LogBuffer()
    alt.records.append(
        {"at": 1.0, "level": "WARNING", "logger": "x", "message": "Speicher knapp"}
    )
    pfad = tmp_path / "log-uebergabe.json"
    alt.save(pfad)

    neu = LogBuffer()
    neu.records.append(
        {"at": 2.0, "level": "WARNING", "logger": "y", "message": "frisch"}
    )
    assert neu.load(pfad) == 1
    rows = neu.entries()
    # Jüngste zuerst: erst das Frische, dann das Übernommene – und das
    # Übernommene trägt den Vermerk, dass es aus dem vorigen Lauf stammt.
    assert rows[0]["message"] == "frisch"
    assert rows[1]["message"] == "Speicher knapp"
    assert rows[1]["vorher"] is True
    # Die Datei ist eine Übergabe, kein Archiv.
    assert not pfad.exists()


def test_a_missing_or_broken_handover_is_silent(tmp_path):
    from homepilot.core.logbuffer import LogBuffer

    ring = LogBuffer()
    assert ring.load(tmp_path / "fehlt.json") == 0
    kaputt = tmp_path / "kaputt.json"
    kaputt.write_text("kein json", encoding="utf-8")
    assert ring.load(kaputt) == 0
