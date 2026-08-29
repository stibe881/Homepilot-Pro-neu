"""«Sag mir in zwei Stunden Bescheid» - zu einem Gerät.

Die Waschmaschine läuft, man geht aus dem Haus, und in zwei Stunden
möchte man daran erinnert werden - ohne dafür einen Ablauf zu bauen.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import spaeter
from homepilot.core.hub import Hub

from .conftest import make_config


def test_erinnerung_landet_in_der_schlange():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        alle = client.get("/api/entities").json()
        licht = next(e for e in alle if e["kind"] == "light")
        antwort = client.post(
            f"/api/entities/{licht['id']}/erinnern", json={"minutes": 120}
        )
        assert antwort.status_code == 200
        assert antwort.json()["minutes"] == 120

        rows = hub.data.get(spaeter.SCHLANGE)
        assert len(rows) == 1
        assert rows[0]["title"].startswith("Nachsehen:")
        # Ein Tipp darauf führt zum Gerät, um das es ging.
        assert rows[0]["ziel"] == f"geraet:{licht['id']}"
        # Der Zustand von damals steht im Text - beim Lesen ist er alt,
        # aber er sagt, worum es ging.
        assert "Damals:" in rows[0]["body"]


def test_zweimal_verschiebt_statt_zu_verdoppeln():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        alle = client.get("/api/entities").json()
        licht = next(e for e in alle if e["kind"] == "light")
        client.post(f"/api/entities/{licht['id']}/erinnern", json={"minutes": 30})
        client.post(f"/api/entities/{licht['id']}/erinnern", json={"minutes": 120})
        rows = hub.data.get(spaeter.SCHLANGE)
        assert len(rows) == 1


def test_unbekanntes_geraet_wird_abgewiesen():
    with TestClient(create_app(Hub(make_config()))) as client:
        antwort = client.post("/api/entities/gibts.nicht/erinnern", json={})
        assert antwort.status_code == 404


def test_das_ziel_reist_mit_der_meldung():
    """Was in der Schlange steht, muss beim Verschicken ankommen."""
    rows = spaeter.einreihen(
        [], {"title": "Nachsehen: Waschmaschine", "ziel": "geraet:vzug.wm"}, 0.0, 60
    )
    assert rows[0]["ziel"] == "geraet:vzug.wm"
    # Ohne Ziel kein leeres Feld.
    ohne = spaeter.einreihen([], {"title": "Fenster offen"}, 0.0, 30)
    assert "ziel" not in ohne[0]
