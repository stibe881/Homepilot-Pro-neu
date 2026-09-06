"""Zigbee meldet seine Funkqualität, und jetzt liest sie jemand (Punkt 230).

Der Fall dahinter: Ein Gerät, dessen linkquality seit Wochen fällt,
verstummt irgendwann ganz - und dann sucht man den Fehler bei der
Batterie. Der Wächter soll den Abstieg vorher melden, je Gerät höchstens
einmal, und erst wieder, wenn der Funk sich deutlich erholt hat.
"""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import funkqualitaet
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.core.watchdog import Watchdog

from .conftest import make_config

START = date(2026, 8, 3)  # ein Montag


def woechentlich(
    staende: list[float], entity_id: str = "zigbee.melder", rows: list | None = None
) -> list:
    rows = list(rows or [])
    for index, stand in enumerate(staende):
        rows = funkqualitaet.aufnehmen(
            rows, entity_id, stand, START + timedelta(weeks=index)
        )
    return rows


# ── Die reine Rechnung ───────────────────────────────────────────────────


def test_within_a_week_the_mean_counts_not_the_last_value():
    """linkquality springt um Dutzende Punkte - der letzte Wert der
    Woche wäre ein Münzwurf, das Mittel ist stabil."""
    rows = funkqualitaet.aufnehmen([], "zigbee.melder", 100.0, START)
    rows = funkqualitaet.aufnehmen(rows, "zigbee.melder", 50.0, START + timedelta(days=2))
    assert len(rows) == 1
    assert rows[0]["lqi"] == 75.0
    assert rows[0]["n"] == 2


def test_a_young_series_gives_no_verdict():
    """Unter drei Wochen Daten wäre der Trend geraten."""
    rows = woechentlich([180, 40])
    assert funkqualitaet.mittelwerte(rows, "zigbee.melder") is None
    assert funkqualitaet.bewertung(rows, "zigbee.melder") is None
    assert funkqualitaet.richtung(rows, "zigbee.melder") is None


def test_a_fall_below_half_and_below_enough_is_weak():
    rows = woechentlich([180, 180, 50, 30])
    schwach = funkqualitaet.bewertung(rows, "zigbee.melder")
    assert schwach == {"von": 180, "auf": 40}
    assert funkqualitaet.richtung(rows, "zigbee.melder") == "falling"


def test_critically_low_counts_even_without_a_fall():
    """Ein Gerät, das seit je bei 25 funkt, ist schwach - auch ohne
    erzählbaren Absturz."""
    rows = woechentlich([25, 26, 24, 25])
    schwach = funkqualitaet.bewertung(rows, "zigbee.melder")
    assert schwach is not None
    assert schwach["auf"] < funkqualitaet.KRITISCH
    # Und der Satz erfindet dazu keinen Absturz.
    assert "seit Wochen schwach" in funkqualitaet.satz(
        schwach["von"], schwach["auf"]
    )


def test_a_halving_that_stays_high_is_no_alarm():
    """Von 255 auf 127 ist immer noch ein grundsolider Funkweg - eine
    Meldung darüber wäre Lärm, den man abbestellt. Als Richtung darf es
    die App trotzdem zeigen."""
    rows = woechentlich([255, 255, 130, 124])
    assert funkqualitaet.bewertung(rows, "zigbee.melder") is None
    assert funkqualitaet.richtung(rows, "zigbee.melder") == "falling"


def test_a_stable_radio_is_steady_and_never_weak():
    rows = woechentlich([120, 118, 122, 121])
    assert funkqualitaet.bewertung(rows, "zigbee.melder") is None
    assert funkqualitaet.richtung(rows, "zigbee.melder") == "steady"


def test_recovery_must_be_clear_not_a_crawl_over_the_threshold():
    """Wer knapp um die Schwelle pendelt, bekäme sonst im Wochentakt
    dieselbe Nachricht."""
    knapp = woechentlich([180, 180, 40, 45])
    assert funkqualitaet.erholt(knapp, "zigbee.melder", 40) is False
    deutlich = woechentlich([180, 180, 40, 30, 110, 120])
    assert funkqualitaet.erholt(deutlich, "zigbee.melder", 40) is True


def test_the_series_is_capped_and_reads_broken_rows_defensively():
    rows = woechentlich([100.0] * (funkqualitaet.WOCHEN + 10))
    assert len(rows) == funkqualitaet.WOCHEN
    kaputt = ["kein Wörterbuch", {"ohne": "Kennung"}, None]
    assert funkqualitaet.mittelwerte(kaputt, "zigbee.melder") is None
    assert funkqualitaet.aufnehmen(kaputt, "zigbee.melder", 80.0, START)[-1][
        "lqi"
    ] == 80.0


def test_the_sentence_names_the_development():
    assert funkqualitaet.satz(180, 40) == "Funkqualität von 180 auf 40 gefallen."


def test_the_report_memory_keeps_one_row_per_device():
    jetzt = 1_000_000_000.0
    rows = funkqualitaet.merke_meldung([], "zigbee.melder", 40, jetzt)
    assert funkqualitaet.gemeldet_zeile(rows, "zigbee.melder")["auf"] == 40.0
    # Alte Zeilen fallen weg, fremde bleiben.
    alt = [{"entity_id": "zigbee.uralt", "at": jetzt - 200 * 86400, "auf": 20}]
    rows = funkqualitaet.merke_meldung(alt, "zigbee.melder", 40, jetzt)
    assert [row["entity_id"] for row in rows] == ["zigbee.melder"]
    rows = funkqualitaet.vergiss(rows, ["zigbee.melder"])
    assert funkqualitaet.gemeldet_zeile(rows, "zigbee.melder") is None


# ── Mit echtem Hub: der Wächter ─────────────────────────────────────────


def _funker(entity_id: str, lqi: float) -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.SENSOR,
        name=f"Melder {entity_id.split('.')[-1]}",
        integration="zigbee",
        state={"state": 21.5, "linkquality": lqi},
    )


async def _hub_mit_funker(lqi: float = 35.0) -> tuple[Hub, Watchdog, list]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    await hub.registry.add(_funker("zigbee.flur", lqi))
    wache = Watchdog(hub)
    gemeldet: list = []

    async def merken(title, body, category="outage", to=None, data=None, entity_id=None):
        gemeldet.append({"title": title, "body": body, "category": category})

    wache._notify = merken  # type: ignore[method-assign]
    return hub, wache, gemeldet


async def test_a_falling_radio_is_reported_once_with_its_development():
    hub, wache, gemeldet = await _hub_mit_funker()
    try:
        hub.data.set(
            funkqualitaet.STORE_KEY, woechentlich([180, 180, 50, 30], "zigbee.flur")
        )
        await wache._check_funk(hub.registry.all())
        assert len(gemeldet) == 1
        assert gemeldet[0]["title"] == "Funk wird schwach: Melder flur"
        # Der Text nennt Gerät und Entwicklung. Die genaue Zielzahl hängt
        # an der Stichprobe von heute, die der Wächter gerade dazulegt -
        # der Ausgangswert nicht.
        assert "Funkqualität von 180 auf " in gemeldet[0]["body"]
        assert "gefallen" in gemeldet[0]["body"]
        # maintenance hat ein Push-Ziel samt Erledigt-Knöpfen (pushziel.py).
        assert gemeldet[0]["category"] == "maintenance"

        # Ein frischer Wächter ist ein Neustart, nur schneller: Das
        # Gedächtnis liegt in der hub.data, die Meldung kommt nicht wieder.
        zweiter = Watchdog(hub)
        zweiter._notify = wache._notify  # type: ignore[method-assign]
        await zweiter._check_funk(hub.registry.all())
        assert len(gemeldet) == 1
    finally:
        await hub.stop()


async def test_within_the_hour_nothing_is_collected_twice():
    """Nicht jede Runde: Das Wochenmittel änderte sich sonst im
    Minutentakt, und jede Änderung schriebe die Datendatei."""
    hub, wache, gemeldet = await _hub_mit_funker()
    try:
        await wache._check_funk(hub.registry.all())
        stand = hub.data.get(funkqualitaet.STORE_KEY)
        assert stand and stand[0]["n"] == 1
        await wache._check_funk(hub.registry.all())
        assert hub.data.get(funkqualitaet.STORE_KEY)[0]["n"] == 1
    finally:
        await hub.stop()


async def test_after_a_clear_recovery_the_warning_is_armed_again():
    hub, wache, gemeldet = await _hub_mit_funker()
    try:
        hub.data.set(
            funkqualitaet.STORE_KEY, woechentlich([180, 180, 50, 30], "zigbee.flur")
        )
        await wache._check_funk(hub.registry.all())
        assert len(gemeldet) == 1

        # Der Repeater steht: Das Mittel erholt sich deutlich.
        hub.data.set(
            funkqualitaet.STORE_KEY,
            woechentlich([180, 180, 50, 30, 110, 120], "zigbee.flur"),
        )
        wache._funk_gesammelt = 0.0
        await wache._check_funk(hub.registry.all())
        assert funkqualitaet.gemeldet_zeile(
            hub.data.get(funkqualitaet.MELDUNG_KEY), "zigbee.flur"
        ) is None

        # Und der nächste Abstieg ist wieder eine Meldung wert.
        hub.data.set(
            funkqualitaet.STORE_KEY,
            woechentlich(
                [180, 180, 50, 30, 110, 120, 25, 20, 22, 18], "zigbee.flur"
            ),
        )
        wache._funk_gesammelt = 0.0
        await wache._check_funk(hub.registry.all())
        assert len(gemeldet) == 2
    finally:
        await hub.stop()


# ── Die Route für die App ────────────────────────────────────────────────


def test_the_funk_route_serves_value_trend_and_direction():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        entity = hub.registry.get("demo.temp_livingroom")
        entity.state["linkquality"] = 34
        hub.data.set(
            funkqualitaet.STORE_KEY, woechentlich([180, 180, 50, 30], entity.id)
        )
        data = client.get("/api/funk").json()
        radios = {row["entity_id"]: row for row in data["radios"]}
        # Nur Geräte mit linkquality - der Rest des Hauses funkt anders.
        assert set(radios) == {entity.id}
        row = radios[entity.id]
        assert row["value"] == 34.0
        assert row["mean_from"] == 180
        assert row["mean_to"] == 40
        assert row["direction"] == "falling"
        assert row["weak"] is True


def test_the_funk_route_invents_no_trend_for_young_series():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        entity = hub.registry.get("demo.temp_livingroom")
        entity.state["linkquality"] = 120
        data = client.get("/api/funk").json()
        row = data["radios"][0]
        assert row["mean_from"] is None
        assert row["direction"] is None
        assert row["weak"] is False
