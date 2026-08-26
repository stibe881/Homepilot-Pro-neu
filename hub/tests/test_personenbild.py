"""Das Bild soll vom Moment kommen, in dem jemand im Bild steht.

Der Fall aus dem Haus: Ein Bewegungsmelder löst aus, die Push kommt mit
Bild – und auf dem Bild ist niemand. Der Weg vom Melder zur Kamera dauert
ein paar Sekunden, und wie viele, wechselt.

Geprüft wird beides: dass die Nachricht deswegen nicht später kommt, und
dass das Bild trotzdem das spätere ist.
"""

from __future__ import annotations

import asyncio

import pytest

from homepilot.core import personenbild
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub

# Ein Fenster von einer halben Sekunde: lang genug, dass der Test das
# Warten wirklich durchläuft, kurz genug, dass er nicht bummelt.
FENSTER = 0.5


def kamera(entity_id: str = "demo.kamera", **state) -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.CAMERA,
        name="Türkamera",
        integration="demo",
        state={"state": "online", **state},
        commands=[],
        room="Eingang",
    )


def melder(entity_id: str = "demo.melder") -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.BINARY_SENSOR,
        name="Bewegungsmelder",
        integration="demo",
        state={"state": "off"},
        commands=[],
        room="Eingang",
    )


# ── Das Rechnen für sich ───────────────────────────────────────────────


def test_eine_kamera_ohne_das_feld_kann_keine_personen_melden():
    assert personenbild.kann_person(kamera()) is False
    assert personenbild.kann_person(kamera(detected_person="off")) is True
    assert personenbild.kann_person(None) is False


def test_auf_eine_kamera_die_schon_jemanden_sieht_wird_nicht_gewartet():
    """Der Türklingel-Fall: Der Besucher steht jetzt im Bild, nicht gleich."""
    assert personenbild.lohnt_warten(kamera(detected_person="off")) is True
    assert personenbild.lohnt_warten(kamera(detected_person="on")) is False
    # Und ohne Personenerkennung gibt es nichts zu erwarten.
    assert personenbild.lohnt_warten(kamera()) is False


def test_gezaehlt_wird_das_auftauchen_und_nicht_das_dastehen():
    """Die Flanke, nicht der Pegel."""
    assert personenbild.ist_personenmeldung({"detected_person": "off"},
                                            {"detected_person": "on"}) is True
    # Schon vorher da: keine neue Meldung.
    assert personenbild.ist_personenmeldung({"detected_person": "on"},
                                            {"detected_person": "on"}) is False
    # Und das Ende der Erkennung ist erst recht keine.
    assert personenbild.ist_personenmeldung({"detected_person": "on"},
                                            {"detected_person": "off"}) is False
    # Eine Kamera, die das Feld gar nicht kennt, meldet nie.
    assert personenbild.ist_personenmeldung({}, {"motion": "on"}) is False


def test_das_fenster_kommt_aus_der_konfiguration_und_haelt_unsinn_aus():
    assert personenbild.fenster(None) == personenbild.FENSTER
    assert personenbild.fenster({}) == personenbild.FENSTER
    assert personenbild.fenster({"person_fenster": 4}) == 4.0
    # Null schaltet das Nachreichen ab – das muss man können.
    assert personenbild.fenster({"person_fenster": 0}) == 0.0
    # Text und negative Zahlen dürfen den Hub nicht stoppen.
    assert personenbild.fenster({"person_fenster": "bald"}) == personenbild.FENSTER
    assert personenbild.fenster({"person_fenster": -3}) == personenbild.FENSTER


# ── Der ganze Weg ──────────────────────────────────────────────────────


async def _hub(monkeypatch, bilder: list[bytes], *, fenster: float = FENSTER):
    """Ein Hub mit Melder und Kamera, die der Reihe nach ``bilder`` liefert."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    await hub.registry.add(melder())
    await hub.registry.add(kamera(detected_person="off"))
    hub.config.push = {"public_url": "https://haus.example", "person_fenster": fenster}

    rest = list(bilder)

    async def liefert(_entity):
        return rest.pop(0) if rest else bilder[-1]

    monkeypatch.setattr(hub.integrations.get("demo"), "snapshot", liefert, raising=False)
    return hub


async def _melden(hub) -> list[dict]:
    """Einen meldenden Ablauf mit «der Kamera, die ausgelöst hat» auslösen."""
    gesendet: list[dict] = []

    async def merken(tokens, title, body, data=None, image=None, **_):
        gesendet.append({"title": title, "image": image})
        return 1

    hub.push.send = merken
    hub.push.register("ExponentPushToken[x]", "Stefan")
    automation = type("A", (), {"id": "bewegung", "alias": "Bewegung"})()
    await hub.automations._notify(
        automation,
        {"type": "notify", "to": "all", "title": "Bewegung", "body": "",
         "camera": "demo.kamera"},
        "demo.melder",
    )
    return gesendet


def _token(url: str) -> str:
    return url.rsplit("/", 1)[-1]


@pytest.mark.asyncio
async def test_das_bild_kommt_vom_moment_der_personenerkennung(monkeypatch):
    """Der eigentliche Fall: erst leer, dann steht jemand da."""
    leer, person = b"\xff\xd8\xff-leerer-vorplatz", b"\xff\xd8\xff-jemand-steht-da"
    hub = await _hub(monkeypatch, [leer, person])
    try:
        gesendet = await _melden(hub)
        token = _token(gesendet[0]["image"])

        # Die Adresse steht schon in der Nachricht, das Bild noch nicht fest.
        assert hub.snapshots.get(token) is None

        # Das Rückfallbild ist geholt, die Wache horcht.
        await asyncio.sleep(0.05)
        # Jetzt läuft jemand ins Bild.
        await hub.registry.update_state("demo.kamera", {"detected_person": "on"})

        assert await hub.snapshots.warten(token, 1.0) == person
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_die_nachricht_wartet_nicht_auf_die_person(monkeypatch):
    """Der Ton kommt sofort – nur das Bild reift nach."""
    hub = await _hub(monkeypatch, [b"\xff\xd8\xff-leer"], fenster=30.0)
    try:
        begonnen = asyncio.get_running_loop().time()
        gesendet = await _melden(hub)
        gedauert = asyncio.get_running_loop().time() - begonnen

        assert [n["title"] for n in gesendet] == ["Bewegung"]
        assert gesendet[0]["image"].startswith("https://haus.example")
        # Grosszügig gemessen: Es geht um Sekundenbruchteile gegen dreissig.
        assert gedauert < 1.0
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_ohne_personenmeldung_kommt_das_bild_vom_ausloeser(monkeypatch):
    """Wer nie im Bild auftaucht, soll trotzdem ein Bild bekommen."""
    leer = b"\xff\xd8\xff-leerer-vorplatz"
    hub = await _hub(monkeypatch, [leer])
    try:
        gesendet = await _melden(hub)
        token = _token(gesendet[0]["image"])
        # Nach Ablauf des Fensters steht das Rückfallbild da – kein 404.
        assert await hub.snapshots.warten(token, 2.0) == leer
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_eine_kamera_ohne_personenerkennung_liefert_sofort(monkeypatch):
    """Nichts zu gewinnen, also kein Nachreichen – wie bisher."""
    bild = b"\xff\xd8\xff-sofort"
    hub = await _hub(monkeypatch, [bild])
    try:
        # Das Feld wieder weg: Diese Kamera kann keine Personen melden.
        await hub.registry.add(kamera())
        gesendet = await _melden(hub)
        # Das Bild liegt schon da, ohne dass jemand warten musste.
        assert hub.snapshots.get(_token(gesendet[0]["image"])) == bild
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_ein_fenster_von_null_schaltet_das_nachreichen_ab(monkeypatch):
    """Die Notbremse in der config.yaml – zurück zum alten Verhalten."""
    bild = b"\xff\xd8\xff-sofort"
    hub = await _hub(monkeypatch, [bild], fenster=0)
    try:
        gesendet = await _melden(hub)
        assert hub.snapshots.get(_token(gesendet[0]["image"])) == bild
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_eine_stumme_kamera_laesst_niemanden_haengen(monkeypatch):
    """Kein Bild ist eine Antwort – und muss schnell kommen.

    Sonst hinge die Auslieferung an das Telefon bis zur vollen Frist auf
    etwas, das längst feststeht.
    """
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        await hub.registry.add(melder())
        await hub.registry.add(kamera(detected_person="off"))
        hub.config.push = {"public_url": "https://haus.example",
                           "person_fenster": FENSTER}

        async def schweigt(_entity):
            return None

        monkeypatch.setattr(hub.integrations.get("demo"), "snapshot", schweigt,
                            raising=False)
        gesendet = await _melden(hub)
        token = _token(gesendet[0]["image"])

        begonnen = asyncio.get_running_loop().time()
        assert await hub.snapshots.warten(token, 5.0) is None
        # Beendet, weil das Fenster ablief – nicht, weil die Geduld endete.
        assert asyncio.get_running_loop().time() - begonnen < 3.0
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_die_auslieferung_haelt_die_anfrage_bis_das_bild_da_ist(monkeypatch):
    """Der ganze Weg, wie das Telefon ihn geht.

    Bis hierher wurde die Ablage geprüft; das hier prüft die Route. Sie
    ist der Punkt, an dem sich entscheidet, ob der Empfänger ein Bild
    oder einen leeren Kasten sieht: Ruft das Telefon ab, während der Hub
    noch auf die Person wartet, muss die Anfrage stillhalten statt 404 zu
    sagen.
    """
    import httpx

    from homepilot.api import create_app

    leer, person = b"\xff\xd8\xff-leerer-flur", b"\xff\xd8\xff-jemand-steht-da"
    hub = await _hub(monkeypatch, [leer, person])
    try:
        gesendet = await _melden(hub)
        token = _token(gesendet[0]["image"])

        async def abrufen():
            transport = httpx.ASGITransport(app=create_app(hub))
            async with httpx.AsyncClient(
                transport=transport, base_url="https://haus.example"
            ) as client:
                # Ohne Anmeldung – das Betriebssystem hat keinen Token.
                return await client.get(f"/api/push/image/{token}")

        async def hereinlaufen():
            await asyncio.sleep(0.05)
            await hub.registry.update_state("demo.kamera", {"detected_person": "on"})

        antwort, _ = await asyncio.gather(abrufen(), hereinlaufen())

        assert antwort.status_code == 200
        assert antwort.headers["content-type"] == "image/jpeg"
        # Und zwar das Bild von *danach*, nicht das vom leeren Flur.
        assert antwort.content == person
    finally:
        await hub.stop()
