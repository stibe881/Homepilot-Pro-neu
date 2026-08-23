"""Die Saugerkarte wird nicht bei jedem Bildaufruf neu geholt.

Der Kartenabruf ist der teuerste Aufruf der Roborock-Bibliothek. Die App
fragt das Bild aber jedes Mal an, wenn die Kachel erscheint – ohne Vorrat
wartete man beim Öffnen der Startseite Sekunden auf ein Bild, das sich
nicht geändert hatte.
"""

import asyncio
import types

from homepilot.integrations import roborock as modul


class FakeTrait:
    """Zählt, wie oft wirklich geholt wurde."""

    def __init__(self) -> None:
        self.holte = 0
        self.map_data = object()
        self.image_content = b"PNG"

    async def refresh(self) -> None:
        self.holte += 1


def sauger(state: str = "docked"):
    """Integration und Gerät, gerade so weit gebaut, wie snapshot() braucht."""
    integration = object.__new__(modul.RoborockIntegration)
    integration._karten = modul.Bildspeicher()
    integration._kartensperren = {}
    integration._calibration = {}
    integration.log = types.SimpleNamespace(debug=lambda *a, **k: None)

    trait = FakeTrait()
    device = types.SimpleNamespace(
        name="Rosa", v1_properties=types.SimpleNamespace(map_content=trait)
    )
    entity = types.SimpleNamespace(id="roborock.rosa", state={"state": state})
    integration._devices = {entity.id: device}
    return integration, entity, trait


def test_the_second_request_comes_from_the_store(monkeypatch):
    monkeypatch.setattr(modul, "map_calibration", lambda _: None)
    monkeypatch.setattr(modul, "robot_position", lambda _: None)
    integration, entity, trait = sauger()

    erstes = asyncio.run(integration.snapshot(entity))
    zweites = asyncio.run(integration.snapshot(entity))
    assert erstes == zweites == b"PNG"
    assert trait.holte == 1


def test_after_the_store_has_gone_stale_it_fetches_again(monkeypatch):
    monkeypatch.setattr(modul, "map_calibration", lambda _: None)
    monkeypatch.setattr(modul, "robot_position", lambda _: None)
    integration, entity, trait = sauger()
    asyncio.run(integration.snapshot(entity))

    # Die Uhr vorstellen, statt zu warten.
    uhr = [modul.KARTE_FRISCH_STEHEND + 1.0]
    monkeypatch.setattr(modul, "monotonic", lambda: uhr[0])
    asyncio.run(integration.snapshot(entity))
    assert trait.holte == 2


def test_a_driving_vacuum_gets_a_fresher_picture(monkeypatch):
    """Steht er, darf dasselbe Bild lange herhalten – fährt er, wandert
    der Punkt, und dieselbe Wartezeit wäre eine eingefrorene Karte."""
    monkeypatch.setattr(modul, "map_calibration", lambda _: None)
    monkeypatch.setattr(modul, "robot_position", lambda _: None)
    integration, entity, trait = sauger(state="cleaning")
    asyncio.run(integration.snapshot(entity))

    uhr = [modul.KARTE_FRISCH_FAHREND + 1.0]
    monkeypatch.setattr(modul, "monotonic", lambda: uhr[0])
    asyncio.run(integration.snapshot(entity))
    assert trait.holte == 2
    assert modul.KARTE_FRISCH_FAHREND < modul.KARTE_FRISCH_STEHEND


def test_two_screens_at_once_cause_a_single_fetch(monkeypatch):
    """iPhone und iPad öffnen die Startseite gleichzeitig. Ohne Sperre
    liefen zwei Abrufe los, und der teure Weg wurde doppelt gegangen."""
    monkeypatch.setattr(modul, "map_calibration", lambda _: None)
    monkeypatch.setattr(modul, "robot_position", lambda _: None)
    integration, entity, trait = sauger()

    async def langsam() -> None:
        # Ein echter Abruf braucht Zeit; genau in dieser Zeit trifft die
        # zweite Anfrage ein.
        await asyncio.sleep(0.05)
        trait.holte += 1

    trait.refresh = langsam

    async def beide():
        return await asyncio.gather(
            integration.snapshot(entity), integration.snapshot(entity)
        )

    assert asyncio.run(beide()) == [b"PNG", b"PNG"]
    assert trait.holte == 1


def test_a_command_throws_the_stored_picture_away(monkeypatch):
    """Wer «Reinigen» drückt und die Karte danach unverändert sieht, hält
    den Befehl für verloren."""
    monkeypatch.setattr(modul, "map_calibration", lambda _: None)
    monkeypatch.setattr(modul, "robot_position", lambda _: None)
    integration, entity, trait = sauger()
    asyncio.run(integration.snapshot(entity))
    integration._karten.vergiss(entity.id)
    asyncio.run(integration.snapshot(entity))
    assert trait.holte == 2


def test_a_failed_fetch_is_not_stored(monkeypatch):
    """Sonst bliebe die Kachel drei Minuten lang leer, obwohl der nächste
    Versuch sofort geklappt hätte."""
    monkeypatch.setattr(modul, "map_calibration", lambda _: None)
    monkeypatch.setattr(modul, "robot_position", lambda _: None)
    integration, entity, trait = sauger()

    async def kaputt() -> None:
        raise RuntimeError("Wolke antwortet nicht")

    trait.refresh = kaputt
    assert asyncio.run(integration.snapshot(entity)) is None

    trait.refresh = FakeTrait.refresh.__get__(trait)
    assert asyncio.run(integration.snapshot(entity)) == b"PNG"
    assert trait.holte == 1


def test_an_unknown_device_answers_with_nothing():
    integration, _, _ = sauger()
    fremd = types.SimpleNamespace(id="roborock.gibtsnicht", state={})
    assert asyncio.run(integration.snapshot(fremd)) is None
