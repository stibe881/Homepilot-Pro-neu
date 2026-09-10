"""Zonen, PIN je Person, Zwangs-PIN, Sensor-Testlauf, Fehlalarm-Statistik.

Punkte 398-400, 403 und 407 der Werkbank. Die reinen Regeln stehen in
alarm_rules.py und core/alarmbericht.py; hier zusätzlich, dass sie in
der Integration wirklich greifen.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import alarmbericht
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.errors import HomePilotError
from homepilot.core.hub import Hub
from homepilot.integrations.alarm import DISARMED
from homepilot.integrations.alarm_rules import (
    guards,
    hash_pin,
    parse_sensors,
    pin_row,
    pin_users,
    sensortest_bestaetigen,
    sensortest_start,
    valid_duress_pin,
    zonen,
)

from .conftest import make_config

# ── Reine Funktionen ─────────────────────────────────────────────────────


def test_guards_mit_zone_lehnt_andere_zonen_ab():
    sensors = parse_sensors(
        [
            {"entity_id": "a", "modes": ["ausser_haus"], "zone": "Garage"},
            {"entity_id": "b", "modes": ["ausser_haus"], "zone": "Keller"},
            {"entity_id": "c", "modes": ["ausser_haus"]},  # keine Zone
        ]
    )
    assert guards(sensors, "a", "ausser_haus", "Garage") is True
    assert guards(sensors, "a", "ausser_haus", "Keller") is False
    # Ohne Zonen-Angabe gilt das ganze Haus, wie bisher.
    assert guards(sensors, "a", "ausser_haus") is True
    assert guards(sensors, "b", "ausser_haus") is True
    # Ein Sensor ohne Zone wacht bei einer Zonen-Scharfschaltung nicht mit.
    assert guards(sensors, "c", "ausser_haus", "Garage") is False


def test_zonen_listet_sortiert_und_ohne_doppelte():
    sensors = parse_sensors(
        [
            {"entity_id": "a", "zone": "Garage"},
            {"entity_id": "b", "zone": "Keller"},
            {"entity_id": "c", "zone": "Garage"},
            {"entity_id": "d", "zone": ""},
        ]
    )
    assert zonen(sensors) == ["Garage", "Keller"]


def test_pin_row_und_pin_users():
    rows = [
        {"user": "Stefan", "hash": "x"},
        {"user": "Livia", "hash": ""},  # entfernt, zählt nicht
        {"user": "Sandra"},  # nie gesetzt
    ]
    assert pin_row(rows, "Stefan") == rows[0]
    assert pin_row(rows, "Unbekannt") is None
    assert pin_users(rows) == ["Stefan"]


def test_valid_duress_pin_nur_mit_eigenem_feldpaar():
    entry = {"salt": "s", "hash": hash_pin("1234", "s")}
    assert valid_duress_pin(entry, "1234") is False  # das ist die normale PIN
    mit_zwang = {**entry, "duress_salt": "z", "duress_hash": hash_pin("9999", "z")}
    assert valid_duress_pin(mit_zwang, "9999") is True
    assert valid_duress_pin(mit_zwang, "1234") is False


def test_sensortest_start_nur_wachende_unueberbrueckte():
    sensors = parse_sensors(
        [
            {"entity_id": "a", "modes": ["nacht"]},
            {"entity_id": "b", "modes": ["ausser_haus"]},  # anderer Modus
            {"entity_id": "c", "modes": ["nacht"], "bypass": True},  # überbrückt
        ]
    )
    test = sensortest_start(sensors, "nacht", 100.0)
    assert test == {"mode": "nacht", "pending": ["a"], "confirmed": [], "started_at": 100.0}


def test_sensortest_bestaetigen_verschiebt_und_ist_idempotent():
    test = {"mode": "nacht", "pending": ["a", "b"], "confirmed": [], "started_at": 0.0}
    neu = sensortest_bestaetigen(test, "a")
    assert neu["pending"] == ["b"] and neu["confirmed"] == ["a"]
    # Ein zweites Mal bestätigen ändert nichts mehr.
    gleich = sensortest_bestaetigen(neu, "a")
    assert gleich == neu


def test_fehlalarm_kandidaten_zaehlt_nur_schnelle_ohne_eskalation():
    def zeile(kind, at, entity_id=None):
        row = {"kind": kind, "at": at, "text": "", "by": ""}
        if entity_id:
            row["entity_id"] = entity_id
        return row

    # Jüngste zuerst, wie im echten Verlauf (_note verwendet insert(0, ...)).
    history = list(
        reversed(
            [
                zeile("triggered", 0, "a"),
                zeile("disarmed", 30),  # 30s, schnell -> zählt
                zeile("triggered", 100, "a"),
                zeile("escalated", 130),
                zeile("disarmed", 140),  # eskaliert -> zählt nicht
                zeile("triggered", 200, "a"),
                zeile("disarmed", 210),  # wieder schnell -> zählt
                zeile("triggered", 300, "b"),
                zeile("disarmed", 305),  # nur einmal -> unter der Schwelle
            ]
        )
    )
    kandidaten = alarmbericht.fehlalarm_kandidaten(history, schwelle=60.0, mindest=2)
    assert kandidaten == [{"entity_id": "a", "anzahl": 2}]
    # Mit mindest=3 verschwindet auch «a».
    assert alarmbericht.fehlalarm_kandidaten(history, schwelle=60.0, mindest=3) == []


# ── Die Integration ───────────────────────────────────────────────────────

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-stefan"}
LIVIA = {"name": "Livia", "role": "bewohner", "token": "t-livia"}


def contact(entity_id: str) -> Entity:
    entity = Entity(
        id=entity_id,
        kind=EntityKind.BINARY_SENSOR,
        name=entity_id,
        integration="test",
        state={"state": "off", "device_class": "contact"},
    )
    entity.available = True
    return entity


def _client(hub: Hub) -> TestClient:
    return TestClient(create_app(hub))


def _hub(tmp_path) -> Hub:
    return Hub(
        make_config(
            token="geheim",
            users=[OWNER, LIVIA],
            integrations=[{"integration": "demo"}, {"integration": "alarm"}],
            data_file=str(tmp_path / "daten.json"),
        )
    )


async def _mit_zwei_zonen(hub: Hub):
    await hub.registry.add(contact("test.garage"))
    await hub.registry.add(contact("test.keller"))
    service = hub.integrations.get("alarm")
    await service.update_config(
        {
            "sensors": [
                {"entity_id": "test.garage", "modes": ["ausser_haus"], "zone": "Garage"},
                {"entity_id": "test.keller", "modes": ["ausser_haus"], "zone": "Keller"},
            ],
            "settings": {"exit_delay": 0},
        }
    )
    return service


def test_scharf_nur_fuer_eine_zone_laesst_die_andere_unbewacht(tmp_path):
    async def run():
        hub = _hub(tmp_path)
        await hub.start()
        try:
            service = await _mit_zwei_zonen(hub)
            ergebnis = await service.arm("ausser_haus", zone="Garage")
            assert ergebnis["ok"] is True
            assert service.guarding("ausser_haus", "Garage")[0].id == "test.garage"
            # Der Kellersensor gehört nicht zur Garage-Zone und wacht nicht mit.
            assert service.open_sensors("ausser_haus", "Garage") == []
            zustand = service._entity.as_dict()["state"]
            assert zustand["zone"] == "Garage"
        finally:
            await hub.stop()

    asyncio.run(run())


def test_die_route_kennt_die_vergebenen_zonen(tmp_path):
    # hub.start() läuft über die Lifespan des TestClient - ein zweiter,
    # eigener Aufruf davor würde hub.data neu laden und die hier gesetzte
    # Zuordnung wieder verlieren. Deshalb erst hinein, dann einrichten.
    hub = _hub(tmp_path)
    with _client(hub) as client:
        asyncio.run(_mit_zwei_zonen(hub))
        antwort = client.get("/api/alarm", headers={"Authorization": "Bearer t-stefan"})
        assert antwort.json()["zones"] == ["Garage", "Keller"]


def test_eigene_und_fremde_pin_ueber_die_route(tmp_path):
    hub = _hub(tmp_path)
    with _client(hub) as client:
        stefan = {"Authorization": "Bearer t-stefan"}
        livia = {"Authorization": "Bearer t-livia"}
        # Livia setzt ihre eigene - braucht nur CONTROL.
        assert client.put("/api/alarm/pin", json={"pin": "1111"}, headers=livia).status_code == 200
        # Livia darf Stefans PIN nicht setzen.
        assert (
            client.put(
                "/api/alarm/pin", json={"pin": "2222", "user": "Stefan"}, headers=livia
            ).status_code
            == 403
        )
        # Stefan (Besitzer) darf.
        assert (
            client.put(
                "/api/alarm/pin", json={"pin": "2222", "user": "Livia"}, headers=stefan
            ).status_code
            == 200
        )
        zustand = client.get("/api/alarm", headers=stefan).json()["state"]
        assert zustand["pin_users"] == ["Livia"]


def test_zwangs_pin_braucht_die_eigene_zuerst(tmp_path):
    hub = _hub(tmp_path)
    with _client(hub) as client:
        stefan = {"Authorization": "Bearer t-stefan"}
        # Ohne eigene PIN geht die Zwangs-PIN nicht.
        antwort = client.put("/api/alarm/pin/zwang", json={"pin": "9999"}, headers=stefan)
        assert antwort.status_code == 400
        client.put("/api/alarm/pin", json={"pin": "1234"}, headers=stefan)
        # Gleich wie die eigene: abgelehnt.
        assert (
            client.put("/api/alarm/pin/zwang", json={"pin": "1234"}, headers=stefan).status_code
            == 400
        )
        assert (
            client.put("/api/alarm/pin/zwang", json={"pin": "9999"}, headers=stefan).status_code
            == 200
        )


def test_die_zwangs_pin_entschaerft_und_meldet_es_nur_den_anderen(tmp_path):
    """Nach aussen ein gewöhnliches Entschärfen - die Meldung geht nur an
    die anderen, nicht an die Person, deren PIN benutzt wurde."""

    async def run():
        hub = _hub(tmp_path)
        await hub.start()
        try:
            service = hub.integrations.get("alarm")
            await service.set_pin("Stefan", "1234")
            await service.set_duress_pin("Stefan", "9999")
            hub.push.register("tok-stefan", "Stefan")
            hub.push.register("tok-livia", "Livia")
            gesendet: list[tuple[list[str], str]] = []

            async def fake_send(tokens, title, body, data=None, **_):
                gesendet.append((tokens, title))
                return len(tokens)

            hub.push.send = fake_send  # type: ignore[assignment]

            await service.arm("ausser_haus", force=True)
            ergebnis = await service.disarm(pin="9999")
            assert ergebnis["ok"] is True
            assert service._state == DISARMED
            # Genau eine zusätzliche Meldung, nur an Livias Gerät.
            zwang = [g for g in gesendet if "Zwangs-PIN" in g[1]]
            assert len(zwang) == 1
            assert zwang[0][0] == ["tok-livia"]
        finally:
            await hub.stop()

    asyncio.run(run())


def test_sensortest_route_hakt_geoeffnete_sensoren_ab(tmp_path):
    async def einrichten(hub):
        await hub.registry.add(contact("test.fenster"))
        await hub.integrations.get("alarm").update_config(
            {"sensors": [{"entity_id": "test.fenster", "modes": ["nacht"]}]}
        )

    # TestClient(create_app(hub)) startet den Hub selbst über die
    # Lifespan (siehe api/server.py) - ein eigener hub.start() davor
    # würde hub.data ein zweites Mal laden und die hier von Hand
    # hinzugefügte Entität wieder verwerfen. Deshalb erst hinein, dann
    # einrichten - wie bei den Zonen-Routentests oben.
    hub = _hub(tmp_path)
    with _client(hub) as client:
        asyncio.run(einrichten(hub))
        stefan = {"Authorization": "Bearer t-stefan"}
        start = client.post(
            "/api/alarm/sensortest/start", json={"mode": "nacht"}, headers=stefan
        )
        assert start.status_code == 200
        assert start.json()["pending"] == [
            {"entity_id": "test.fenster", "name": "test.fenster", "room": None}
        ]
        asyncio.run(hub.registry.update_state("test.fenster", {"state": "on"}))
        laufend = client.get("/api/alarm/sensortest", headers=stefan).json()
        assert laufend["pending"] == []
        assert len(laufend["confirmed"]) == 1
        gestoppt = client.post("/api/alarm/sensortest/stop", headers=stefan)
        assert gestoppt.json() == {"running": False}


def test_sensortest_nur_bei_unscharfer_anlage(tmp_path):
    async def run():
        hub = _hub(tmp_path)
        await hub.start()
        try:
            service = hub.integrations.get("alarm")
            await service.arm("ausser_haus", force=True)
            with pytest.raises(HomePilotError):
                service.start_sensor_test("ausser_haus")
        finally:
            await hub.stop()

    asyncio.run(run())


def test_fehlalarme_route_nennt_den_namen(tmp_path):
    async def dreimal_schnell_entschaerfen(hub):
        await hub.registry.add(contact("test.fenster"))
        service = hub.integrations.get("alarm")
        await service.update_config(
            {
                "sensors": [{"entity_id": "test.fenster", "modes": ["ausser_haus"]}],
                "settings": {"exit_delay": 0, "notify_trigger": False},
            }
        )
        for _ in range(3):
            await service.arm("ausser_haus", force=True)
            await hub.registry.update_state("test.fenster", {"state": "on"})
            await service.disarm()
            await hub.registry.update_state("test.fenster", {"state": "off"})

    hub = _hub(tmp_path)
    with _client(hub) as client:
        asyncio.run(dreimal_schnell_entschaerfen(hub))
        antwort = client.get(
            "/api/alarm/fehlalarme", headers={"Authorization": "Bearer t-stefan"}
        )
        kandidaten = antwort.json()["kandidaten"]
        assert kandidaten == [
            {"entity_id": "test.fenster", "anzahl": 3, "name": "test.fenster"}
        ]
