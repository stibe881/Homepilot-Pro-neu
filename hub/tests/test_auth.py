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
        # Kein Internet, DNS weg, Supabase down - wie der 503, den
        # supabase_auth._send aus einem Netzfehler macht.
        self.down = False

    async def sign_in(self, email, password):
        if self.down:
            raise supabase_auth.AuthError(
                "Der Anmeldedienst ist nicht erreichbar.", 503
            )
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


# ── Punkt 234 der Werkbank: lokaler Rückfall bei Supabase-Ausfall ────────


def eingetragen_und_einmal_online_angemeldet(client):
    """Adresse eintragen und einmal online anmelden - führt den Hash nach."""
    client.put(
        "/api/users/Stefan/email",
        json={"email": "stefan@example.ch"},
        headers={"Authorization": "Bearer geheim"},
    )
    ok = client.post(
        "/api/auth/login",
        json={"email": "stefan@example.ch", "password": "richtig", "label": "iPhone"},
    )
    assert ok.status_code == 200
    return ok.json()["token"]


def test_login_still_works_with_the_right_password_while_supabase_is_down(monkeypatch):
    """«Antwortet Supabase nicht, kommt niemand mit Passwort ins Haus.»

    Der Hub kennt seine Benutzer selbst: Nach einer erfolgreichen
    Online-Anmeldung liegt der Hash lokal, und im Ausfall prüft der Hub
    dagegen und stellt eine ganz normale Sitzung aus."""
    hub, fake = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        eingetragen_und_einmal_online_angemeldet(client)
        fake.down = True
        ok = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig", "label": "iPad"},
        )
        assert ok.status_code == 200
        token = ok.json()["token"]
        assert ok.json()["user"]["name"] == "Stefan"
        # Eine normale Sitzung: Damit geht alles, was Stefan darf.
        assert (
            client.get(
                "/api/entities", headers={"Authorization": f"Bearer {token}"}
            ).status_code
            == 200
        )


def test_the_stored_fallback_is_a_salted_hash_and_never_the_password(monkeypatch):
    hub, _ = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        eingetragen_und_einmal_online_angemeldet(client)
    rows = hub.data.get("emails")
    entry = next(row["passwort"] for row in rows if row["email"] == "stefan@example.ch")
    assert entry["salt"] and entry["hash"]
    import json

    assert "richtig" not in json.dumps(rows)


def test_a_wrong_password_is_refused_even_while_supabase_is_down(monkeypatch):
    """Der Rückfall ist kein Hintertürchen: Das Passwort muss stimmen."""
    hub, fake = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        eingetragen_und_einmal_online_angemeldet(client)
        fake.down = True
        refused = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "falsch"},
        )
        assert refused.status_code == 401


def test_without_a_stored_hash_an_outage_stays_an_outage(monkeypatch):
    """Wer sich nie online angemeldet hat, hat keinen lokalen Hash - dann
    bleibt die ehrliche Auskunft: Der Anmeldedienst ist nicht erreichbar."""
    hub, fake = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        client.put(
            "/api/users/Stefan/email",
            json={"email": "stefan@example.ch"},
            headers={"Authorization": "Bearer geheim"},
        )
        fake.down = True
        antwort = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig"},
        )
        assert antwort.status_code == 503


def test_a_supabase_rejection_does_not_fall_back_to_the_local_hash(monkeypatch):
    """Supabase hat entschieden - sonst bliebe ein dort zurückgesetztes
    Passwort über den lokalen Hash ewig gültig."""
    hub, fake = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        eingetragen_und_einmal_online_angemeldet(client)
        # Passwort bei Supabase geändert (z.B. über «Passwort vergessen»):
        # Das alte stimmt lokal noch, Supabase lehnt es ab.
        fake.accounts["stefan@example.ch"] = "neu-und-anders"
        vorher = len(hub.sessions.list_for("Stefan"))
        refused = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig"},
        )
        assert refused.status_code == 400
        # Kein lokaler Zweitversuch: keine neue Sitzung entstanden.
        assert len(hub.sessions.list_for("Stefan")) == vorher


def test_a_disabled_user_stays_out_even_during_an_outage(monkeypatch):
    hub, fake = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        eingetragen_und_einmal_online_angemeldet(client)
        hub.users.by_name("Stefan").enabled = False
        fake.down = True
        refused = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig"},
        )
        assert refused.status_code == 403


def test_config_offers_password_login_from_the_stored_hash_alone(monkeypatch):
    """Fällt Supabase sogar aus der Konfiguration, bleibt die Anmeldemaske
    offen, solange nachgeführte Hashes da sind - und die Anmeldung geht."""
    hub, _ = make_auth_hub(monkeypatch)
    with TestClient(create_app(hub)) as client:
        eingetragen_und_einmal_online_angemeldet(client)
        hub.config.supabase = {}
        assert client.get("/api/auth/config").json()["password_login"] is True
        ok = client.post(
            "/api/auth/login",
            json={"email": "stefan@example.ch", "password": "richtig"},
        )
        assert ok.status_code == 200


# ── Punkt 244 der Werkbank: das eigene Konto verwalten ───────────────────


def make_local_hub():
    """Ein Hub ganz ohne Supabase - Anmeldung nur mit Name und Passwort."""
    return Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
        )
    )


def lokal_anmelden(client, name, passwort, label):
    antwort = client.post(
        "/api/auth/login", json={"email": name, "password": passwort, "label": label}
    )
    assert antwort.status_code == 200
    return antwort.json()["token"]


def test_a_password_change_ends_the_other_sessions_but_keeps_this_one():
    hub = make_local_hub()
    with TestClient(create_app(hub)) as client:
        owner = {"Authorization": "Bearer geheim"}
        client.post(
            "/api/users",
            json={"name": "Levin", "role": "bewohner", "password": "start1234"},
            headers=owner,
        )
        iphone = lokal_anmelden(client, "Levin", "start1234", "iPhone")
        ipad = lokal_anmelden(client, "Levin", "start1234", "iPad")

        gewechselt = client.post(
            "/api/auth/passwort-wechsel",
            json={"old": "start1234", "new": "eigenes1234"},
            headers={"Authorization": f"Bearer {iphone}"},
        )
        assert gewechselt.status_code == 200
        assert gewechselt.json()["revoked"] == 1

        # Das andere Gerät ist draussen, das eigene bleibt drin.
        assert (
            client.get("/api/me", headers={"Authorization": f"Bearer {ipad}"}).status_code
            == 401
        )
        assert (
            client.get(
                "/api/me", headers={"Authorization": f"Bearer {iphone}"}
            ).status_code
            == 200
        )

        # Das alte Passwort taugt nicht mehr, das neue schon - und die
        # Wechsel-Pflicht des Initialpassworts ist erledigt.
        assert (
            client.post(
                "/api/auth/login", json={"email": "Levin", "password": "start1234"}
            ).status_code
            == 401
        )
        wieder = client.post(
            "/api/auth/login", json={"email": "Levin", "password": "eigenes1234"}
        )
        assert wieder.status_code == 200
        assert wieder.json()["must_change_password"] is False


def test_the_sessions_list_marks_the_current_device():
    hub = make_local_hub()
    with TestClient(create_app(hub)) as client:
        owner = {"Authorization": "Bearer geheim"}
        client.post(
            "/api/users",
            json={"name": "Levin", "role": "bewohner", "password": "start1234"},
            headers=owner,
        )
        iphone = lokal_anmelden(client, "Levin", "start1234", "iPhone")
        lokal_anmelden(client, "Levin", "start1234", "iPad")

        rows = client.get(
            "/api/auth/sessions", headers={"Authorization": f"Bearer {iphone}"}
        ).json()["sessions"]
        assert len(rows) == 2
        assert all(row["label"] and row["created"] and row["seen"] for row in rows)
        assert all(row["id"] for row in rows)
        # Genau die eigene ist markiert - sonst räumt man in «Meine
        # Geräte» das Gerät in der eigenen Hand mit ab.
        assert [row["label"] for row in rows if row["current"]] == ["iPhone"]


def test_a_single_session_can_be_ended_by_its_id():
    hub = make_local_hub()
    with TestClient(create_app(hub)) as client:
        owner = {"Authorization": "Bearer geheim"}
        client.post(
            "/api/users",
            json={"name": "Levin", "role": "bewohner", "password": "start1234"},
            headers=owner,
        )
        iphone = lokal_anmelden(client, "Levin", "start1234", "iPhone")
        ipad = lokal_anmelden(client, "Levin", "start1234", "iPad")

        rows = client.get(
            "/api/auth/sessions", headers={"Authorization": f"Bearer {iphone}"}
        ).json()["sessions"]
        fremd = next(row["id"] for row in rows if not row["current"])
        beendet = client.delete(
            f"/api/auth/sessions/{fremd}",
            headers={"Authorization": f"Bearer {iphone}"},
        )
        assert beendet.status_code == 200
        assert (
            client.get("/api/me", headers={"Authorization": f"Bearer {ipad}"}).status_code
            == 401
        )
        assert (
            client.get(
                "/api/me", headers={"Authorization": f"Bearer {iphone}"}
            ).status_code
            == 200
        )


def test_you_can_only_end_your_own_sessions():
    """Die Kennung allein genügt absichtlich nicht - sie muss zu einer
    eigenen Sitzung gehören."""
    hub = make_local_hub()
    with TestClient(create_app(hub)) as client:
        owner = {"Authorization": "Bearer geheim"}
        for name in ("Levin", "Lina"):
            client.post(
                "/api/users",
                json={"name": name, "role": "bewohner", "password": "start1234"},
                headers=owner,
            )
        levin = lokal_anmelden(client, "Levin", "start1234", "iPhone")
        lina = lokal_anmelden(client, "Lina", "start1234", "iPad")

        lina_sid = client.get(
            "/api/auth/sessions", headers={"Authorization": f"Bearer {lina}"}
        ).json()["sessions"][0]["id"]
        verboten = client.delete(
            f"/api/auth/sessions/{lina_sid}",
            headers={"Authorization": f"Bearer {levin}"},
        )
        assert verboten.status_code == 404
        assert (
            client.get("/api/me", headers={"Authorization": f"Bearer {lina}"}).status_code
            == 200
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


def test_an_orphaned_address_is_written_into_the_log(monkeypatch, caplog):
    """Eine Adresse, die auf einen Namen zeigt, den es nicht mehr gibt.

    Der Fall aus dem Betrieb: In der config.yaml aus «Stefan» ein «stibe»
    gemacht - die Adressen liegen aber getrennt und nach Namen ab. Beim
    Anmelden kam danach nur «Diese Adresse ist im Haus nicht freigegeben»,
    und dass das eine verwaiste Zeile in der Datendatei war, stand
    nirgends.
    """
    import logging

    hub, _ = make_auth_hub(monkeypatch)
    hub.data.set("emails", [{"name": "Stefan", "email": "stefan@example.ch"}])
    hub.users.by_name("Stefan").name = "stibe"
    with caplog.at_level(logging.WARNING):
        hub._load_stored_users()

    meldung = " ".join(record.getMessage() for record in caplog.records)
    assert "stefan@example.ch" in meldung
    assert "Stefan" in meldung
    # Und die Anmeldung geht wieder, sobald die Adresse am neuen Namen hängt.
    hub.users.set_email("stibe", "stefan@example.ch")
    assert hub.users.by_email("stefan@example.ch").name == "stibe"
