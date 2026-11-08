"""Konsolenzeit: der Wächter mit Uhr und Konsolen (die Regeln: test_konsolenzeit.py).

Die Uhr ist ein Argument von ``tick``: Dienstag, 10. November 2026, und
jeder Test sagt, wie spät es ist.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from homepilot.core import konsolenwache as kw
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.errors import HomePilotError

PS5 = "playstation.wohnzimmer"
SWITCH = "nintendo.switch"


def um(stunde: int, minute: int = 0, sekunde: int = 0) -> float:
    return datetime(2026, 11, 10, stunde, minute, sekunde).timestamp()


PLAN = {
    "aktiv": True,
    "konsolen": [PS5, SWITCH],
    "tage": [{"an": True, "von": 960, "bis": 1140, "minuten": 45}] * 7,
    "monat": 1200,
}


@pytest.fixture
async def wache(hub, monkeypatch):
    """Der Wächter des Hubs mit zwei Konsolen und aufgezeichneten Wirkungen."""
    hub.konsolenwache._sitzungen.clear()
    for kennung, integration, befehle in (
        (PS5, "playstation", ["turn_on", "turn_off"]),
        (SWITCH, "nintendo", []),
    ):
        await hub.registry.add(
            Entity(
                id=kennung, kind=EntityKind.MEDIA_PLAYER, name=kennung, integration=integration,
                state={"state": "on", "app": "FC 25"}, commands=befehle,
            )
        )
    hub.konsolenwache.plan_setzen("Maja", PLAN)
    wirkungen: dict[str, list] = {"aus": [], "ansagen": [], "pushes": []}

    async def dispatch(entity_id, command, data=None):
        if command == "turn_off":
            wirkungen["aus"].append(entity_id)
        return hub.registry.get(entity_id)

    async def ansage(konsole_id, text):
        wirkungen["ansagen"].append(text)

    async def melden(titel, text):
        wirkungen["pushes"].append((titel, text))

    monkeypatch.setattr(hub.integrations, "dispatch_command", dispatch)
    monkeypatch.setattr(hub.konsolenwache, "_ansage", ansage)
    monkeypatch.setattr(hub.konsolenwache, "_eltern_melden", melden)
    hub.konsolenwache.wirkungen = wirkungen
    return hub.konsolenwache


async def test_time_runs_only_after_the_child_signs_in(wache):
    await wache.tick(um(16, 0))
    await wache.tick(um(16, 5))
    assert wache.lage("Maja", um(16, 5))["heute"]["gesamt_s"] == 0
    wache.spielen("Maja", PS5, um(16, 5))
    await wache.tick(um(16, 5, 15))
    assert wache.lage("Maja", um(16, 5, 15))["heute"]["gesamt_s"] == 15


async def test_both_consoles_draw_from_one_account(wache):
    wache.spielen("Maja", SWITCH, um(16, 0))
    for sekunde in range(15, 15 * 60 + 1, 15):  # 15 min an der Switch
        await wache.tick(um(16, 0) + sekunde)
    wache.spielen("Maja", PS5, um(16, 15))
    for sekunde in range(15, 10 * 60 + 1, 15):  # 10 min an der PS5
        await wache.tick(um(16, 15) + sekunde)
    lage = wache.lage("Maja", um(16, 25))
    assert lage["heute"]["gesamt_s"] == 25 * 60
    assert lage["heute"]["konsolen"] == {SWITCH: 900, PS5: 600}
    assert lage["rest_s"] == 20 * 60


async def test_time_stops_when_the_console_is_off(wache, hub):
    wache.spielen("Maja", PS5, um(16, 0))
    await wache.tick(um(16, 0, 15))
    hub.registry.get(PS5).state["state"] = "off"
    await wache.tick(um(16, 0, 30))
    await wache.tick(um(16, 0, 45))
    assert wache.lage("Maja", um(16, 1))["heute"]["gesamt_s"] == 15


async def test_the_session_ends_when_the_console_stays_off(wache, hub):
    wache.spielen("Maja", PS5, um(16, 0))
    hub.registry.get(PS5).state["state"] = "off"
    await wache.tick(um(16, 0, 15))
    assert wache.lage("Maja", um(16, 1))["sitzung"] is not None
    await wache.tick(um(16, 3))
    assert wache.lage("Maja", um(16, 3))["sitzung"] is None


async def test_a_gap_after_a_restart_is_not_booked(wache):
    wache.spielen("Maja", PS5, um(16, 0))
    await wache.tick(um(16, 0, 15))
    await wache.tick(um(16, 20))  # der Hub war zwanzig Minuten weg
    assert wache.lage("Maja", um(16, 20))["heute"]["gesamt_s"] == 15


async def test_the_warnings_come_once_each_at_ten_five_and_one_minute(wache):
    wache.spielen("Maja", PS5, um(16, 2))
    # Vorab 34,5 min gebucht, 10,5 übrig - die Zehn-Minuten-Marke liegt noch voraus.
    wache._zeile("Maja", datetime(2026, 11, 10).date())["gesamt"] = 34.5 * 60
    jetzt = um(16, 30)
    wache._sitzungen["maja"]["zuletzt"] = jetzt
    for sekunde in range(15, 10 * 60 + 30, 15):
        await wache.tick(jetzt + sekunde)
    texte = wache.wirkungen["ansagen"]
    assert [t for t in texte if "noch" in t] == [
        "Maja, noch 10 Minuten – speichere dein Spiel.",
        "Maja, noch 5 Minuten – speichere dein Spiel.",
        "Maja, noch eine Minute – speichere jetzt dein Spiel.",
    ]


async def test_when_time_is_up_the_console_sleeps_and_the_parents_hear_it(wache):
    wache.spielen("Maja", PS5, um(16, 0))
    wache._zeile("Maja", datetime(2026, 11, 10).date())["gesamt"] = 44 * 60 + 30
    wache._sitzungen["maja"]["zuletzt"] = um(16, 40)
    await wache.tick(um(16, 40, 15))
    assert wache.wirkungen["aus"] == []
    await wache.tick(um(16, 40, 30))
    assert wache.wirkungen["aus"] == [PS5]
    titel, text = wache.wirkungen["pushes"][0]
    assert titel == "Maja: Konsolenzeit aufgebraucht"
    assert "Die Konsole ruht." in text
    assert wache.lage("Maja", um(16, 41))["sitzung"] is None
    assert any("deine Konsolenzeit für heute ist um" in t for t in wache.wirkungen["ansagen"])


async def test_with_switching_off_disabled_it_only_reports(wache):
    wache.plan_setzen("Maja", {**PLAN, "abschalten": False})
    wache.spielen("Maja", PS5, um(16, 0))
    wache._zeile("Maja", datetime(2026, 11, 10).date())["gesamt"] = 45 * 60 - 5
    wache._sitzungen["maja"]["zuletzt"] = um(16, 40)
    await wache.tick(um(16, 40, 15))
    assert wache.wirkungen["aus"] == []
    assert len(wache.wirkungen["pushes"]) == 1


async def test_a_console_that_will_not_switch_off_is_said_so(wache, hub, monkeypatch):
    async def kaputt(entity_id, command, data=None):
        raise RuntimeError("Remote Play getrennt")

    monkeypatch.setattr(hub.integrations, "dispatch_command", kaputt)
    wache.spielen("Maja", PS5, um(16, 0))
    wache._zeile("Maja", datetime(2026, 11, 10).date())["gesamt"] = 45 * 60 - 5
    wache._sitzungen["maja"]["zuletzt"] = um(16, 40)
    await wache.tick(um(16, 40, 15))
    assert "liess sich nicht ausschalten" in wache.wirkungen["pushes"][0][1]


async def test_a_console_without_a_switch_off_command_is_reported_honestly(wache):
    """Die Switch kann der Hub nicht selbst schlafen legen."""
    wache.spielen("Maja", SWITCH, um(16, 0))
    wache._zeile("Maja", datetime(2026, 11, 10).date())["gesamt"] = 45 * 60 - 5
    wache._sitzungen["maja"]["zuletzt"] = um(16, 40)
    await wache.tick(um(16, 40, 15))
    assert wache.wirkungen["aus"] == []
    assert "liess sich nicht ausschalten" in wache.wirkungen["pushes"][0][1]


async def test_a_child_without_time_cannot_sign_in(wache):
    with pytest.raises(HomePilotError, match="Maja"):
        wache.spielen("Maja", PS5, um(15, 40))  # Fenster noch zu


async def test_a_child_cannot_play_on_a_console_outside_the_plan(wache):
    wache.plan_setzen("Maja", {**PLAN, "konsolen": [PS5]})
    with pytest.raises(HomePilotError, match="nicht spielen"):
        wache.spielen("Maja", SWITCH, um(16, 0))


async def test_a_sibling_signing_in_takes_over_the_console(wache):
    wache.plan_setzen("Noah", PLAN)
    wache.spielen("Maja", PS5, um(16, 0))
    wache.spielen("Noah", PS5, um(16, 10))
    assert wache.lage("Maja", um(16, 10))["sitzung"] is None
    assert wache.lage("Noah", um(16, 10))["sitzung"]["konsole"] == PS5


async def test_grown_ups_playing_are_not_counted_and_not_asked_about(wache, hub):
    hub.registry.get(SWITCH).state["state"] = "off"  # nur die PS5 läuft
    wache.eltern_spielen(PS5, um(21, 0))
    for sekunde in range(15, 600, 15):
        await wache.tick(um(21, 0) + sekunde)
    assert wache.wirkungen["pushes"] == []
    assert wache.wirkungen["aus"] == []
    assert wache.lage("Maja", um(21, 10))["heute"]["gesamt_s"] == 0


async def test_a_running_console_nobody_signed_in_to_makes_the_parents_ask_once(wache):
    await wache.tick(um(17, 0))
    await wache.tick(um(17, 1))
    assert wache.wirkungen["pushes"] == []  # noch in der Gnadenfrist
    await wache.tick(um(17, 2, 30))
    await wache.tick(um(17, 5))
    fragen = [p for p in wache.wirkungen["pushes"] if "wer spielt" in p[0]]
    assert len(fragen) == 2  # PS5 und Switch laufen, je einmal
    assert wache.wirkungen["aus"] == []


async def test_asking_is_replaced_by_switching_off_when_the_parents_chose_so(wache):
    wache.einstellungen_setzen("sperren")
    await wache.tick(um(17, 0))
    await wache.tick(um(17, 3))
    assert PS5 in wache.wirkungen["aus"]
    assert any("ausgeschaltet" in p[1] or "liess sich nicht" in p[1] for p in wache.wirkungen["pushes"])


async def test_a_console_that_goes_off_is_forgotten(wache, hub):
    await wache.tick(um(17, 0))
    hub.registry.get(PS5).state["state"] = "off"
    hub.registry.get(SWITCH).state["state"] = "off"
    await wache.tick(um(17, 1))
    assert wache._unbekannt == {}


async def test_given_minutes_and_a_day_off_are_remembered_for_today_only(wache):
    wache.geben("Maja", 15, um(16, 0))
    assert wache.lage("Maja", um(16, 0))["heute"]["bonus"] == 15
    assert wache.lage("Maja", um(16, 0) + 86400)["heute"]["bonus"] == 0


async def test_a_manual_lock_stays_until_it_is_lifted(wache):
    wache.sperre_setzen("Maja", True)
    assert wache.lage("Maja", um(16, 0))["gesperrt"] is True
    with pytest.raises(HomePilotError):
        wache.spielen("Maja", PS5, um(16, 0))
    assert wache.lage("Maja", um(16, 0) + 3 * 86400)["gesperrt"] is True
    wache.sperre_setzen("Maja", False)
    wache.spielen("Maja", PS5, um(16, 0))


async def test_the_month_adds_up_the_days_before(wache):
    for tag, sekunden in (("2026-11-02", 3600), ("2026-11-09", 1800), ("2026-10-30", 9999)):
        wache._tage[("maja", tag)] = {
            "kind": "Maja", "tag": tag, "gesamt": sekunden, "konsolen": {}, "bonus": 0,
            "frei": False, "verlauf": [],
        }
    lage = wache.lage("Maja", um(16, 0))
    assert lage["monat"]["gespielt_s"] == 5400
    assert [t["tag"] for t in lage["tage"]] == ["2026-11-09", "2026-11-02", "2026-10-30"]


async def test_looking_at_a_child_does_not_write_empty_days(wache):
    vorher = len(wache._tage)
    wache.lage("Maja", um(16, 0))
    wache.uebersicht(um(16, 0))
    assert len(wache._tage) == vorher


async def test_sessions_and_days_survive_a_restart(wache, hub):
    wache.spielen("Maja", PS5, um(16, 0))
    await wache.tick(um(16, 0, 15))
    wache._tage_sichern()
    neu = kw.Konsolenwache(hub)
    neu.restore()
    assert neu._sitzungen["maja"]["konsole"] == PS5
    assert neu.lage("Maja", um(16, 1))["heute"]["gesamt_s"] == 15


async def test_the_plan_is_kept_per_child_and_read_back_cleaned(wache):
    wache.plan_setzen("Noah", {"aktiv": True, "konsolen": [PS5], "monat": 600})
    uebersicht = wache.uebersicht(um(16, 0))
    assert sorted(k["kind"] for k in uebersicht["kinder"]) == ["Maja", "Noah"]
    assert wache.plan("Noah")["monat"] == 600
    assert len(wache.plan("Noah")["tage"]) == 7
    assert {k["id"] for k in uebersicht["konsolen"]} >= {PS5, SWITCH}
