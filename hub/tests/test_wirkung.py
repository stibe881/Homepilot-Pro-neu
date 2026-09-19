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


def test_eine_ruhende_box_gilt_nach_pause_oder_aus_als_gewirkt():
    """Der gemeldete Fall: «Niemand mehr zuhause» pausiert die Musik in
    jedem Zimmer, und jedes einzelne meldete «spielte weiter» - obwohl
    nirgends etwas lief.

    Eine Cast-Box, die schon ruhte, meldet nie wörtlich «paused» oder
    «off», nur «idle» oder «standby» (integrations/google_cast.py).
    `abgleich` verglich bisher mit blossem Stringvergleich und kannte
    diese Gleichsetzung nicht - dieselbe Aktion in einer Szene galt
    längst richtig als «gilt noch» (szenenrueckweg.py, Punkt 650/653),
    ein Ablauf mit derselben Aktion meldete trotzdem «wirkungslos»
    (Punkt 740 der Werkbank).
    """
    punkte = wirkung.pruefpunkte(
        [
            {"entity_id": "cast.bad", "command": "pause"},
            {"entity_id": "cast.buero", "command": "turn_off"},
        ]
    )
    ergebnis = wirkung.abgleich(
        punkte,
        {"cast.bad": {"state": "idle"}, "cast.buero": {"state": "standby"}},
    )
    assert ergebnis == {"ok": ["cast.bad", "cast.buero"], "fehlt": []}
    assert wirkung.urteil(ergebnis) == "gewirkt"

    # Lief die Box wirklich noch, bleibt es zu Recht ein Fehlschlag.
    laeuft = wirkung.abgleich(punkte, {"cast.bad": {"state": "playing"}})
    assert laeuft == {"ok": [], "fehlt": ["cast.bad"]}


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
            "nachgefasst": False,
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
        # Punkt 596: Es wurde nachgefasst - und es half nichts.
        assert eintrag["effect"]["nachgefasst"] is True
    finally:
        await hub.stop()


# ── Nachfassen (Punkt 596) ────────────────────────────────────────────────


def test_nachfass_aktionen_nimmt_den_letzten_schritt_je_fehlendem_geraet():
    actions = [
        {"type": "command", "entity_id": "a", "command": "turn_on"},
        {"type": "delay", "seconds": 5},
        {"type": "command", "entity_id": "b", "command": "turn_off"},
        {"type": "command", "entity_id": "a", "command": "turn_off"},
        {"type": "broadcast", "text": "Gute Nacht"},
    ]
    noch_einmal = wirkung.nachfass_aktionen(actions, ["a", "b"])
    assert noch_einmal == [
        {"type": "command", "entity_id": "a", "command": "turn_off"},
        {"type": "command", "entity_id": "b", "command": "turn_off"},
    ]
    # Was nicht fehlte, wird nicht wiederholt.
    assert wirkung.nachfass_aktionen(actions, []) == []


def test_die_meldung_sagt_was_man_im_zimmer_sieht():
    punkte = [
        {"entity_id": "hue.stehlampe", "ziel": {"state": "off"}},
        {"entity_id": "hm.store", "ziel": {"position": 0, "state": "closed"}},
    ]
    titel, text = wirkung.meldung(
        "Gute Nacht", punkte, ["hue.stehlampe", "hm.store"], lambda e: e.split(".")[1]
    )
    assert titel == "Ablauf ohne Wirkung"
    assert text == "Gute Nacht: stehlampe blieb an, store blieb offen"
    assert wirkung.blieb_satz({"volume": 30}) == "folgte nicht"


async def test_ein_verlorener_befehl_wird_nachgefasst_und_dann_gemeldet(monkeypatch):
    """Der erste Funkbefehl geht verloren, der zweite kommt an: Der Lauf
    gilt als gewirkt - mit dem Vermerk, dass es zwei Anläufe brauchte.
    Kommt auch der zweite nicht an, gibt es eine Meldung, einmal am Tag."""
    monkeypatch.setattr(automation_modul, "WIRKUNG_NACH", 0.01)
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        echt = hub.integrations.dispatch_command
        versuche: list[str] = []

        async def wackelig(entity_id, command, data=None):
            versuche.append(command)
            # Der erste Versuch verpufft, der zweite kommt an.
            if len(versuche) == 1:
                return hub.registry.get(entity_id)
            return await echt(entity_id, command, data)

        monkeypatch.setattr(hub.integrations, "dispatch_command", wackelig)
        gesendet: list[tuple[str, str]] = []

        async def merken(tokens, title, body, **_):
            gesendet.append((title, body))

        hub.push.send = merken  # type: ignore[method-assign]

        await hub.registry.update_state("demo.light_bedroom", {"state": "off"})
        ablauf = Automation(
            id="a",
            alias="Gute Nacht",
            triggers=[],
            actions=[
                {"type": "command", "entity_id": "demo.light_bedroom", "command": "turn_on"}
            ],
        )
        await hub.automations._run(ablauf)
        await asyncio.sleep(0.15)
        eintrag = hub.automations.runs[0]
        assert versuche == ["turn_on", "turn_on"]
        assert eintrag["effect"]["urteil"] == "gewirkt"
        assert eintrag["effect"]["nachgefasst"] is True
        assert hub.registry.get("demo.light_bedroom").state["state"] == "on"
        # Gewirkt heisst: keine Meldung.
        assert gesendet == []

        # Und jetzt ein Gerät, das gar nicht hört.
        async def taub(entity_id, command, data=None):
            return hub.registry.get(entity_id)

        monkeypatch.setattr(hub.integrations, "dispatch_command", taub)
        stumm = Automation(
            id="b",
            alias="Gute Nacht",
            triggers=[],
            actions=[
                {"type": "command", "entity_id": "demo.light_bedroom", "command": "turn_off"}
            ],
        )
        await hub.automations._run(stumm)
        await asyncio.sleep(0.15)
        assert hub.automations.runs[0]["effect"]["urteil"] == "wirkungslos"
        assert gesendet == [("Ablauf ohne Wirkung", "Gute Nacht: Licht Schlafzimmer blieb an")]
        # Einmal am Tag je Ablauf - wie bei 465.
        await hub.automations._run(stumm)
        await asyncio.sleep(0.15)
        assert len(gesendet) == 1
    finally:
        await hub.stop()
