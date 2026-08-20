"""Regeln für die eingebauten Wächter-Nachrichten.

Der Fall: Die Erinnerung an die volle Waschmaschine soll nach vier statt
zwei Stunden kommen, die Frostwarnung interessiert nicht – bisher stand
beides fest im Quelltext. Jetzt sind es Regeln unter Abläufe → Push.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import notifyrules
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

from .conftest import make_config


def test_defaults_apply_without_storage():
    """Ein frischer Hub meldet wie bisher – niemand muss etwas speichern."""
    rules = notifyrules.effective(None)
    assert set(rules) == {r["key"] for r in notifyrules.RULES}
    assert all(rule["enabled"] for rule in rules.values())
    assert rules["outage"]["params"]["minutes"] == 2
    assert rules["frost"]["params"]["below"] == 3.0
    assert rules["disk"]["params"]["percent"] == 85


def test_broken_storage_falls_back_instead_of_crashing():
    """Gespeicherter Unsinn darf den Hub nicht am Melden hindern."""
    rules = notifyrules.effective(
        [
            {"key": "open", "enabled": True, "params": {"hours": 99}},
            {"key": "frost", "params": {"below": "kalt"}},
            {"key": "quatsch", "enabled": False},
            "kein_dict",
        ]
    )
    # In die Grenzen gezwungen bzw. auf die Vorgabe zurück.
    assert rules["open"]["params"]["hours"] == 24
    assert rules["frost"]["params"]["below"] == 3.0
    # Unbekanntes verschwindet, alles Bekannte bleibt vorhanden.
    assert "quatsch" not in rules
    assert rules["leak"]["enabled"] is True


def test_store_replaces_and_validates():
    stored = notifyrules.store([], "appliance", True, {"hours": 4})
    stored = notifyrules.store(stored, "appliance", False, {"hours": 6})
    assert stored == [{"key": "appliance", "enabled": False, "params": {"hours": 6.0}}]

    try:
        notifyrules.store([], "unbekannt", True, {})
        raise AssertionError("unbekannte Regel wurde angenommen")
    except ValueError:
        pass


def _down_entity():
    return type(
        "E",
        (),
        {
            "id": "hue.lampe",
            "name": "Lampe",
            "kind": "light",
            "integration": "hue",
            "available": False,
            "state": {},
        },
    )()


async def test_disabled_rule_suppresses_the_push_but_not_the_bookkeeping():
    """Abgeschaltet heisst still – der System-Screen zeigt den Ausfall
    trotzdem, sonst würde die Regel zum blinden Fleck."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[str] = []

        async def fake_send(tokens, title, body, data=None):
            sent.append(title)
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")
        hub.data.set("notify_rules", notifyrules.store([], "outage", False, {}))

        hub.registry.all = lambda: [_down_entity()]  # type: ignore[assignment]
        await hub.watchdog.check()
        await hub.watchdog.check()
        assert "hue" in hub.watchdog.down_since
        assert sent == []
    finally:
        await hub.stop()


async def test_a_changed_threshold_takes_effect():
    """Karenz auf eine Minute → schon die erste Fehlrunde meldet."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[str] = []

        async def fake_send(tokens, title, body, data=None):
            sent.append(title)
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")
        hub.data.set(
            "notify_rules", notifyrules.store([], "outage", True, {"minutes": 1})
        )

        hub.registry.all = lambda: [_down_entity()]  # type: ignore[assignment]
        await hub.watchdog.check()
        assert sent and "hue" in sent[0]
    finally:
        await hub.stop()


def _hub():
    return Hub(
        make_config(
            token="geheim",
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t-stefan"},
                {"name": "Besuch", "role": "gast", "token": "t-gast"},
            ],
        )
    )


def test_rules_over_the_api():
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}

        listed = client.get("/api/notifyrules", headers=headers).json()["rules"]
        assert [r["key"] for r in listed] == [r["key"] for r in notifyrules.RULES]
        # Metadaten für die App: Grenzen und aktueller Wert je Parameter.
        disk = next(r for r in listed if r["key"] == "disk")
        assert disk["params"][0]["value"] == 85
        assert disk["params"][0]["min"] == 50

        # Ändern: aus, und die Schwelle wird in die Grenzen gezwungen.
        answer = client.put(
            "/api/notifyrules/disk",
            json={"enabled": False, "params": {"percent": 200}},
            headers=headers,
        )
        assert answer.status_code == 200
        disk = next(r for r in answer.json()["rules"] if r["key"] == "disk")
        assert disk["enabled"] is False
        assert disk["params"][0]["value"] == 99
        # Der laufende Wächter kennt die Änderung sofort.
        assert hub.watchdog.rules["disk"]["enabled"] is False

        # Unbekannte Regel → 404, kein stiller Neueintrag.
        assert (
            client.put(
                "/api/notifyrules/quatsch", json={"enabled": False}, headers=headers
            ).status_code
            == 404
        )

        # Ein Gast sieht die Regeln, darf sie aber nicht ändern.
        gast = {"Authorization": "Bearer t-gast"}
        assert client.get("/api/notifyrules", headers=gast).status_code == 200
        assert (
            client.put(
                "/api/notifyrules/disk", json={"enabled": True}, headers=gast
            ).status_code
            == 403
        )
