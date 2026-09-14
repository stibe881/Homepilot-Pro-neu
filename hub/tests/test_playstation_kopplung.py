"""Die PlayStation koppeln und fernbedienen - mit einer Attrappe der Bibliothek (Punkt 643).

``pyremoteplay`` wird erst beim Gebrauch importiert, damit der Hub auch
ohne sie startet - deshalb genügt hier je ein Modul unter demselben
Namen, wie bei den Fernseher-Prüfungen (test_tv_kopplung.py).

Geprüft wird der Weg, nicht das Protokoll: Konto hinterlegen, Code
eintragen, eine Taste in einer kurzlebigen Sitzung, Standby, und dass
die Sitzung nach dem Leerlauf wieder weg ist.
"""

from __future__ import annotations

import asyncio
import json
import sys
import types
from typing import Any

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations import playstation
from homepilot.integrations.playstation import (
    NICHT_AN,
    NICHT_GEKOPPELT,
    NICHT_REGISTRIERT,
    PlaystationIntegration,
)

from .conftest import make_config
from .test_playstation import ANTWORT_AN, ANTWORT_RUHE, FakeKanal

REDIRECT = "https://remoteplay.dl.playstation.net/remoteplay/redirect?code=abc123&cid=1"
HOST_ID = "0123456789ab"


# ── Die Attrappe ───────────────────────────────────────────────────────


class FakeProfil:
    def __init__(self, name: str, data: dict[str, Any]):
        self.name = name
        self.data = data


class FakeProfiles:
    """Die Profildatei von pyremoteplay - als Wörterbuch mit Pfad."""

    def __init__(self, data: dict[str, Any]):
        self.data = data

    @classmethod
    def load(cls, path: str = "") -> FakeProfiles:
        try:
            with open(path, encoding="utf-8") as datei:
                return cls(json.load(datei))
        except (OSError, json.JSONDecodeError):
            return cls({})

    def update_user(self, profil: FakeProfil) -> None:
        self.data[profil.name] = profil.data

    def save(self, path: str = "") -> None:
        FakeProfiles.gespeichert.append(path)
        with open(path, "w", encoding="utf-8") as datei:
            json.dump(self.data, datei)

    gespeichert: list[str] = []


def fake_format_user_account(account: dict[str, Any]) -> FakeProfil:
    return FakeProfil(account["online_id"], {"id": account["user_rpid"], "hosts": {}})


class FakeSession:
    def __init__(self):
        self.is_ready = True
        self.error = ""
        self.standby_gerufen = 0

    async def async_wait(self, timeout=5.0):
        return self.is_ready

    async def async_standby(self):
        self.standby_gerufen += 1
        return True


class FakeController:
    def __init__(self):
        self.tasten: list[str] = []
        self.laeuft = False
        self.gestartet = 0

    async def async_button(self, name, action="tap"):
        self.tasten.append(name)

    def start(self):
        self.laeuft = True
        self.gestartet += 1

    def stop(self):
        self.laeuft = False


class FakeDevice:
    """RPDevice: Status, Registrierung, Sitzung."""

    alle: list[FakeDevice] = []
    status: dict[str, Any] = {}
    #: Welcher Code auf der Konsole steht.
    code = "12345678"

    def __init__(self, host: str):
        self.host = host
        self.session: FakeSession | None = None
        self.controller = FakeController()
        self.getrennt = 0
        self.verbunden = 0
        FakeDevice.alle.append(self)

    async def async_get_status(self):
        return dict(FakeDevice.status)

    async def async_register(self, user, pin, profiles=None, save=True):
        if pin != FakeDevice.code:
            return None
        profil = profiles.data.setdefault(user, {"id": "AAAA", "hosts": {}})
        profil["hosts"][HOST_ID] = {"data": {"RegistKey": "3031323334353637"}, "type": "PS5"}
        return FakeProfil(user, profil)

    def create_session(self, user, profiles=None, receiver=None, **_kw):
        assert receiver is None, "Video brauchen wir nie"
        hosts = (profiles.data.get(user) or {}).get("hosts") or {}
        if HOST_ID not in hosts:
            return None
        self.session = FakeSession()
        return self.session

    async def connect(self):
        self.verbunden += 1
        return True

    def disconnect(self):
        self.getrennt += 1
        self.session = None


async def fake_get_user_account(redirect_url: str) -> dict[str, Any]:
    assert redirect_url == REDIRECT
    return {
        "user_rpid": "AAAA",
        "user_id": "1",
        "online_id": "stibe",
        "credentials": "deadbeef",
        "access_token": "nicht speichern",
    }


@pytest.fixture(autouse=True)
def fake_bibliothek(monkeypatch):
    modul = types.ModuleType("pyremoteplay")
    modul.RPDevice = FakeDevice
    oauth = types.ModuleType("pyremoteplay.oauth")
    oauth.async_get_user_account = fake_get_user_account
    oauth.get_login_url = lambda: playstation.LOGIN_URL
    profile = types.ModuleType("pyremoteplay.profile")
    profile.Profiles = FakeProfiles
    profile.format_user_account = fake_format_user_account
    modul.oauth = oauth
    modul.profile = profile
    monkeypatch.setitem(sys.modules, "pyremoteplay", modul)
    monkeypatch.setitem(sys.modules, "pyremoteplay.oauth", oauth)
    monkeypatch.setitem(sys.modules, "pyremoteplay.profile", profile)
    monkeypatch.setattr(playstation, "remote_play_verfuegbar", lambda: True)
    FakeDevice.alle = []
    FakeDevice.status = {"status-code": 200, "host-id": HOST_ID, "host-type": "PS5"}
    FakeProfiles.gespeichert = []
    yield


async def aufbau(hub, tmp_path, monkeypatch) -> tuple[PlaystationIntegration, FakeKanal, Entity]:
    integration = PlaystationIntegration(
        hub,
        {
            "devices": [{"host": "10.0.0.60", "name": "PlayStation 5"}],
            "token_file": str(tmp_path / "playstation-token.json"),
            "profile_file": str(tmp_path / "playstation-profile.json"),
        },
    )
    kanal = FakeKanal()
    integration._ddp = kanal

    # Die Bibliothek bekommt den Port zeitweise ganz (_port_frei); danach
    # öffnet der Hub seinen Kanal neu - im Test wieder die Attrappe.
    async def kanal_fabrik():
        return kanal

    integration._kanal_fabrik = kanal_fabrik
    monkeypatch.setattr(integration, "_starte_loop", lambda entity_id: None)
    await integration.setup()
    entity = hub.registry.get("playstation.10_0_0_60")
    assert entity is not None
    kanal.antwort = ANTWORT_AN
    await integration._refresh(entity.id)
    return integration, kanal, entity


async def gekoppelt(hub, tmp_path, monkeypatch):
    integration, kanal, entity = await aufbau(hub, tmp_path, monkeypatch)
    await integration.pair_account(entity.id, REDIRECT)
    await integration.pair_pin(entity.id, "1234 5678")
    return integration, kanal, entity


# ── Die Kopplung ───────────────────────────────────────────────────────


async def test_kopplung_von_anfang_bis_ende(hub, tmp_path, monkeypatch):
    integration, _, entity = await aufbau(hub, tmp_path, monkeypatch)

    # Schritt 1: die Anmeldeseite.
    url = await integration.pair_start(entity.id)
    assert url.startswith("https://auth.api.sonyentertainmentnetwork.com/")

    # Die Adresse nach der Anmeldung: Konto hinterlegt, aber noch nicht
    # registriert - die Kachel sagt weiter «nicht gekoppelt».
    assert await integration.pair_account(entity.id, REDIRECT) == "stibe"
    konto = json.loads((tmp_path / "playstation-token.json").read_text())
    assert konto == {"user_rpid": "AAAA", "user_id": "1", "online_id": "stibe", "credentials": "deadbeef"}
    assert "access_token" not in konto
    assert (tmp_path / "playstation-token.json").stat().st_mode & 0o777 == 0o600
    assert entity.state["paired"] is False
    assert integration.pair_stand(entity.id)["account"] is True
    # Das Profil liegt neben der Datendatei, nicht im Home-Verzeichnis.
    assert FakeProfiles.gespeichert == [str(tmp_path / "playstation-profile.json")]

    # Schritt 2: der Code von der Konsole.
    await integration.pair_pin(entity.id, "1234 5678")
    profil = json.loads((tmp_path / "playstation-profile.json").read_text())
    assert HOST_ID in profil["stibe"]["hosts"]
    assert entity.state["paired"] is True
    assert integration.pair_stand(entity.id)["paired"] is True
    await integration.teardown()


async def test_der_code_braucht_eine_eingeschaltete_konsole(hub, tmp_path, monkeypatch):
    integration, _, entity = await aufbau(hub, tmp_path, monkeypatch)
    with pytest.raises(ValueError) as ohne_konto:
        await integration.pair_pin(entity.id, "12345678")
    assert str(ohne_konto.value) == NICHT_GEKOPPELT

    await integration.pair_account(entity.id, REDIRECT)
    FakeDevice.status = {"status-code": 620, "host-id": HOST_ID, "host-type": "PS5"}
    with pytest.raises(ValueError) as ruht:
        await integration.pair_pin(entity.id, "12345678")
    assert str(ruht.value) == NICHT_AN

    FakeDevice.status = {}
    with pytest.raises(ConnectionError):
        await integration.pair_pin(entity.id, "12345678")
    await integration.teardown()


async def test_ein_falscher_code_wird_abgelehnt_und_nichts_gespeichert(hub, tmp_path, monkeypatch):
    integration, _, entity = await aufbau(hub, tmp_path, monkeypatch)
    await integration.pair_account(entity.id, REDIRECT)
    gespeichert = list(FakeProfiles.gespeichert)
    with pytest.raises(ConnectionError) as falsch:
        await integration.pair_pin(entity.id, "0000 0000")
    assert "Code" in str(falsch.value)
    assert FakeProfiles.gespeichert == gespeichert
    assert entity.state["paired"] is False
    # Ein Tippfehler kommt gar nicht bis zur Konsole.
    with pytest.raises(ValueError):
        await integration.pair_pin(entity.id, "1234")
    await integration.teardown()


async def test_neu_verwirft_konto_und_registrierung(hub, tmp_path, monkeypatch):
    """Beiseite, nicht gelöscht - wer abbricht, kann zurück."""
    integration, _, entity = await gekoppelt(hub, tmp_path, monkeypatch)
    assert entity.state["paired"] is True
    await integration.pair_start(entity.id, neu=True)
    assert entity.state["paired"] is False
    assert integration.pair_stand(entity.id) == {
        "account": False,
        "paired": False,
        "online_id": None,
        "remote_play": True,
    }
    assert (tmp_path / "playstation-token.json.alt").exists()
    assert (tmp_path / "playstation-profile.json.alt").exists()
    assert not (tmp_path / "playstation-token.json").exists()
    await integration.teardown()


async def test_die_kopplung_wird_beim_start_von_der_platte_gelesen(hub, tmp_path, monkeypatch):
    """Ein Neustart des Hubs darf die Kopplung nicht vergessen."""
    integration, _, entity = await gekoppelt(hub, tmp_path, monkeypatch)
    await integration.teardown()
    await hub.registry.remove(entity.id)

    zweite = PlaystationIntegration(hub, dict(integration.config))
    zweite._ddp = FakeKanal()
    monkeypatch.setattr(zweite, "_starte_loop", lambda entity_id: None)
    await zweite.setup()
    stand = zweite.pair_stand("playstation.10_0_0_60")
    assert stand["account"] is True and stand["online_id"] == "stibe"
    assert stand["paired"] is True
    await zweite.teardown()


async def test_wecken_meldet_das_konto_an_sobald_die_konsole_oben_ist(
    hub, tmp_path, monkeypatch
):
    """Aus dem Haus: «Ich starte sie mit der Fernbedienung, kann dann aber
    nichts, bis ich mein Profil gewählt habe.» Das blosse Weckpaket landet
    auf der Profilauswahl; eine Remote-Play-Sitzung meldet das Konto an. Der
    Hub öffnet sie im Hintergrund, sobald die Konsole hochgefahren ist."""
    monkeypatch.setattr(playstation, "WECKEN_ANMELDEN_TAKT", 0.01)
    monkeypatch.setattr(playstation, "WECKEN_ANMELDEN_WARTEN", 1.0)
    monkeypatch.setattr(playstation, "SITZUNG_LEERLAUF", 999.0)
    integration, kanal, entity = await gekoppelt(hub, tmp_path, monkeypatch)

    # Die Konsole ruht: Das Wecken schickt das Paket und wartet dann aufs
    # Hochfahren.
    kanal.antwort = ANTWORT_RUHE
    await integration._refresh(entity.id)
    kanal.antwort = ANTWORT_AN  # ein paar Sekunden später ist sie oben
    vorher = len(FakeDevice.alle)
    await integration.handle_command(entity, "toggle", {})

    # Der Hintergrund-Task sieht die Konsole «an» und öffnet die Sitzung -
    # ohne dass jemand eine Taste drücken musste.
    for _ in range(50):
        await asyncio.sleep(0.02)
        if entity.id in integration._sitzungen:
            break
    assert entity.id in integration._sitzungen, "nach dem Wecken meldet der Hub sich an"
    assert len(FakeDevice.alle) == vorher + 1
    await integration.teardown()


async def test_ohne_registrierung_bleibt_es_beim_weckpaket(hub, tmp_path, monkeypatch):
    """Ohne Registrierung gibt es keine Remote-Play-Sitzung - dann weckt der
    Hub nur, und die Profilauswahl bleibt Handarbeit (kein Hintergrund-Task,
    der ins Leere läuft)."""
    monkeypatch.setattr(playstation, "WECKEN_ANMELDEN_TAKT", 0.01)
    monkeypatch.setattr(playstation, "WECKEN_ANMELDEN_WARTEN", 0.2)
    integration, kanal, entity = await aufbau(hub, tmp_path, monkeypatch)
    await integration.pair_account(entity.id, REDIRECT)  # Konto, aber nicht registriert
    kanal.antwort = ANTWORT_RUHE
    await integration._refresh(entity.id)
    vorher = len(FakeDevice.alle)
    await integration.handle_command(entity, "toggle", {})
    await asyncio.sleep(0.3)
    assert entity.id not in integration._sitzungen
    assert len(FakeDevice.alle) == vorher
    await integration.teardown()


# ── Tasten und Standby ─────────────────────────────────────────────────


async def test_eine_taste_oeffnet_eine_sitzung_und_der_leerlauf_schliesst_sie(
    hub, tmp_path, monkeypatch
):
    """Eine Dauer-Sitzung hielte die Konsole auf «Remote Play verbunden»."""
    monkeypatch.setattr(playstation, "SITZUNG_LEERLAUF", 0.05)
    integration, _, entity = await gekoppelt(hub, tmp_path, monkeypatch)
    vorher = len(FakeDevice.alle)

    await integration.handle_command(entity, "ok", {})
    await integration.handle_command(entity, "dpad_down", {})
    await integration.handle_command(entity, "home", {})
    # Eine Sitzung für alle drei Tasten, ohne Video.
    assert len(FakeDevice.alle) == vorher + 1
    device = FakeDevice.alle[-1]
    assert device.controller.tasten == ["CROSS", "DOWN", "PS"]
    assert device.verbunden == 1 and device.getrennt == 0
    assert entity.id in integration._sitzungen

    await asyncio.sleep(0.2)
    assert device.getrennt == 1
    assert entity.id not in integration._sitzungen

    # Die nächste Taste baut eine neue auf.
    await integration.handle_command(entity, "circle", {})
    assert len(FakeDevice.alle) == vorher + 2
    await integration.teardown()


async def test_standby_geht_ueber_die_sitzung_und_trennt_sie(hub, tmp_path, monkeypatch):
    integration, _, entity = await gekoppelt(hub, tmp_path, monkeypatch)
    await integration.handle_command(entity, "turn_off", {})
    device = FakeDevice.alle[-1]
    assert device.getrennt == 1
    assert entity.id not in integration._sitzungen
    # Die Kachel sagt es sofort; die nächste DDP-Runde bestätigt es.
    assert entity.state["state"] == "off" and entity.state["standby"] is True
    assert entity.state["app"] is None
    await integration.teardown()


async def test_tasten_brauchen_die_registrierung_und_eine_laufende_konsole(
    hub, tmp_path, monkeypatch
):
    integration, kanal, entity = await aufbau(hub, tmp_path, monkeypatch)
    await integration.pair_account(entity.id, REDIRECT)
    with pytest.raises(ConnectionError) as ohne:
        await integration.handle_command(entity, "ok", {})
    assert str(ohne.value) == NICHT_REGISTRIERT

    await integration.pair_pin(entity.id, "12345678")
    kanal.antwort = ANTWORT_RUHE
    await integration._refresh(entity.id)
    with pytest.raises(ConnectionError) as ruht:
        await integration.handle_command(entity, "ok", {})
    assert str(ruht.value) == NICHT_AN
    await integration.teardown()


async def test_die_sitzung_haelt_das_pad_am_leben_und_haengt_nicht_am_leerlauf(
    hub, tmp_path, monkeypatch
):
    """Aus dem Haus: «nach ein paar Sekunden wird getrennt» - viel kürzer
    als jeder Leerlauf. Ursache: Ohne den Controller-Worker fehlt der
    Konsole der stete Pad-Zustand, und sie legt die Sitzung selbst ab.
    Beim Aufbau muss der Worker also laufen, beim Trennen stehen."""
    integration, _, entity = await gekoppelt(hub, tmp_path, monkeypatch)
    monkeypatch.setattr(playstation, "SITZUNG_LEERLAUF", 999.0)
    await integration.handle_command(entity, "ok", {})
    device = FakeDevice.alle[-1]
    assert device.controller.laeuft, "der Worker hält die Sitzung am Leben"
    assert device.controller.gestartet == 1
    integration._sitzung_trennen(entity.id)
    assert not device.controller.laeuft, "beim Trennen steht der Worker still"
    await integration.teardown()


async def test_der_quellport_gehoert_waehrend_der_registrierung_der_bibliothek(
    hub, tmp_path, monkeypatch
):
    """Der Fall aus dem Haus beim allerersten Koppeln: Hub und Bibliothek
    wollten beide den Quellport 9303, «Address already in use» wurde zum
    500. Solange die Bibliothek fragt, ist der Kanal des Hubs zu; danach
    steht er wieder."""
    integration, kanal, entity = await aufbau(hub, tmp_path, monkeypatch)
    await integration.pair_account(entity.id, REDIRECT)
    gesehen: list[Any] = []

    async def status_mit_blick(self):
        gesehen.append(integration._ddp)
        return dict(FakeDevice.status)

    monkeypatch.setattr(FakeDevice, "async_get_status", status_mit_blick)
    await integration.pair_pin(entity.id, "12345678")
    assert gesehen == [None], "während der Bibliotheksaufrufe muss der Kanal zu sein"
    assert integration._ddp is kanal, "danach gehört der Port wieder dem Hub"
    await integration.teardown()


async def test_ein_belegter_port_wird_zur_klaren_absage(hub, tmp_path, monkeypatch):
    """Rutscht doch ein Fehler der Bibliothek durch, steht er als Satz in
    der Antwort - nicht als «im Hub ist etwas schiefgegangen»."""
    integration, _, entity = await aufbau(hub, tmp_path, monkeypatch)
    await integration.pair_account(entity.id, REDIRECT)

    async def belegt(self):
        raise OSError(98, "Address already in use")

    monkeypatch.setattr(FakeDevice, "async_get_status", belegt)
    with pytest.raises(ConnectionError) as absage:
        await integration.pair_pin(entity.id, "12345678")
    assert "Address already in use" in str(absage.value)
    await integration.teardown()


async def test_eine_gescheiterte_sitzung_sagt_woran_es_liegen_kann(hub, tmp_path, monkeypatch):
    integration, _, entity = await gekoppelt(hub, tmp_path, monkeypatch)

    async def nein(self):
        self.session.error = "Auth Failed."
        return False

    monkeypatch.setattr(FakeDevice, "connect", nein)
    with pytest.raises(ConnectionError) as absage:
        await integration.handle_command(entity, "ok", {})
    assert "Remote Play" in str(absage.value) and "Auth Failed" in str(absage.value)
    assert FakeDevice.alle[-1].getrennt == 1
    assert entity.id not in integration._sitzungen
    await integration.teardown()


# ── Die Routen ─────────────────────────────────────────────────────────


class FakeService:
    """Die Integration aus Sicht der Routen - fünf Methoden."""

    name = "playstation"

    def __init__(self):
        self.aufrufe: list[tuple[str, Any]] = []
        self.fehler: Exception | None = None

    async def teardown(self) -> None:
        return None

    def playstation_id(self, entity_id: str) -> str | None:
        return entity_id if entity_id.startswith("playstation.") else None

    def pair_stand(self, entity_id: str) -> dict[str, Any]:
        return {"account": True, "paired": False, "online_id": "stibe", "remote_play": True}

    async def pair_start(self, entity_id: str, neu: bool = False) -> str:
        self.aufrufe.append(("start", neu))
        return playstation.LOGIN_URL

    async def pair_account(self, entity_id: str, redirect_url: str) -> str:
        self.aufrufe.append(("account", redirect_url))
        if self.fehler:
            raise self.fehler
        return "stibe"

    async def pair_pin(self, entity_id: str, pin: str) -> None:
        self.aufrufe.append(("pin", pin))
        if self.fehler:
            raise self.fehler


@pytest.fixture
def client():
    hub = Hub(make_config())
    asyncio.run(
        hub.registry.add(
            Entity(
                id="playstation.10_0_0_60",
                kind=EntityKind.MEDIA_PLAYER,
                name="PlayStation 5",
                integration="playstation",
                state={"state": "off"},
                commands=["turn_on"],
            )
        )
    )
    with TestClient(create_app(hub)) as test_client:
        test_client.hub = hub
        yield test_client


def test_die_routen_reichen_an_die_integration_durch(client):
    service = FakeService()
    client.hub.integrations._integrations["playstation"] = service
    pfad = "/api/playstation/playstation.10_0_0_60/pair"

    assert client.get(pfad).json() == {
        "account": True,
        "paired": False,
        "online_id": "stibe",
        "remote_play": True,
    }
    antwort = client.post(pfad, json={"neu": True})
    assert antwort.status_code == 200
    assert antwort.json()["ok"] is True
    assert antwort.json()["login_url"].startswith("https://auth.api.sonyentertainmentnetwork.com/")
    assert client.post(pfad).status_code == 200
    assert service.aufrufe[:2] == [("start", True), ("start", False)]

    antwort = client.post(f"{pfad}/account", json={"redirect_url": REDIRECT})
    assert antwort.status_code == 200 and antwort.json() == {"ok": True, "online_id": "stibe"}
    antwort = client.post(f"{pfad}/pin", json={"pin": "1234 5678"})
    assert antwort.status_code == 200 and antwort.json() == {"ok": True}
    assert service.aufrufe[2:] == [("account", REDIRECT), ("pin", "1234 5678")]


def test_die_routen_uebersetzen_die_fehler_wie_beim_fernseher(client):
    service = FakeService()
    client.hub.integrations._integrations["playstation"] = service
    pfad = "/api/playstation/playstation.10_0_0_60/pair"

    service.fehler = ValueError("Das ist nicht die Seite nach der Anmeldung")
    antwort = client.post(f"{pfad}/account", json={"redirect_url": "x"})
    assert antwort.status_code == 400 and "Anmeldung" in antwort.json()["detail"]

    service.fehler = ConnectionError(playstation.BIBLIOTHEK_FEHLT)
    antwort = client.post(f"{pfad}/pin", json={"pin": "12345678"})
    assert antwort.status_code == 503 and "pip install" in antwort.json()["detail"]

    # Kein solches Gerät, keine PlayStation, keine Integration.
    assert client.get("/api/playstation/nope.nope/pair").status_code == 404
    assert client.get("/api/playstation/demo.light_livingroom/pair").status_code == 400
    client.hub.integrations._integrations.pop("playstation")
    assert client.get(pfad).status_code == 503
