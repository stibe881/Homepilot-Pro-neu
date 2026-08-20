"""Küchen-Timer und Gäste-WLAN."""

import time

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.qr import wifi_payload

from .conftest import make_config


def test_wifi_payload_escapes_special_characters():
    assert (
        wifi_payload("Familie Gross", "ge;heim:12")
        == "WIFI:T:WPA;S:Familie Gross;P:ge\;heim\\:12;;"
    )
    assert "H:true;" in wifi_payload("Netz", "pw", hidden=True)


def test_wifi_payload_open_network_for_captive_portal():
    """Captive Portal: Das Netz ist offen, der QR verbindet nur."""
    payload = wifi_payload("Gast", open_network=True)
    assert payload == "WIFI:T:nopass;S:Gast;;"
    assert "P:" not in payload


def test_wifi_endpoint_with_captive_portal():
    hub = Hub(
        make_config(
            guest_wifi={
                "ssid": "Gast",
                "auth": "open",
                "portal_password": "sommer24",
            }
        )
    )
    with TestClient(create_app(hub)) as client:
        data = client.get("/api/wifi").json()
        assert data["open"] is True
        assert data["portal_password"] == "sommer24"
        assert data["payload"].startswith("WIFI:T:nopass;")


def test_wifi_endpoint_serves_config_or_404():
    ohne = Hub(make_config())
    with TestClient(create_app(ohne)) as client:
        assert client.get("/api/wifi").status_code == 404

    mit = Hub(make_config(guest_wifi={"ssid": "Gast", "password": "sommer24"}))
    with TestClient(create_app(mit)) as client:
        data = client.get("/api/wifi").json()
        assert data["ssid"] == "Gast"
        assert data["payload"].startswith("WIFI:T:WPA;S:Gast;")


def test_timers_run_and_announce():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        # Unsinnige Dauer wird abgewiesen.
        assert client.post("/api/timers", json={"minutes": 0}).status_code == 400
        assert client.post("/api/timers", json={"minutes": 999}).status_code == 400

        sent: list[str] = []

        async def fake_send(tokens, title, body, data=None, image=None):
            sent.append(body)
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        started = client.post(
            "/api/timers", json={"minutes": 0.005, "text": "Pizza rausnehmen!"}
        )
        assert started.status_code == 200
        timer_id = started.json()["timer"]["id"]
        assert client.get("/api/timers").json()["timers"][0]["id"] == timer_id

        # Nach Ablauf: Push da, Timer weg (Durchsage scheitert hier still -
        # keine Boxen, kein gTTS - und genau so soll es sein).
        time.sleep(0.8)
        assert sent == ["Pizza rausnehmen!"]
        assert client.get("/api/timers").json()["timers"] == []


def test_timer_cancel():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        started = client.post("/api/timers", json={"minutes": 5, "text": "Tee"})
        timer_id = started.json()["timer"]["id"]
        assert client.delete(f"/api/timers/{timer_id}").status_code == 200
        assert client.get("/api/timers").json()["timers"] == []
        assert client.delete(f"/api/timers/{timer_id}").status_code == 404
