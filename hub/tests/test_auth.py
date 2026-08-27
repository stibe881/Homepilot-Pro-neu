"""Anmeldung mit E-Mail und Passwort.

Supabase wird hier nachgebaut: Die Tests sollen ohne Konto und ohne Netz
laufen und trotzdem prüfen, was der Hub daraus macht – wer hereindarf, wer
nicht, und was von einer Anmeldung übrig bleibt.
"""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from homepilot.api import create_app
from homepilot.core import supabase_auth
from homepilot.core.hub import Hub

from .conftest import make_config


class FakeAuth:
    """Ein Supabase, das tut, was der Test gerade braucht."""

    def __init__(self, url="https://x.supabase.co", anon_key="anon", service_key="srv"):
        self.invited: list[tuple[str, str]] = []
        self.recovered: list[str] = []
        self.passwords: list[tuple[str, str]] = []
        self.accounts = {"stefan@example.ch": "richtig"}
        self.unconfirmed: set[str] = set()
        self.can_invite = bool(service_key)

    async def sign_in(self, email, password):
        email = email.strip().lower()
        if self.accounts.get(email) != password:
            raise supabase_auth.AuthError("E-Mail-Adresse oder Passwort stimmen nicht.", 400)
        if email in self.unconfirmed:
            raise supabase_auth.AuthError("Noch nicht bestätigt.", 403)
        return {"id": "u1", "email": email, "confirmed": True, "access_token": "jwt"}

    async def invite(self, email, redirect_to=""):
        if not self.can_invite:
            raise supabase_auth.AuthError("Kein Dienstschlüssel.", 503)
        self.invited.append((email.strip().lower(), redirect_to))
        return {"id": "u2", "email": email.strip().lower()}

    async def set_password(self, access_token, password):
        if access_token != "ticket":
            raise supabase_auth.AuthError("Der Link ist abgelaufen.", 401)
        self.passwords.append((access_token, password))
        return {"email": "stefan@example.ch"}

    async def recover(self, email, redirect_to=""):
        self.recovered.append(email.strip().lower())


def make_auth_hub(monkeypatch, fake=None):
    fake = fake or FakeAuth()
    monkeypatch.setattr(supabase_auth, "SupabaseAuth", lambda *a, **k: fake)
    hub = Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
            supabase={
                "url": "https://x.supabase.co",
                "anon_key": "anon",
                "service_key": "srv",
            },
            push={"public_url": "https://haus.example.ch"},
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
        assert client.get("/api/auth/config").json() == {
            "password_login": True,
            "self_signup": False,
            "invite": True,
        }

        # Noch ohne Eintrag: abgewiesen, obwohl das Passwort stimmt.
        refused = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig"},
        )
        assert refused.status_code == 403

        # Besitzer trägt die Adresse ein.
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


def test_nobody_can_sign_up_on_their_own(monkeypatch):
    """Es gibt keine Selbstregistrierung – der Weg führt über den Besitzer.

    Sonst legte sich jeder, der die Adresse des Hubs kennt, ein Konto an,
    und der Hub verschickte auf Zuruf E-Mails an Fremde."""
    hub, fake = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        gone = client.post(
            "/api/auth/register",
            json={"email": "fremd@example.ch", "password": "geheim12"},
        )
        assert gone.status_code == 404
        assert fake.invited == []


def test_only_the_owner_invites_and_only_with_an_address(monkeypatch):
    hub, fake = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        owner = {"Authorization": "Bearer geheim"}

        # Ohne Anmeldung geht gar nichts.
        assert client.post("/api/users/Stefan/invite").status_code == 401

        # Eingetragen ist noch keine Adresse – dann gibt es nichts zu schicken.
        assert client.post("/api/users/Stefan/invite", headers=owner).status_code == 400
        assert fake.invited == []

        client.put(
            "/api/users/Stefan/email", json={"email": "stefan@example.ch"}, headers=owner
        )
        sent = client.post("/api/users/Stefan/invite", headers=owner)
        assert sent.status_code == 200
        # Der Link in der E-Mail führt auf die Seite des Hubs, nicht zu Supabase.
        assert fake.invited == [
            ("stefan@example.ch", "https://haus.example.ch/einladung")
        ]

        # Unbekannte Person: 404, und nichts verschickt.
        assert client.post("/api/users/Niemand/invite", headers=owner).status_code == 404
        assert len(fake.invited) == 1


def test_password_is_set_with_the_ticket_from_the_mail(monkeypatch):
    """Wer das Ticket hat, hat das Postfach – mehr braucht es nicht."""
    hub, fake = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        # Zu kurz wird gar nicht erst weitergereicht.
        short = client.post(
            "/api/auth/password", json={"access_token": "ticket", "password": "kurz"}
        )
        assert short.status_code == 400
        assert fake.passwords == []

        # Falsches oder abgelaufenes Ticket.
        assert (
            client.post(
                "/api/auth/password", json={"access_token": "alt", "password": "geheim12"}
            ).status_code
            == 401
        )

        ok = client.post(
            "/api/auth/password", json={"access_token": "ticket", "password": "geheim12"}
        )
        assert ok.status_code == 200
        assert fake.passwords == [("ticket", "geheim12")]


def test_the_invite_page_is_reachable_without_login(monkeypatch):
    """Der Link landet im Browser, oft auf einem Gerät ohne App."""
    hub, _ = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        page = client.get("/einladung")
        assert page.status_code == 200
        assert "Passwort setzen" in page.text
        # Die Seite selbst kennt kein Geheimnis: weder Projekt noch
        # Schlüssel. Sie redet nur mit dem Hub.
        assert "x.supabase.co" not in page.text
        assert "/api/auth/password" in page.text


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
        assert client.get("/api/auth/config").json() == {
            "password_login": False,
            "self_signup": False,
            "invite": False,
        }
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
    assert "service_key" in error_text(403, {"msg": "User not allowed", "code": "not_admin"})
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


def test_the_session_also_opens_the_websocket(monkeypatch):
    """Sonst kommt man durch die Anmeldung und die App bleibt «getrennt».

    Der Zustandskanal ist die eigentliche Verbindung – wer sich anmeldet,
    aber keinen Snapshot bekommt, sieht eine tote App.
    """
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

        with client.websocket_connect(f"/ws?token={token}") as socket:
            first = socket.receive_json()
        assert first["type"] == "snapshot"
        assert first["user"]["name"] == "Stefan"

        # Eine beendete Sitzung kommt auch nicht mehr durch.
        client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f"/ws?token={token}") as socket:
                socket.receive_json()


def test_a_rename_does_not_lock_the_owner_out(monkeypatch):
    """«Ich habe meinen Namen von Stefan in stibe geändert – seitdem habe
    ich keinen Zugriff mehr.»

    Die Sitzung merkte sich nur den Namen. Nach einer Umbenennung in der
    config.yaml zeigte sie auf einen Benutzer, den es nicht mehr gab: Jede
    Anfrage bekam «Ungültiges Token», auf allen Geräten gleichzeitig. Die
    Adresse dagegen bleibt dieselbe – und über sie findet der Hub zurück.
    """
    hub, _ = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        owner = {"Authorization": "Bearer geheim"}
        client.put(
            "/api/users/Stefan/email", json={"email": "stefan@example.ch"}, headers=owner
        )
        angemeldet = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig", "label": "iPhone"},
        )
        token = angemeldet.json()["token"]
        sitzung = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/me", headers=sitzung).json()["name"] == "Stefan"

        # Wie nach einem Neustart mit geänderter config.yaml.
        hub.users.by_name("Stefan").name = "stibe"

        antwort = client.get("/api/me", headers=sitzung)
        assert antwort.status_code == 200
        assert antwort.json()["name"] == "stibe"
        assert antwort.json()["role"] == "besitzer"

        # Und die Sitzung steht danach wieder auf dem neuen Namen, statt
        # bei jeder Anfrage den Umweg über die Adresse zu nehmen.
        assert hub.sessions.user_for(token) == "stibe"


def test_a_dead_session_does_not_block_the_login(monkeypatch):
    """Die App fragt im Takt weiter, auch wenn ihre Sitzung nichts mehr taugt.

    Zehn solche Anfragen sperrten die Adresse – und die Sperre gilt auch
    für die Anmeldemaske. Genau daraus wurde «Zu viele Fehlversuche» beim
    ersten Anmeldeversuch.
    """
    hub, _ = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        owner = {"Authorization": "Bearer geheim"}
        client.put(
            "/api/users/Stefan/email", json={"email": "stefan@example.ch"}, headers=owner
        )
        for _ in range(30):
            assert (
                client.get(
                    "/api/me", headers={"Authorization": "Bearer tote-sitzung"}
                ).status_code
                == 401
            )

        ok = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig"},
        )
        assert ok.status_code == 200
