"""Die Verbindungen-Seite: Kalender, Spotify und Google Home aus der App.

Die reinen Hälften (Stand-Sätze, Blockbearbeitung, secrets.env) und die
Routen, über die die App liest, ändert und anlegt.
"""

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import config_edit, verbindungen
from homepilot.core.config import load_config
from homepilot.core.hub import Hub

# ── Der Stand-Satz (rein) ────────────────────────────────────────────────


def test_the_status_names_the_next_step_in_setup_order():
    satz = verbindungen.status_von
    assert satz(False, False, False, None, None, None)["text"] == "Nicht eingerichtet"
    assert satz(True, False, False, None, None, None)["text"] == "Ausgeschaltet"
    assert satz(True, True, False, None, False, None)["text"] == "Zugangsdaten fehlen"
    assert satz(True, True, False, None, True, False)["text"] == "Anmeldung fehlt"
    assert satz(True, True, False, None, True, True)["text"] == "Erst nach dem Neustart aktiv"
    assert satz(True, True, True, False, True, True)["ton"] == "warnung"
    assert satz(True, True, True, True, True, True) == {"text": "Verbunden", "ton": "gut"}


def test_a_recorded_load_error_beats_the_restart_hint():
    # «Neu starten» ist der falsche Rat, wenn genau das schon gescheitert ist.
    satz = verbindungen.status_von(True, True, False, None, True, True, "kaputt")
    assert satz["text"] == "Start fehlgeschlagen"


# ── Werte aus dem Block (rein) ───────────────────────────────────────────


def test_calendar_values_understand_both_spellings():
    assert verbindungen.kalender_werte(
        {"calendar_ids": ["primary", "x@gmail.com"], "remind_minutes": "15"}
    ) == {"calendar_ids": ["primary", "x@gmail.com"], "remind_minutes": 15}
    # Die alte Einzahl und der Leerfall fallen auf den Hauptkalender zurück.
    assert verbindungen.kalender_werte({"calendar_id": "y@gmail.com"})["calendar_ids"] == [
        "y@gmail.com"
    ]
    assert verbindungen.kalender_werte(None)["calendar_ids"] == ["primary"]


def test_cast_devices_carry_their_reachability():
    geraete = verbindungen.cast_geraete(
        {
            "devices": [
                {"host": "10.0.0.5", "name": "Küche"},
                {"host": "10.0.0.5", "name": "Gruppe", "port": 32187},
            ]
        },
        {"10_0_0_5": True, "10_0_0_5_32187": False},
    )
    assert [g["erreichbar"] for g in geraete] == [True, False]
    assert geraete[1]["port"] == 32187


def test_credentials_count_as_set_even_as_reference():
    # Der Wert geht die App nichts an - ein ${VERWEIS} ist «gesetzt».
    assert verbindungen.zugang_da({"client_id": "${A}", "client_secret": "x"})
    assert not verbindungen.zugang_da({"client_id": "abc"})


def test_calendar_ids_and_hosts_are_checked_before_they_reach_yaml():
    assert verbindungen.gueltige_kalender_id("primary")
    assert verbindungen.gueltige_kalender_id("addressbook#contacts@group.v.calendar.google.com")
    assert not verbindungen.gueltige_kalender_id("mit leerzeichen")
    assert not verbindungen.gueltige_kalender_id("a: b")
    assert verbindungen.gueltiger_host("192.168.1.35")
    assert not verbindungen.gueltiger_host("10.0.0.1; rm -rf")


def test_secrets_lines_replace_in_place_and_keep_comments():
    text = "# Kommentar\nSPOTIFY_CLIENT_ID=alt\n"
    neu = verbindungen.secrets_zeile_setzen(text, "SPOTIFY_CLIENT_ID", "frisch")
    assert neu == "# Kommentar\nSPOTIFY_CLIENT_ID=frisch\n"
    neu = verbindungen.secrets_zeile_setzen(neu, "GOOGLE_CLIENT_ID", "g1")
    assert neu.endswith("GOOGLE_CLIENT_ID=g1\n") and "SPOTIFY_CLIENT_ID=frisch" in neu
    # Eine frische Datei erklärt sich selbst.
    frisch = verbindungen.secrets_zeile_setzen("", "X", "1")
    assert frisch.startswith("#") and "X=1" in frisch


# ── Blockbearbeitung (rein, core/config_edit) ────────────────────────────

CONFIG = """\
api:
  port: 8080

integrations:
  # Der Kalender des Hauses
  - integration: google_calendar
    client_id: "${GOOGLE_CLIENT_ID}"
    client_secret: "${GOOGLE_CLIENT_SECRET}"
    calendar_ids:
      - primary
    remind_minutes: 15

  # - integration: spotify
  #   client_id: alt

  - integration: google_cast
    devices:
      - host: 10.10.1.20
        name: Wohnzimmer TV
      - host: 10.10.1.20
        name: Alle Boxen
        port: 32187
"""


def test_a_scalar_lands_inside_its_block_and_only_there():
    neu = config_edit.set_block_scalar(CONFIG, "google_calendar", "remind_minutes", 30)
    assert "remind_minutes: 30" in neu
    assert "# Der Kalender des Hauses" in neu
    # Neuer Schlüssel: ans Ende des Blocks, nicht in den nächsten.
    neu = config_edit.set_block_scalar(neu, "google_calendar", "scan_interval", 300)
    zeilen = neu.splitlines()
    stelle = zeilen.index("    scan_interval: 300")
    assert "- integration: google_cast" in "\n".join(zeilen[stelle:])
    # None entfernt die Zeile wieder.
    weg = config_edit.set_block_scalar(neu, "google_calendar", "scan_interval", None)
    assert "scan_interval" not in weg


def test_a_disabled_block_is_not_edited():
    # In Kommentare hineinzuschreiben ergäbe YAML zwischen Erklärzeilen.
    assert (
        config_edit.set_block_scalar(CONFIG, "spotify", "scan_interval", 30) == CONFIG
    )


def test_the_calendar_list_is_replaced_as_a_whole():
    neu = config_edit.set_block_list(
        CONFIG, "google_calendar", "calendar_ids", ["primary", "sohn@gmail.com"]
    )
    # Das «@» bekommt Anführungszeichen - quote() ist da bewusst vorsichtig.
    assert '      - primary\n      - "sohn@gmail.com"' in neu
    assert neu.count("calendar_ids:") == 1
    # Und die einzeilige Schreibweise wird genauso verstanden.
    inline = CONFIG.replace(
        "    calendar_ids:\n      - primary", "    calendar_ids: [primary]"
    )
    neu = config_edit.set_block_list(
        inline, "google_calendar", "calendar_ids", ["a@b.ch"]
    )
    assert "calendar_ids: [primary]" not in neu and '- "a@b.ch"' in neu
    # Eine leere Liste nimmt den Schlüssel heraus - es gilt die Vorgabe.
    leer = config_edit.set_block_list(CONFIG, "google_calendar", "calendar_ids", [])
    assert "calendar_ids" not in leer


def test_a_new_block_joins_the_end_of_the_integrations_list():
    neu = config_edit.append_integration_block(
        CONFIG,
        "spotify2",
        [("client_id", "${SPOTIFY_CLIENT_ID}"), ("calendar_ids", ["a", "b"])],
    )
    zeilen = neu.splitlines()
    stelle = zeilen.index("  - integration: spotify2")
    assert zeilen[stelle + 1] == '    client_id: "${SPOTIFY_CLIENT_ID}"'
    assert zeilen[stelle + 3 : stelle + 5] == ["      - a", "      - b"]
    # Ein zweiter Block derselben Integration entsteht nicht.
    assert config_edit.append_integration_block(neu, "spotify2", []) == neu


def test_removing_a_cast_device_respects_the_port():
    # Gruppe und Box teilen sich die Adresse - nur der Port unterscheidet.
    neu = config_edit.remove_cast_device(CONFIG, "10.10.1.20", 32187)
    assert "Alle Boxen" not in neu and "Wohnzimmer TV" in neu
    neu = config_edit.remove_cast_device(neu, "10.10.1.20")
    assert "Wohnzimmer TV" not in neu
    # Ein Eintrag, den es nicht gibt, ändert nichts.
    assert config_edit.remove_cast_device(CONFIG, "10.9.9.9") == CONFIG


# ── Die Routen ───────────────────────────────────────────────────────────

# Mit Leerzeilen zwischen den Abschnitten, wie die echte Datei: An der
# Leerzeile erkennt die Gliederung, dass ein auskommentierter Block noch
# zu `integrations` gehört und nicht der Kommentar über `users` ist
# (siehe config_edit._start_with_comments).
ROUTEN_CONFIG = """\
api: {{ host: 127.0.0.1, port: 18170 }}

integrations:
  - integration: demo
  - integration: google_cast
    devices:
      - host: 10.10.1.20
        name: Wohnzimmer TV

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
    config_file.write_text(ROUTEN_CONFIG.format(data_file=tmp_path / "data.json"))
    hub = Hub(load_config(config_file))
    with TestClient(create_app(hub)) as test_client:
        test_client.config_file = config_file
        test_client.secrets_file = tmp_path / "secrets.env"
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_only_the_owner_sees_the_services(client):
    assert client.get("/api/verbindungen", headers=auth("t-resident")).status_code == 403
    antwort = client.get("/api/verbindungen", headers=auth("t-owner"))
    assert antwort.status_code == 200
    dienste = {d["key"]: d for d in antwort.json()["dienste"]}
    assert set(dienste) == {"kalender", "spotify", "googlehome"}
    assert dienste["kalender"]["status"]["text"] == "Nicht eingerichtet"
    assert dienste["googlehome"]["eingerichtet"] is True
    geraete = dienste["googlehome"]["werte"]["geraete"]
    assert geraete[0]["host"] == "10.10.1.20"


def test_setting_up_the_calendar_writes_reference_and_secret_apart(client):
    antwort = client.put(
        "/api/verbindungen/kalender",
        json={
            "client_id": "id-123",
            "client_secret": "geheim-456",
            "calendar_ids": ["primary", "stefan@gmail.com"],
            "remind_minutes": 15,
        },
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200, antwort.text
    text = client.config_file.read_text()
    # In der Datei steht der Verweis, nie der Wert.
    assert 'client_secret: "${GOOGLE_CLIENT_SECRET}"' in text
    assert "geheim-456" not in text
    assert '- "stefan@gmail.com"' in text
    secrets = client.secrets_file.read_text()
    assert "GOOGLE_CLIENT_SECRET=geheim-456" in secrets
    # Und die Übersicht kennt den Dienst jetzt - samt Anmelde-Hinweis.
    dienste = {
        d["key"]: d
        for d in client.get("/api/verbindungen", headers=auth("t-owner")).json()["dienste"]
    }
    assert dienste["kalender"]["zugang"] is True
    assert dienste["kalender"]["angemeldet"] is False
    assert "google_calendar" in dienste["kalender"]["anmeldung"]


def test_setting_up_a_service_needs_its_credentials(client):
    antwort = client.put(
        "/api/verbindungen/spotify", json={"enabled": True}, headers=auth("t-owner")
    )
    assert antwort.status_code == 400
    assert "client_id" in antwort.json()["detail"]


def test_calendar_addresses_are_validated(client):
    client.put(
        "/api/verbindungen/kalender",
        json={"client_id": "a", "client_secret": "b"},
        headers=auth("t-owner"),
    )
    antwort = client.put(
        "/api/verbindungen/kalender",
        json={"calendar_ids": ["mit leerzeichen"]},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 400
    # Und ganz ohne Kalender geht es nicht - die Karte bräuchte sonst
    # einen vierten Zustand «eingerichtet, aber ohne Quelle».
    antwort = client.put(
        "/api/verbindungen/kalender",
        json={"calendar_ids": ["  "]},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 400


def test_fields_sent_to_the_wrong_service_are_an_error(client):
    antwort = client.put(
        "/api/verbindungen/spotify",
        json={"calendar_ids": ["primary"]},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 400
    antwort = client.put(
        "/api/verbindungen/googlehome",
        json={"client_id": "x", "client_secret": "y"},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 400
    assert client.put(
        "/api/verbindungen/sonos", json={}, headers=auth("t-owner")
    ).status_code == 404


def test_google_home_devices_come_and_go(client):
    antwort = client.put(
        "/api/verbindungen/googlehome",
        json={"geraet_hinzu": {"name": "Küche", "host": "10.10.1.30"}},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200
    assert "10.10.1.30" in client.config_file.read_text()
    antwort = client.put(
        "/api/verbindungen/googlehome",
        json={"geraet_weg": {"host": "10.10.1.30"}},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200
    assert "10.10.1.30" not in client.config_file.read_text()


def test_a_service_can_be_switched_off_and_on_again(client):
    antwort = client.put(
        "/api/verbindungen/googlehome", json={"enabled": False}, headers=auth("t-owner")
    )
    assert antwort.status_code == 200
    assert "# - integration: google_cast" in client.config_file.read_text()
    # Ausgeschaltet lässt sich nichts ändern - die Zeilen sind Kommentare.
    antwort = client.put(
        "/api/verbindungen/googlehome",
        json={"geraet_weg": {"host": "10.10.1.20"}},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 400
    antwort = client.put(
        "/api/verbindungen/googlehome", json={"enabled": True}, headers=auth("t-owner")
    )
    assert antwort.status_code == 200
    assert "# - integration: google_cast" not in client.config_file.read_text()


def test_a_request_that_changes_nothing_does_not_touch_the_file(client):
    vorher = client.config_file.read_text()
    antwort = client.put(
        "/api/verbindungen/googlehome",
        json={"geraet_weg": {"host": "10.99.99.99"}},
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200
    assert antwort.json().get("unveraendert") is True
    assert client.config_file.read_text() == vorher
