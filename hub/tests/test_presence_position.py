"""Ortung nach Position statt nach Flanke.

Der Fall, aus dem das hier entstand: Jemand verlässt das Haus, kommt nach
gut einer Stunde zurück - und die App führt ihn weiter als «unterwegs».
Die Ankunftsmeldung war eine Flanke, sie ging beim Wechsel von Mobilfunk
auf WLAN verloren, und eine verlorene Flanke kommt nie wieder. Der
Ankunfts-Ablauf lief entsprechend nie.

Eine Positionsmeldung beschreibt dagegen den ganzen Zustand. Sie darf
verloren gehen, denn die nächste rückt es gerade.
"""

from __future__ import annotations

import time

from homepilot.core import presence
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.integrations.geofence import GeofenceIntegration

# Ein Haus und eine weite Vorlaufzone auf demselben Punkt.
ORTE = [
    {"id": "home", "name": "Zuhause", "latitude": 47.1381, "longitude": 7.9228, "radius": 150.0},
    {"id": "quartier", "name": "Quartier", "latitude": 47.1381, "longitude": 7.9228, "radius": 3000.0},
]


# ── Das Rechnen ────────────────────────────────────────────────────────────


def test_a_point_in_the_house_is_inside_both_places():
    drin, unklar = presence.orte_fuer_position(ORTE, 47.1381, 7.9228, 10.0)
    assert drin == ["home", "quartier"]
    assert unklar == []


def test_a_fuzzy_fix_just_outside_the_house_decides_nothing():
    """Der Fehler, den ein entschiedenes «weg» anrichtet, ist grösser.

    180 m vom Haus weg, aber 70 m Streuung: Das sagt nicht «draussen»,
    es sagt «weiss nicht». Daran hängen Alarmanlage und «alles aus».
    """
    # Rund 180 m nördlich: 0.00162° Breite.
    drin, unklar = presence.orte_fuer_position(ORTE, 47.1381 + 0.00162, 7.9228, 70.0)
    assert "home" not in drin
    assert "home" in unklar


def test_an_unclear_place_keeps_what_the_hub_already_knew():
    vorher = ["home", "quartier"]
    neu = presence.inside_aus_position(
        vorher, ORTE, 47.1381 + 0.00162, 7.9228, 70.0
    )
    # «home» war bekannt und ist jetzt unklar - es bleibt stehen.
    assert "home" in neu


def test_a_precise_fix_outside_the_house_really_removes_it():
    neu = presence.inside_aus_position(
        ["home", "quartier"], ORTE, 47.1381 + 0.00162, 7.9228, 10.0
    )
    assert "home" not in neu
    assert "quartier" in neu


def test_a_position_replaces_the_whole_list_so_a_lost_report_heals():
    """Der Kern des Umbaus.

    Der Hub glaubt, die Person sei zuhause - die «leave»-Flanke ging
    verloren. Eine einzige Position aus der Stadt räumt das auf, ohne
    dass irgendjemand eine Grenze kreuzen müsste.
    """
    neu = presence.inside_aus_position(["home", "quartier"], ORTE, 47.05, 8.31, 20.0)
    assert neu == []


def test_a_place_from_life360_survives_a_position_report():
    """Das Telefon kann über «Tanners Home» nichts sagen.

    Der Ort steht nicht in den Orten des Hubs, also enthält die Messung
    keine Aussage über ihn. Ihn stillschweigend zu löschen hiesse, die
    eine Quelle mit der anderen zu überschreiben.
    """
    neu = presence.inside_aus_position(
        ["tanners_home"], ORTE, 47.05, 8.31, 20.0
    )
    assert neu == ["tanners_home"]


# ── «geändert» ist nicht «gehört» ──────────────────────────────────────────


def test_silence_is_measured_from_the_last_report_not_the_last_change():
    """Wer seit drei Tagen zuhause sitzt, ist nicht verschollen.

    Solange `settle` auf `changed_at` schaute, galt jeder als verstummt,
    der sich lange nicht *geändert* hatte - obwohl er sich im
    Minutentakt meldete.
    """
    jetzt = time.time()
    zustand = {
        "state": "home",
        "changed_at": jetzt - 3 * 24 * 3600,
        "last_seen": jetzt - 60,
    }
    assert presence.settle(zustand, jetzt)["state"] == "home"


def test_a_frozen_position_still_becomes_unknown():
    jetzt = time.time()
    zustand = {
        "state": "away",
        "changed_at": jetzt - 20 * 3600,
        "last_seen": jetzt - 20 * 3600,
    }
    assert presence.settle(zustand, jetzt)["state"] == "unknown"


def test_a_state_from_before_the_split_still_works():
    """Gespeicherte Zustände kennen `last_seen` nicht."""
    jetzt = time.time()
    assert presence.zuletzt_gehoert({"changed_at": jetzt - 30}) == jetzt - 30
    assert presence.zuletzt_gehoert({}) == 0.0


def test_the_diagnosis_reports_the_age_of_the_last_report():
    jetzt = time.time()
    zeile = presence.diagnose(
        "Stefan",
        {
            "state": "home",
            "source": "geofence",
            "changed_at": jetzt - 3 * 24 * 3600,
            "last_seen": jetzt - 45,
        },
        jetzt,
    )
    assert zeile["silent"] is False
    assert zeile["age_seconds"] == 45


# ── Der ganze Weg durch die Integration ────────────────────────────────────


async def make_geofence() -> tuple[Hub, GeofenceIntegration]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    integration = GeofenceIntegration(
        hub,
        {
            "integration": "geofence",
            "zones": [{"id": "stefan", "name": "Stefan"}],
            "places": ORTE,
        },
    )
    await integration.setup()
    return hub, integration


async def test_coming_home_is_noticed_even_though_the_leave_was_lost() -> None:
    """Der Fall, wegen dem der Umbau kam.

    Kein «enter» und kein «leave» - nur zwei Positionen. Die zweite
    genügt, um aus «unterwegs» wieder «zuhause» zu machen.
    """
    hub, geo = await make_geofence()
    try:
        await geo.report_position("stefan", 47.05, 8.31, accuracy=20.0)
        assert hub.registry.get("geofence.stefan").state["state"] == "away"

        await geo.report_position("stefan", 47.1381, 7.9228, accuracy=15.0)
        assert hub.registry.get("geofence.stefan").state["state"] == "home"
    finally:
        await hub.stop()


async def test_a_replayed_report_does_not_turn_back_the_clock() -> None:
    """Aus der Warteschlange des Telefons kommt Älteres nach.

    Ohne Zeitstempel legte sich die nachgereichte Messung von der
    Ausfahrt über die frische von zuhause - und man stand wieder
    «unterwegs», nachdem man schon angekommen war.
    """
    hub, geo = await make_geofence()
    try:
        jetzt = time.time()
        await geo.report_position("stefan", 47.1381, 7.9228, accuracy=15.0, at=jetzt)
        assert hub.registry.get("geofence.stefan").state["state"] == "home"

        # Die nachgereichte Meldung von vor zehn Minuten.
        await geo.report_position("stefan", 47.05, 8.31, accuracy=20.0, at=jetzt - 600)
        assert hub.registry.get("geofence.stefan").state["state"] == "home"
    finally:
        await hub.stop()


async def test_a_repeated_report_does_not_reset_since_when() -> None:
    """«seit wann zuhause» darf nicht bei jeder Meldung neu anfangen.

    Bei einer Meldung alle paar Minuten stand sonst dauerhaft «gerade
    angekommen».
    """
    hub, geo = await make_geofence()
    try:
        await geo.report_position("stefan", 47.1381, 7.9228, accuracy=15.0)
        erste = hub.registry.get("geofence.stefan").state["changed_at"]

        await geo.report_position("stefan", 47.1382, 7.9229, accuracy=15.0)
        zustand = hub.registry.get("geofence.stefan").state
        assert zustand["changed_at"] == erste
        assert zustand["last_seen"] > erste
    finally:
        await hub.stop()


async def test_a_coarse_indoor_fix_still_arrives_at_home() -> None:
    """Der Fall, an dem die erste Fassung des Umbaus scheiterte.

    Drinnen misst das Telefon über WLAN und Funkzellen, nicht über GPS –
    60 bis 100 Meter Streuung sind dort normal. Die App hatte eine
    Sperre, die bei so etwas gar nichts meldete; sie stammte aus der Zeit
    der enter/leave-Flanken, wo ein grober Fix ein falsches «weg» hätte
    erzeugen können.

    Beim Hub ist die Streuung dagegen richtig aufgehoben: Der Punkt liegt
    mitten im Hausradius, also ist er drin – ganz gleich, wie grob die
    Messung war. Unsicher wird es erst am Rand, und dort bleibt stehen,
    was der Hub schon wusste.
    """
    hub, geo = await make_geofence()
    try:
        await geo.report_position("stefan", 47.05, 8.31, accuracy=20.0)
        assert hub.registry.get("geofence.stefan").state["state"] == "away"

        # Im Haus, aber nur auf 100 m genau - gröber als der halbe Radius.
        await geo.report_position("stefan", 47.1381, 7.9228, accuracy=100.0)
        assert hub.registry.get("geofence.stefan").state["state"] == "home"
    finally:
        await hub.stop()


async def test_a_narrow_shop_does_not_block_the_house() -> None:
    """Ein erfasster Laden mit 50 m Radius darf das Haus nicht sperren.

    Die alte Sperre in der App rechnete über den *engsten* aller Orte.
    Ein einziger Laden zog damit die Schranke für jede Meldung auf 25
    Meter – auch für das Zuhause mit seinen 150.
    """
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    try:
        geo = GeofenceIntegration(
            hub,
            {
                "integration": "geofence",
                "zones": [{"id": "stefan", "name": "Stefan"}],
                "places": [
                    *ORTE,
                    {
                        "id": "coop",
                        "name": "Coop",
                        "latitude": 47.1600,
                        "longitude": 7.9500,
                        "radius": 50.0,
                    },
                ],
            },
        )
        await geo.setup()
        await geo.report_position("stefan", 47.1381, 7.9228, accuracy=100.0)
        assert hub.registry.get("geofence.stefan").state["state"] == "home"
    finally:
        await hub.stop()

    """Ein ungenauer Fix darf niemanden aus dem Haus werfen."""
    hub, geo = await make_geofence()
    try:
        await geo.report_position("stefan", 47.1381, 7.9228, accuracy=15.0)
        assert hub.registry.get("geofence.stefan").state["state"] == "home"

        # Knapp draussen, aber zu ungenau, um es zu entscheiden.
        await geo.report_position(
            "stefan", 47.1381 + 0.00162, 7.9228, accuracy=70.0
        )
        assert hub.registry.get("geofence.stefan").state["state"] == "home"
    finally:
        await hub.stop()


async def test_a_fuzzy_fix_near_home_does_not_arm_the_alarm() -> None:
    """Ein ungenauer Fix darf niemanden aus dem Haus werfen."""
    hub, geo = await make_geofence()
    try:
        await geo.report_position("stefan", 47.1381, 7.9228, accuracy=15.0)
        assert hub.registry.get("geofence.stefan").state["state"] == "home"

        # Knapp draussen, aber zu ungenau, um es zu entscheiden.
        await geo.report_position(
            "stefan", 47.1381 + 0.00162, 7.9228, accuracy=70.0
        )
        assert hub.registry.get("geofence.stefan").state["state"] == "home"
    finally:
        await hub.stop()
