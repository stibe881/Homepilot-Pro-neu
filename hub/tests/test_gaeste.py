"""Gästemodus: ein Griff statt fünf Handgriffen – und mit Frist.

Der Fall: Besuch kommt. Man gibt das WLAN weiter, macht im Eingang
Licht und sorgt dafür, dass nicht mitten im Abend die Storen
herunterfahren, weil kein Telefon mehr zuhause gemeldet ist. Den
letzten Handgriff vergisst man - und das Aufheben am Ende erst recht.
"""

import time
from datetime import datetime

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import gaeste, rueckgriff
from homepilot.core.hub import Hub

from .conftest import make_config


def test_unsinnige_dauer_wird_zur_vorgabe():
    assert gaeste.stunden_pruefen("lang") == gaeste.STUNDEN_VORGABE
    assert gaeste.stunden_pruefen(0) == gaeste.STUNDEN_VORGABE
    assert gaeste.stunden_pruefen(-3) == gaeste.STUNDEN_VORGABE
    # Länger als einen Tag ist kein Besuch mehr, sondern ein Umzug.
    assert gaeste.stunden_pruefen(100) == gaeste.MAX_STUNDEN


def test_ein_kaputter_eintrag_heisst_modus_aus():
    """Ein Tippfehler in einer Datei darf nicht das halbe Haus anhalten."""
    assert gaeste.read("quatsch")["active"] is False
    assert gaeste.read([{"active": True}])["active"] is False  # ohne Frist
    assert gaeste.laeuft(None, 1000) is False


def test_die_frist_zaehlt_und_nicht_der_schalter():
    """Sonst hinge das ganze Haus an einer Aufräumrunde, die aus
    irgendeinem Grund nicht lief."""
    stand = gaeste.store(gaeste.starten(2, "Stefan", 1000))
    assert gaeste.laeuft(stand, 1000 + 3600) is True
    assert gaeste.laeuft(stand, 1000 + 3 * 3600) is False
    assert gaeste.restminuten(stand, 1000 + 3600) == 60
    assert gaeste.restminuten(stand, 1000 + 3 * 3600) == 0


def test_eine_fremde_pause_bleibt_stehen():
    """Wer während des Besuchs von Hand «bis morgen pausieren» wählt,
    behält das - das Ende des Gästemodus nimmt keine fremde
    Entscheidung zurück."""
    assert gaeste.darf_entpausieren(5000.0, 5000.0) is True
    assert gaeste.darf_entpausieren(5030.0, 5000.0) is True
    assert gaeste.darf_entpausieren(90000.0, 5000.0) is False
    assert gaeste.darf_entpausieren(None, 5000.0) is False


async def test_der_griff_macht_licht_haelt_die_ablaeufe_an_und_nimmt_beides_zurueck():
    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
            integrations=[{"integration": "demo"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        kopf = {"Authorization": "Bearer t-owner"}
        lampe = next(e for e in hub.registry.all() if e.kind == "light")
        await hub.integrations.dispatch_command(lampe.id, "turn_off")

        antwort = client.post(
            "/api/guestmode",
            json={"hours": 3, "lights": [lampe.id]},
            headers=kopf,
        )
        assert antwort.status_code == 200, antwort.text
        assert antwort.json()["active"] is True
        assert hub.registry.get(lampe.id).state["state"] == "on"
        assert hub.automations.paused is True
        # Die Auswahl überlebt: Beim nächsten Besuch soll sie angehakt sein.
        assert client.get("/api/guestmode", headers=kopf).json()["lights"] == [lampe.id]

        ende = client.delete("/api/guestmode", headers=kopf)
        assert ende.status_code == 200
        assert ende.json()["active"] is False
        # Licht wieder aus - es war vorher aus, also gehört es wieder aus.
        assert hub.registry.get(lampe.id).state["state"] == "off"
        assert hub.automations.paused is False
        assert rueckgriff.gueltige(hub.data.get(rueckgriff.SCHLANGE), time.time()) == []


async def test_ein_licht_das_schon_brannte_bleibt_am_ende_an():
    """Der Rückweg stellt den Stand von vorher her, nicht «alles aus»."""
    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
            integrations=[{"integration": "demo"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        kopf = {"Authorization": "Bearer t-owner"}
        lampe = next(e for e in hub.registry.all() if e.kind == "light")
        await hub.integrations.dispatch_command(lampe.id, "turn_on")
        client.post("/api/guestmode", json={"lights": [lampe.id]}, headers=kopf)
        client.delete("/api/guestmode", headers=kopf)
        assert hub.registry.get(lampe.id).state["state"] == "on"


async def test_der_waechter_beendet_ihn_wenn_die_frist_um_ist():
    """Der ganze Sinn: An dem Abend, an dem er läuft, denkt niemand
    ans Ausschalten."""
    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
            integrations=[{"integration": "demo"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        kopf = {"Authorization": "Bearer t-owner"}
        lampe = next(e for e in hub.registry.all() if e.kind == "light")
        await hub.integrations.dispatch_command(lampe.id, "turn_off")
        client.post("/api/guestmode", json={"hours": 1, "lights": [lampe.id]}, headers=kopf)

        # Die Uhr vorstellen, statt eine Stunde zu warten - und zwar
        # beide: Im Betrieb enden die Pause der Abläufe und der Modus
        # im selben Augenblick, und genau darauf schaut das Aufheben.
        vorbei = time.time() - 1
        stand = gaeste.read(hub.data.get(gaeste.KEY))
        hub.data.set(gaeste.KEY, gaeste.store({**stand, "until": vorbei}))
        hub.automations.paused_until = datetime.fromtimestamp(vorbei)

        gesendet: list[str] = []

        async def fake_send(tokens, title, body, data=None, **_):
            gesendet.append(title)
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        await hub.watchdog._check_gaeste()
        assert gaeste.read(hub.data.get(gaeste.KEY))["active"] is False
        assert hub.registry.get(lampe.id).state["state"] == "off"
        assert hub.automations.paused is False
