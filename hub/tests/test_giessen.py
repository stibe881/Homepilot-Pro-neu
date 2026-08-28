"""Giess-Erinnerung: die drei Bedingungen einzeln und zusammen."""

from __future__ import annotations

from homepilot.core import giessen


def tag(mm: float, datum: str = "2026-08-20") -> dict[str, float | str]:
    return {"date": datum, "rain_mm": mm}


def test_dry_days_counts_today_and_the_days_before() -> None:
    vergangen = [tag(0.0), tag(0.2), tag(0.0)]
    assert giessen.trockentage(vergangen, tag(0.0)) == 4


def test_rain_today_ends_the_dry_spell() -> None:
    # Ein Schauer am Mittag zählt, auch wenn die Tage davor staubig waren.
    vergangen = [tag(0.0), tag(0.0), tag(0.0)]
    assert giessen.trockentage(vergangen, tag(4.0)) == 0


def test_dry_days_stop_at_the_last_wet_day() -> None:
    # Vorletzter Tag nass: gezählt werden nur heute und gestern.
    vergangen = [tag(0.0), tag(6.0), tag(0.0)]
    assert giessen.trockentage(vergangen, tag(0.0)) == 2


def test_light_dew_does_not_count_as_rain() -> None:
    assert giessen.trockentage([tag(0.4)], tag(0.0)) == 2


def test_rain_next_skips_today() -> None:
    # [0] ist heute - was heute schon fiel, steht in trockentage.
    tage = [tag(9.0), tag(2.0), tag(1.5), tag(8.0)]
    assert giessen.regen_kommt(tage) == 3.5


def test_watering_when_dry_warm_and_no_rain_ahead() -> None:
    stand = {"dry_days": 4, "rain_next": 0.0, "high": 26.0}
    assert giessen.soll_giessen(stand) is True


def test_no_watering_when_rain_is_coming() -> None:
    # Wer abends giesst, während nachts der Regen kommt, giesst zweimal.
    stand = {"dry_days": 6, "rain_next": 5.0, "high": 28.0}
    assert giessen.soll_giessen(stand) is False


def test_no_watering_when_it_stayed_cold() -> None:
    # Bei 14 Grad verdunstet nichts, da hält die Erde eine Woche.
    stand = {"dry_days": 6, "rain_next": 0.0, "high": 14.0}
    assert giessen.soll_giessen(stand) is False


def test_no_watering_after_a_single_dry_day() -> None:
    stand = {"dry_days": 1, "rain_next": 0.0, "high": 29.0}
    assert giessen.soll_giessen(stand) is False


def test_watering_ignores_a_state_without_weather() -> None:
    assert giessen.soll_giessen(None) is False
    assert giessen.soll_giessen({}) is False


def test_message_names_the_number_of_dry_days() -> None:
    assert "Seit 5 Tagen" in giessen.satz({"dry_days": 5})


# --- Der Wächter: wann die Meldung wirklich rausgeht -----------------


async def _wach(monkeypatch, jetzt, stand):
    """Ein Hub mit einem Wetter-Gerät und angehaltener Uhr."""
    from datetime import datetime as _datetime

    from homepilot.core.config import ApiConfig, HubConfig
    from homepilot.core.entity import Entity
    from homepilot.core.hub import Hub

    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    await hub.registry.add(
        Entity(
            id="test.wetter",
            kind="weather",
            name="Wetter",
            integration="test",
            state=stand,
        )
    )

    class Uhr(_datetime):
        @classmethod
        def now(cls, tz=None):
            return jetzt

    monkeypatch.setattr("homepilot.core.watchdog.datetime", Uhr)
    gesendet: list[tuple[str, str]] = []

    async def merken(title, body, **kwargs):
        gesendet.append((title, body))

    hub.watchdog._notify = merken  # type: ignore[method-assign]
    return hub, gesendet


TROCKEN = {"state": "Sonnig", "dry_days": 5, "rain_next": 0.0, "high": 27.0}


async def test_the_reminder_comes_in_the_evening(monkeypatch):
    from datetime import datetime as dt

    hub, gesendet = await _wach(monkeypatch, dt(2026, 8, 20, 18, 0), TROCKEN)
    try:
        await hub.watchdog._check_giessen(hub.registry.all())
        assert len(gesendet) == 1
        assert gesendet[0][0] == "Pflanzen giessen"
        assert "Seit 5 Tagen" in gesendet[0][1]
    finally:
        await hub.stop()


async def test_no_reminder_at_noon(monkeypatch):
    # Mittags giessen verbrennt die Blätter - also wird auch nicht daran
    # erinnert.
    from datetime import datetime as dt

    hub, gesendet = await _wach(monkeypatch, dt(2026, 8, 20, 12, 0), TROCKEN)
    try:
        await hub.watchdog._check_giessen(hub.registry.all())
        assert gesendet == []
    finally:
        await hub.stop()


async def test_the_reminder_comes_only_once_per_evening(monkeypatch):
    from datetime import datetime as dt

    hub, gesendet = await _wach(monkeypatch, dt(2026, 8, 20, 18, 0), TROCKEN)
    try:
        await hub.watchdog._check_giessen(hub.registry.all())
        await hub.watchdog._check_giessen(hub.registry.all())
        assert len(gesendet) == 1
    finally:
        await hub.stop()


async def test_no_reminder_when_rain_is_forecast(monkeypatch):
    from datetime import datetime as dt

    nass = {**TROCKEN, "rain_next": 7.0}
    hub, gesendet = await _wach(monkeypatch, dt(2026, 8, 20, 18, 0), nass)
    try:
        await hub.watchdog._check_giessen(hub.registry.all())
        assert gesendet == []
    finally:
        await hub.stop()
