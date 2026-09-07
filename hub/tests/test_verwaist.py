"""Verwaiste Abläufe (Punkt 262): Stille sieht wie Erfolg aus.

Ein Ablauf, der seit Monaten nicht gefeuert hat (umbenanntes Gerät, nie
erfüllte Bedingung), ist meist tot - und niemand merkt es, weil ein
toter Ablauf genauso aussieht wie einer, der brav wartet.
"""

import asyncio

from homepilot.core import verwaist
from homepilot.core.automation import Automation

TAG = 24 * 3600
JETZT = 20_000_000.0


def _ablauf(**kwargs) -> Automation:
    felder = {
        "id": "a1",
        "alias": "Licht bei Bewegung",
        "triggers": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
    }
    felder.update(kwargs)
    return Automation(**felder)


# ── Die Zeilen ─────────────────────────────────────────────────────────────


def test_merke_feuer_legt_zeile_an_und_beginnt_die_uhr():
    rows = verwaist.merke_feuer([], "a1", JETZT)
    assert rows == [{"automation_id": "a1", "first_seen": JETZT, "fired": JETZT}]


def test_merke_feuer_behaelt_das_erste_gesehene_datum():
    """Sonst wäre jeder Ablauf beim Feuern wieder «neu» - und die
    Altersfrage («gab es ihn überhaupt schon 90 Tage?») unbeantwortbar."""
    rows = verwaist.merke_gesehen([], ["a1"], JETZT - 100 * TAG)
    rows = verwaist.merke_feuer(rows, "a1", JETZT)
    assert verwaist.zeile(rows, "a1") == {
        "automation_id": "a1",
        "first_seen": JETZT - 100 * TAG,
        "fired": JETZT,
    }


def test_merke_gesehen_legt_fehlende_an_und_vergisst_geloeschte():
    rows = verwaist.merke_gesehen([], ["a1"], JETZT - 5 * TAG)
    rows = verwaist.merke_gesehen(rows, ["a1", "a2"], JETZT)
    assert {row["automation_id"] for row in rows} == {"a1", "a2"}
    # a1 behält sein altes Datum - nur a2 ist neu.
    assert verwaist.zeile(rows, "a1")["first_seen"] == JETZT - 5 * TAG
    assert verwaist.zeile(rows, "a2")["first_seen"] == JETZT
    # Gelöschte Abläufe schleppen ihre Zeile nicht ewig mit.
    rows = verwaist.merke_gesehen(rows, ["a2"], JETZT)
    assert [row["automation_id"] for row in rows] == ["a2"]


def test_merke_gesehen_meldet_nichts_zu_tun():
    """None statt derselben Liste: Der Motor ruft das im Takt auf, und
    ein Schreibvorgang ohne Änderung wäre jedes Mal ein fsync für nichts."""
    rows = verwaist.merke_gesehen([], ["a1"], JETZT)
    assert verwaist.merke_gesehen(rows, ["a1"], JETZT + TAG) is None


def test_kaputte_zeilen_stoeren_nicht():
    kaputt = ["Unsinn", {"ohne": "kennung"}, None, {"automation_id": "a1", "fired": "x"}]
    assert verwaist.zeile(kaputt, "a1") == {"automation_id": "a1", "fired": "x"}
    assert verwaist.letzte_feuer(kaputt) == {}
    assert verwaist.verwaiste(kaputt, [_ablauf()], JETZT) == []


def test_letzte_feuer_laesst_nie_gefeuerte_weg():
    """Kein Eintrag statt einer Null, die wie 1970 aussieht - die API
    macht daraus ein ehrliches null."""
    rows = verwaist.merke_gesehen([], ["still"], JETZT)
    rows = verwaist.merke_feuer(rows, "laut", JETZT - TAG)
    assert verwaist.letzte_feuer(rows) == {"laut": JETZT - TAG}


# ── Wer als verwaist gilt ──────────────────────────────────────────────────


def test_alter_stummer_ablauf_ist_verwaist():
    rows = verwaist.merke_gesehen([], ["a1"], JETZT - 120 * TAG)
    tote = verwaist.verwaiste(rows, [_ablauf()], JETZT)
    assert tote == [{"id": "a1", "alias": "Licht bei Bewegung", "last_fired": None}]


def test_lange_nicht_gefeuert_ist_verwaist_mit_zeitpunkt():
    rows = verwaist.merke_feuer([], "a1", JETZT - 120 * TAG)
    tote = verwaist.verwaiste(rows, [_ablauf()], JETZT)
    assert tote[0]["last_fired"] == JETZT - 120 * TAG


def test_ein_junger_ablauf_ist_nicht_verwaist():
    """Ein letzte Woche angelegter Ablauf hatte noch keine 90 Tage Zeit -
    massgebend ist das erste gesehene Datum, nicht die blosse Stille."""
    rows = verwaist.merke_gesehen([], ["a1"], JETZT - 7 * TAG)
    assert verwaist.verwaiste(rows, [_ablauf()], JETZT) == []


def test_wer_kuerzlich_gefeuert_hat_ist_nicht_verwaist():
    rows = verwaist.merke_gesehen([], ["a1"], JETZT - 200 * TAG)
    rows = verwaist.merke_feuer(rows, "a1", JETZT - 10 * TAG)
    assert verwaist.verwaiste(rows, [_ablauf()], JETZT) == []


def test_ohne_zeile_hat_die_uhr_noch_nicht_begonnen():
    assert verwaist.verwaiste([], [_ablauf()], JETZT) == []


def test_ausgeschaltete_und_ruhende_zaehlen_nicht():
    """Wer einen Ablauf absichtlich stilllegt, braucht keine Meldung,
    dass er still ist."""
    rows = verwaist.merke_gesehen([], ["a1", "a2"], JETZT - 120 * TAG)
    aus = _ablauf(enabled=False)
    ruht = _ablauf(id="a2", quiet_until=JETZT + TAG)
    assert verwaist.verwaiste(rows, [aus, ruht], JETZT) == []
    # Eine abgelaufene Ruhefrist schützt nicht mehr.
    wach = _ablauf(id="a2", quiet_until=JETZT - TAG)
    assert [row["id"] for row in verwaist.verwaiste(rows, [wach], JETZT)] == ["a2"]


def test_wer_nur_von_hand_startet_ist_nie_verwaist():
    """Ein Ablauf ohne Auslöser (Babysitter-Modus, «Alles aus» für andere
    Abläufe) feuert eben selten - das ist kein Befund."""
    rows = verwaist.merke_gesehen([], ["a1"], JETZT - 120 * TAG)
    von_hand = _ablauf(triggers=[])
    assert verwaist.nur_von_hand(von_hand)
    assert not verwaist.nur_von_hand(_ablauf())
    assert verwaist.verwaiste(rows, [von_hand], JETZT) == []


# ── Der Sammel-Hinweis ─────────────────────────────────────────────────────


def test_hinweis_nennt_die_namen():
    titel, text = verwaist.hinweis(
        [
            {"id": "a1", "alias": "Frostwarnung", "last_fired": None},
            {"id": "a2", "alias": "Storen bei Sturm", "last_fired": 1.0},
            {"id": "a3", "alias": "Kellerlicht", "last_fired": None},
        ]
    )
    assert titel == "3 Abläufe haben lange nicht gefeuert"
    assert "Frostwarnung" in text
    assert "Storen bei Sturm" in text
    assert "90 Tagen" in text


def test_hinweis_fuer_einen_einzelnen():
    titel, text = verwaist.hinweis([{"id": "a1", "alias": "Frostwarnung"}])
    assert "Ein Ablauf" in titel
    assert "«Frostwarnung»" in text


def test_hinweis_kuerzt_bei_vielen():
    """Eine Push ist kein Bericht - ab dem fünften Namen wird gezählt."""
    viele = [{"id": f"a{i}", "alias": f"Ablauf {i}"} for i in range(6)]
    _titel, text = verwaist.hinweis(viele)
    assert "und 2 weitere" in text
    assert "Ablauf 5" not in text


# ── Der Motor führt das Feuern nach ────────────────────────────────────────


MOTION = {
    "id": "motion_light",
    "alias": "Licht bei Bewegung",
    "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
    "action": [
        {"type": "command", "entity_id": "demo.light_livingroom", "command": "turn_on"}
    ],
}


async def _settle():
    for _ in range(10):
        await asyncio.sleep(0)


async def test_a_real_run_records_last_fired():
    from homepilot.core.config import ApiConfig, HubConfig
    from homepilot.core.hub import Hub

    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            automations=[MOTION],
        )
    )
    await hub.start()
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await _settle()
        row = verwaist.zeile(hub.data.get(verwaist.STORE_KEY), "motion_light")
        assert row is not None and row["fired"] > 0
    finally:
        await hub.stop()


async def test_a_manual_test_does_not_reset_the_clock():
    """Der Testen-Knopf würde sonst die Uhr eines toten Ablaufs
    zurückstellen, ohne dass er je von selbst gefeuert hätte."""
    from homepilot.core.config import ApiConfig, HubConfig
    from homepilot.core.hub import Hub

    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            automations=[MOTION],
        )
    )
    await hub.start()
    try:
        assert await hub.automations.trigger_now("motion_light")
        await _settle()
        assert verwaist.zeile(hub.data.get(verwaist.STORE_KEY), "motion_light") is None
    finally:
        await hub.stop()


# ── Die Liste der API trägt das Feld ───────────────────────────────────────


def test_the_list_reports_last_fired_and_orphaned():
    import time

    from fastapi.testclient import TestClient

    from homepilot.api import create_app
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(make_config(automations=[MOTION]))
    with TestClient(create_app(hub)) as client:
        eintrag = {
            entry["id"]: entry
            for entry in client.get("/api/automations").json()["automations"]
        }["motion_light"]
        # Abwärtskompatibel: die Felder sind da, aber ohne Geschichte
        # noch leer - und frisch gesehen ist niemand verwaist.
        assert eintrag["last_fired"] is None
        assert eintrag["orphaned"] is False

        # Mit einer alten Zeile kippt das Urteil - dieselbe 90-Tage-Regel,
        # die auch den Sammel-Hinweis speist.
        jetzt = time.time()
        hub.data.set(
            verwaist.STORE_KEY,
            [
                {
                    "automation_id": "motion_light",
                    "first_seen": jetzt - 200 * TAG,
                    "fired": jetzt - 120 * TAG,
                }
            ],
        )
        eintrag = {
            entry["id"]: entry
            for entry in client.get("/api/automations").json()["automations"]
        }["motion_light"]
        assert eintrag["orphaned"] is True
        assert eintrag["last_fired"] == jetzt - 120 * TAG
