"""Der Einrichtungs-Code muss genau das enthalten, was die App liest."""

import json

from homepilot.core.users import Role, User, UserRegistry
from homepilot.qr import render, setup_hint, setup_payload


def test_payload_has_the_fields_the_app_expects():
    raw = setup_payload("192.168.1.42", 8123, "geheim", "Stefan")
    data = json.loads(raw)
    # Siehe app/src/components/QrScanner.tsx: parseSetup()
    assert data == {
        "url": "http://192.168.1.42:8123",
        "token": "geheim",
        "name": "Stefan",
    }


def test_wildcard_host_is_replaced_by_a_reachable_address():
    """0.0.0.0 hilft dem Telefon nicht – da muss die echte Adresse rein."""
    data = json.loads(setup_payload("0.0.0.0", 8123, "t", "S"))
    assert "0.0.0.0" not in data["url"]
    assert data["url"].startswith("http://")


def test_hint_contains_a_drawn_code():
    users = UserRegistry([User(name="Stefan", role=Role.OWNER, token="geheim")])
    text = setup_hint(users, "0.0.0.0", 8123)
    assert "Stefan" in text
    # Halbblock-Zeichen: der Code wurde tatsächlich gezeichnet.
    assert "█" in text or "▀" in text


def test_hint_without_users_explains_open_access():
    text = setup_hint(UserRegistry([], open_access=True), "0.0.0.0", 8123)
    assert "offen" in text


def test_render_without_the_package_returns_none(monkeypatch):
    """Ohne qrcode soll der Hub starten, nur ohne Bild."""
    import builtins

    original = builtins.__import__

    def blocked(name, *args, **kwargs):
        if name == "qrcode":
            raise ImportError
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", blocked)
    assert render("test") is None
