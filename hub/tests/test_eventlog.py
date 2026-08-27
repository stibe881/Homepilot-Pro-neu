"""Ereignisprotokoll je Gerät: Schaltvorgänge samt Quelle, Sensoren nicht."""

import time

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.eventlog import EventLog, worth_recording
from homepilot.core.hub import Hub

from .conftest import make_config


def test_worth_recording_filters_noise():
    # Ein echter Schaltvorgang zählt …
    assert worth_recording("light", {"state": "off"}, {"state": "on"}) is True
    # … Attribut-Zappelei beim ohnehin brennenden Licht nicht …
    assert (
        worth_recording(
            "light", {"state": "on", "brightness": 40}, {"state": "on", "brightness": 80}
        )
        is False
    )
    # … und Messwerte fluten das Protokoll nicht.
    assert worth_recording("sensor", {"state": 21.0}, {"state": 21.5}) is False


def test_for_entity_returns_newest_first():
    log = EventLog()
    for state in ("on", "off", "on"):
        log.record(
            "state_changed",
            {
                "entity_id": "hue.lampe",
                "entity": {"kind": "light"},
                "old_state": {"state": "x"},
                "new_state": {"state": state},
                "source": {"kind": "user", "label": "Stefan"},
            },
        )
    events = log.for_entity("hue.lampe")
    assert [event["state"] for event in events] == ["on", "off", "on"][::-1]
    assert events[0]["source"]["label"] == "Stefan"
    assert log.for_entity("andere.lampe") == []


def test_events_over_the_api():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        # Schalten erzeugt einen Eintrag mit Quelle.
        client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on"},
        )
        events = client.get("/api/entities/demo.light_livingroom/log").json()["events"]
        assert events and events[0]["state"] == "on"
        # Unbekanntes Gerät bleibt ein sauberes 404.
        assert client.get("/api/entities/nope.nope/log").status_code == 404


def test_span_says_the_log_is_young_and_not_full():
    """Ein frisches Protokoll: Anfang bekannt, Puffer nicht übergelaufen."""
    log = EventLog()
    leer = log.span()
    assert leer["count"] == 0
    assert leer["oldest"] is None
    assert leer["full"] is False
    assert leer["started"] > 0

    log.record(
        "state_changed",
        {
            "entity_id": "hue.lampe",
            "entity": {"kind": "light"},
            "old_state": {"state": "off"},
            "new_state": {"state": "on"},
            "source": {"kind": "user", "label": "Stefan"},
        },
    )
    voll = log.span()
    assert voll["count"] == 1
    # Der älteste Eintrag kann nicht vor dem Start des Protokolls liegen.
    assert voll["oldest"] >= leer["started"]


def test_span_reaches_the_api():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        client.post(
            "/api/entities/demo.light_livingroom/command",
            json={"command": "turn_on"},
        )
        body = client.get("/api/entities/demo.light_livingroom/log").json()
        assert body["log"]["count"] >= 1
        assert body["log"]["limit"] == 2000


# ── Der Verlauf überlebt den Neustart ────────────────────────────────────
#
# Hier stand einmal, das Protokoll sei bewusst flüchtig. Das war der
# falsche Handel: Nach jedem Update war der Verlauf leer - also genau
# dann, wenn man ihn braucht, weil sich etwas geändert hat.


def _schalten(log, entity_id="light.kueche", state="on"):
    log.record(
        "state_changed",
        {
            "entity_id": entity_id,
            "entity": {"kind": "light", "name": "Küche"},
            "old_state": {"state": "off" if state == "on" else "on"},
            "new_state": {"state": state},
            "source": {"kind": "user", "label": "Stefan"},
        },
    )


def test_verlauf_wird_gesichert_und_geladen(tmp_path):
    pfad = tmp_path / "geraete-verlauf.json"
    log = EventLog(pfad)
    _schalten(log, state="on")
    _schalten(log, state="off")
    log.save(force=True)
    assert pfad.is_file()

    # Der Neustart.
    zweiter = EventLog(pfad)
    zeilen = zweiter.for_entity("light.kueche")
    assert [zeile["state"] for zeile in zeilen] == ["off", "on"]
    # Und die Quelle steht noch dabei - sonst wäre «warum ging das an?»
    # nach dem Neustart wieder unbeantwortbar.
    assert zeilen[0]["source"]["label"] == "Stefan"


def test_der_anfang_bleibt_der_erste_start(tmp_path):
    """Sonst behauptete die App nach jedem Neustart, alles Ältere sei nie
    passiert - «nichts aufgezeichnet» statt «nichts passiert»."""
    pfad = tmp_path / "verlauf.json"
    erster = EventLog(pfad)
    _schalten(erster)
    erster.save(force=True)

    zweiter = EventLog(pfad)
    assert zweiter.started == erster.started


def test_gesichert_wird_gedrosselt(tmp_path):
    pfad = tmp_path / "verlauf.json"
    log = EventLog(pfad)
    _schalten(log)
    log.save(force=True)
    erste_groesse = pfad.stat().st_size

    # Gleich danach noch ein Ereignis - ohne force wird nicht geschrieben.
    _schalten(log, state="off")
    log.save()
    assert pfad.stat().st_size == erste_groesse
    # Mit force schon.
    log.save(force=True)
    assert pfad.stat().st_size != erste_groesse


def test_ohne_aenderung_wird_nicht_geschrieben(tmp_path):
    pfad = tmp_path / "verlauf.json"
    log = EventLog(pfad)
    log.save(force=True)
    # Nichts passiert, nichts zu sichern - kein leeres Dateigerippe.
    assert not pfad.exists()


def test_ein_kaputter_stand_haelt_den_hub_nicht_auf(tmp_path):
    pfad = tmp_path / "verlauf.json"
    pfad.write_text("{kein json", encoding="utf-8")
    log = EventLog(pfad)
    assert log.all() == []
    # Und er lässt sich danach normal weiterbenutzen.
    _schalten(log)
    log.save(force=True)
    assert EventLog(pfad).all()


def test_ohne_pfad_bleibt_alles_wie_frueher():
    log = EventLog()
    _schalten(log)
    log.save(force=True)
    assert len(log.all()) == 1


# ── Was den Eintrag erklärt ──────────────────────────────────────────────


def test_eine_fahrende_store_kommt_ins_protokoll():
    """«Halb runter» ist ein Handgriff wie jeder andere - nur meldet das
    Gerät ihn nicht als Zustandswechsel."""
    assert (
        worth_recording(
            "cover", {"state": "open", "position": 100}, {"state": "open", "position": 40}
        )
        is True
    )


def test_eine_zwischenstellung_nicht():
    # Die Overkiz-Abfrage sieht während einer Fahrt ein halbes Dutzend
    # davon - jede wäre eine Zeile für nichts.
    assert (
        worth_recording(
            "cover", {"state": "open", "position": 100}, {"state": "open", "position": 90}
        )
        is False
    )
    # Und ohne Positionsangabe bleibt es beim Zustandsvergleich.
    assert (
        worth_recording("cover", {"state": "open"}, {"state": "open", "position": 40})
        is False
    )


def test_die_positionsausnahme_gilt_nur_fuer_storen():
    # Eine Lampe, die heller wird, bleibt Attribut-Zappelei.
    assert (
        worth_recording(
            "light", {"state": "on", "position": 100}, {"state": "on", "position": 0}
        )
        is False
    )


def test_detail_erklaert_den_eintrag():
    from homepilot.core.eventlog import detail_text

    assert detail_text("cover", {"state": "open", "position": 40}) == "auf 40 %"
    assert detail_text("media_player", {"state": "playing", "track": "Shivers"}) == "Shivers"
    assert detail_text("climate", {"state": "heat", "target_temperature": 21.5}) == "Ziel 21.5 °C"
    assert detail_text("light", {"state": "on", "brightness": 60}) == "60 %"
    # Eine ausgeschaltete Lampe hat keine Helligkeit, die etwas erklärt.
    assert detail_text("light", {"state": "off", "brightness": 60}) is None
    # Und Unsinn ergibt kein Detail statt einer Ausnahme.
    assert detail_text("cover", {"position": "weit offen"}) is None
    assert detail_text("switch", {"state": "on"}) is None


def test_detail_landet_im_eintrag():
    log = EventLog()
    log.record(
        "state_changed",
        {
            "entity_id": "cover.wohnzimmer",
            "entity": {"kind": "cover"},
            "old_state": {"state": "closed", "position": 0},
            "new_state": {"state": "open", "position": 40},
            "source": {},
        },
    )
    assert log.for_entity("cover.wohnzimmer")[0]["detail"] == "auf 40 %"


# ── Seit wann steht die Türe offen? ──────────────────────────────────────
#
# Der Wächter zählte selbst - und begann in der Runde, in der er den
# Kontakt zum ersten Mal offen sah. Ging eine Türe zwischen zwei Runden
# auf, zu und wieder auf, lief die Uhr von der ersten Öffnung weiter, und
# die «seit einer Stunde offen»-Nachricht kam lange vor der Stunde.


def _kontakt(log, state, at=None):
    log.record(
        "state_changed",
        {
            "entity_id": "matter.kontakt",
            "entity": {"kind": "binary_sensor"},
            "old_state": {"state": "off" if state == "on" else "on"},
            "new_state": {"state": state, "device_class": "contact"},
            "source": {},
        },
    )
    if at is not None:
        log.all()[-1]["at"] = at


def test_offen_seit_nimmt_die_juengste_oeffnung():
    log = EventLog()
    _kontakt(log, "on", at=1000)
    _kontakt(log, "off", at=2000)
    _kontakt(log, "on", at=3000)
    # Zwischendurch war zu - gezählt wird ab der zweiten Öffnung.
    assert log.offen_seit("matter.kontakt", "binary_sensor") == 3000


def test_offen_seit_ohne_protokoll():
    """None heisst «weiss ich nicht» - der Wächter bleibt dann bei seiner
    eigenen Zählung, statt eine Zeit zu erfinden."""
    log = EventLog()
    assert log.offen_seit("gibt.es.nicht", "binary_sensor") is None
    _kontakt(log, "off", at=1000)
    assert log.offen_seit("matter.kontakt", "binary_sensor") is None


def test_die_tuere_eines_schlosses_zaehlt_getrennt_vom_riegel():
    """Abgeschlossen und offen ist bei einer Haustüre mit Falle kein
    Widerspruch - der Riegel sagt nichts darüber, ob sie offen steht."""
    from homepilot.core.eventlog import ist_offen

    assert ist_offen("lock", {"state": "locked", "door": "open"}) is True
    assert ist_offen("lock", {"state": "unlocked", "door": "closed"}) is False
    # Bei einem Kontakt zählt weiterhin der Zustand selbst.
    assert ist_offen("binary_sensor", {"state": "on"}) is True


def test_ein_tuersensor_kommt_ins_protokoll():
    log = EventLog()
    log.record(
        "state_changed",
        {
            "entity_id": "nuki.haustuere",
            "entity": {"kind": "lock"},
            # Der Riegel bleibt, wo er ist - nur die Türe geht auf.
            "old_state": {"state": "unlocked", "door": "closed"},
            "new_state": {"state": "unlocked", "door": "open"},
            "source": {},
        },
    )
    eintraege = log.for_entity("nuki.haustuere")
    assert len(eintraege) == 1
    assert eintraege[0]["door"] == "open"
    assert log.offen_seit("nuki.haustuere", "lock") == eintraege[0]["at"]


# ── Der Rückblick fürs ganze Haus ────────────────────────────────────────


def test_rueckblick_nimmt_nur_das_fenster():
    """«Was war heute Nacht los?» ist eine andere Frage als «warum ging
    das an?» - und war nur zu beantworten, indem man jede Kachel einzeln
    aufmachte."""
    log = EventLog()
    jetzt = time.time()
    log._events.extend(
        [
            {"entity_id": "a", "state": "on", "at": jetzt - 100000},
            {"entity_id": "b", "state": "on", "at": jetzt - 3600},
            {"entity_id": "c", "state": "off", "at": jetzt - 60},
        ]
    )
    zeilen = log.rueckblick(stunden=24)
    # Jüngste zuerst, und das Uralte fällt weg.
    assert [z["entity_id"] for z in zeilen] == ["c", "b"]


def test_rueckblick_haelt_sich_an_die_grenze():
    log = EventLog()
    jetzt = time.time()
    for nummer in range(20):
        log._events.append({"entity_id": f"g{nummer}", "state": "on", "at": jetzt - nummer})
    assert len(log.rueckblick(limit=5)) == 5


def test_rueckblick_zeigt_nur_was_jemand_sehen_darf():
    log = EventLog()
    jetzt = time.time()
    log._events.extend(
        [
            {"entity_id": "sichtbar", "state": "on", "at": jetzt - 10},
            {"entity_id": "geheim", "state": "on", "at": jetzt - 20},
        ]
    )
    zeilen = log.rueckblick(sichtbar=lambda kennung: kennung != "geheim")
    assert [z["entity_id"] for z in zeilen] == ["sichtbar"]
