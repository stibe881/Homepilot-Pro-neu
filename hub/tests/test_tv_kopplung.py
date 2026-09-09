"""Den Fernseher koppeln, ohne ein Terminal aufzumachen.

Der Fall aus dem Haus: «Wenn ich den Timer für den Fernseher einschalten
will, kommt diese Meldung» – und die Meldung sagte, die Kopplung müsse
einmal am Gerät bestätigt werden, «siehe Hub-Protokoll». Im Protokoll
stand dann ein Aufruf für die Kommandozeile des Hub-Rechners. Wer abends
den Einschlaf-Timer stellen will, hat kein Terminal.

Die Kopplung selbst braucht weiterhin einen Menschen vor dem Fernseher –
er zeigt einen Code, und nur wer ihn sieht, darf ihn fernbedienen. Neu
ist bloss, dass dieser Mensch dafür die App in der Hand hat.
"""

import sys
import types

import pytest

from homepilot.core.entity import Entity, EntityKind
from homepilot.integrations.androidtv import (
    NICHT_GEKOPPELT,
    SLEEP_MINUTES,
    AndroidTvIntegration,
    pair_absage,
)


class CannotConnect(Exception):
    pass


class InvalidAuth(Exception):
    pass


class FakeRemote:
    """Ein Fernseher, der den Code 123456 zeigt.

    Wie in den übrigen Fernseher-Prüfungen: ``androidtvremote2`` wird
    erst beim Gebrauch importiert, damit der Hub auch ohne die
    Bibliothek startet – deshalb genügt hier ein eigenes Modul unter
    demselben Namen.
    """

    #: Alle je gebauten Fernbedienungen, in der Reihenfolge ihrer Geburt.
    alle: list["FakeRemote"] = []

    def __init__(self, name, certfile, keyfile, host, enable_ime=True):
        self.host = host
        self.certfile = certfile
        self.keyfile = keyfile
        self.gestartet = False
        self.code = None
        self.getrennt = False
        self.verbunden = False
        self.is_on = False
        self.current_app = None
        self.volume_info = {}
        FakeRemote.alle.append(self)

    async def async_generate_cert_if_missing(self):
        return False

    async def async_connect(self):
        self.verbunden = True

    async def async_start_pairing(self):
        self.gestartet = True

    async def async_finish_pairing(self, code):
        if code != "123456":
            raise InvalidAuth()
        self.code = code

    def disconnect(self):
        self.getrennt = True

    def add_is_on_updated_callback(self, cb):
        pass

    def add_current_app_updated_callback(self, cb):
        pass

    def add_volume_info_updated_callback(self, cb):
        pass

    def add_is_available_updated_callback(self, cb):
        pass

    def keep_reconnecting(self, invalid_auth_callback=None):
        pass


@pytest.fixture(autouse=True)
def fake_bibliothek(monkeypatch):
    modul = types.ModuleType("androidtvremote2")
    modul.AndroidTVRemote = FakeRemote
    modul.CannotConnect = CannotConnect
    modul.InvalidAuth = InvalidAuth
    monkeypatch.setitem(sys.modules, "androidtvremote2", modul)
    FakeRemote.alle = []
    yield


async def _aufbau(hub, tmp_path) -> tuple[AndroidTvIntegration, Entity, Entity]:
    """Integration ohne echten Fernseher – wie in test_tv_timer.py.

    setup() braucht ein Gerät im Netz; die Entitäten und Zuordnungen
    entstehen deshalb hier von Hand, genau wie setup() sie anlegt.
    """
    integration = AndroidTvIntegration(hub, {})
    tv = await integration.add_entity(
        "10_0_0_5",
        EntityKind.MEDIA_PLAYER,
        "Fernseher Wohnzimmer",
        state={
            "state": "off",
            "sleep_until": None,
            "sleep_minutes": SLEEP_MINUTES,
            "paired": True,
        },
        commands=["turn_off", "sleep_timer"],
    )
    timer = await integration.add_entity(
        "10_0_0_5_timer",
        EntityKind.TIMER,
        "Fernseher Wohnzimmer Timer",
        state={
            "state": "off",
            "sleep_until": None,
            "sleep_minutes": SLEEP_MINUTES,
            "paired": True,
        },
        commands=["sleep_timer"],
    )
    integration._timer_of[tv.id] = timer.id
    integration._tv_of[timer.id] = tv.id
    integration._geraete[tv.id] = {
        "host": "10.0.0.5",
        "cert_dir": str(tmp_path),
        "ime": True,
        "name": "Fernseher Wohnzimmer",
    }
    return integration, tv, timer


# ── Die Sätze für sich ─────────────────────────────────────────────────


def test_die_absage_nennt_den_weg_in_der_app():
    """Sie verwies auf das Hub-Protokoll – dort stand ein docker-Aufruf."""
    assert "koppeln" in NICHT_GEKOPPELT
    assert "Protokoll" not in NICHT_GEKOPPELT


def test_pair_absage_uebersetzt_die_bibliothek():
    """«InvalidAuth» ist kein Satz, den jemand lesen will."""
    assert "erreichbar" in pair_absage(CannotConnect())
    assert "Code" in pair_absage(InvalidAuth())
    # Unbekanntes geht mit seinem Text hinaus statt ins Leere.
    assert pair_absage(RuntimeError("Netz weg")) == "Kopplung fehlgeschlagen: Netz weg"
    assert pair_absage(RuntimeError()) == "Kopplung fehlgeschlagen."


# ── Der ganze Weg ──────────────────────────────────────────────────────


async def test_kopplung_von_anfang_bis_ende(hub, tmp_path):
    integration, tv, timer = await _aufbau(hub, tmp_path)
    await integration._push_gekoppelt(tv.id, False)

    await integration.pair_start(tv.id)
    remote = FakeRemote.alle[-1]
    assert remote.gestartet, "Ohne dies zeigt der Fernseher gar keinen Code"

    await integration.pair_finish(tv.id, " 123456 ")
    assert remote.code == "123456", "Leerzeichen aus der Tastatur gehören weg"
    # Und beide Kacheln wissen es: Die Timer-Kachel ist die zweite
    # Ansicht desselben Fernsehers, und von dort kam die Meldung.
    assert tv.state["paired"] is True
    assert timer.state["paired"] is True
    await integration.teardown()


async def test_ein_falscher_code_verlangt_einen_neuen_anlauf(hub, tmp_path):
    """Der Fernseher schliesst die Sitzung und zeigt danach eine neue Zahl –
    gegen die alte weiterzuprüfen hiesse, gegen nichts zu prüfen."""
    integration, tv, _ = await _aufbau(hub, tmp_path)
    await integration.pair_start(tv.id)

    with pytest.raises(ConnectionError) as absage:
        await integration.pair_finish(tv.id, "000000")
    assert "Code" in str(absage.value)

    with pytest.raises(ValueError) as zweiter:
        await integration.pair_finish(tv.id, "123456")
    assert "koppeln" in str(zweiter.value)
    await integration.teardown()


async def test_code_ohne_begonnene_kopplung_sagt_was_fehlt(hub, tmp_path):
    integration, tv, _ = await _aufbau(hub, tmp_path)
    with pytest.raises(ValueError):
        await integration.pair_finish(tv.id, "123456")


async def test_die_timer_kachel_koppelt_ihren_fernseher(hub, tmp_path):
    """Gemeldet wurde der Fehler von der Timer-Kachel aus – gekoppelt wird
    trotzdem der Fernseher, es gibt nur eine Kopplung."""
    integration, tv, timer = await _aufbau(hub, tmp_path)
    assert integration.tv_id(timer.id) == tv.id
    assert integration.tv_id(tv.id) == tv.id
    assert integration.tv_id("hue.light_flur") is None


async def test_der_verlorene_zugang_steht_auf_beiden_kacheln(hub, tmp_path):
    """So geht eine Kopplung im Betrieb verloren: Am Fernseher werden die
    Daten des Remote-Dienstes gelöscht. Stand das nur im Log, sah man in
    der App bloss ein Gerät, das nichts mehr tut."""
    integration, tv, timer = await _aufbau(hub, tmp_path)
    await integration._push_gekoppelt(tv.id, False)
    assert tv.state["paired"] is False
    assert timer.state["paired"] is False
    assert integration._gekoppelt[tv.id] is False


async def test_neu_legt_das_alte_zertifikat_beiseite(hub, tmp_path):
    """Der Fall, der einen Abend gekostet hat: Nach dem Datenlöschen am
    Fernseher verbindet das alte Zertifikat weiter und wirkt nicht mehr."""
    integration, tv, _ = await _aufbau(hub, tmp_path)
    alt_pem = tmp_path / "androidtv-10.0.0.5.pem"
    alt_key = tmp_path / "androidtv-10.0.0.5.key"
    alt_pem.write_text("altes Zertifikat")
    alt_key.write_text("alter Schlüssel")

    await integration.pair_start(tv.id, neu=True)
    assert not alt_pem.exists()
    assert (tmp_path / "androidtv-10.0.0.5.pem.alt").read_text() == "altes Zertifikat"
    assert (tmp_path / "androidtv-10.0.0.5.key.alt").read_text() == "alter Schlüssel"
    await integration.teardown()


async def test_ein_fremdes_geraet_wird_abgewiesen(hub, tmp_path):
    integration, _, _ = await _aufbau(hub, tmp_path)
    with pytest.raises(ValueError):
        await integration.pair_start("hue.light_flur")


# ── Der Weg von der App her ────────────────────────────────────────────


class KopplungsAttrappe:
    """Nur so viel Integration, wie die Route anfasst.

    Der Fernseher ist hier das Demo-Licht: Die Route fragt die Registry
    bloss, ob es die Kachel überhaupt gibt – welche davon ein Fernseher
    ist, sagt die Integration. So braucht die Prüfung kein zweites
    Gerät im laufenden Hub.
    """

    name = "androidtv"

    def __init__(self) -> None:
        self.gestartet: list[tuple[str, bool]] = []
        self.codes: list[tuple[str, str]] = []
        self.absage: Exception | None = None

    def tv_id(self, entity_id: str) -> str | None:
        return "demo.light_livingroom" if entity_id == "demo.light_livingroom" else None

    async def pair_start(self, entity_id: str, neu: bool = False) -> None:
        if self.absage is not None:
            raise self.absage
        self.gestartet.append((entity_id, neu))

    async def pair_finish(self, entity_id: str, code: str) -> None:
        if self.absage is not None:
            raise self.absage
        self.codes.append((entity_id, code))

    async def teardown(self) -> None:
        pass


def _api_aufbau():
    """Ein Hub mit Demo-Geräten und einer angehängten Fernseher-Attrappe."""
    from fastapi.testclient import TestClient

    from homepilot.api import create_app
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(make_config())
    app = create_app(hub)
    attrappe = KopplungsAttrappe()
    hub.integrations._integrations["androidtv"] = attrappe
    return TestClient(app), attrappe


def test_die_route_reicht_code_und_neu_weiter():
    client, attrappe = _api_aufbau()
    with client:
        antwort = client.post(
            "/api/androidtv/demo.light_livingroom/pair", json={"neu": True}
        )
        assert antwort.status_code == 200
        assert attrappe.gestartet == [("demo.light_livingroom", True)]

        antwort = client.post(
            "/api/androidtv/demo.light_livingroom/pair/code", json={"code": "123456"}
        )
        assert antwort.status_code == 200
        assert attrappe.codes == [("demo.light_livingroom", "123456")]


def test_ohne_angaben_wird_nicht_neu_gekoppelt():
    """«Neu» wirft das Zertifikat weg – das passiert nicht aus Versehen."""
    client, attrappe = _api_aufbau()
    with client:
        assert client.post("/api/androidtv/demo.light_livingroom/pair").status_code == 200
        assert attrappe.gestartet == [("demo.light_livingroom", False)]


def test_ein_fremdes_geraet_bekommt_keine_kopplung():
    client, _ = _api_aufbau()
    with client:
        # Ein Thermometer ist kein Fernseher, und «nope.nope» gibt es nicht.
        assert client.post("/api/androidtv/demo.temp_livingroom/pair").status_code == 400
        assert client.post("/api/androidtv/nope.nope/pair").status_code == 404


def test_ein_ausgeschalteter_fernseher_gibt_keinen_serverfehler():
    """503 und nicht 500: Der Fernseher ist aus, der Hub ist heil – und die
    App zeigt den Satz, statt «Interner Fehler» zu schreiben."""
    client, attrappe = _api_aufbau()
    attrappe.absage = ConnectionError("Fernseher nicht erreichbar – ist er an?")
    with client:
        antwort = client.post("/api/androidtv/demo.light_livingroom/pair")
        assert antwort.status_code == 503
        assert "erreichbar" in antwort.json()["detail"]
