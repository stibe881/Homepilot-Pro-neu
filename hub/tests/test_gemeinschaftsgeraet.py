"""Ein Benutzer, der kein Mensch ist: das Wandtablet.

Es meldet sich wie eine Person an, gehört aber allen. Zuerst war es von
Push-Nachrichten ausgenommen – die Überlegung war, dass ein Brummen im
Flur nachts niemanden weckt. Der Haushalt sieht das anders: Genau dort
soll die Meldung stehen, gross und für jeden lesbar, der vorbeigeht.
Darum bekommt das Gerät alles wie ein Bewohner und steht auch in der
Empfängerliste.
"""

import time

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.core.push import PushService
from homepilot.core.users import Role, User

from .conftest import make_config

OWNER = User(name="Stefan", role=Role.OWNER, token="t-owner")
TABLET = User(name="Wandtablet Flur", role=Role.RESIDENT, token="t-tablet", shared=True)


def dienst() -> PushService:
    push = PushService()
    push.register("ExponentPushToken[stefan]", "Stefan")
    push.register("ExponentPushToken[tablet]", "Wandtablet Flur")
    return push


def test_an_alle_erreicht_auch_das_wandtablet():
    tokens = dienst().recipients([OWNER, TABLET], "all")
    assert tokens == ["ExponentPushToken[stefan]", "ExponentPushToken[tablet]"]


def test_ausdruecklich_gemeint_kommt_es_ebenfalls_an():
    tokens = dienst().recipients([OWNER, TABLET], "Wandtablet Flur")
    assert tokens == ["ExponentPushToken[tablet]"]


def test_die_rolle_nimmt_es_mit():
    # Das Tablet ist als Bewohner angemeldet – «an alle Bewohner» meint es
    # also mit, so wie jedes andere angemeldete Gerät.
    tokens = dienst().recipients([OWNER, TABLET], Role.RESIDENT)
    assert tokens == ["ExponentPushToken[tablet]"]


def test_es_steht_in_der_empfaengerliste():
    hub = Hub(make_config(token="t-owner"))
    # add() statt users.append(): users gibt eine Kopie zurück, ein
    # append darauf verpufft lautlos.
    hub.users.add(TABLET)
    with TestClient(create_app(hub)) as client:
        namen = client.get(
            "/api/push/targets", headers={"Authorization": "Bearer t-owner"}
        ).json()["names"]
    assert "Wandtablet Flur" in namen


def test_die_kennzeichnung_ueberlebt_das_speichern():
    daten = TABLET.as_dict()
    assert daten["shared"] is True
    # Und ein gewöhnlicher Benutzer bleibt gewöhnlich.
    assert OWNER.as_dict()["shared"] is False


# ── Was am Wandtablet anders ist ─────────────────────────────────────────
# Es hängt im Flur, immer offen, für jeden erreichbar. Daraus folgt
# dreierlei: Die Alarm-PIN ist Pflicht, die Sitzung läuft nie ab, und vor
# den persönlichen Bereichen steht ein Riegel.

from homepilot.core import bereich, sessions


def test_die_sitzung_des_wandtablets_laeuft_nicht_ab():
    alt = time.time() - 5 * sessions.MAX_AGE
    zeilen = [
        {"hash": "a", "user": "Wandtablet Flur", "seen": alt, "keep": True},
        {"hash": "b", "user": "Stefan", "seen": alt},
    ]
    uebrig = sessions.prune(zeilen)
    assert [row["user"] for row in uebrig] == ["Wandtablet Flur"]


def test_eine_gewoehnliche_sitzung_laeuft_weiterhin_ab():
    frisch = {"hash": "c", "user": "Stefan", "seen": time.time()}
    assert sessions.prune([frisch]) == [frisch]


def _alarm_hub() -> Hub:
    return Hub(
        make_config(
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
                {
                    "name": "Wandtablet Flur",
                    "role": "bewohner",
                    "token": "t-tablet",
                    "shared": True,
                },
            ],
            integrations=[{"integration": "demo"}, {"integration": "alarm"}],
        )
    )


def test_ohne_pin_darf_das_wandtablet_nicht_entschaerfen():
    # Der gefährliche Fall: keine PIN gesetzt, also lief die Prüfung bisher
    # sofort durch - ausgerechnet an dem Gerät, das im Flur hängt.
    with TestClient(create_app(_alarm_hub())) as client:
        antwort = client.post(
            "/api/alarm/disarm", json={}, headers={"Authorization": "Bearer t-tablet"}
        )
        assert antwort.status_code == 403
        assert "PIN" in antwort.json()["detail"]
        # Für ein Telefon bleibt es wie bisher.
        assert (
            client.post(
                "/api/alarm/disarm",
                json={},
                headers={"Authorization": "Bearer t-owner"},
            ).status_code
            == 200
        )


def test_auch_die_kachel_auf_der_startseite_verlangt_die_pin():
    # Der kurze Weg: Die Alarm-Kachel schaltet mit «toggle» um, ohne je
    # ein PIN-Feld gezeigt zu haben. Ohne Prüfung führte er an der PIN
    # vorbei - und es ist der Weg, den man nimmt.
    hub = _alarm_hub()
    with TestClient(create_app(hub)) as client:
        tablet = {"Authorization": "Bearer t-tablet"}
        antwort = client.post(
            "/api/entities/alarm.anlage/command",
            json={"command": "disarm"},
            headers=tablet,
        )
        assert antwort.status_code == 500
        assert "PIN" in antwort.json()["detail"]


def test_mit_gesetzter_pin_entschaerft_auch_das_wandtablet():
    with TestClient(create_app(_alarm_hub())) as client:
        stefan = {"Authorization": "Bearer t-owner"}
        assert (
            client.put("/api/alarm/pin", json={"pin": "2580"}, headers=stefan).status_code
            == 200
        )
        tablet = {"Authorization": "Bearer t-tablet"}
        assert (
            client.post(
                "/api/alarm/disarm", json={"pin": "2580"}, headers=tablet
            ).status_code
            == 200
        )


def test_der_riegel_vor_den_persoenlichen_bereichen():
    eintrag = bereich.make_entry("1234")
    assert bereich.matches(eintrag, "1234")
    assert not bereich.matches(eintrag, "1235")
    # Der Wert selbst steht nirgends.
    assert "1234" not in str(eintrag)


def test_das_passwort_wird_nie_zurueckgegeben():
    tablet = User(name="Tablet", role=Role.RESIDENT, token="t", shared=True)
    tablet.area_lock = bereich.make_entry("geheim")
    daten = tablet.as_dict()
    assert daten["area_locked"] is True
    assert "area_lock" not in daten
    assert User(name="S", role=Role.OWNER, token="x").as_dict()["area_locked"] is False


def test_zu_kurzes_passwort_wird_abgelehnt():
    with pytest.raises(ValueError):
        bereich.check_length("123")
    assert bereich.check_length("  1234  ") == "1234"


def test_der_admin_vergibt_das_passwort_und_das_geraet_pruefet_es():
    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        stefan = {"Authorization": "Bearer t-owner"}
        angelegt = client.post(
            "/api/users",
            json={"name": "Wandtablet", "role": "bewohner", "shared": True},
            headers=stefan,
        )
        assert angelegt.status_code == 200
        tablet = {"Authorization": "Bearer " + angelegt.json()["user"]["token"]}

        # Ohne Riegel steht alles offen.
        assert client.post("/api/areas/unlock", json={}, headers=tablet).json()["ok"]

        # Zu kurz wird abgelehnt, mit einem lesbaren Grund.
        kurz = client.put(
            "/api/users/Wandtablet", json={"area_password": "12"}, headers=stefan
        )
        assert kurz.status_code == 400

        gesetzt = client.put(
            "/api/users/Wandtablet", json={"area_password": "Flur2024"}, headers=stefan
        )
        assert gesetzt.status_code == 200
        assert gesetzt.json()["user"]["area_locked"] is True
        # Das Passwort selbst kommt nie zurück.
        assert "Flur2024" not in gesetzt.text

        assert (
            client.post(
                "/api/areas/unlock", json={"password": "falsch"}, headers=tablet
            ).status_code
            == 403
        )
        assert client.post(
            "/api/areas/unlock", json={"password": "Flur2024"}, headers=tablet
        ).json()["ok"]

        # Und wieder abnehmen lässt er sich auch.
        weg = client.put(
            "/api/users/Wandtablet", json={"area_password": ""}, headers=stefan
        )
        assert weg.json()["user"]["area_locked"] is False


def test_die_kennzeichnung_ueberlebt_den_neustart(tmp_path):
    # Der stille Fall: Beim Anlegen wird alles gespeichert, beim Laden
    # fielen `shared` und der Riegel unter den Tisch. Nach dem nächsten
    # Neustart war das Wandtablet wieder eine Person - begrüsst, ohne
    # PIN-Zwang, mit offener Einkaufsliste im Flur.
    daten = tmp_path / "hub.json"
    erste = Hub(make_config(token="t-owner", data_file=str(daten)))
    # Erst dadurch schreibt der Hub Benutzeränderungen mit.
    erste._load_stored_users()
    erste.users.add(
        User(name="Wandtablet", role=Role.RESIDENT, token="t-x", editable=True, shared=True)
    )
    erste.users.update("Wandtablet", area_password="Flur2024")
    erste.data.flush()

    zweite = Hub(make_config(token="t-owner", data_file=str(daten)))
    zweite._load_stored_users()
    wieder = zweite.users.by_name("Wandtablet")
    assert wieder is not None
    assert wieder.shared is True
    assert bereich.matches(wieder.area_lock, "Flur2024")
