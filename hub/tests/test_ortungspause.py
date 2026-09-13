"""Die Ortungspause kennt der Hub - nicht nur das eine Telefon (Punkt 627).

«Pausieren ist Pausieren» stand im Hook der App, aber die Pause lag nur
im Speicher des Geräts. Der Wächter schickte nach zwölf Stunden Stille
«Meldet sich nicht mehr» an die ganze Familie, die Familienseite zeigte
«meldet sich nicht», und das zweite eigene Gerät wusste von nichts.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import personen, presence
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

TOKEN = "probe-token"


def make_hub() -> Hub:
    return Hub(
        HubConfig(
            api=ApiConfig(token=TOKEN),
            integrations=[
                {
                    "integration": "geofence",
                    "zones": [{"id": "stefan", "name": "Stefan"}, {"id": "maja", "name": "Maja"}],
                }
            ],
            automations=[],
            users=[
                {"name": "Stefan", "role": "besitzer", "token": TOKEN},
                {"name": "Maja", "role": "bewohner", "token": "maja-token"},
            ],
        )
    )


def kopf(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_pausen_lesen_laesst_abgelaufene_und_kaputte_zeilen_weg():
    rows = [
        {"zone": "stefan", "until": 2000.0},
        {"zone": "maja", "until": 500.0},
        {"zone": "", "until": 3000.0},
        {"zone": "x", "until": "nein"},
        "kaputt",
    ]
    assert presence.pausen_lesen(rows, 1000.0) == {"stefan": 2000.0}


def test_pause_setzen_und_aufheben():
    rows = presence.pause_setzen([], "stefan", 2000.0, 1000.0)
    assert rows == [{"zone": "stefan", "until": 2000.0}]
    rows = presence.pause_setzen(rows, "maja", 3000.0, 1000.0)
    assert [r["zone"] for r in rows] == ["maja", "stefan"]
    # None hebt auf; Vergangenes ebenso.
    assert presence.pause_setzen(rows, "stefan", None, 1000.0) == [{"zone": "maja", "until": 3000.0}]
    assert presence.pause_setzen(rows, "maja", 900.0, 1000.0) == [{"zone": "stefan", "until": 2000.0}]


def test_pausierter_zustand_ist_unbekannt_mit_grund_und_ende():
    zustand = presence.pausiert_zustand({"state": "away", "place": "schule", "battery": 40}, 2000.0)
    assert zustand["state"] == presence.UNKNOWN
    assert zustand["reason"] == "paused"
    assert zustand["until"] == 2000.0
    assert zustand["place"] is None
    assert zustand["battery"] == 40


def test_aufenthalt_sagt_ortung_pausiert_bis():
    ende = time.mktime((2026, 9, 14, 6, 0, 0, 0, 0, -1))
    assert personen.aufenthalt({"state": "unknown", "reason": "paused", "until": ende}) == (
        "Ortung pausiert bis 06:00"
    )
    assert personen.aufenthalt({"state": "unknown"}) == "unbekannt"


def test_nur_die_eigene_zone_laesst_sich_pausieren_und_die_liste_sagt_es():
    with TestClient(create_app(make_hub())) as client:
        bis = time.time() + 3600
        fremd = client.post("/api/personen/maja/pause", headers=kopf(), json={"until": bis})
        assert fremd.status_code == 403
        unbekannt = client.post("/api/personen/niemand/pause", headers=kopf(), json={"until": bis})
        assert unbekannt.status_code == 404

        antwort = client.post("/api/personen/stefan/pause", headers=kopf(), json={"until": bis})
        assert antwort.status_code == 200
        assert antwort.json()["until"] == bis

        daten = client.get("/api/personen", headers=kopf()).json()
        stefan = next(p for p in daten["people"] if p["name"] == "Stefan")
        assert stefan["paused_until"] == bis
        assert stefan["where"].startswith("Ortung pausiert bis ")
        assert stefan["state"] == "unknown"
        maja = next(p for p in daten["people"] if p["name"] == "Maja")
        assert maja["paused_until"] is None

        # Aufheben: null.
        weiter = client.post("/api/personen/stefan/pause", headers=kopf(), json={"until": None})
        assert weiter.json()["until"] is None
        daten = client.get("/api/personen", headers=kopf()).json()
        stefan = next(p for p in daten["people"] if p["name"] == "Stefan")
        assert stefan["paused_until"] is None


async def test_der_waechter_schweigt_ueber_akku_und_funkstille_einer_pausierten_zone():
    hub = make_hub()
    await hub.start()
    try:
        gemeldet: list[str] = []

        async def merken(title, body, category="outage", to=None, data=None, entity_id=None):
            gemeldet.append(title)

        hub.watchdog._notify = merken  # type: ignore[method-assign]
        geo = hub.integrations.get("geofence")
        assert geo is not None
        # Stefan meldet mit fast leerem Akku - und dann seit einem Tag nichts.
        await geo.report("stefan", "leave", battery=5)
        entity = hub.registry.get(geo.zone_entity("stefan"))
        await hub.registry.update_state(
            entity.id, {**entity.state, "changed_at": time.time() - 24 * 3600, "reported_at": time.time() - 24 * 3600}
        )
        jetzt = time.time()
        hub.data.set(presence.PAUSE_KEY, presence.pause_setzen([], "stefan", jetzt + 3600, jetzt))

        await hub.watchdog._check_presence()
        assert gemeldet == []
        # Pausiert heisst für die App: unbekannt, weil pausiert.
        assert geo.merged("stefan")["reason"] == "paused"

        # Pause vorbei: jetzt kommen die Meldungen.
        hub.data.set(presence.PAUSE_KEY, [])
        await hub.watchdog._check_presence()
        assert "Telefon fast leer" in gemeldet
    finally:
        await hub.stop()
