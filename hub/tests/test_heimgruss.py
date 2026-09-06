"""Der Anrufbeantworter des Hauses (Punkt 259 der Werkbank).

Eine Sprachnotiz «fürs nächste Heimkommen»: Wer als Nächstes ankommt,
hört sie auf der gewählten Box - danach ist sie verbraucht. Die Tests
halten die drei Regeln fest, an denen das kippen kann: Der Hinterleger
verbraucht sie nicht selbst, die Neustart-Welle unknown→home verbraucht
sie nicht, und nach 48 Stunden ist sie kalt.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from homepilot.api.server import create_app
from homepilot.core import heimgruss, say
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.integrations.geofence import GeofenceIntegration

from .conftest import make_config

WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 2000

JETZT = 1_700_000_000.0


def eintrag(zone: str = "stefan", at: float = JETZT) -> dict:
    return heimgruss.neuer_eintrag(
        wer="Stefan", zone=zone, speakers=["cast.kueche"], volume=None,
        typ="audio/webm", now=at,
    )


# ── Die reine Logik ──────────────────────────────────────────────────────


def test_a_second_message_replaces_the_first() -> None:
    # Ein Band, keine Warteschlange: Wer eine zweite hinterlegt,
    # überspielt die erste.
    zweite = eintrag(at=JETZT + 60)
    assert heimgruss.ablegen([eintrag()], zweite) == [zweite]


def test_a_fresh_message_is_open_an_old_one_is_cold() -> None:
    assert heimgruss.offen([eintrag()], JETZT + 3600) is not None
    # Nach 48 Stunden stimmt «Lasagne im Ofen» nicht mehr.
    kalt = JETZT + heimgruss.VERFALL_STUNDEN * 3600 + 1
    assert heimgruss.offen([eintrag()], kalt) is None


def test_the_public_view_carries_no_audio_and_no_zone() -> None:
    sicht = heimgruss.oeffentlich(eintrag())
    assert sicht["by"] == "Stefan"
    assert sicht["until"] == JETZT + heimgruss.VERFALL_STUNDEN * 3600
    assert "zone" not in sicht and "typ" not in sicht


def test_the_depositor_does_not_consume_their_own_message() -> None:
    # Wer sie gesprochen hat, weiss, was drin ist - erst der nächste
    # andere Ankömmling verbraucht sie.
    lage = heimgruss.entscheidung([eintrag(zone="stefan")], "stefan", JETZT, False)
    assert lage == heimgruss.EIGENE


def test_any_other_arrival_plays_the_message() -> None:
    lage = heimgruss.entscheidung([eintrag(zone="stefan")], "livia", JETZT, False)
    assert lage == heimgruss.SPIELEN


def test_without_a_zone_the_message_plays_for_everyone() -> None:
    # Die Route konnte keine Kennung ausrechnen: lieber einmal die
    # eigene Stimme hören als eine Nachricht, die nie abläuft.
    lage = heimgruss.entscheidung([eintrag(zone="")], "stefan", JETZT, False)
    assert lage == heimgruss.SPIELEN


def test_quiet_night_neither_plays_nor_consumes() -> None:
    # Wer um halb zwölf heimkommt, soll das Haus nicht wecken - die
    # Nachricht wartet auf die nächste Ankunft bei Tag.
    lage = heimgruss.entscheidung([eintrag(zone="stefan")], "livia", JETZT, True)
    assert lage == heimgruss.NACHTRUHE


def test_an_expired_message_reports_itself_for_cleanup() -> None:
    kalt = JETZT + heimgruss.VERFALL_STUNDEN * 3600 + 1
    assert (
        heimgruss.entscheidung([eintrag()], "livia", kalt, False)
        == heimgruss.ABGELAUFEN
    )
    assert heimgruss.entscheidung([], "livia", JETZT, False) == heimgruss.KEINE


# ── Der Haken an der Ankunft ─────────────────────────────────────────────


class _Push:
    def __init__(self) -> None:
        self.gesendet: list[tuple[str, str]] = []
        self.an: list[str] = []

    def recipients(self, users, to="all", category=None):
        del users, category
        self.an.append(to)
        return ["token"]

    async def send(self, tokens, title, body, data=None, image=None, category=None):
        del tokens, data, image, category
        self.gesendet.append((title, body))


async def make_geofence() -> tuple[Hub, GeofenceIntegration]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    integration = GeofenceIntegration(
        hub,
        {
            "integration": "geofence",
            "zones": [
                {"id": "stefan", "name": "Stefan"},
                {"id": "livia", "name": "Livia"},
            ],
        },
    )
    await integration.setup()
    return hub, integration


def hinterlegen(hub: Hub, zone: str = "stefan") -> None:
    hub.data.set(heimgruss.KEY, [eintrag(zone=zone, at=time.time())])
    hub.heimgruss_audio = WEBM
    say.remember_base(hub, "http://127.0.0.1:8199")


@pytest.fixture
def gespielt(monkeypatch) -> list[dict]:
    """Fängt play_audio ab - die Boxen der Tests sind Attrappen."""
    laeufe: list[dict] = []

    async def fake(hub, audio, address, speakers=None, volume=None, source=None):
        del hub, address, source
        laeufe.append({"audio": audio, "speakers": speakers, "volume": volume})
        return {"sent": ["Küche"], "errors": []}

    monkeypatch.setattr(say, "play_audio", fake)
    # Die Nachtruhe darf den Test nicht von der Tageszeit abhängig machen.
    monkeypatch.setattr(heimgruss.nachtruhe, "still", lambda jetzt: False)
    return laeufe


async def test_the_next_other_arrival_plays_and_consumes(gespielt) -> None:
    hub, geo = await make_geofence()
    push = _Push()
    hub.push = push
    try:
        hinterlegen(hub, zone="stefan")
        await geo.report("livia", "leave")
        await geo.report("livia", "enter")
        assert len(gespielt) == 1
        assert gespielt[0]["audio"] == WEBM
        # Auf der beim Hinterlegen gewählten Box, nicht auf allen.
        assert gespielt[0]["speakers"] == ["cast.kueche"]
        # Verbraucht: Ein Anrufbeantworter wiederholt sich nicht.
        assert heimgruss.offen(hub.data.get(heimgruss.KEY), time.time()) is None
        assert heimgruss.audio_lesen(hub) is None
        # Und der Hinterleger erfährt es - an ihn, nicht an alle.
        assert "Stefan" in push.an
        assert any("Livia ist angekommen" in body for _, body in push.gesendet)
    finally:
        await hub.stop()


async def test_the_depositors_own_arrival_leaves_the_message(gespielt) -> None:
    hub, geo = await make_geofence()
    hub.push = _Push()
    try:
        hinterlegen(hub, zone="stefan")
        await geo.report("stefan", "leave")
        await geo.report("stefan", "enter")
        assert gespielt == []
        assert heimgruss.offen(hub.data.get(heimgruss.KEY), time.time()) is not None
    finally:
        await hub.stop()


async def test_the_restart_wave_does_not_consume_the_message(gespielt) -> None:
    """Nach einem Neustart melden alle Telefone einmal unknown→home.

    Dieselbe Vorsicht wie bei der «ist angekommen»-Push (geofence._sagen)
    und beim presence-Auslöser in core/automation.py: Wer längst dasitzt,
    ist nicht angekommen - sonst wäre jedes Update ein Abspielen.
    """
    hub, geo = await make_geofence()
    hub.push = _Push()
    try:
        hinterlegen(hub, zone="stefan")
        # Erste Meldung überhaupt: Vorzustand unbekannt.
        await geo.report("livia", "enter")
        assert gespielt == []
        assert heimgruss.offen(hub.data.get(heimgruss.KEY), time.time()) is not None
    finally:
        await hub.stop()


async def test_an_unreached_box_keeps_the_message(monkeypatch) -> None:
    """Was nicht gespielt hat, ist nicht gehört - der nächste Versuch
    kommt mit der nächsten Ankunft."""

    async def stumm(hub, audio, address, speakers=None, volume=None, source=None):
        del hub, audio, address, speakers, volume, source
        return {"sent": [], "errors": ["Küche: keine Antwort"]}

    monkeypatch.setattr(say, "play_audio", stumm)
    monkeypatch.setattr(heimgruss.nachtruhe, "still", lambda jetzt: False)
    hub, geo = await make_geofence()
    hub.push = _Push()
    try:
        hinterlegen(hub, zone="stefan")
        await geo.report("livia", "leave")
        await geo.report("livia", "enter")
        assert heimgruss.offen(hub.data.get(heimgruss.KEY), time.time()) is not None
    finally:
        await hub.stop()


async def test_a_cold_message_is_cleaned_up_on_arrival(gespielt) -> None:
    hub, geo = await make_geofence()
    hub.push = _Push()
    try:
        alt = time.time() - heimgruss.VERFALL_STUNDEN * 3600 - 60
        hub.data.set(heimgruss.KEY, [eintrag(zone="stefan", at=alt)])
        hub.heimgruss_audio = WEBM
        say.remember_base(hub, "http://127.0.0.1:8199")
        await geo.report("livia", "leave")
        await geo.report("livia", "enter")
        assert gespielt == []
        # Weggeräumt, nicht nur übergangen: Der Ton soll nicht als
        # Leiche neben der Datendatei liegen bleiben.
        assert hub.data.get(heimgruss.KEY) == []
        assert heimgruss.audio_lesen(hub) is None
    finally:
        await hub.stop()


async def test_during_quiet_night_the_message_waits(monkeypatch, gespielt) -> None:
    monkeypatch.setattr(heimgruss.nachtruhe, "still", lambda jetzt: True)
    hub, geo = await make_geofence()
    hub.push = _Push()
    try:
        hinterlegen(hub, zone="stefan")
        await geo.report("livia", "leave")
        await geo.report("livia", "enter")
        assert gespielt == []
        assert heimgruss.offen(hub.data.get(heimgruss.KEY), time.time()) is not None
    finally:
        await hub.stop()


# ── Die Routen ───────────────────────────────────────────────────────────


def test_the_routes_deposit_show_and_withdraw() -> None:
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        # Nichts hinterlegt: message ist null, kein Fehler.
        assert client.get("/api/heimgruss").json()["message"] is None

        antwort = client.post(
            "/api/heimgruss/voice?speakers=demo.speaker&volume=40", content=WEBM
        )
        assert antwort.status_code == 200
        nachricht = antwort.json()["message"]
        assert nachricht["by"]
        assert nachricht["speakers"] == ["demo.speaker"]

        stand = client.get("/api/heimgruss").json()["message"]
        assert stand is not None and stand["by"] == nachricht["by"]
        # Der Ton liegt beim Hub bereit - unverändert, wie bei der
        # Sprachnotiz: Der Hub wandelt nichts um.
        assert heimgruss.audio_lesen(hub) == WEBM

        assert client.delete("/api/heimgruss").json()["message"] is None
        assert client.get("/api/heimgruss").json()["message"] is None
        assert heimgruss.audio_lesen(hub) is None


def test_the_route_rejects_a_slipped_button() -> None:
    with TestClient(create_app(Hub(make_config()))) as client:
        antwort = client.post("/api/heimgruss/voice", content=b"kurz")
        assert antwort.status_code == 400
        assert "zu kurz" in antwort.json()["detail"]
