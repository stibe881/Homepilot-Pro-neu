"""Die Storen-Wächter: Unwetter fährt hoch, Sommerhitze empfiehlt runter."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import storenwaechter
from homepilot.core.config import load_config
from homepilot.core.hub import Hub

# ── Unwetter erkennen (rein) ─────────────────────────────────────────────


def _alert(event: str, severity: str = "Severe") -> dict:
    return {"event": event, "severity": severity}


def test_hail_beats_storm_beats_thunder():
    state = {
        "alerts": [
            _alert("Gewitter"),
            _alert("Sturmböen"),
            _alert("Gewitter mit Hagel"),
        ]
    }
    lage = storenwaechter.unwetter(state)
    assert lage is not None and lage["grund"] == "Hagel"


def test_a_minor_warning_does_not_move_the_house():
    state = {"alerts": [_alert("Sturm", "Minor")]}
    assert storenwaechter.unwetter(state) is None
    assert storenwaechter.unwetter({"alerts": []}) is None
    assert storenwaechter.unwetter({}) is None


def test_thunderstorm_is_thunder_not_storm():
    # Dieselbe Lehre wie in meteoalarm.ist_wind(): «Thunderstorm»
    # enthält «storm», ist aber ein Gewitter.
    lage = storenwaechter.unwetter({"alerts": [_alert("Thunderstorm")]})
    assert lage is not None and lage["grund"] == "Gewitter"
    lage = storenwaechter.unwetter({"alerts": [_alert("Rain")]})
    assert lage is None


# ── Auswahl und Temperatur (rein) ────────────────────────────────────────


def _cover(entity_id: str) -> SimpleNamespace:
    return SimpleNamespace(id=entity_id, kind="cover", commands=["open"])


def test_empty_choice_means_every_cover():
    entities = [_cover("a.1"), _cover("a.2"), SimpleNamespace(id="l.1", kind="light")]
    assert len(storenwaechter.storen_auswahl(entities, [])) == 2
    gewaehlt = storenwaechter.storen_auswahl(entities, ["a.2", "gibtsnicht"])
    assert [e.id for e in gewaehlt] == ["a.2"]


def test_indoor_temperature_ignores_outdoor_and_broken_sensors():
    entities = [
        SimpleNamespace(id="t.1", kind="sensor", room="Stube", state={"state": 26.0, "unit": "°C"}),
        SimpleNamespace(id="t.2", kind="climate", room="Bad", state={"temperature": 24.0}),
        # Draussen zählt nicht - der Fühler auf der Terrasse sagt nichts
        # über die Stube.
        SimpleNamespace(id="t.3", kind="sensor", room="Terrasse", state={"state": 31.0, "unit": "°C"}),
        # Ohne Raum, ohne Einheit, unplausibel: alle drei fliegen raus.
        SimpleNamespace(id="t.4", kind="sensor", room=None, state={"state": 22.0, "unit": "°C"}),
        SimpleNamespace(id="t.5", kind="sensor", room="Küche", state={"state": 55, "unit": "%"}),
        SimpleNamespace(id="t.6", kind="sensor", room="Küche", state={"state": 180.0, "unit": "°C"}),
    ]
    assert storenwaechter.innentemperatur(entities) == 25.0
    assert storenwaechter.innentemperatur([]) is None


def test_the_heat_hint_needs_sun_daytime_and_a_warm_house():
    hitze = storenwaechter.hitze_tagsueber
    assert hitze(26.0, 25.0, 40.0, 14)
    assert not hitze(24.0, 25.0, 40.0, 14)  # noch angenehm
    assert not hitze(26.0, 25.0, 5.0, 14)  # Sonne zu tief
    assert not hitze(26.0, 25.0, 40.0, 19)  # zu spät, bringt nichts mehr
    assert not hitze(None, 25.0, 40.0, 14)


def test_the_evening_hint_waits_for_cooler_air_outside():
    lueften = storenwaechter.lueften_abends
    assert lueften(27.0, 22.0, 25.0, -3.0)
    assert not lueften(27.0, 26.0, 25.0, -3.0)  # draussen kaum kühler
    assert not lueften(27.0, 22.0, 25.0, 10.0)  # Sonne noch oben
    assert not lueften(23.0, 20.0, 25.0, -3.0)  # drinnen angenehm
    assert not lueften(27.0, None, 25.0, -3.0)


def test_guard_choice_survives_broken_storage():
    assert storenwaechter.guard_auswahl([{"storm": ["a.1"]}], "storm") == ["a.1"]
    assert storenwaechter.guard_auswahl([{"storm": "kaputt"}], "storm") == []
    assert storenwaechter.guard_auswahl([], "heat") == []
    assert storenwaechter.guard_auswahl(None, "heat") == []


# ── Der Wächter am lebenden Hub ──────────────────────────────────────────

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18190 }}
integrations:
  - integration: demo
users:
  - name: Stefan
    role: besitzer
    token: t-owner
  - name: Partnerin
    role: bewohner
    token: t-resident
data_file: {data_file}
"""


@pytest.fixture
def client(tmp_path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(CONFIG.format(data_file=tmp_path / "data.json"))
    hub = Hub(load_config(config_file))
    with TestClient(create_app(hub)) as test_client:
        test_client.hub = hub
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_the_chosen_covers_are_stored_and_validated(client):
    antwort = client.get("/api/coverguard", headers=auth("t-owner"))
    assert antwort.status_code == 200
    daten = antwort.json()
    assert daten["storm"] == [] and daten["heat"] == []
    covers = [eintrag["id"] for eintrag in daten["covers"]]
    assert covers, "die Demo-Integration hat Storen"

    antwort = client.put(
        "/api/coverguard", json={"storm": [covers[0]]}, headers=auth("t-owner")
    )
    assert antwort.status_code == 200
    assert antwort.json()["storm"] == [covers[0]]
    # Die andere Auswahl bleibt unangetastet.
    assert antwort.json()["heat"] == []

    antwort = client.put(
        "/api/coverguard", json={"heat": ["gibt.esnicht"]}, headers=auth("t-owner")
    )
    assert antwort.status_code == 404


async def test_a_storm_warning_raises_the_covers_once(client, monkeypatch):
    hub = client.hub
    # Die Morgen-Zusammenfassung stilllegen - um 07:xx würde sie sonst
    # in denselben Lauf funken (siehe test_watchdog.py).
    hub.data.set("notify_rules", [{"key": "morning", "enabled": False, "params": {}}])

    cover = next(e for e in hub.registry.all() if e.kind == "cover")
    warnung = SimpleNamespace(
        id="meteoalarm.switzerland",
        kind="alert",
        state={"alerts": [{"event": "Hagel", "severity": "Severe", "expires": "18:00"}]},
        room=None,
    )
    befehle: list[tuple[str, str]] = []

    async def merken(entity_id, command, data=None):
        befehle.append((entity_id, command))
        return hub.registry.get(entity_id)

    monkeypatch.setattr(hub.integrations, "dispatch_command", merken)
    gesendet: list[str] = []

    async def kein_push(title, body, category="outage", **kwargs):
        gesendet.append(f"{category}:{title}")

    monkeypatch.setattr(hub.watchdog, "_notify", kein_push)

    # Ohne die Warngeräte des Hubs: Der Wächter nimmt die *erste*
    # Warn-Entität, und die Demo-Integration bringt seit dem Lauftext der
    # Startseite eine eigene mit (integrations/demo.py). Sonst prüfte
    # dieser Test, was die Registry zufällig zuerst hergibt.
    ohne_warnungen = [e for e in hub.registry.all() if e.kind != "alert"]
    entities = [*ohne_warnungen, warnung]
    await hub.watchdog._check_storm_covers(entities)
    assert any(eintrag[0] == cover.id for eintrag in befehle)
    # Mit Zeichen am Anfang - auf dem Sperrbildschirm zwischen zwanzig
    # Zeilen erkennt man daran, dass etwas passiert ist.
    assert gesendet == ["storm_covers:⚠️ Hagelwarnung - Storen hochgefahren"]

    # Dieselbe Warnung fährt kein zweites Mal.
    befehle.clear()
    await hub.watchdog._check_storm_covers(entities)
    assert befehle == []

    # Und auch eine *neue* Warnung desselben Gewitters nicht: MeteoAlarm
    # stellt im Lauf eines Abends immer wieder welche mit neuem Ablauf
    # aus, und genau daran kam die Meldung alle paar Stunden wieder.
    warnung.state = {
        "alerts": [{"event": "Hagel", "severity": "Severe", "expires": "22:00"}]
    }
    await hub.watchdog._check_storm_covers([*ohne_warnungen, warnung])
    assert befehle == []
    assert len(gesendet) == 1

    # Vorbei heisst: Die Warnliste ist leer - das Gerät bleibt. (Fehlt
    # es ganz, etwa weil MeteoAlarm gerade nicht erreichbar ist, wird
    # nichts behauptet: Eine Entwarnung, die nur aus einem Ausfall
    # folgt, wäre eine falsche.)
    warnung.state = {"alerts": []}
    await hub.watchdog._check_storm_covers([*ohne_warnungen, warnung])
    assert gesendet[-1] == "storm_covers:✅ Hagel vorbei"
    await hub.watchdog._check_storm_covers([*ohne_warnungen, warnung])
    assert len(gesendet) == 2

    # Das nächste Unwetter fährt wieder.
    warnung.state = {
        "alerts": [{"event": "Sturm", "severity": "Severe", "expires": "23:00"}]
    }
    await hub.watchdog._check_storm_covers([*ohne_warnungen, warnung])
    assert befehle
    assert gesendet[-1] == "storm_covers:⚠️ Sturmwarnung - Storen hochgefahren"


def test_ein_gewitter_ist_ein_unwetter_und_nicht_jede_warnung():
    """Gemeldet: «Diese Meldung kommt immer wieder. Sie soll aber nur
    einmal kommen pro Gewitter.»

    Gemerkt wurde Grund *und Ablaufzeit* der Warnung - und MeteoAlarm
    stellt im Lauf eines Gewitterabends immer wieder neue Warnungen mit
    neuem Ablauf aus. Für den Wächter war jede davon ein neues
    Unwetter: Storen nochmals hoch, Nachricht nochmals raus."""
    from homepilot.core.storenwaechter import sturm_schritt

    # Erste Warnung: fahren, und merken, dass eines läuft.
    schritt, gemerkt = sturm_schritt({"grund": "Gewitter", "bis": "18:00"}, [], 1000.0)
    assert schritt == "fahren"
    assert gemerkt[0]["grund"] == "Gewitter"

    # Eine Stunde später dieselbe Lage, aber eine neue Warnung mit
    # anderem Ablauf - genau das, woran es lag.
    schritt, gemerkt = sturm_schritt(
        {"grund": "Gewitter", "bis": "22:00"}, gemerkt, 4600.0
    )
    assert schritt == "nichts"

    # Auch ein Wechsel des Grundes fährt nicht nochmals: Die Storen sind
    # längst oben.
    schritt, gemerkt = sturm_schritt({"grund": "Hagel", "bis": "22:00"}, gemerkt, 5000.0)
    assert schritt == "nichts"


def test_erst_wenn_keine_warnung_mehr_laeuft_gibt_es_die_entwarnung():
    from homepilot.core.storenwaechter import sturm_schritt

    _, gemerkt = sturm_schritt({"grund": "Gewitter", "bis": "18:00"}, [], 1000.0)
    schritt, gemerkt = sturm_schritt(None, gemerkt, 9000.0)
    assert schritt == "entwarnen"
    assert gemerkt == []
    # Und danach ist Ruhe - nicht bei jeder Runde eine zweite Entwarnung.
    schritt, gemerkt = sturm_schritt(None, gemerkt, 9060.0)
    assert schritt == "nichts"

    # Das nächste Unwetter fährt wieder.
    schritt, _ = sturm_schritt({"grund": "Sturm", "bis": "23:00"}, gemerkt, 20000.0)
    assert schritt == "fahren"


def test_der_merker_uebersteht_einen_neustart():
    """Er liegt in `hub.data` und nicht im Gedächtnis des Prozesses: Der
    Hub startet bei jedem Update neu, und ein Neustart mitten im
    Gewitter fuhr die Storen sonst ein zweites Mal hoch."""
    from homepilot.core.storenwaechter import sturm_schritt

    # So, wie es aus der Datendatei zurückkommt.
    gemerkt = [{"grund": "Gewitter", "seit": 1000.0}]
    schritt, _ = sturm_schritt({"grund": "Gewitter", "bis": "18:00"}, gemerkt, 5000.0)
    assert schritt == "nichts"
