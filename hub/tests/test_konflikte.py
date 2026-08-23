"""Gegensätzliche Abläufe abhaken.

Der Fall dahinter: Die Liste stand mit neun Zeilen da, von denen acht in
Ordnung waren («der eine schaltet ein, der andere später aus») - und die
neunte, die es nicht war, ging darin unter.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import konflikte
from homepilot.core.hub import Hub

from .conftest import make_config

EIN_AUS = {
    "entity_id": "hue.gang",
    "commands": ["turn_on/turn_off"],
    "automations": [
        {"id": "a1", "alias": "Bewegung Licht Gang ein"},
        {"id": "a2", "alias": "Bewegung Licht Gang aus"},
    ],
}
ANDERER = {
    "entity_id": "hue.terrasse",
    "commands": ["turn_on/turn_off"],
    "automations": [
        {"id": "b1", "alias": "Bewegung Licht Terrasse ein"},
        {"id": "b2", "alias": "Niemand Zuhause"},
    ],
}


def test_der_schluessel_haengt_nicht_an_der_reihenfolge():
    gedreht = {**EIN_AUS, "automations": list(reversed(EIN_AUS["automations"]))}
    assert konflikte.schluessel(EIN_AUS) == konflikte.schluessel(gedreht)


def test_ein_anderer_widerspruch_bekommt_einen_anderen_schluessel():
    assert konflikte.schluessel(EIN_AUS) != konflikte.schluessel(ANDERER)
    # Und derselbe Ablauf mit anderen Befehlen ebenfalls: Quittiert wurde,
    # was vorher dastand.
    umgebaut = {**EIN_AUS, "commands": ["open/close"]}
    assert konflikte.schluessel(EIN_AUS) != konflikte.schluessel(umgebaut)


def test_quittieren_nimmt_die_zeile_aus_der_liste():
    gespeichert = konflikte.quittieren([], konflikte.schluessel(EIN_AUS), "Stefan", 1.0)
    offen, erledigt = konflikte.teilen([EIN_AUS, ANDERER], gespeichert)
    assert [zeile["entity_id"] for zeile in offen] == ["hue.terrasse"]
    assert erledigt[0]["ack"]["by"] == "Stefan"


def test_zuruecknehmen_holt_sie_zurueck():
    key = konflikte.schluessel(EIN_AUS)
    gespeichert = konflikte.zuruecknehmen(konflikte.quittieren([], key), key)
    offen, erledigt = konflikte.teilen([EIN_AUS], gespeichert)
    assert len(offen) == 1
    assert erledigt == []


def test_eine_kaputte_zeile_heisst_nicht_quittiert():
    # Die harmlose Richtung: Die Zeile taucht wieder auf, statt still zu
    # verschwinden.
    offen, _ = konflikte.teilen([EIN_AUS], ["Unsinn", {}, {"key": ""}])
    assert len(offen) == 1


def test_quittungen_ohne_zeile_fliegen_raus():
    gespeichert = konflikte.quittieren([], konflikte.schluessel(EIN_AUS))
    # Der Widerspruch ist weg (ein Ablauf gelöscht) - die Quittung auch.
    assert konflikte.aufraeumen(gespeichert, [ANDERER]) == []
    # Und wenn nichts zu tun ist, wird auch nichts geschrieben.
    assert konflikte.aufraeumen(gespeichert, [EIN_AUS]) is None


# ── Über die Schnittstelle ───────────────────────────────────────────────


def _hub() -> Hub:
    return Hub(
        make_config(
            token="t-owner",
            automations=[
                {
                    "alias": "Licht an",
                    "trigger": {"entity_id": "demo.motion_hall", "to": "on"},
                    "action": {"entity_id": "demo.light_livingroom", "command": "turn_on"},
                },
                {
                    "alias": "Licht aus",
                    "trigger": {"entity_id": "demo.motion_hall", "to": "off"},
                    "action": {"entity_id": "demo.light_livingroom", "command": "turn_off"},
                },
            ],
        )
    )


def test_quittieren_ueber_die_api():
    with TestClient(create_app(_hub())) as client:
        kopf = {"Authorization": "Bearer t-owner"}
        antwort = client.get("/api/automations/conflicts", headers=kopf).json()
        assert len(antwort["conflicts"]) == 1
        assert antwort["acknowledged"] == []
        key = antwort["conflicts"][0]["key"]

        nachher = client.post(
            "/api/automations/conflicts/ack", json={"key": key}, headers=kopf
        ).json()
        assert nachher["conflicts"] == []
        assert len(nachher["acknowledged"]) == 1
        # Und beim nächsten Nachsehen bleibt es so.
        assert client.get("/api/automations/conflicts", headers=kopf).json()[
            "conflicts"
        ] == []

        zurueck = client.post(
            "/api/automations/conflicts/ack",
            json={"key": key, "on": False},
            headers=kopf,
        ).json()
        assert len(zurueck["conflicts"]) == 1
