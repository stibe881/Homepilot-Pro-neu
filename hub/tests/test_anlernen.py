"""Ein neues Gerät anlernen - aus der App (Punkt 632 der Werkbank).

Zigbee: «Permit join» gab es nur an der Zigbee2MQTT-Oberfläche, der Hub
sendete nie `bridge/request/permit_join`. Matter: `pair(code)` war nur
über die Kommandozeile erreichbar. Hier die reinen Hälften (was die
Bridge meldet, was ein Code ist) und die Routen, über die die App beides
auslöst.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.api.routes.verbindungen import matter_code_sauber
from homepilot.core.config import load_config
from homepilot.core.hub import Hub
from homepilot.integrations import zigbee2mqtt as z
from homepilot.integrations.zigbee2mqtt import Zigbee2MqttIntegration

# ── Was die Bridge meldet (rein) ─────────────────────────────────────────


def test_erst_der_geglueckte_interview_ist_ein_gefundenes_geraet():
    assert z.anlern_ereignis({"type": "device_joined", "data": {"friendly_name": "0x00158d"}}) == {
        "name": "0x00158d",
        "model": "",
        "status": "joined",
    }
    # «started» hat noch keinen Namen für das, was da kommt.
    assert (
        z.anlern_ereignis(
            {"type": "device_interview", "data": {"friendly_name": "0x00158d", "status": "started"}}
        )
        is None
    )
    gefunden = z.anlern_ereignis(
        {
            "type": "device_interview",
            "data": {
                "friendly_name": "0x00158d",
                "status": "successful",
                "supported": True,
                "definition": {"model": "MCCGQ11LM", "description": "Aqara door & window contact sensor"},
            },
        }
    )
    assert gefunden == {
        "name": "0x00158d",
        "model": "Aqara door & window contact sensor",
        "status": "successful",
    }
    # Gefunden, aber Zigbee2MQTT kennt es nicht: Das soll die App sagen,
    # statt dass die Kachel einfach nie kommt.
    unbekannt = z.anlern_ereignis(
        {
            "type": "device_interview",
            "data": {"friendly_name": "0xabc", "status": "successful", "supported": False},
        }
    )
    assert unbekannt is not None and unbekannt["status"] == "unsupported"
    assert z.anlern_ereignis({"type": "device_leave", "data": {"friendly_name": "x"}}) is None
    assert z.anlern_ereignis("kaputt") is None


def test_die_restzeit_versteht_beide_fassungen_von_zigbee2mqtt():
    jetzt = 1_700_000_000.0
    # 2.x: der Zeitpunkt des Endes in Millisekunden.
    assert z.permit_join_rest({"permit_join": True, "permit_join_end": (jetzt + 90) * 1000}, jetzt) == 90
    # 1.x: die Restdauer in Sekunden.
    assert z.permit_join_rest({"permit_join": True, "permit_join_timeout": 120}, jetzt) == 120
    assert z.permit_join_rest({"permit_join": False}, jetzt) == 0
    # Eine Meldung ohne Auskunft lässt den eigenen Zähler in Ruhe.
    assert z.permit_join_rest({"version": "2.1.0"}, jetzt) is None
    assert z.permit_join_rest({"permit_join": True}, jetzt) is None


def test_ein_matter_code_ist_der_qr_inhalt_oder_elf_ziffern():
    assert matter_code_sauber("MT:Y.K90-Q000KA0648G00") == "MT:Y.K90-Q000KA0648G00"
    assert matter_code_sauber("  mt:Y.K90 ") == "MT:Y.K90"
    assert matter_code_sauber("3497-011-2332") == "34970112332"
    assert matter_code_sauber("34970112332") == "34970112332"
    # Ein Tippfehler geht nicht erst dreissig Sekunden lang an den Dienst.
    assert matter_code_sauber("3497011233") is None
    assert matter_code_sauber("Stehlampe") is None
    assert matter_code_sauber("MT:") is None
    assert matter_code_sauber("") is None


# ── Die Integration hält den Stand ───────────────────────────────────────


class _Broker:
    def __init__(self) -> None:
        self.veroeffentlicht: list[tuple[str, Any]] = []

    async def publish(self, topic: str, payload: str) -> None:
        self.veroeffentlicht.append((topic, json.loads(payload)))


async def _zigbee(hub: Hub) -> tuple[Zigbee2MqttIntegration, _Broker]:
    integration = Zigbee2MqttIntegration(hub, {"integration": "zigbee2mqtt", "broker": "127.0.0.1"})
    integration._base = "zigbee2mqtt"
    integration._ignorieren = set()
    integration._geraete = {}
    integration._namen = {}
    integration._arten = {}
    integration._klassen = {}
    integration._haupt = {}
    integration._sirenen = {}
    integration._optionen = {}
    integration._anlernen_bis = None
    integration._gefunden = []
    broker = _Broker()
    integration._client = broker  # type: ignore[assignment]
    return integration, broker


async def test_anlernen_oeffnet_das_netz_und_sammelt_wer_anklopft(hub):
    integration, broker = await _zigbee(hub)
    stand = await integration.anlernen_starten(2)
    assert broker.veroeffentlicht == [
        ("zigbee2mqtt/bridge/request/permit_join", {"value": True, "time": 120})
    ]
    assert stand["offen"] is True and 118 <= stand["rest"] <= 120
    assert stand["gefunden"] == []

    await integration._nachricht(
        "zigbee2mqtt/bridge/event",
        json.dumps({"type": "device_joined", "data": {"friendly_name": "0x00158d"}}),
    )
    await integration._nachricht(
        "zigbee2mqtt/bridge/event",
        json.dumps(
            {
                "type": "device_interview",
                "data": {
                    "friendly_name": "0x00158d",
                    "status": "successful",
                    "supported": True,
                    "definition": {"description": "Aqara door & window contact sensor"},
                },
            }
        ),
    )
    gefunden = integration.anlernen_stand()["gefunden"]
    # Je Gerät nur der jüngste Stand - nicht «klopft an» und «gefunden»
    # untereinander.
    assert [(e["name"], e["status"]) for e in gefunden] == [("0x00158d", "successful")]
    assert gefunden[0]["model"] == "Aqara door & window contact sensor"

    # Was Zigbee2MQTT über das Ende sagt, sticht den eigenen Zähler.
    await integration._nachricht(
        "zigbee2mqtt/bridge/info", json.dumps({"permit_join": False})
    )
    assert integration.anlernen_stand()["offen"] is False

    # Schliessen von Hand.
    await integration.anlernen_starten(0)
    assert broker.veroeffentlicht[-1] == (
        "zigbee2mqtt/bridge/request/permit_join",
        {"value": False, "time": 0},
    )


async def test_ohne_broker_gibt_es_kein_anlernen(hub):
    integration, _broker = await _zigbee(hub)
    integration._client = None
    with pytest.raises(ConnectionError):
        await integration.anlernen_starten(1)
    assert integration.anlernen_stand()["verbunden"] is False


# ── Die Routen ───────────────────────────────────────────────────────────

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18171 }}
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


class _FakeZigbee:
    name = "zigbee2mqtt"

    def __init__(self) -> None:
        self.aufrufe: list[float] = []
        self.verbunden = True

    async def teardown(self) -> None:
        pass

    async def anlernen_starten(self, minuten: float) -> dict[str, Any]:
        if not self.verbunden:
            raise ConnectionError("Keine Verbindung zum Broker")
        self.aufrufe.append(minuten)
        return self.anlernen_stand()

    def anlernen_stand(self) -> dict[str, Any]:
        return {"offen": bool(self.aufrufe), "rest": 240, "gefunden": [], "verbunden": True}


class _FakeMatter:
    name = "matter"

    def __init__(self) -> None:
        self._ws = object()
        self.codes: list[str] = []

    async def teardown(self) -> None:
        pass

    async def pair(self, code: str) -> dict[str, Any]:
        self.codes.append(code)
        if code.startswith("MT:"):
            return {"node_id": 7, "geraete": ["Stehlampe"]}
        raise RuntimeError("commissioning failed")


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


def test_the_listing_says_what_can_be_paired(client):
    assert client.get("/api/verbindungen/anlernen", headers=auth("t-resident")).status_code == 403
    # Ohne die beiden Integrationen: nichts anzubieten, aber kein Fehler.
    assert client.get("/api/verbindungen/anlernen", headers=auth("t-owner")).json() == {
        "zigbee": None,
        "matter": None,
    }
    client.hub.integrations._integrations["zigbee2mqtt"] = _FakeZigbee()
    client.hub.integrations._integrations["matter"] = _FakeMatter()
    stand = client.get("/api/verbindungen/anlernen", headers=auth("t-owner")).json()
    assert stand["zigbee"]["offen"] is False
    assert stand["matter"] == {"verbunden": True}


def test_zigbee_permit_join_runs_through_the_route(client):
    assert (
        client.post("/api/verbindungen/zigbee/anlernen", json={}, headers=auth("t-owner")).status_code
        == 404
    )
    zigbee = _FakeZigbee()
    client.hub.integrations._integrations["zigbee2mqtt"] = zigbee
    antwort = client.post(
        "/api/verbindungen/zigbee/anlernen", json={"minuten": 3}, headers=auth("t-owner")
    )
    assert antwort.status_code == 200 and antwort.json()["offen"] is True
    assert zigbee.aufrufe == [3]
    # Ohne Angabe: vier Minuten.
    client.post("/api/verbindungen/zigbee/anlernen", json={}, headers=auth("t-owner"))
    assert zigbee.aufrufe == [3, 4]
    zigbee.verbunden = False
    assert (
        client.post("/api/verbindungen/zigbee/anlernen", json={}, headers=auth("t-owner")).status_code
        == 503
    )


def test_matter_pairing_checks_the_code_and_never_echoes_it(client):
    matter = _FakeMatter()
    client.hub.integrations._integrations["matter"] = matter
    tippfehler = client.post(
        "/api/verbindungen/matter/koppeln", json={"code": "Stehlampe"}, headers=auth("t-owner")
    )
    assert tippfehler.status_code == 400
    assert matter.codes == []

    antwort = client.post(
        "/api/verbindungen/matter/koppeln",
        json={"code": "MT:Y.K90-Q000KA0648G00"},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200
    assert antwort.json() == {"ok": True, "node_id": 7, "geraete": ["Stehlampe"]}

    scheitert = client.post(
        "/api/verbindungen/matter/koppeln", json={"code": "3497-011-2332"}, headers=auth("t-owner")
    )
    assert scheitert.status_code == 502
    # Der Code ist ein Geheimnis auf Zeit und steht in keiner Meldung.
    assert "34970112332" not in scheitert.text
