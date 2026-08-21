"""Das Haus auf einem Blatt – was drauf gehört und was nicht."""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hausblatt import hausblatt
from homepilot.core.hub import Hub

from .conftest import make_config


def test_messwerte_gehoeren_nicht_aufs_blatt():
    """Dreissig Sensoren machen aus einer Seite drei – und bedienen kann
    man sie ohnehin nicht."""
    text = hausblatt(
        haus="Haus",
        raeume={
            "Küche": [
                {"name": "Kaffeemaschine", "kind": "switch", "commands": ["turn_on"]},
                {"name": "Temperatur Küche", "kind": "sensor", "commands": []},
                {"name": "Fenster Küche", "kind": "binary_sensor", "commands": []},
            ]
        },
        szenen=[],
        ablaeufe=[],
    )
    assert "Kaffeemaschine" in text
    assert "Temperatur Küche" not in text
    assert "Fenster Küche" not in text


def test_ein_raum_ohne_bedienbares_faellt_weg():
    text = hausblatt(
        haus="Haus",
        raeume={"Estrich": [{"name": "Fühler", "kind": "sensor", "commands": []}]},
        szenen=[],
        ablaeufe=[],
    )
    assert "Estrich" not in text
    assert "(nichts eingerichtet)" in text


def test_was_von_selbst_passiert_steht_in_worten_da():
    """Der eigentliche Grund für das Blatt: Ein Licht, das um 22 Uhr von
    allein ausgeht, erschreckt jemanden, der es nicht weiss."""
    text = hausblatt(
        haus="Haus",
        raeume={},
        szenen=[],
        ablaeufe=[
            {
                "alias": "Aussenlicht abends",
                "enabled": True,
                "triggers": [{"type": "sun"}, {"type": "time"}],
            }
        ],
    )
    assert "Aussenlicht abends" in text
    assert "nach dem Sonnenstand" in text
    assert "zu einer festen Uhrzeit" in text


def test_abgeschaltete_ablaeufe_stehen_nicht_drauf():
    text = hausblatt(
        haus="Haus",
        raeume={},
        szenen=[],
        ablaeufe=[{"alias": "Ruht im Sommer", "enabled": False, "triggers": []}],
    )
    assert "Ruht im Sommer" not in text
    assert "(nichts)" in text


def test_unbekannter_ausloeser_wird_nicht_verschwiegen():
    """Lieber ein roher Typ als eine Zeile, die schweigt."""
    text = hausblatt(
        haus="Haus",
        raeume={},
        szenen=[],
        ablaeufe=[{"alias": "Neu", "enabled": True, "triggers": [{"type": "webhook"}]}],
    )
    assert "webhook" in text


def test_blatt_ueber_die_api():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        response = client.get("/api/system/hausblatt")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/plain")
        text = response.text
        assert "Räume und Geräte" in text
        assert "Was von selbst passiert" in text
        # Die Demo-Wohnung hat ein Licht im Wohnzimmer.
        assert "Wohnzimmer" in text
