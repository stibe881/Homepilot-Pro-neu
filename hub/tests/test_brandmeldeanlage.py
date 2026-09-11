"""Die Brandmeldeanlage (Punkt 445).

Der Fall, für den es sie gibt: Ein Rauchmelder schlägt um drei Uhr an,
die Alarmanlage ist unscharf, kein Ablauf hört zu - und trotzdem muss
das Telefon brummen, das Licht angehen und die Box sprechen.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import brandmelder
from homepilot.core.config import ApiConfig, HubConfig, load_config
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.core.integration import Integration

# ── Reine Hälften ─────────────────────────────────────────────────────────


def _melder(entity_id: str, klasse: str = "smoke", state: str = "off", **extra):
    return SimpleNamespace(
        id=entity_id,
        kind="binary_sensor",
        label=entity_id,
        name=entity_id,
        room=extra.pop("room", None),
        commands=extra.pop("commands", []),
        available=True,
        last_seen=None,
        state={"state": state, "device_class": klasse, **extra},
    )


def test_melder_erkennt_rauch_gas_und_hoerende_kameras():
    rauch = _melder("z.rauch")
    gas = _melder("z.gas", "gas")
    kontakt = _melder("z.fenster", "contact")
    kamera = SimpleNamespace(
        id="cam.flur", kind="camera", label="Flur", name="Flur", room="Flur",
        commands=[], available=True, last_seen=None,
        state={"state": "online", "detected_smoke_alarm": "off"},
    )
    assert [e.id for e in brandmelder.melder([kontakt, kamera, gas, rauch])] == [
        "z.gas", "z.rauch", "cam.flur",
    ]
    assert brandmelder.ist_melder(kontakt) is False


def test_zustand_folgt_den_meldern_und_dem_quittieren():
    ruhig = _melder("z.a")
    laut = _melder("z.b", state="on")
    assert brandmelder.zustand([], set(), False) == brandmelder.UNBESETZT
    assert brandmelder.zustand([ruhig], set(), False) == brandmelder.BEREIT
    assert brandmelder.zustand([ruhig, laut], set(), False) == brandmelder.AUSGELOEST
    assert brandmelder.zustand([ruhig, laut], set(), True) == brandmelder.QUITTIERT
    # Ein abgeschalteter Melder zählt nicht - auch nicht, wenn er anschlägt.
    assert brandmelder.zustand([ruhig, laut], {"z.b"}, False) == brandmelder.BEREIT
    assert brandmelder.zustand([laut], {"z.b"}, False) == brandmelder.UNBESETZT


def test_schaltbefehle_folgen_den_schaltern():
    licht = SimpleNamespace(id="l.1", kind="light", commands=["turn_on", "set_brightness"], state={})
    schalter = SimpleNamespace(id="l.2", kind="light", commands=["turn_on"], state={})
    store = SimpleNamespace(id="c.1", kind="cover", commands=["open", "close"], state={})
    schloss = SimpleNamespace(id="k.1", kind="lock", commands=["lock", "unlock"], state={})
    anderer = _melder("z.b", commands=["mute", "buzzer_alarm"])
    ausloeser = _melder("z.a", state="on", commands=["mute", "buzzer_alarm"])
    alle = [licht, schalter, store, schloss, anderer, ausloeser]
    befehle = brandmelder.schaltbefehle(alle, brandmelder.DEFAULT_SETTINGS, {"z.a"})
    assert befehle == [
        ("l.1", "set_brightness", {"brightness": 100}),
        ("l.2", "turn_on", {}),
        ("c.1", "open", {}),
        ("z.b", "buzzer_alarm", {}),
    ]
    mit_tuer = {**brandmelder.DEFAULT_SETTINGS, "unlock_doors": True, "lights_on": False}
    assert ("k.1", "unlock", {}) in brandmelder.schaltbefehle(alle, mit_tuer, {"z.a"})
    assert not any(b[0].startswith("l.") for b in brandmelder.schaltbefehle(alle, mit_tuer, {"z.a"}))
    assert sorted(brandmelder.stummbefehle([anderer, ausloeser, licht])) == [
        ("z.a", "mute", {}), ("z.b", "mute", {}),
    ]


def test_durchsage_nennt_den_raum_oder_das_geraet():
    vorlage = brandmelder.DEFAULT_SETTINGS["announce_text"]
    assert brandmelder.durchsage_text(vorlage, _melder("z.a", room="Küche")) == (
        "Achtung, Rauch in Küche. Bitte das Haus verlassen."
    )
    assert "Rauch in z.a" in brandmelder.durchsage_text(vorlage, _melder("z.a"))


def test_wiederholung_und_pruefung():
    assert brandmelder.wiederholung_faellig(0.0, 200.0, 3, False) is True
    assert brandmelder.wiederholung_faellig(0.0, 100.0, 3, False) is False
    assert brandmelder.wiederholung_faellig(0.0, 200.0, 3, True) is False
    assert brandmelder.wiederholung_faellig(0.0, 200.0, 0, False) is False
    jetzt = 10_000_000.0
    assert brandmelder.pruefung_faellig(None, jetzt, 6) is True
    assert brandmelder.pruefung_faellig(jetzt - 10 * 86400, jetzt, 6) is False
    assert brandmelder.pruefung_faellig(jetzt - 200 * 86400, jetzt, 6) is True
    # Höchstens einmal im Monat erinnern, und gar nicht bei 0 Monaten.
    assert brandmelder.pruefung_faellig(None, jetzt, 6, erinnert=jetzt - 86400) is False
    assert brandmelder.pruefung_faellig(None, jetzt, 0) is False


def test_settings_lesen_klemmt():
    sauber = brandmelder.settings_lesen(
        {"repeat_minutes": 999, "test_months": -3, "announce_text": "  ", "unlock_doors": 1}
    )
    assert sauber["repeat_minutes"] == 60
    assert sauber["test_months"] == 0
    assert sauber["announce_text"] == brandmelder.DEFAULT_SETTINGS["announce_text"]
    assert sauber["unlock_doors"] is True
    assert brandmelder.settings_lesen(None) == brandmelder.DEFAULT_SETTINGS


# ── Am lebenden Hub ───────────────────────────────────────────────────────


class Zigbee(Integration):
    """Zwei Aqara-Melder und eine Store, wie Zigbee2MQTT sie anlegt."""

    name = "z"

    def __init__(self, hub, config):
        super().__init__(hub, config)
        self.befehle: list[tuple[str, str, dict]] = []

    async def setup(self) -> None:
        for kennung, raum in (("kueche", "Küche"), ("flur", "Flur")):
            await self.add_entity(
                kennung,
                EntityKind.BINARY_SENSOR,
                f"Rauchmelder {raum}",
                state={"state": "off", "device_class": "smoke", "battery": 90},
                commands=["mute", "buzzer_alarm", "self_test"],
                room=raum,
            )
        await self.add_entity(
            "store", EntityKind.COVER, "Store Küche", state={"state": "closed"},
            commands=["open", "close"], room="Küche",
        )

    async def handle_command(self, entity: Entity, command: str, data: dict) -> None:
        self.befehle.append((entity.id, command, data))


OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


async def _hub(tmp_path) -> tuple[Hub, Zigbee, list[dict]]:
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            users=[OWNER],
            data_file=str(tmp_path / "daten.json"),
        )
    )
    await hub.start()
    zigbee = Zigbee(hub, {})
    hub.integrations._integrations["z"] = zigbee
    await zigbee.setup()
    hub.push.register("ExponentPushToken[Stefan]", "Stefan")
    gesendet: list[dict] = []

    async def send(tokens, title, body, data=None, image=None, category=None):
        gesendet.append({"title": title, "body": body, "category": category, "data": data})
        return SimpleNamespace(accepted=len(tokens))

    hub.push.send = send  # type: ignore[method-assign]
    return hub, zigbee, gesendet


def test_rauch_meldet_sofort_spricht_und_schaltet(tmp_path, monkeypatch):
    async def check():
        hub, zigbee, gesendet = await _hub(tmp_path)
        gesprochen: list[str] = []

        async def speak(hub_, text, speakers=None, volume=None, **_):
            gesprochen.append(text)
            return {"sent": []}

        from homepilot.core import say

        monkeypatch.setattr(say, "speak", speak)
        try:
            anlage = hub.integrations.get("brand")
            assert anlage.zustand() == brandmelder.BEREIT
            await hub.registry.update_state("z.kueche", {"state": "on", "device_class": "smoke"})
            await asyncio.sleep(0.05)
            assert anlage.zustand() == brandmelder.AUSGELOEST
            assert anlage._entity.state["alarm"] == ["z.kueche"]
            # Die Nachricht: Kategorie «smoke», mit Raum, als erstes.
            assert gesendet[0]["category"] == "smoke"
            assert "Küche" in gesendet[0]["body"]
            assert gesendet[0]["data"]["ziel"] == "bereich:brand"
            # Die Durchsage nennt den Raum.
            assert gesprochen == ["Achtung, Rauch in Küche. Bitte das Haus verlassen."]
            # Geschaltet: das Demo-Licht an, die Store auf, der andere Melder heult mit.
            assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
            assert ("z.store", "open", {}) in zigbee.befehle
            assert ("z.flur", "buzzer_alarm", {}) in zigbee.befehle
            assert not any(e == "z.kueche" for e, c, _ in zigbee.befehle if c == "buzzer_alarm")
            assert anlage.history[0]["kind"] == "ausgeloest"

            # Quittieren stoppt die Wiederholung, Stumm geht an beide Melder.
            await anlage.quittieren(by="Stefan")
            assert anlage.zustand() == brandmelder.QUITTIERT
            assert anlage.takt() is not None
            await anlage.takt()
            assert len([g for g in gesendet if "Immer noch" in g["title"]]) == 0
            antwort = await anlage.stumm(by="Stefan")
            assert sorted(antwort["muted"]) == ["z.flur", "z.kueche"]

            # Entwarnung, sobald der Melder wieder ruhig ist.
            await hub.registry.update_state("z.kueche", {"state": "off", "device_class": "smoke"})
            await asyncio.sleep(0.05)
            assert anlage.zustand() == brandmelder.BEREIT
            assert gesendet[-1]["title"] == "Entwarnung"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_wiederholung_bis_jemand_quittiert(tmp_path, monkeypatch):
    async def check():
        hub, zigbee, gesendet = await _hub(tmp_path)
        try:
            anlage = hub.integrations.get("brand")
            # Ohne Prüf-Erinnerung: Die Melder sind nie geprüft, und die
            # Erinnerung dazu ist hier nicht die Frage.
            await anlage.update_config(
                {"settings": {"announce": False, "repeat_minutes": 3, "test_months": 0}}
            )
            await hub.registry.update_state("z.flur", {"state": "on", "device_class": "smoke"})
            await asyncio.sleep(0.05)
            assert len(gesendet) == 1
            # Noch keine drei Minuten: nichts.
            await anlage.takt()
            assert len(gesendet) == 1
            anlage._zuletzt_gemeldet -= 200
            await anlage.takt()
            assert len(gesendet) == 2
            assert gesendet[1]["title"].startswith("🔥 Immer noch")
        finally:
            await hub.stop()

    asyncio.run(check())


def test_abgeschalteter_melder_loest_nicht_aus(tmp_path):
    async def check():
        hub, zigbee, gesendet = await _hub(tmp_path)
        try:
            anlage = hub.integrations.get("brand")
            await anlage.update_config({"settings": {"announce": False}, "disabled": ["z.kueche"]})
            await hub.registry.update_state("z.kueche", {"state": "on", "device_class": "smoke"})
            await asyncio.sleep(0.05)
            assert anlage.zustand() == brandmelder.BEREIT
            assert gesendet == []
            zeilen = {z["entity_id"]: z for z in anlage.melderliste()}
            assert zeilen["z.kueche"]["active"] is False
            assert zeilen["z.flur"]["can_mute"] is True
            assert zeilen["z.flur"]["test_overdue"] is True
        finally:
            await hub.stop()

    asyncio.run(check())


# ── Die Routen ────────────────────────────────────────────────────────────

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18199 }}
integrations:
  - integration: demo
users:
  - name: Stefan
    role: besitzer
    token: t-owner
  - name: Livia
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


def kopf(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_die_routen_zeigen_melder_und_lassen_bewohner_quittieren(client):
    daten = client.get("/api/brand", headers=kopf("t-resident")).json()
    # Die Demo-Integration bringt einen Rauchmelder mit.
    assert any(z["device_class"] == "smoke" for z in daten["detectors"])
    assert daten["state"]["state"] == brandmelder.BEREIT
    assert daten["settings"]["lights_on"] is True
    # Bewohner dürfen quittieren und testen, aber nicht einstellen.
    assert client.post("/api/brand/quittieren", headers=kopf("t-resident")).status_code == 200
    assert (
        client.put("/api/brand", json={"settings": {"lights_on": False}}, headers=kopf("t-resident")).status_code
        == 403
    )
    gesetzt = client.put(
        "/api/brand", json={"settings": {"lights_on": False, "repeat_minutes": 5}}, headers=kopf("t-owner")
    ).json()
    assert gesetzt["settings"]["lights_on"] is False
    assert gesetzt["settings"]["repeat_minutes"] == 5
    melder = daten["detectors"][0]["entity_id"]
    getestet = client.post(f"/api/brand/melder/{melder}/getestet", headers=kopf("t-resident")).json()
    zeile = next(z for z in getestet["detectors"] if z["entity_id"] == melder)
    assert zeile["last_test"] is not None and zeile["test_overdue"] is False
    assert getestet["history"][0]["kind"] == "test"
    assert client.post("/api/brand/melder/gibt.esnicht/getestet", headers=kopf("t-owner")).status_code == 404
