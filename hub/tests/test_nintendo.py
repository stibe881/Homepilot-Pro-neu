"""Nintendo Switch: was die Integration aus Nintendos Meldungen macht.

Die Cloud selbst ist nicht erreichbar - eine Attrappe steht an der Stelle
der Bibliothek. Dass die echte Switch 2 sich so verhält, beweist nur ein
Lauf an der Konsole (``python -m homepilot.integrations.nintendo``).
"""

from __future__ import annotations

import asyncio

import pytest

from homepilot.core import tokenstore
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.errors import HomePilotError
from homepilot.core.hub import Hub
from homepilot.integrations import nintendo


class AttrappeGeraet:
    def __init__(self) -> None:
        self.name = "Switch 2 im Wohnzimmer"
        self.model = "Switch 2"
        self.today_playing_time = 10
        self.today_time_remaining = 35
        self.limit_time = 45
        self.month_playing_time = 300
        self.forced_termination_mode = False
        self.last_sync = 1_700_000_000.0
        self.gesetzt: list[int] = []
        self.modi: list[object] = []

    async def update_max_daily_playtime(self, minutes):
        self.gesetzt.append(minutes)
        self.limit_time = None if minutes == -1 else minutes

    async def set_restriction_mode(self, mode):
        self.modi.append(mode)
        self.forced_termination_mode = True


class AttrappeKonto:
    def __init__(self) -> None:
        self.devices = {"abc-123": AttrappeGeraet()}
        self.abrufe = 0

    async def update(self):
        self.abrufe += 1


# ── Reine Regeln ───────────────────────────────────────────────────────


def test_the_limit_accepts_whole_minutes_up_to_six_hours_or_minus_one():
    assert nintendo.limit_wert(45) == 45
    assert nintendo.limit_wert("0") == 0
    assert nintendo.limit_wert(-1) == -1
    for schlecht in (361, -5, "viel", None):
        with pytest.raises(HomePilotError):
            nintendo.limit_wert(schlecht)


def test_a_console_counts_as_on_only_while_its_playtime_keeps_growing():
    an, merker = nintendo.laeuft_gerade(10, None, 1000.0)
    assert an is False  # der erste Abruf kennt noch kein Wachstum
    an, merker = nintendo.laeuft_gerade(11, merker, 1060.0)
    assert an is True
    an, merker = nintendo.laeuft_gerade(11, merker, 1060.0 + 100)
    assert an is True  # ein ausgelassener Abgleich fällt nicht auf
    an, merker = nintendo.laeuft_gerade(11, merker, 1060.0 + nintendo.AN_NACH_WACHSTUM + 1)
    assert an is False


def test_a_new_day_restarts_the_count_and_the_console_is_off():
    _, merker = nintendo.laeuft_gerade(99, (98, 500.0), 560.0)
    an, merker = nintendo.laeuft_gerade(0, merker, 620.0)
    assert an is False
    assert merker[0] == 0


def test_the_state_says_it_is_delayed():
    zustand = nintendo.zustand(AttrappeGeraet(), True)
    assert zustand["state"] == "on"
    assert zustand["playing_min"] == 10
    assert zustand["limit_min"] == 45
    assert zustand["verzoegert"] is True


def test_object_ids_survive_odd_device_ids():
    assert nintendo.objekt_id("Abc-123/XY") == "abc_123_xy"


# ── Die Integration ────────────────────────────────────────────────────


@pytest.fixture
async def haus(tmp_path, monkeypatch):
    token = tmp_path / "nintendo-token.json"
    tokenstore.save(token, {"session_token": "geheim"})
    konto = AttrappeKonto()

    async def fabrik(token, session, zeitzone, sprache):
        assert token == "geheim"
        return konto

    monkeypatch.setattr(nintendo, "_echte_fabrik", fabrik)
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "nintendo", "token_file": str(token)}],
            data_file=str(tmp_path / "data.json"),
        )
    )
    await hub.start()
    for _ in range(50):
        if hub.registry.get("nintendo.abc_123"):
            break
        await asyncio.sleep(0.05)
    yield hub, konto, token
    await hub.stop()


async def test_nintendo_creates_a_tile_per_console_once_logged_in(haus):
    hub, _, _ = haus
    geraet = hub.registry.get("nintendo.abc_123")
    assert geraet is not None
    assert geraet.name == "Switch 2 im Wohnzimmer"
    assert geraet.commands == ["set_limit"]
    assert geraet.state["remaining_min"] == 35


async def test_without_a_token_there_is_no_tile_and_no_crash(tmp_path):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "nintendo", "token_file": str(tmp_path / "leer.json")}],
            data_file=str(tmp_path / "data.json"),
        )
    )
    await hub.start()
    try:
        assert [e for e in hub.registry.all() if e.integration == "nintendo"] == []
        assert hub.integrations.get("nintendo") is not None
    finally:
        await hub.stop()


async def test_setting_the_limit_switches_the_console_to_ending_the_game(haus):
    """Eine Höchstzeit, bei der die Konsole nur läutet, ist keine."""
    hub, konto, _ = haus
    await hub.integrations.dispatch_command("nintendo.abc_123", "set_limit", {"minutes": 25})
    geraet = konto.devices["abc-123"]
    assert geraet.gesetzt == [25]
    assert len(geraet.modi) == 1


async def test_the_limit_the_parents_had_is_remembered_and_put_back(haus):
    hub, konto, token = haus
    geraet = konto.devices["abc-123"]
    await hub.integrations.dispatch_command("nintendo.abc_123", "set_limit", {"minutes": 20})
    await hub.integrations.dispatch_command("nintendo.abc_123", "set_limit", {"minutes": 15})
    assert tokenstore.load(token)["limit_vorher"] == {"abc-123": 45}  # nur beim ersten Eingriff
    await hub.integrations.dispatch_command("nintendo.abc_123", "set_limit", {})
    assert geraet.gesetzt[-1] == 45
    assert "limit_vorher" in tokenstore.load(token)
    assert tokenstore.load(token)["limit_vorher"] == {}


async def test_nintendo_refusing_the_limit_comes_back_as_a_readable_error(haus):
    hub, konto, _ = haus

    async def nein(minutes):
        raise RuntimeError("Zusatzzeit aktiv")

    konto.devices["abc-123"].update_max_daily_playtime = nein
    with pytest.raises(Exception, match="Zusatzzeit aktiv"):
        await hub.integrations.dispatch_command("nintendo.abc_123", "set_limit", {"minutes": 5})


async def test_a_failing_cloud_marks_the_console_unreachable_only_after_three_misses(haus):
    hub, konto, _ = haus
    integ = hub.integrations.get("nintendo")

    async def kaputt():
        raise RuntimeError("Nintendo antwortet nicht")

    konto.update = kaputt
    for _ in range(2):
        with pytest.raises(RuntimeError):
            await integ._abrufen()
        integ._konto = konto  # der nächste Takt baut neu auf; hier bleibt es bei der Attrappe
    assert hub.registry.get("nintendo.abc_123").available is True
    with pytest.raises(RuntimeError):
        await integ._abrufen()
    assert hub.registry.get("nintendo.abc_123").available is False


async def test_a_login_stores_the_session_key_for_next_time(haus, tmp_path):
    hub, _, token = haus
    integ = hub.integrations.get("nintendo")

    class Anmeldung:
        login_url = "https://accounts.nintendo.com/connect/1.0.0/authorize?x=1"
        session_token = "frisch"

        async def async_complete_login(self, adresse):
            assert adresse.startswith("npf")

    integ._anmeldung_fabrik = lambda session: Anmeldung()
    assert integ.anmeldung_starten().startswith("https://accounts.nintendo.com")
    await integ.anmeldung_abschliessen("  npf54789befb391a838://auth#session_token_code=abc  ")
    assert tokenstore.load(token)["session_token"] == "frisch"


async def test_finishing_a_login_that_never_started_says_so(haus):
    hub, _, _ = haus
    with pytest.raises(HomePilotError, match="Erst die Anmeldung starten"):
        await hub.integrations.get("nintendo").anmeldung_abschliessen("npf://x")


# ── Die Tür für die App ────────────────────────────────────────────────


def test_the_login_route_hands_out_the_address_and_takes_the_pasted_one_back(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from homepilot.api import create_app

    token = tmp_path / "nintendo-token.json"

    class Anmeldung:
        login_url = "https://accounts.nintendo.com/x"
        session_token = "neu"

        async def async_complete_login(self, adresse):
            pass

    async def fabrik(*_args):
        return AttrappeKonto()

    monkeypatch.setattr(nintendo, "_echte_fabrik", fabrik)
    monkeypatch.setattr(nintendo, "_echte_anmeldung", lambda session: Anmeldung())
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "nintendo", "token_file": str(token)}],
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
                {"name": "Maja", "role": "kind", "token": "t-maja"},
            ],
            data_file=str(tmp_path / "data.json"),
        )
    )
    kopf = {"Authorization": "Bearer t-owner"}
    with TestClient(create_app(hub)) as client:
        assert client.get("/api/nintendo", headers=kopf).json()["angemeldet"] is False
        assert client.get("/api/nintendo", headers={"Authorization": "Bearer t-maja"}).status_code == 403
        assert client.post("/api/nintendo/anmeldung", headers=kopf).json()["url"].startswith("https://")
        antwort = client.post(
            "/api/nintendo/anmeldung/abschluss", json={"adresse": "npf://auth#x"}, headers=kopf
        )
        assert antwort.json() == {"angemeldet": True}
        assert tokenstore.load(token)["session_token"] == "neu"
        # Ohne gestartete Anmeldung gibt es eine lesbare Absage, keinen Absturz.
        zweite = client.post(
            "/api/nintendo/anmeldung/abschluss", json={"adresse": "npf://auth#x"}, headers=kopf
        )
        assert zweite.status_code == 400
