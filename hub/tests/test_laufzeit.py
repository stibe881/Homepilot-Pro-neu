"""Fortschritt laufender Haushaltgeräte – fürs Widget."""

from __future__ import annotations

from homepilot.core import laufzeit
from homepilot.core.entity import Entity


def lauf(entity_id: str, minuten: float) -> dict[str, object]:
    return {"entity_id": entity_id, "name": "Waschmaschine", "seconds": minuten * 60}


def maschine(
    entity_id: str = "demo.washer",
    minutes_left: object = 20,
    program: str | None = "Buntwäsche",
    state: str = "running",
    target: object = None,
) -> Entity:
    stand: dict[str, object] = {"state": state}
    if minutes_left is not None:
        stand["minutes_left"] = minutes_left
    if program is not None:
        stand["program"] = program
    if target is not None:
        stand["target"] = target
    return Entity(
        id=entity_id,
        kind="appliance",
        name="Waschmaschine",
        integration="demo",
        state=stand,
    )


def test_duration_is_the_median_of_past_runs() -> None:
    cycles = [lauf("demo.washer", 90), lauf("demo.washer", 60), lauf("demo.washer", 120)]
    assert laufzeit.typische_dauer(cycles, "demo.washer") == 90.0


def test_an_aborted_run_does_not_shorten_the_estimate() -> None:
    # Der Median hält den Zwei-Minuten-Abbruch heraus; ein Mittelwert
    # nicht - und der Balken stünde zu weit rechts.
    cycles = [lauf("demo.washer", 2), lauf("demo.washer", 90), lauf("demo.washer", 95)]
    assert laufzeit.typische_dauer(cycles, "demo.washer") == 90.0


def test_no_duration_after_a_single_run() -> None:
    assert laufzeit.typische_dauer([lauf("demo.washer", 90)], "demo.washer") is None


def test_duration_ignores_other_appliances() -> None:
    cycles = [lauf("demo.dryer", 60), lauf("demo.dryer", 60), lauf("demo.washer", 90)]
    assert laufzeit.typische_dauer(cycles, "demo.washer") is None


def test_progress_from_remaining_minutes() -> None:
    assert laufzeit.fortschritt(30, 90.0) == 0.67


def test_progress_stands_still_when_the_run_takes_longer_than_usual() -> None:
    # Vorwäsche: mehr Restzeit als die übliche Gesamtdauer. Der Balken
    # bleibt bei null, statt rückwärts zu laufen.
    assert laufzeit.fortschritt(120, 90.0) == 0.0


def test_no_progress_without_a_known_duration() -> None:
    assert laufzeit.fortschritt(30, None) is None


def test_no_progress_without_a_remaining_time() -> None:
    assert laufzeit.fortschritt(None, 90.0) is None


def test_running_appliance_carries_time_and_progress() -> None:
    cycles = [lauf("demo.washer", 90), lauf("demo.washer", 90)]
    zeilen = laufzeit.laufende([maschine()], cycles)
    assert zeilen == [
        {
            "id": "demo.washer",
            "name": "Waschmaschine",
            "program": "Buntwäsche",
            "minutes_left": 20,
            "percent": 0.78,
        }
    ]


def test_idle_appliances_stay_out() -> None:
    assert laufzeit.laufende([maschine(state="idle")], []) == []


def test_the_grill_is_not_a_washing_machine() -> None:
    # Er ist auch ein «appliance», führt aber ein Temperaturziel statt
    # einer Restzeit - ein Zeitbalken wäre dort erfunden.
    grill = maschine(entity_id="demo.grill", minutes_left=None, target=180)
    assert laufzeit.laufende([grill], []) == []


def test_without_history_only_the_time_is_shown() -> None:
    zeilen = laufzeit.laufende([maschine()], [])
    assert zeilen[0]["minutes_left"] == 20
    assert zeilen[0]["percent"] is None


def test_the_shortest_remaining_time_comes_first() -> None:
    zeilen = laufzeit.laufende(
        [
            maschine("demo.dryer", minutes_left=50),
            maschine("demo.washer", minutes_left=8),
        ],
        [],
    )
    assert [z["id"] for z in zeilen] == ["demo.washer", "demo.dryer"]


def test_an_appliance_without_a_remaining_time_goes_last() -> None:
    zeilen = laufzeit.laufende(
        [
            maschine("demo.dryer", minutes_left=None),
            maschine("demo.washer", minutes_left=45),
        ],
        [],
    )
    assert [z["id"] for z in zeilen] == ["demo.washer", "demo.dryer"]


def test_at_most_three_appliances() -> None:
    geraete = [maschine(f"demo.a{i}", minutes_left=i) for i in range(6)]
    assert len(laufzeit.laufende(geraete, [])) == 3


# ── Über die Route ────────────────────────────────────────────────────


def test_glance_stays_quiet_when_nothing_is_running() -> None:
    """Der Normalfall ist ein leerer Waschkeller - und dafür soll die
    Antwort nicht um ein Feld wachsen, das immer «[]» heisst."""
    from fastapi.testclient import TestClient

    from homepilot.api.server import create_app
    from homepilot.core.hub import Hub

    from .conftest import make_config

    with TestClient(create_app(Hub(make_config()))) as client:
        assert "running" not in client.get("/api/glance").json()


async def test_glance_carries_the_running_machine() -> None:
    from fastapi.testclient import TestClient

    from homepilot.api.server import create_app
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        hub.data.set(
            "appliance_cycles",
            [lauf("test.washer", 90), lauf("test.washer", 90)],
        )
        await hub.registry.add(maschine("test.washer", minutes_left=45))
        daten = client.get("/api/glance").json()
        assert daten["running"] == [
            {
                "id": "test.washer",
                "name": "Waschmaschine",
                "program": "Buntwäsche",
                "minutes_left": 45,
                "percent": 0.5,
            }
        ]
