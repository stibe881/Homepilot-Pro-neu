"""Wer hat was eingerichtet.

Die andere Hälfte des Zugriffsprotokolls: Das eine ist Bedienung und
passiert hundertmal am Tag, das andere Einrichtung und passiert selten.
"""

from homepilot.core import aenderungen


def test_eintrag_haelt_das_noetige_fest():
    row = aenderungen.eintrag("Stefan", "geraet", "umbenannt", "Küchenlicht")
    assert row["user"] == "Stefan"
    assert row["art"] == "geraet"
    assert row["was"] == "umbenannt"
    assert row["ziel"] == "Küchenlicht"
    assert row["at"] > 0


def test_ohne_ziel_kein_leeres_feld():
    row = aenderungen.eintrag("Livia", "konfiguration", "gespeichert")
    assert "ziel" not in row


def test_ohne_namen_ein_fragezeichen():
    """Und nicht ein leeres Feld, das aussieht, als fehle etwas."""
    assert aenderungen.eintrag("", "geraet", "umbenannt")["user"] == "?"


def test_gekuerzt_wird_von_vorne():
    rows = [{"at": n} for n in range(10)]
    assert aenderungen.trim(rows, 3) == [{"at": 7}, {"at": 8}, {"at": 9}]


def test_haus_nennt_die_felder_beim_namen():
    """«widgetButtons geändert» wäre richtig - nur sucht niemand danach."""
    satz = aenderungen.haus_beschreiben({"hidden": []}, {"hidden": ["light.a"]})
    assert satz == "ausgeblendete Geräte"


def test_haus_meldet_nur_das_wirklich_andere():
    satz = aenderungen.haus_beschreiben(
        {"hidden": ["a"], "locked": []}, {"hidden": ["a"], "locked": ["b"]}
    )
    assert satz == "gesperrte Geräte"


def test_haus_schweigt_wenn_nichts_anders_ist():
    # Dann gehört auch keine Zeile ins Protokoll.
    assert aenderungen.haus_beschreiben({"hidden": ["a"]}, {"hidden": ["a"]}) == ""


def test_haus_kuerzt_bei_vielen_feldern():
    alt: dict = {}
    neu = {
        "hidden": ["a"],
        "locked": ["b"],
        "order": {"x": []},
        "bioLock": True,
        "doorConfirm": False,
    }
    satz = aenderungen.haus_beschreiben(alt, neu)
    assert "und 2 weitere" in satz


# ── Über die Route ─────────────────────────────────────────────────────────


def test_protokoll_haelt_das_umbenennen_fest():
    """«Seit wann heisst das so?» - die Frage, die man wirklich stellt."""
    from fastapi.testclient import TestClient

    from homepilot.api import create_app
    from homepilot.core.hub import Hub

    from .conftest import make_config

    with TestClient(create_app(Hub(make_config()))) as client:
        alle = client.get("/api/entities").json()
        licht = next(e for e in alle if e["kind"] == "light")
        client.put(f"/api/entities/{licht['id']}/meta", json={"name": "Leselampe"})
        eintraege = client.get("/api/system/einrichtung").json()["entries"]
        assert eintraege[0]["art"] == "geraet"
        assert "Leselampe" in eintraege[0]["was"]


def test_protokoll_haelt_die_hausansicht_fest():
    from fastapi.testclient import TestClient

    from homepilot.api import create_app
    from homepilot.core.hub import Hub

    from .conftest import make_config

    with TestClient(create_app(Hub(make_config()))) as client:
        client.put("/api/houseprefs", json={"prefs": {"hidden": ["light.a"]}})
        eintraege = client.get("/api/system/einrichtung").json()["entries"]
        assert eintraege[0]["art"] == "haus"
        assert "ausgeblendete Geräte" in eintraege[0]["was"]


def test_ohne_aenderung_keine_zeile():
    """Ein Zug, der nichts ändert, gehört nicht ins Protokoll."""
    from fastapi.testclient import TestClient

    from homepilot.api import create_app
    from homepilot.core.hub import Hub

    from .conftest import make_config

    with TestClient(create_app(Hub(make_config()))) as client:
        client.put("/api/houseprefs", json={"prefs": {"hidden": ["light.a"]}})
        client.put("/api/houseprefs", json={"prefs": {"hidden": ["light.a"]}})
        eintraege = client.get("/api/system/einrichtung").json()["entries"]
        assert len(eintraege) == 1
