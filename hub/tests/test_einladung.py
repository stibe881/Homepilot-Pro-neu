"""Einladen mit Link und Passwort statt Token im Chat.

Der Fall: «Hier soll es nicht so einen langen Token geben. Es soll ein
Link erstellt werden und ein Passwort, das man festlegen muss.»

Bis dahin verschickte man eine Zeile mit Adresse, Name und Token – der
Hinweis daneben sagte selbst, dass das der Schlüssel zum Haus ist. Ein
Schlüssel, der einmal in einem Chat liegt, liegt dort für immer.
"""

import time

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import einladung
from homepilot.core.config import load_config
from homepilot.core.hub import Hub

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18190 }}
integrations:
  - integration: demo
users:
  - name: Stefan
    role: besitzer
    token: t-owner
  - name: Bine
    role: bewohner
    token: t-bine
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


def ausstellen(client, passwort="sommer2026", name="Bine"):
    return client.post(
        f"/api/users/{name}/einladung",
        json={"password": passwort},
        headers=auth("t-owner"),
    )


# ── Das Rechnen ──────────────────────────────────────────────────────────


def test_das_passwort_wird_nie_gespeichert():
    """Nur ein Abdruck – wer die hub.data liest, kann damit nichts anfangen."""
    zeile = einladung.neu("Bine", "sommer2026", 1000.0)
    assert "sommer2026" not in repr(zeile)
    assert zeile["hash"] != "sommer2026"
    assert einladung.stimmt(zeile, "sommer2026")
    assert not einladung.stimmt(zeile, "Sommer2026")


def test_kurze_passwoerter_sind_kein_schutz():
    assert einladung.passwort_haltbar("kurz")
    assert einladung.passwort_haltbar(" mit Leerzeichen ")
    assert einladung.passwort_haltbar("sommer2026") is None


def test_abgelaufen_gebraucht_verbraucht():
    jetzt = 1000.0
    offen = einladung.neu("Bine", "sommer2026", jetzt, minuten=10)
    assert einladung.zustand(offen, jetzt) == "offen"
    assert einladung.zustand(offen, jetzt + 11 * 60) == "abgelaufen"
    assert einladung.zustand({**offen, "used_at": jetzt}, jetzt) == "gebraucht"
    assert (
        einladung.zustand({**offen, "tries": einladung.MAX_VERSUCHE}, jetzt)
        == "verbraucht"
    )


def test_erledigtes_bleibt_kurz_als_auskunft_liegen():
    """Sonst liest der Empfänger «gibt es nicht» statt «abgelaufen».

    Und sucht den Fehler bei sich, statt um eine neue Einladung zu
    bitten. Nach der Gnadenfrist fliegt die Zeile weg – ein Abdruck hat
    in einer Datei nichts verloren, die nichts mehr tut.
    """
    jetzt = 1000.0 + einladung.GNADENFRIST
    rows = [
        einladung.neu("A", "sommer2026", jetzt, minuten=10, id_="offen"),
        einladung.neu("B", "sommer2026", jetzt - 3600, minuten=10, id_="eben_abgelaufen"),
        {**einladung.neu("C", "sommer2026", jetzt, id_="gebraucht"), "used_at": jetzt},
        einladung.neu("D", "sommer2026", 0.0, minuten=10, id_="uralt"),
    ]
    behalten = [row["id"] for row in einladung.aufraeumen(rows, jetzt)]
    assert behalten == ["offen", "eben_abgelaufen", "gebraucht"]

    # Weit genug danach ist auch die Auskunft vorbei. Zwei Fristen, weil
    # die offene Einladung erst in zehn Minuten abläuft und ihre Frist
    # erst danach zu laufen beginnt.
    spaeter = jetzt + 2 * einladung.GNADENFRIST + 1
    assert einladung.aufraeumen(rows, spaeter) == []


# ── Der ganze Weg ────────────────────────────────────────────────────────


def test_der_link_allein_oeffnet_nichts(client):
    antwort = ausstellen(client)
    assert antwort.status_code == 200
    link = antwort.json()["link"]
    assert "/einladung/" in link
    # Der Token steht nirgends im Link – genau darum geht es.
    assert "t-bine" not in link

    kennung = link.rsplit("/", 1)[-1]
    seite = client.get(f"/einladung/{kennung}")
    assert seite.status_code == 200
    assert "Passwort" in seite.text
    assert "t-bine" not in seite.text


def test_mit_dem_passwort_kommt_der_zugang(client):
    kennung = ausstellen(client).json()["link"].rsplit("/", 1)[-1]
    seite = client.post(f"/einladung/{kennung}", data={"password": "sommer2026"})
    assert seite.status_code == 200
    assert "t-bine" in seite.text
    assert "Bine" in seite.text


def test_ein_falsches_passwort_gibt_nichts_heraus(client):
    kennung = ausstellen(client).json()["link"].rsplit("/", 1)[-1]
    seite = client.post(f"/einladung/{kennung}", data={"password": "daneben"})
    assert seite.status_code == 401
    assert "t-bine" not in seite.text
    assert "stimmt nicht" in seite.text


def test_nach_zu_vielen_versuchen_ist_die_einladung_tot(client):
    """Eine kurze Kennung plus Passwort wäre ohne Deckel ratbar."""
    kennung = ausstellen(client).json()["link"].rsplit("/", 1)[-1]
    for _ in range(einladung.MAX_VERSUCHE):
        client.post(f"/einladung/{kennung}", data={"password": "daneben"})
    # Auch das richtige Passwort hilft jetzt nicht mehr.
    seite = client.post(f"/einladung/{kennung}", data={"password": "sommer2026"})
    assert seite.status_code in (410, 429)
    assert "t-bine" not in seite.text


def test_eine_einladung_gilt_genau_einmal(client):
    kennung = ausstellen(client).json()["link"].rsplit("/", 1)[-1]
    assert "t-bine" in client.post(
        f"/einladung/{kennung}", data={"password": "sommer2026"}
    ).text
    zweite = client.post(f"/einladung/{kennung}", data={"password": "sommer2026"})
    assert zweite.status_code == 410
    assert "t-bine" not in zweite.text


def test_eine_abgelaufene_einladung_sagt_das_auch(client):
    kennung = ausstellen(client).json()["link"].rsplit("/", 1)[-1]
    rows = client.hub.data.get("invites")
    rows[0]["expires"] = time.time() - 1
    client.hub.data.set("invites", rows)
    seite = client.get(f"/einladung/{kennung}")
    assert seite.status_code == 410
    assert "abgelaufen" in seite.text


def test_ein_zu_kurzes_passwort_wird_abgewiesen(client):
    antwort = ausstellen(client, passwort="abc")
    assert antwort.status_code == 400
    assert "Zeichen" in antwort.json()["detail"]


def test_nur_wer_benutzer_verwalten_darf_stellt_einladungen_aus(client):
    antwort = client.post(
        "/api/users/Bine/einladung",
        json={"password": "sommer2026"},
        headers=auth("t-bine"),
    )
    assert antwort.status_code in (401, 403)


def test_eine_neue_einladung_loest_die_alte_ab(client):
    """Zwei offene sind zwei Türen, von denen man eine vergisst."""
    erste = ausstellen(client).json()["link"].rsplit("/", 1)[-1]
    zweite = ausstellen(client, passwort="anderes2026").json()["link"].rsplit("/", 1)[-1]
    assert erste != zweite
    assert client.get(f"/einladung/{erste}").status_code == 410
    assert client.get(f"/einladung/{zweite}").status_code == 200


def test_eine_einladung_laesst_sich_zurueckziehen(client):
    kennung = ausstellen(client).json()["link"].rsplit("/", 1)[-1]
    assert client.get("/api/users/Bine/einladung", headers=auth("t-owner")).json()["open"]
    client.delete("/api/users/Bine/einladung", headers=auth("t-owner"))
    assert client.get(f"/einladung/{kennung}").status_code == 410


def test_der_zugang_traegt_die_aussenadresse(tmp_path):
    """Der gemeldete Fall: Maja löste die Einladung unterwegs ein und
    bekam als Zugang die Haus-IP - «so wird man von extern keinen
    Zugriff haben». Mit push.public_url gehört die Aussenadresse in die
    Zugangsdaten, dieselbe wie im Einladungs-Link."""
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        CONFIG.format(data_file=tmp_path / "data.json")
        + 'push: { public_url: "https://haus.example.ch" }\n'
    )
    hub = Hub(load_config(config_file))
    with TestClient(create_app(hub)) as client:
        antwort = ausstellen(client)
        assert antwort.json()["link"].startswith("https://haus.example.ch/einladung/")
        kennung = antwort.json()["link"].rsplit("/", 1)[-1]
        seite = client.post(f"/einladung/{kennung}", data={"password": "sommer2026"})
        assert seite.status_code == 200
        # html.escape macht aus den Anführungszeichen &quot; - geprüft
        # wird deshalb die Adresse selbst.
        assert "https://haus.example.ch" in seite.text
        assert "127.0.0.1" not in seite.text
