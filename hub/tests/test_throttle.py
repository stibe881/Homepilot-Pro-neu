"""Bremse für fehlgeschlagene Anmeldeversuche.

Im eigenen Netz entbehrlich – im offenen Internet klopft binnen Stunden
der erste Scanner an.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.core.throttle import Throttle, client_address

from .conftest import make_config


def test_a_few_typos_are_forgiven():
    """Wer sein Token einmal falsch abtippt, soll nicht ausgesperrt sein."""
    bremse = Throttle(limit=3, window=60, block=100)
    assert bremse.failed("1.2.3.4", now=1000) is False
    assert bremse.failed("1.2.3.4", now=1001) is False
    assert bremse.blocked_for("1.2.3.4", now=1002) == 0.0


def test_the_limit_locks_the_address_out():
    bremse = Throttle(limit=3, window=60, block=100)
    for moment in (1000, 1001, 1002):
        gesperrt = bremse.failed("1.2.3.4", now=moment)
    assert gesperrt is True
    assert bremse.blocked_for("1.2.3.4", now=1003) > 0
    # Und nach Ablauf ist wieder gut.
    assert bremse.blocked_for("1.2.3.4", now=1103) == 0.0


def test_only_the_guilty_address_is_locked_out():
    """Sonst sperrte ein Scanner die ganze Familie mit aus."""
    bremse = Throttle(limit=2, window=60, block=100)
    bremse.failed("1.2.3.4", now=1000)
    bremse.failed("1.2.3.4", now=1001)
    assert bremse.blocked_for("1.2.3.4", now=1002) > 0
    assert bremse.blocked_for("5.6.7.8", now=1002) == 0.0


def test_old_mistakes_do_not_add_up():
    """Ein Vertipper von heute morgen soll abends nicht mitzählen."""
    bremse = Throttle(limit=3, window=60, block=100)
    bremse.failed("1.2.3.4", now=1000)
    bremse.failed("1.2.3.4", now=1010)
    # Weit ausserhalb des Fensters: Der Zähler beginnt von vorne.
    assert bremse.failed("1.2.3.4", now=2000) is False
    assert bremse.failed("1.2.3.4", now=2001) is False
    assert bremse.blocked_for("1.2.3.4", now=2002) == 0.0


def test_a_valid_token_wipes_the_slate():
    bremse = Throttle(limit=3, window=60, block=100)
    bremse.failed("1.2.3.4", now=1000)
    bremse.failed("1.2.3.4", now=1001)
    bremse.succeeded("1.2.3.4")
    assert bremse.failed("1.2.3.4", now=1002) is False
    assert bremse.blocked_for("1.2.3.4", now=1003) == 0.0


class FakeRequest:
    def __init__(self, headers=None, host=None):
        self.headers = headers or {}
        self.client = type("C", (), {"host": host})() if host else None


def test_the_address_comes_from_the_proxy_header():
    """Hinter einem Reverse Proxy steht in request.client immer der Proxy –
    ohne diesen Kopf sperrte die Bremse ihn aus, und mit ihm das ganze
    Haus."""
    request = FakeRequest(
        headers={"x-forwarded-for": "203.0.113.9, 10.0.0.1"}, host="10.0.0.1"
    )
    assert client_address(request) == "203.0.113.9"

    # Ohne Proxy die direkte Adresse.
    assert client_address(FakeRequest(host="192.168.1.5")) == "192.168.1.5"
    # Und ohne alles kein Absturz.
    assert client_address(FakeRequest()) == "unbekannt"


def test_the_api_answers_429_after_too_many_wrong_tokens():
    """Zehn *verschiedene* Tokens sind ein Rateversuch."""
    hub = Hub(make_config(token="geheim"))
    with TestClient(create_app(hub)) as client:
        for nummer in range(10):
            response = client.get(
                "/api/entities", headers={"Authorization": f"Bearer falsch{nummer}"}
            )
        assert response.status_code == 401

        # Der nächste Versuch läuft in die Sperre – auch der mit dem
        # richtigen Token, denn die Adresse ist jetzt draussen.
        response = client.get(
            "/api/entities", headers={"Authorization": "Bearer geheim"}
        )
        assert response.status_code == 429
        assert "Retry-After" in response.headers


def test_the_same_dead_token_over_and_over_locks_nobody_out():
    """Eine App, die von ihrer abgelaufenen Sitzung nichts weiss, rät nicht.

    Der Fall aus dem Betrieb: Nach einer Umbenennung passte die Sitzung
    nicht mehr. Die App fragte im Takt weiter, nach zehn Anfragen war die
    Adresse gesperrt - und die Sperre gilt auch für die Anmeldemaske. Der
    Besitzer sah nach dem ersten Anmeldeversuch «Zu viele Fehlversuche»
    und kam nicht mehr in sein eigenes Haus.
    """
    hub = Hub(make_config(token="geheim"))
    with TestClient(create_app(hub)) as client:
        for _ in range(50):
            response = client.get(
                "/api/entities", headers={"Authorization": "Bearer tot"}
            )
            assert response.status_code == 401

        # Und der Weg zurück steht weiterhin offen.
        response = client.get(
            "/api/entities", headers={"Authorization": "Bearer geheim"}
        )
        assert response.status_code == 200


def test_a_valid_token_is_never_throttled():
    """Wer hereindarf, soll die App bedienen können, so oft er will."""
    hub = Hub(make_config(token="geheim"))
    with TestClient(create_app(hub)) as client:
        for _ in range(30):
            response = client.get(
                "/api/entities", headers={"Authorization": "Bearer geheim"}
            )
        assert response.status_code == 200
