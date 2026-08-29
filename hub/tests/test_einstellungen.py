"""Einstellungen ändern, ohne die der anderen zu löschen.

Der Fall, der es nötig machte: Der Anblick der App wird im Profil gesetzt,
die Playlist-Reihenfolge an der Musikkarte, die Vorlese-Box im Kochbuch.
Wer den ganzen Bestand mitschicken müsste, um ein Feld zu ändern, löscht
bei jedem Zug alles, was er nicht kennt.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.einstellungen import verschmelzen
from homepilot.core.hub import Hub

from .conftest import make_config


def make_client() -> TestClient:
    return TestClient(create_app(Hub(make_config())))


# ── Die reine Regel ────────────────────────────────────────────────────────


def test_genannte_schluessel_gewinnen():
    assert verschmelzen({"a": 1, "b": 2}, {"b": 3}) == {"a": 1, "b": 3}


def test_ungenannte_bleiben_liegen():
    """Der ganze Zweck: Wer den Anblick setzt, kennt die Favoriten nicht."""
    assert verschmelzen({"favoriten": ["x"]}, {"theme": "dark"}) == {
        "favoriten": ["x"],
        "theme": "dark",
    }


def test_null_loescht():
    """Sonst bekäme man nie wieder los, was man einmal gesetzt hat."""
    assert verschmelzen({"a": 1, "b": 2}, {"a": None}) == {"b": 2}


def test_leere_liste_ist_ein_wert_und_kein_loeschen():
    """«Keine Favoriten mehr» heisst leer, nicht «wie vorher»."""
    assert verschmelzen({"favoriten": ["x"]}, {"favoriten": []}) == {"favoriten": []}


def test_nur_die_oberste_ebene():
    """Tiefer zu verschmelzen machte das Kürzen einer Liste unmöglich."""
    assert verschmelzen({"order": {"a": [1], "b": [2]}}, {"order": {"a": [9]}}) == {
        "order": {"a": [9]}
    }


def test_ohne_bestand_bleibt_der_zug_uebrig():
    assert verschmelzen({}, {"theme": "sand"}) == {"theme": "sand"}


def test_der_bestand_bleibt_unangetastet():
    """Eine Kopie, kein Umbau am Speicher des Hubs."""
    alt = {"a": 1}
    verschmelzen(alt, {"b": 2})
    assert alt == {"a": 1}


# ── Über die Routen ────────────────────────────────────────────────────────


def test_persoenlich_teilzug_laesst_den_rest_stehen():
    with make_client() as client:
        client.put("/api/prefs", json={"prefs": {"favorites": ["light.a"]}})
        antwort = client.put("/api/prefs", json={"prefs": {"theme": "dark"}})
        assert antwort.status_code == 200
        gelesen = client.get("/api/prefs").json()["prefs"]
        assert gelesen == {"favorites": ["light.a"], "theme": "dark"}


def test_persoenlich_ueberschreibt_was_genannt_ist():
    with make_client() as client:
        client.put("/api/prefs", json={"prefs": {"favorites": ["light.a"]}})
        client.put("/api/prefs", json={"prefs": {"favorites": ["light.b"]}})
        assert client.get("/api/prefs").json()["prefs"] == {"favorites": ["light.b"]}


def test_persoenlich_null_loescht_ueber_die_route():
    with make_client() as client:
        client.put("/api/prefs", json={"prefs": {"theme": "pink"}})
        client.put("/api/prefs", json={"prefs": {"theme": None}})
        assert client.get("/api/prefs").json()["prefs"] == {}


def test_haus_teilzug_laesst_den_rest_stehen():
    """Die Widget-Knöpfe werden woanders gesetzt als die Reihenfolge."""
    with make_client() as client:
        client.put("/api/houseprefs", json={"prefs": {"hidden": ["light.a"]}})
        client.put("/api/houseprefs", json={"prefs": {"widgetButtons": ["door"]}})
        gelesen = client.get("/api/houseprefs").json()["prefs"]
        assert gelesen == {"hidden": ["light.a"], "widgetButtons": ["door"]}


def test_zu_gross_wird_am_ergebnis_gemessen():
    """Ein kleiner Zug auf einen schon vollen Bestand soll nicht
    durchrutschen - sonst wächst die Datei über jede Grenze."""
    with make_client() as client:
        client.put("/api/prefs", json={"prefs": {"a": "x" * 30_000}})
        antwort = client.put("/api/prefs", json={"prefs": {"b": "y" * 5_000}})
        assert antwort.status_code == 413
        # Und der Bestand bleibt, wie er war.
        assert "b" not in client.get("/api/prefs").json()["prefs"]
