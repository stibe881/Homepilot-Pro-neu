"""Wartungserinnerungen: Filter, Batterien, Entkalken."""

from datetime import date

from homepilot.core.maintenance import (
    QUITTUNGEN,
    clean_interval,
    describe,
    due_items,
    next_after,
    quittieren,
)


def test_the_clock_restarts_when_it_was_actually_done():
    """Wer den Filter drei Wochen zu spät wechselt, hat danach wieder ein
    volles halbes Jahr - bei Verschleiss zählt, wann es getan wurde, nicht
    wann es geplant war. Genau umgekehrt als bei den wiederkehrenden
    Aufgaben, wo der Montags-Abfall montags bleiben soll."""
    assert next_after("2026-08-20", 180) == "2027-02-16"
    assert next_after("2026-08-20", 30) == "2026-09-19"


def test_a_nonsense_interval_becomes_something_usable():
    """Ein Eintrag ohne brauchbares Intervall taucht sonst nie wieder auf -
    lieber eine Erinnerung zu viel."""
    assert clean_interval(0) == 90
    assert clean_interval(-5) == 90
    assert clean_interval("quatsch") == 90
    assert clean_interval(None) == 90
    # Und nach oben gedeckelt: alles über fünf Jahre ist ein Tippfehler.
    assert clean_interval(99999) == 1825
    assert clean_interval(180) == 180


def test_reminders_come_early_enough_to_act_on():
    """Ein Filter, den man erst am Stichtag bestellt, ist zu spät
    bestellt."""
    heute = date(2026, 8, 20)
    zeilen = [
        {"text": "Wasserfilter", "due": "2026-08-25"},   # in 5 Tagen
        {"text": "Kalkschutz", "due": "2026-08-18"},     # 2 Tage überfällig
        {"text": "Lüftung", "due": "2026-12-01"},        # weit weg
        {"text": "Ohne Frist"},
    ]
    faellig = due_items(zeilen, heute)
    # Überfälliges zuerst, Fernes gar nicht.
    assert [row["text"] for row in faellig] == ["Kalkschutz", "Wasserfilter"]
    assert faellig[0]["days_left"] == -2


def test_the_wording_says_how_dringend_it_is():
    assert "seit 2 Tagen fällig" in describe({"text": "Kalk", "days_left": -2})
    assert "heute fällig" in describe({"text": "Kalk", "days_left": 0})
    assert "in 5 Tagen" in describe({"text": "Kalk", "days_left": 5})


def test_wer_quittiert_steht_dabei():
    """«Erledigt» ohne Namen ist in einem Haushalt mit drei Leuten eine
    Behauptung: Danach weiss niemand, ob der Filter gewechselt wurde
    oder ob jemand nur die Meldung weggedrückt hat."""
    row = {"id": "w1", "text": "Wasserfilter", "interval_days": 180, "due": "2026-08-12"}
    neu = quittieren(row, "Bine", date(2026, 8, 27))
    assert neu["last_done"] == "2026-08-27"
    assert neu["last_by"] == "Bine"
    assert neu["log"] == [{"at": "2026-08-27", "by": "Bine"}]
    # Und die nächste Frist zählt ab heute, nicht ab der alten.
    assert neu["due"] == "2027-02-23"


def test_die_vorletzte_quittung_bleibt_stehen():
    """«Wann war das eigentlich zuletzt?» ist genau die Frage, die man
    beim nächsten Mal nicht beantworten kann."""
    row = {"text": "Kalkschutz", "interval_days": 90}
    row = quittieren(row, "Stefan", date(2026, 1, 5))
    row = quittieren(row, "Bine", date(2026, 4, 8))
    assert [eintrag["by"] for eintrag in row["log"]] == ["Bine", "Stefan"]


def test_die_quittungen_wachsen_nicht_ins_uferlose():
    row = {"text": "Filter", "interval_days": 30}
    for tag in range(1, QUITTUNGEN + 4):
        row = quittieren(row, "Stefan", date(2026, 1, tag))
    assert len(row["log"]) == QUITTUNGEN
    # Die jüngste zuoberst.
    assert row["log"][0]["at"] == f"2026-01-0{QUITTUNGEN + 3}"


async def test_eine_wartung_laesst_sich_ueberhaupt_eintragen():
    """Der Rumpf der Anfrage muss als Rumpf ankommen.

    Stand das Modell in register(), fand FastAPI es beim Auflösen der
    Annotation nicht (from __future__ import annotations) und hielt den
    Rumpf für einen Abfrageparameter: «Field required: query.body». Der
    Knopf «Wartung eintragen» tat damit nichts, und kein Test merkte es.
    """
    from fastapi.testclient import TestClient

    from homepilot.api import create_app
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
            integrations=[{"integration": "demo"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        kopf = {"Authorization": "Bearer t-owner"}
        antwort = client.post(
            "/api/maintenance",
            json={"text": "Wasserfilter wechseln", "interval_days": 180},
            headers=kopf,
        )
        assert antwort.status_code == 200, antwort.text
        kennung = antwort.json()["id"]

        quittung = client.post(f"/api/maintenance/{kennung}/done", headers=kopf)
        assert quittung.status_code == 200
        assert quittung.json()["last_by"] == "Stefan"
        assert quittung.json()["log"][0]["by"] == "Stefan"
