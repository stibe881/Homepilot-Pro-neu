"""«Batterie schwach» kommt immer und immer wieder.

Zwei Wege führten dorthin, und dieser Test hält beide fest: der Merker
lag im Arbeitsspeicher und war nach jedem Neustart weg, und er fiel weg,
sobald ein Gerät kurz nichts meldete. Dazu das Quittieren – ein Aufschub
bis morgen früh, keine Abschaltung.
"""

import time
from datetime import datetime

from homepilot.core import batterie
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.core.watchdog import Watchdog


def test_a_warning_goes_out_once_and_not_again():
    """Eine schwache Batterie bleibt wochenlang schwach. Jeden Tag daran
    zu erinnern macht sie nicht voller."""
    jetzt = 1_000_000.0
    rows: list = []
    assert batterie.soll_melden(rows, "hm.melder", jetzt) is True

    rows = batterie.merke_meldung(rows, "hm.melder", jetzt)
    assert batterie.soll_melden(rows, "hm.melder", jetzt) is False
    # Auch eine Woche später nicht – der Merker liegt auf der Platte.
    assert batterie.soll_melden(rows, "hm.melder", jetzt + 7 * 86400) is False


def test_acknowledging_is_a_delay_not_a_switch():
    """«Bis morgen stumm» heisst: morgen früh noch einmal. Wer die
    Batterie bis dahin gewechselt hat, hört nichts mehr."""
    # Ein Dienstagabend um 23 Uhr.
    abend = datetime(2026, 8, 25, 23, 0).timestamp()
    rows = batterie.merke_meldung([], "hm.melder", abend)
    rows = batterie.quittiere(rows, "hm.melder", abend)

    assert batterie.ist_stumm(rows, "hm.melder", abend) is True
    assert batterie.soll_melden(rows, "hm.melder", abend) is False
    # Mitten in der Nacht: immer noch still.
    assert batterie.soll_melden(rows, "hm.melder", abend + 3600) is False
    # Am nächsten Morgen um acht: die Erinnerung.
    morgen = datetime(2026, 8, 26, 8, 0).timestamp()
    assert batterie.soll_melden(rows, "hm.melder", morgen) is True
    assert batterie.ist_stumm(rows, "hm.melder", morgen) is False

    # Und diese Erinnerung ist dann wieder die eine, die es gibt.
    rows = batterie.merke_meldung(rows, "hm.melder", morgen)
    assert batterie.soll_melden(rows, "hm.melder", morgen + 3600) is False


def test_tomorrow_means_the_next_morning_not_in_24_hours():
    """Wer abends um elf quittiert, will nicht am nächsten Abend um elf
    erinnert werden, sondern am Tag, an dem er wechseln kann."""
    abend = datetime(2026, 8, 25, 23, 30).timestamp()
    assert batterie.stumm_bis(abend) == datetime(2026, 8, 26, 8, 0).timestamp()
    frueh = datetime(2026, 8, 25, 6, 15).timestamp()
    assert batterie.stumm_bis(frueh) == datetime(2026, 8, 26, 8, 0).timestamp()


def test_a_changed_battery_arms_the_warning_again():
    """Nach dem Wechsel soll die nächste schwache Batterie desselben
    Geräts wieder zur Sprache kommen."""
    jetzt = 1_000_000.0
    rows = batterie.merke_meldung([], "hm.melder", jetzt)
    rows = batterie.vergiss(rows, ["hm.melder"])
    assert batterie.zeile(rows, "hm.melder") is None
    assert batterie.soll_melden(rows, "hm.melder", jetzt) is True


def test_old_rows_are_forgotten_but_the_others_stay():
    jetzt = 1_000_000_000.0
    alt = jetzt - 200 * 86400
    rows = [
        {"entity_id": "hm.alt", "at": alt, "until": 0},
        {"entity_id": "hm.neu", "at": jetzt - 86400, "until": 0},
        "kein Wörterbuch",
        {"ohne": "Kennung"},
    ]
    nachher = batterie.merke_meldung(rows, "hm.dritt", jetzt)
    kennungen = [row["entity_id"] for row in nachher]
    assert kennungen == ["hm.dritt", "hm.neu"]


# ── Mit echtem Hub ───────────────────────────────────────────────────────


def _melder(entity_id: str, low: bool | None) -> Entity:
    zustand = {"state": "off", "device_class": "motion"}
    if low is not None:
        zustand["low_battery"] = low
    return Entity(
        id=entity_id,
        kind=EntityKind.BINARY_SENSOR,
        name=f"Melder {entity_id.split('.')[-1]}",
        integration="hm",
        state=zustand,
    )


async def _hub_mit_melder(low: bool | None = True) -> tuple[Hub, Watchdog, list]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    await hub.registry.add(_melder("hm.flur", low))
    wache = Watchdog(hub)
    gemeldet: list = []

    async def merken(title, body, category="outage", to=None, data=None):
        gemeldet.append({"title": title, "category": category, "data": data})

    wache._notify = merken  # type: ignore[method-assign]
    return hub, wache, gemeldet


async def test_a_restart_does_not_repeat_the_warning():
    """Genau das war der Fall: Der Merker lag im Arbeitsspeicher, und
    jeder Neustart des Hubs schickte die Warnung erneut."""
    hub, wache, gemeldet = await _hub_mit_melder()
    try:
        await wache._check_batteries(hub.registry.all())
        assert len(gemeldet) == 1
        assert gemeldet[0]["title"] == "Batterie schwach: Melder flur"
        # Der Tipp auf die Nachricht soll zu den Batterien führen.
        assert gemeldet[0]["data"] == {
                "type": "battery",
                "entity_id": "hm.flur",
                # Wohin der Tipp führt: zur Liste mit dem Knopf zum
                # Quittieren, nicht auf die Startseite (core/pushziel.py).
                "ziel": "batterien",
            }

        # Ein frischer Wächter ist derselbe Neustart, nur schneller.
        zweiter = Watchdog(hub)
        zweiter._notify = wache._notify  # type: ignore[method-assign]
        await zweiter._check_batteries(hub.registry.all())
        assert len(gemeldet) == 1
    finally:
        await hub.stop()


async def test_a_sensor_that_briefly_says_nothing_does_not_repeat_it_either():
    """Ein Funksensor, der sich neu anmeldet, steht einen Moment ohne
    Batterieangabe da. Daran fiel der Merker weg."""
    hub, wache, gemeldet = await _hub_mit_melder()
    try:
        await wache._check_batteries(hub.registry.all())
        assert len(gemeldet) == 1

        # Neu angemeldet: der Zustand kommt ohne low_battery zurück.
        await hub.registry.add(_melder("hm.flur", None))
        await wache._check_batteries(hub.registry.all())
        # Und gleich darauf meldet er wieder «schwach».
        await hub.registry.add(_melder("hm.flur", True))
        await wache._check_batteries(hub.registry.all())
        assert len(gemeldet) == 1
    finally:
        await hub.stop()


async def test_an_explicit_all_clear_arms_the_warning_again():
    """Nur ein ausdrückliches «Batterie in Ordnung» vergisst den Merker –
    dann ist die nächste schwache Batterie wieder eine Meldung wert."""
    hub, wache, gemeldet = await _hub_mit_melder()
    try:
        await wache._check_batteries(hub.registry.all())
        assert len(gemeldet) == 1

        await hub.registry.add(_melder("hm.flur", False))
        await wache._check_batteries(hub.registry.all())
        assert len(gemeldet) == 1  # in Ordnung ist keine Meldung

        await hub.registry.add(_melder("hm.flur", True))
        await wache._check_batteries(hub.registry.all())
        assert len(gemeldet) == 2
    finally:
        await hub.stop()


async def test_the_routes_acknowledge_and_undo():
    """Quittieren und der Fehlgriff danach."""
    from fastapi.testclient import TestClient

    from homepilot.api import create_app

    from .conftest import make_config

    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        assert client.get("/api/batteries").json() == {"batteries": []}

        # Ein Gerät, das es nicht gibt, lässt sich nicht quittieren.
        assert client.post("/api/batteries/nope.nope/ack").status_code == 404

        antwort = client.post("/api/batteries/demo.motion_hall/ack")
        assert antwort.status_code == 200
        assert antwort.json()["muted_until"] > time.time()

        zeilen = client.get("/api/batteries").json()["batteries"]
        assert len(zeilen) == 1
        assert zeilen[0]["entity_id"] == "demo.motion_hall"
        assert zeilen[0]["muted"] is True

        assert client.delete("/api/batteries/demo.motion_hall/ack").status_code == 200
        assert client.get("/api/batteries").json() == {"batteries": []}
