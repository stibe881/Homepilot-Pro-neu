"""Anmeldung mit E-Mail und Passwort.

Supabase wird hier nachgebaut: Die Tests sollen ohne Konto und ohne Netz
laufen und trotzdem prüfen, was der Hub daraus macht – wer hereindarf, wer
nicht, und was von einer Anmeldung übrig bleibt.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import supabase_auth
from homepilot.core.hub import Hub

from .conftest import make_config


class FakeAuth:
    """Ein Supabase, das tut, was der Test gerade braucht."""

    def __init__(self, url="https://x.supabase.co", anon_key="anon"):
        self.signed_up: list[tuple[str, str]] = []
        self.recovered: list[str] = []
        self.accounts = {"stefan@example.ch": "richtig"}
        self.unconfirmed: set[str] = set()

    async def sign_in(self, email, password):
        email = email.strip().lower()
        if self.accounts.get(email) != password:
            raise supabase_auth.AuthError("E-Mail-Adresse oder Passwort stimmen nicht.", 400)
        if email in self.unconfirmed:
            raise supabase_auth.AuthError("Noch nicht bestätigt.", 403)
        return {"id": "u1", "email": email, "confirmed": True, "access_token": "jwt"}

    async def sign_up(self, email, password):
        self.signed_up.append((email.strip().lower(), password))
        return {"id": "u2", "email": email, "confirmed": False, "access_token": ""}

    async def recover(self, email):
        self.recovered.append(email.strip().lower())


def make_auth_hub(monkeypatch, fake=None):
    fake = fake or FakeAuth()
    monkeypatch.setattr(supabase_auth, "SupabaseAuth", lambda *a, **k: fake)
    hub = Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
            supabase={"url": "https://x.supabase.co", "anon_key": "anon"},
        )
    )
    return hub, fake


def test_login_needs_an_address_that_the_house_knows(monkeypatch):
    """Ein Konto bei Supabase genügt nicht – jemand im Haus muss die
    Adresse eingetragen haben. Sonst käme jeder herein, der die Adresse
    des Hubs kennt und sich selbst ein Konto anlegt."""
    hub, _ = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        owner = {"Authorization": "Bearer geheim"}
        assert client.get("/api/auth/config").json() == {"password_login": True}

        # Noch ohne Eintrag: abgewiesen, obwohl das Passwort stimmt.
        refused = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig"},
        )
        assert refused.status_code == 403

        # Besitzer trägt die Adresse ein – das ist die Einladung.
        assert (
            client.put(
                "/api/users/Stefan/email",
                json={"email": "Stefan@Example.ch"},
                headers=owner,
            ).status_code
            == 200
        )

        ok = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig", "label": "iPhone"},
        )
        assert ok.status_code == 200
        token = ok.json()["token"]
        assert ok.json()["user"]["name"] == "Stefan"

        # Mit der Sitzung geht alles, was Stefan darf.
        assert (
            client.get(
                "/api/entities", headers={"Authorization": f"Bearer {token}"}
            ).status_code
            == 200
        )


def test_wrong_password_is_refused(monkeypatch):
    hub, _ = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        client.put(
            "/api/users/Stefan/email",
            json={"email": "stefan@example.ch"},
            headers={"Authorization": "Bearer geheim"},
        )
        response = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "falsch"},
        )
        assert response.status_code == 400


def test_registration_only_for_invited_addresses(monkeypatch):
    """Sonst verschickte der Hub auf Zuruf E-Mails an Fremde."""
    hub, fake = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        fremd = client.post(
            "/api/auth/register",
            json={"email": "fremd@example.ch", "password": "geheim12"},
        )
        assert fremd.status_code == 403
        assert fake.signed_up == []

        client.put(
            "/api/users/Stefan/email",
            json={"email": "stefan@example.ch"},
            headers={"Authorization": "Bearer geheim"},
        )
        ok = client.post(
            "/api/auth/register",
            json={"email": "stefan@example.ch", "password": "geheim12"},
        )
        assert ok.status_code == 200
        assert fake.signed_up == [("stefan@example.ch", "geheim12")]


def test_recover_says_the_same_thing_either_way(monkeypatch):
    hub, fake = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        known = client.post("/api/auth/recover", json={"email": "stefan@example.ch"})
        unknown = client.post("/api/auth/recover", json={"email": "niemand@example.ch"})
        assert known.json() == unknown.json()
        # Angestossen wird trotzdem – Supabase entscheidet, ob es etwas gibt.
        assert fake.recovered == ["stefan@example.ch", "niemand@example.ch"]


def test_logout_ends_only_this_session(monkeypatch):
    hub, _ = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        client.put(
            "/api/users/Stefan/email",
            json={"email": "stefan@example.ch"},
            headers={"Authorization": "Bearer geheim"},
        )
        first = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig", "label": "iPhone"},
        ).json()["token"]
        second = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig", "label": "iPad"},
        ).json()["token"]

        client.post("/api/auth/logout", headers={"Authorization": f"Bearer {first}"})
        assert (
            client.get(
                "/api/entities", headers={"Authorization": f"Bearer {first}"}
            ).status_code
            == 401
        )
        # Das andere Gerät bleibt angemeldet, und das feste Token auch.
        assert (
            client.get(
                "/api/entities", headers={"Authorization": f"Bearer {second}"}
            ).status_code
            == 200
        )
        assert (
            client.get(
                "/api/entities", headers={"Authorization": "Bearer t-stefan"}
            ).status_code
            == 200
        )


def test_revoke_all_sessions(monkeypatch):
    """Der Knopf für «Telefon verloren»."""
    hub, _ = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        client.put(
            "/api/users/Stefan/email",
            json={"email": "stefan@example.ch"},
            headers={"Authorization": "Bearer geheim"},
        )
        token = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig"},
        ).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/auth/sessions", headers=headers).json()["sessions"]
        client.delete("/api/auth/sessions", headers=headers)
        assert client.get("/api/entities", headers=headers).status_code == 401


def test_without_supabase_there_is_no_password_login():
    hub = Hub(make_config(token="geheim"))
    with TestClient(create_app(hub)) as client:
        assert client.get("/api/auth/config").json() == {"password_login": False}
        assert (
            client.post(
                "/api/auth/login", json={"email": "a@b.ch", "password": "x"}
            ).status_code
            == 503
        )


def test_error_text_translates_the_usual_suspects():
    from homepilot.core.supabase_auth import error_text

    assert "nicht bestätigt" in error_text(400, {"msg": "Email not confirmed"})
    assert "stimmen nicht" in error_text(400, {"msg": "Invalid login credentials"})
    assert "schon ein Konto" in error_text(422, {"msg": "User already registered"})
    assert "zu kurz" in error_text(422, {"msg": "Password should be at least 8 characters"})
    # Unbekanntes bleibt stehen, statt verschluckt zu werden.
    assert error_text(500, {"message": "boom"}) == "boom"


def test_sessions_expire_and_are_capped():
    import time

    from homepilot.core.sessions import MAX_AGE, PER_USER, prune

    now = time.time()
    rows = [{"user": "a", "seen": now - MAX_AGE - 10, "hash": "alt"}]
    assert prune(rows, now) == []

    many = [{"user": "a", "seen": now - index, "hash": str(index)} for index in range(20)]
    assert len(prune(many, now)) == PER_USER
