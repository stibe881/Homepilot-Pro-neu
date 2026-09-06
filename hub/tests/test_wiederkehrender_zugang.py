"""Der wiederkehrende Gast: «jeden Donnerstag 8-12», einmal angelegt.

Bisher kannte ein Zugang nur Ablaufdatum und Tages-Zeitfenster - für die
Putzhilfe hiess das: jede Woche ein neues Fenster. Jetzt trägt der
Benutzer Wochentage; an den übrigen Tagen ist das Token wertlos.
"""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import users
from homepilot.core.config import load_config
from homepilot.core.hub import Hub

# 2026-09-03 ist ein Donnerstag.
DONNERSTAG_VORMITTAG = datetime(2026, 9, 3, 9, 30)
DIENSTAG = datetime(2026, 9, 1, 9, 30)


def test_parse_days_keeps_only_real_weekdays():
    assert users.parse_days([3]) == [3]
    assert users.parse_days(["3", 0, 9, "x", None]) == [0, 3]
    assert users.parse_days(None) == []
    # Alle sieben Tage sind keine Einschränkung - eine Schreibweise genügt.
    assert users.parse_days([0, 1, 2, 3, 4, 5, 6]) == []


def test_thursday_guest_gets_in_on_thursday_only():
    gast = users.User(
        name="Putzhilfe",
        role=users.Role.GUEST,
        token="t",
        hours={"from": "08:00", "to": "12:00"},
        days=[3],
    )
    assert gast.active(DONNERSTAG_VORMITTAG)
    assert not gast.active(DIENSTAG)
    # Und am Donnerstag ausserhalb des Fensters auch nicht.
    assert not gast.active(datetime(2026, 9, 3, 13, 0))


def test_a_window_over_midnight_belongs_to_its_evening():
    """Der Babysitter-Fall: «Freitag 20:00 bis 01:00» meint den
    Freitagabend - um 00:30 ist zwar schon Samstag, aber es ist noch
    derselbe Abend. Ohne die Vortags-Regel flöge er um Mitternacht raus."""
    gast = users.User(
        name="Babysitter",
        role=users.Role.GUEST,
        token="t",
        hours={"from": "20:00", "to": "01:00"},
        days=[4],  # Freitag
    )
    # 2026-09-04 ist ein Freitag; 05.09. um 00:30 gehört noch dazu.
    assert gast.active(datetime(2026, 9, 4, 22, 0))
    assert gast.active(datetime(2026, 9, 5, 0, 30))
    # Samstagabend dagegen nicht.
    assert not gast.active(datetime(2026, 9, 5, 22, 0))


def test_access_end_skips_days_without_a_window():
    # Am Dienstag gibt es kein laufendes Donnerstags-Fenster - der
    # Wächter soll kein Ende ankündigen, wo nie ein Anfang war.
    ende = users.access_end(None, {"from": "08:00", "to": "12:00"}, DIENSTAG, [3])
    assert ende is None
    ende = users.access_end(
        None, {"from": "08:00", "to": "12:00"}, DONNERSTAG_VORMITTAG, [3]
    )
    assert ende == datetime(2026, 9, 3, 12, 0)


def test_a_recurring_guest_does_not_expire_weekly():
    heute = "2026-09-03"
    assert users.laeuft_wieder([3], None, heute)
    assert users.laeuft_wieder([3], "2026-12-31", heute)
    # Erst wenn auch das Datum vorbei ist, ist Schluss.
    assert not users.laeuft_wieder([3], "2026-09-01", heute)
    assert not users.laeuft_wieder([], None, heute)


# ── Über die API angelegt und geändert ───────────────────────────────────

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18180 }}
integrations:
  - integration: demo
users:
  - name: Stefan
    role: besitzer
    token: t-owner
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


def test_days_survive_create_update_and_reload(client):
    antwort = client.post(
        "/api/users",
        json={
            "name": "Putzhilfe",
            "role": "gast",
            "hours": {"from": "08:00", "to": "12:00"},
            "days": [3],
        },
        headers=auth("t-owner"),
    )
    assert antwort.status_code == 200, antwort.text
    assert antwort.json()["user"]["days"] == [3]

    antwort = client.put(
        "/api/users/Putzhilfe", json={"days": [1, 3]}, headers=auth("t-owner")
    )
    assert antwort.status_code == 200
    assert antwort.json()["user"]["days"] == [1, 3]

    # Und der Neustart vergisst sie nicht: Was editable_users speichert,
    # muss der Lade-Weg im Hub wieder aufnehmen.
    gespeichert = client.hub.users.editable_users()
    assert gespeichert[0]["days"] == [1, 3]
    # Leere Liste heisst wieder alle Tage.
    antwort = client.put(
        "/api/users/Putzhilfe", json={"days": []}, headers=auth("t-owner")
    )
    assert antwort.json()["user"]["days"] == []
