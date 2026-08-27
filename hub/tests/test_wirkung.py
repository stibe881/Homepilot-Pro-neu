"""«Wirkte der Ablauf?» – nachsehen, statt es anzunehmen.

Der Fall: Der Lauf-Verlauf sagt «ausgeführt», und das Licht ist trotzdem
aus. «Ausgeführt» heisst bisher nur «abgeschickt» - ein Funkbefehl, der
nicht ankommt, sieht genauso aus.
"""

import asyncio

from homepilot.core import automation as automation_modul
from homepilot.core import wirkung
from homepilot.core.automation import Automation
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub


def test_was_sich_nicht_vorhersagen_laesst_wird_nicht_geprueft():
    """«Umschalten» kann alles heissen - geraten wird nicht."""
    assert wirkung.pruefpunkte([{"entity_id": "demo.a", "command": "toggle"}]) == []
    assert wirkung.pruefpunkte([{"command": "turn_on"}]) == []


def test_beim_selben_geraet_zaehlt_der_letzte_befehl():
    """Ein Ablauf, der das Licht einschaltet und am Ende wieder aus, soll
    hinterher ein dunkles Licht vorfinden und nicht bemängeln."""
    punkte = wirkung.pruefpunkte(
        [
            {"entity_id": "demo.a", "command": "turn_on"},
            {"entity_id": "demo.a", "command": "turn_off"},
        ]
    )
    assert punkte == [{"entity_id": "demo.a", "ziel": {"state": "off"}}]


def test_einschalten_und_dimmen_gehoeren_zusammen():
    punkte = wirkung.pruefpunkte(
        [
            {"entity_id": "demo.a", "command": "turn_on"},
            {
                "entity_id": "demo.a",
                "command": "set_brightness",
                "data": {"brightness": 40},
            },
        ]
    )
    assert punkte == [
        {"entity_id": "demo.a", "ziel": {"state": "on", "brightness": 40}}
    ]


def test_ein_licht_das_nicht_anging_faellt_auf():
    punkte = wirkung.pruefpunkte(
        [
            {"entity_id": "demo.a", "command": "turn_on"},
            {"entity_id": "demo.b", "command": "turn_on"},
        ]
    )
    ergebnis = wirkung.abgleich(
        punkte, {"demo.a": {"state": "on"}, "demo.b": {"state": "off"}}
    )
    assert ergebnis == {"ok": ["demo.a"], "fehlt": ["demo.b"]}
    assert wirkung.urteil(ergebnis) == "teilweise"


def test_ein_paar_prozentpunkte_sind_kein_fehlschlag():
    """Dimmer runden, und Storen kommen selten genau auf dem Wert zum
    Stehen."""
    punkte = wirkung.pruefpunkte(
        [
            {
                "entity_id": "demo.a",
                "command": "set_brightness",
                "data": {"brightness": 40},
            }
        ]
    )
    assert wirkung.abgleich(punkte, {"demo.a": {"state": "on", "brightness": 41}}) == {
        "ok": ["demo.a"],
        "fehlt": [],
    }
    assert wirkung.abgleich(punkte, {"demo.a": {"state": "on", "brightness": 12}}) == {
        "ok": [],
        "fehlt": ["demo.a"],
    }


def test_ohne_pruefbares_gibt_es_kein_urteil():
    """Keine Auskunft ist keine schlechte Nachricht - und soll auch nicht
    als eine angezeigt werden."""
    assert wirkung.urteil({"ok": [], "fehlt": []}) is None
    assert wirkung.urteil({"ok": ["a"], "fehlt": []}) == "gewirkt"
    assert wirkung.urteil({"ok": [], "fehlt": ["a"]}) == "wirkungslos"


def test_ein_geraet_das_es_nicht_mehr_gibt_zaehlt_nirgends():
    punkte = wirkung.pruefpunkte([{"entity_id": "demo.weg", "command": "turn_on"}])
    assert wirkung.abgleich(punkte, {}) == {"ok": [], "fehlt": []}


async def test_der_lauf_traegt_hinterher_ein_ob_er_gewirkt_hat(monkeypatch):
    monkeypatch.setattr(automation_modul, "WIRKUNG_NACH", 0.01)
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        ablauf = Automation(
            id="a",
            alias="Licht an",
            triggers=[],
            conditions=[],
            actions=[
                {
                    "type": "command",
                    "entity_id": "demo.light_livingroom",
                    "command": "turn_on",
                }
            ],
        )
        await hub.automations._run(ablauf)
        await asyncio.sleep(0.1)
        assert hub.automations.runs[0]["effect"] == {
            "urteil": "gewirkt",
            "geprueft": 1,
            "nicht": [],
        }

        # Und jetzt einer, dessen Befehl niemand ausführt: Das Gerät bleibt
        # aus, obwohl der Lauf als «ausgeführt» im Protokoll steht.
        async def taub(entity_id, command, data=None):
            return hub.registry.get(entity_id)

        monkeypatch.setattr(hub.integrations, "dispatch_command", taub)
        await hub.registry.update_state("demo.light_bedroom", {"state": "off"})
        stummer = Automation(
            id="b",
            alias="Schlafzimmer an",
            triggers=[],
            conditions=[],
            actions=[
                {
                    "type": "command",
                    "entity_id": "demo.light_bedroom",
                    "command": "turn_on",
                }
            ],
        )
        await hub.automations._run(stummer)
        await asyncio.sleep(0.1)
        eintrag = hub.automations.runs[0]
        assert eintrag["executed"] is True
        assert eintrag["effect"]["urteil"] == "wirkungslos"
        assert eintrag["effect"]["nicht"] == ["Licht Schlafzimmer"]
    finally:
        await hub.stop()
