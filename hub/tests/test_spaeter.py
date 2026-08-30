"""«Später erinnern» – der Knopf in der Mitteilung und die Schlange dahinter.

Der Fall: «Fenster offen» kommt, während man am Herd steht. Wegwischen
heisst vergessen - beim offenen Fenster meldet der Wächter erst wieder,
wenn es jemand schliesst und neu öffnet.
"""

import time

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import spaeter
from homepilot.core.hub import Hub
from homepilot.core.push import knoepfe

from .conftest import make_config


def test_die_knoepfe_haengen_an_der_art_der_meldung():
    assert knoepfe("open") == "spaeter"
    assert knoepfe("battery") == "erledigt"
    # Die volle Maschine bekommt einen eigenen Griff: «Ich mach's».
    assert knoepfe("appliance") == "waesche"


def test_ohne_sinnvollen_handgriff_keine_knoepfe():
    """Beim Alarm wäre «später erinnern» die falsche Auskunft, und
    entschärfen darf man auf einem Sperrbildschirm ohnehin nicht."""
    assert knoepfe("alarm") is None
    assert knoepfe(None) is None
    assert knoepfe("automation:tuerklingel") is None


def test_zweimal_schieben_verschiebt_statt_zu_verdoppeln():
    rows = spaeter.einreihen([], {"title": "Fenster offen", "body": "seit 2 Std"}, 1000, 30)
    rows = spaeter.einreihen(rows, {"title": "Fenster offen", "body": "seit 2 Std"}, 1200, 60)
    assert len(rows) == 1
    assert rows[0]["at"] == 1200 + 3600


def test_unsinnige_wartezeit_wird_zur_halben_stunde():
    assert spaeter.minuten_pruefen("viel") == 30
    assert spaeter.minuten_pruefen(0) == 30
    assert spaeter.minuten_pruefen(-5) == 30
    # Und mehr als einen Tag ist kein «später», sondern ein «nie».
    assert spaeter.minuten_pruefen(99999) == spaeter.MAX_MINUTEN


def test_ohne_titel_wird_nichts_eingereiht():
    assert spaeter.einreihen([], {"body": "ohne Titel"}, 1000) == []


def test_faellig_trennt_jetzt_von_spaeter():
    rows = [{"title": "a", "at": 100.0}, {"title": "b", "at": 300.0}, "quatsch"]
    dran, rest = spaeter.faellig(rows, 200.0)
    assert [row["title"] for row in dran] == ["a"]
    assert [row["title"] for row in rest] == ["b"]


def test_die_schlange_bleibt_gedeckelt():
    """Ein Telefon, das eine Woche lang alles sammelt, schüttet es
    irgendwann auf einmal aus."""
    rows: list = []
    for nummer in range(spaeter.HOECHSTENS + 20):
        rows = spaeter.einreihen(rows, {"title": f"Meldung {nummer}"}, 1000 + nummer)
    assert len(rows) == spaeter.HOECHSTENS


async def test_der_knopf_reicht_die_meldung_an_den_hub_und_sie_kommt_wieder():
    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
            integrations=[{"integration": "demo"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        antwort = client.post(
            "/api/push/snooze",
            json={"title": "Fenster offen", "body": "seit 2 Std", "category": "open"},
            headers={"Authorization": "Bearer t-owner"},
        )
        assert antwort.status_code == 200
        assert antwort.json()["minutes"] == 30
        rows = hub.data.get(spaeter.SCHLANGE)
        assert rows[0]["title"] == "Fenster offen"
        # Nur an die Person, die geschoben hat.
        assert rows[0]["to"] == "Stefan"

        # Nach Ablauf schickt der Wächter denselben Satz noch einmal.
        gesendet: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None, **_):
            gesendet.append((title, body))
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")
        hub.data.set(
            spaeter.SCHLANGE,
            [{**rows[0], "at": time.time() - 1}],
        )
        await hub.watchdog._check_spaeter()
        assert gesendet == [("Fenster offen", "seit 2 Std")]
        assert hub.data.get(spaeter.SCHLANGE) == []
