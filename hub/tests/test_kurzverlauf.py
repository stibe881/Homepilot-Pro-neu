"""Die Funkenlinie: die letzten Stunden eines Messwerts, nur im Speicher."""

import time

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import kurzverlauf
from homepilot.core.hub import Hub
from homepilot.core.kurzverlauf import aufnehmen, messwert

from .conftest import make_config


def test_nur_sensoren_haben_eine_messreihe():
    assert messwert("sensor", {"state": "21.5"}) == 21.5
    # Ein Licht mit Helligkeit ist keine Messreihe, sondern ein Schalter.
    assert messwert("light", {"state": "on", "brightness": 80}) is None
    assert messwert("sensor", {"state": "offen"}) is None


def test_ein_zappelnder_sensor_ersetzt_statt_zu_fluten():
    reihe = aufnehmen([], 21.0, 1000.0)
    reihe = aufnehmen(reihe, 21.2, 1010.0)
    reihe = aufnehmen(reihe, 21.4, 1020.0)
    # Innerhalb des Abstands bleibt es ein Punkt - mit dem neuesten Wert,
    # damit die Linie beim aktuellen Stand endet.
    assert reihe == [[1000.0, 21.4]]
    reihe = aufnehmen(reihe, 22.0, 1000.0 + kurzverlauf.ABSTAND)
    assert len(reihe) == 2


def test_alte_punkte_fallen_hinten_ab():
    reihe = [[0.0, 20.0], [kurzverlauf.SPANNE, 21.0]]
    neu = aufnehmen(reihe, 22.0, kurzverlauf.SPANNE + kurzverlauf.ABSTAND + 1)
    assert [punkt[1] for punkt in neu] == [21.0, 22.0]


async def test_die_reihen_kommen_in_einem_abruf():
    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
            integrations=[{"integration": "demo"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        fuehler = next(e for e in hub.registry.all() if e.kind == "sensor")
        # Ein *anderer* Wert als der Startwert - unveränderte Zustände
        # publiziert die Registry gar nicht.
        await hub.registry.update_state(fuehler.id, {"state": 33.5})
        # Der zweite Punkt kommt erst nach dem Drosselabstand - die Uhr
        # der bestehenden Reihe zurückstellen statt zu warten.
        hub.kurzverlauf._reihen[fuehler.id][-1][0] = time.time() - kurzverlauf.ABSTAND
        await hub.registry.update_state(fuehler.id, {"state": 22.0})
        antwort = client.get(
            "/api/trends", headers={"Authorization": "Bearer t-owner"}
        ).json()
        assert fuehler.id in antwort["trends"]
        assert [punkt[1] for punkt in antwort["trends"][fuehler.id]] == [33.5, 22.0]
        # Eine Linie aus einem Punkt ist keine: Geräte mit nur einer
        # Meldung fehlen in der Antwort.
        assert all(len(reihe) >= 2 for reihe in antwort["trends"].values())
