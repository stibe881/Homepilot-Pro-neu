"""Ein Benutzer, der kein Mensch ist: das Wandtablet.

Es meldet sich wie eine Person an, hat aber keine Hosentasche. Eine
Push-Nachricht dorthin weckt niemanden – sie brummt nachts im Flur, und
gelesen hat sie keiner. Angesprochen werden möchte es auch nicht.
"""

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


def test_an_alle_heisst_an_alle_menschen():
    tokens = dienst().recipients([OWNER, TABLET], "all")
    assert tokens == ["ExponentPushToken[stefan]"]


def test_ausdruecklich_gemeint_kommt_es_trotzdem_an():
    # Wer die Nachricht wirklich an die Wand hängen will, spricht das
    # Gerät mit Namen an - dann ist es eine Entscheidung, kein Versehen.
    tokens = dienst().recipients([OWNER, TABLET], "Wandtablet Flur")
    assert tokens == ["ExponentPushToken[tablet]"]


def test_die_rolle_nimmt_es_nicht_mit():
    # «An alle Bewohner» meint die Menschen, nicht ihre Bildschirme.
    tokens = dienst().recipients([OWNER, TABLET], Role.RESIDENT)
    assert "ExponentPushToken[tablet]" not in tokens


def test_es_steht_nicht_in_der_empfaengerliste():
    hub = Hub(make_config(token="t-owner"))
    hub.users.users.append(TABLET)
    with TestClient(create_app(hub)) as client:
        namen = client.get(
            "/api/push/targets", headers={"Authorization": "Bearer t-owner"}
        ).json()["names"]
    assert "Wandtablet Flur" not in namen


def test_die_kennzeichnung_ueberlebt_das_speichern():
    daten = TABLET.as_dict()
    assert daten["shared"] is True
    # Und ein gewöhnlicher Benutzer bleibt gewöhnlich.
    assert OWNER.as_dict()["shared"] is False
