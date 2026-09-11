"""Die Routen für den Klingelton: Wahl speichern, Testtaste, Validierung."""

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import klingelton, say
from homepilot.core.config import load_config
from homepilot.core.hub import Hub

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18191 }}
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


def test_default_is_the_standard_sound_and_no_speakers(client):
    antwort = client.get("/api/push/doorbell-sound", headers=auth("t-owner"))
    assert antwort.status_code == 200
    daten = antwort.json()
    assert daten["sound"] == klingelton.STANDARD
    assert daten["speakers"] == []
    # Alle eingebauten Klänge stehen zur Wahl, mit lesbarem Namen.
    schluessel = {eintrag["key"] for eintrag in daten["sounds"]}
    assert schluessel == {klang["key"] for klang in klingelton.KLAENGE}
    # Nur Geräte, die tatsächlich einen Ton abspielen können.
    kandidaten = [eintrag["id"] for eintrag in daten["candidates"]]
    assert kandidaten, "die Demo-Integration hat Lautsprecher"


def test_choice_is_stored_and_validated(client):
    kandidaten = [
        eintrag["id"]
        for eintrag in client.get(
            "/api/push/doorbell-sound", headers=auth("t-owner")
        ).json()["candidates"]
    ]
    box = kandidaten[0]

    antwort = client.put(
        "/api/push/doorbell-sound",
        json={"sound": "hupe", "speakers": [box]},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200
    daten = antwort.json()
    assert daten["sound"] == "hupe"
    # Eine blosse Kennung kommt mit ihren Vorgaben zurück - eine ältere
    # App darf weiter schreiben, ohne etwas zu verlieren.
    assert [eintrag["id"] for eintrag in daten["speakers"]] == [box]
    assert daten["speakers"][0]["volume"] == 55
    assert daten["speakers"][0]["from"] == "00:00"

    # Ein unbekannter Ton wird abgelehnt, nicht stillschweigend übernommen.
    antwort = client.put(
        "/api/push/doorbell-sound",
        json={"sound": "gibtsnicht"},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 404

    # Ebenso ein unbekannter Lautsprecher.
    antwort = client.put(
        "/api/push/doorbell-sound",
        json={"speakers": ["gibt.esnicht"]},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 404

    # Die zuletzt gültige Wahl steht weiterhin - ein abgelehnter Versuch
    # überschreibt nichts.
    antwort = client.get("/api/push/doorbell-sound", headers=auth("t-owner"))
    assert antwort.json()["sound"] == "hupe"
    assert [eintrag["id"] for eintrag in antwort.json()["speakers"]] == [box]


def test_omitting_a_field_leaves_it_untouched(client):
    kandidaten = [
        eintrag["id"]
        for eintrag in client.get(
            "/api/push/doorbell-sound", headers=auth("t-owner")
        ).json()["candidates"]
    ]
    box = kandidaten[0]
    client.put(
        "/api/push/doorbell-sound",
        json={"sound": "kuckuck", "speakers": [box]},
        headers=auth("t-owner"),
    )
    # Nur den Ton ändern - die Boxen bleiben, wie sie waren.
    antwort = client.put(
        "/api/push/doorbell-sound", json={"sound": "tusch"}, headers=auth("t-owner")
    )
    daten = antwort.json()
    assert daten["sound"] == "tusch"
    assert daten["speakers"] == [{"id": box, "volume": 55, "from": "00:00", "to": "24:00"}]
    assert daten["night"] == klingelton.NACHT_STANDARD
    assert daten["announce"] is False


def test_the_test_button_plays_without_saving(client):
    hub = client.hub
    say.remember_base(hub, "http://127.0.0.1:18191")
    kandidaten = [
        eintrag["id"]
        for eintrag in client.get(
            "/api/push/doorbell-sound", headers=auth("t-owner")
        ).json()["candidates"]
    ]
    box = kandidaten[0]

    antwort = client.post(
        "/api/push/doorbell-sound/test",
        json={"sound": "tusch", "speakers": [box]},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200
    assert antwort.json()["ok"] is True
    assert antwort.json()["sent"]

    # Gespeichert wurde dabei nichts - die Wahl bleibt beim Standard.
    assert (
        client.get("/api/push/doorbell-sound", headers=auth("t-owner")).json()["sound"]
        == klingelton.STANDARD
    )


def test_the_test_button_without_a_speaker_reports_it(client):
    say.remember_base(client.hub, "http://127.0.0.1:18191")
    antwort = client.post(
        "/api/push/doorbell-sound/test", json={}, headers=auth("t-owner")
    )
    assert antwort.status_code == 400


def test_only_edit_automations_may_save(client):
    antwort = client.put(
        "/api/push/doorbell-sound",
        json={"sound": "hupe"},
        headers=auth("t-resident"),
    )
    assert antwort.status_code == 403


def test_every_sound_can_be_fetched_as_a_wav(client):
    """Zum Anhören auf dem Gerät in der Hand: jeder Klang als Datei."""
    for klang in klingelton.KLAENGE:
        antwort = client.get(
            f"/api/push/doorbell-sound/{klang['key']}.wav", headers=auth("t-owner")
        )
        assert antwort.status_code == 200, klang["key"]
        assert antwort.headers["content-type"].startswith("audio/wav")
        assert antwort.content.startswith(b"RIFF")


def test_wav_accepts_the_token_in_the_query(client):
    """Audio-Player schicken keine eigenen Kopfzeilen mit - ohne Token in
    der Adresse bliebe die Probe auf dem Telefon stumm."""
    antwort = client.get(f"/api/push/doorbell-sound/{klingelton.STANDARD}.wav?token=t-owner")
    assert antwort.status_code == 200
    assert antwort.content.startswith(b"RIFF")


def test_wav_needs_a_token(client):
    antwort = client.get(f"/api/push/doorbell-sound/{klingelton.STANDARD}.wav")
    assert antwort.status_code == 401


def test_unknown_sound_has_no_wav(client):
    antwort = client.get("/api/push/doorbell-sound/nie-gehört.wav", headers=auth("t-owner"))
    assert antwort.status_code == 404
def test_night_rule_and_announcement_are_stored_and_validated(client):
    antwort = client.put(
        "/api/push/doorbell-sound",
        json={
            "night": {"mode": "leise", "from": 21, "to": 6},
            "announce": True,
            "announce_text": "Es klingelt an der Haustüre.",
        },
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200, antwort.text
    daten = antwort.json()
    assert daten["night"] == {"mode": "leise", "from": 21, "to": 6}
    assert daten["announce"] is True
    assert daten["announce_text"] == "Es klingelt an der Haustüre."
    # Ein Feld allein lässt die anderen stehen.
    client.put("/api/push/doorbell-sound", json={"sound": "hupe"}, headers=auth("t-owner"))
    daten = client.get("/api/push/doorbell-sound", headers=auth("t-owner")).json()
    assert daten["night"]["mode"] == "leise"
    assert daten["announce"] is True
    assert (
        client.put(
            "/api/push/doorbell-sound", json={"night": {"mode": "laut"}}, headers=auth("t-owner")
        ).status_code
        == 400
    )
