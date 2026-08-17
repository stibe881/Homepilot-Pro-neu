"""Beschattung: Storen zu, wenn die Sonne wirklich aufs Fenster brennt.

Die drei Bedingungen müssen zusammen zutreffen – jede einzeln führt in die
Irre: Die Richtung allein verdunkelt im Winter, die Höhe allein beschattet
die Ostseite zur Mittagszeit, die Temperatur allein reagiert auf einen
kalten klaren Tag gar nicht.
"""

import asyncio

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.integrations.shading import parse_windows, should_shade

FENSTER = {
    "cover": "demo.store",
    "azimuth": (90.0, 200.0),
    "elevation": 15.0,
    "temperature": 22.0,
    "position": 30,
}


def test_a_window_without_direction_is_dropped():
    """Eine Store, die auf Verdacht zufährt, ärgert mehr als sie hilft."""
    windows = parse_windows(
        [
            {"cover": "demo.store", "azimuth": [90, 200]},
            {"cover": "demo.ohne"},                       # keine Richtung
            {"azimuth": [90, 200]},                       # keine Store
            {"cover": "demo.krumm", "azimuth": [90]},     # halber Bereich
            {"cover": "demo.text", "azimuth": ["ost", "sued"]},
            "kaputt",
        ]
    )
    assert [entry["cover"] for entry in windows] == ["demo.store"]
    # Und die Vorgaben stehen, ohne dass man sie angeben muss.
    assert windows[0]["elevation"] == 15.0
    assert windows[0]["temperature"] == 22.0


def test_all_three_conditions_must_hold():
    # Alles passt.
    assert should_shade(FENSTER, 40.0, 150.0, 26.0)
    # Sonne zu flach – im Winter ist sie willkommen.
    assert not should_shade(FENSTER, 8.0, 150.0, 26.0)
    # Falsche Himmelsrichtung – sie brennt auf die andere Seite.
    assert not should_shade(FENSTER, 40.0, 280.0, 26.0)
    # Zu kalt – ein klarer Wintertag blendet, heizt aber nicht.
    assert not should_shade(FENSTER, 40.0, 150.0, 12.0)


def test_an_unknown_temperature_counts_as_too_cold():
    """Lieber keine Beschattung als eine, die im Februar die Stube
    verdunkelt, weil der Fühler schweigt."""
    assert not should_shade(FENSTER, 40.0, 150.0, None)


def test_a_window_opened_by_hand_stays_open_for_the_day():
    """Sonst führen sich Mensch und Automatik gegenseitig vor: Man macht
    auf, fünf Minuten später fährt sie wieder zu."""

    async def check():
        hub = Hub(
            HubConfig(
                api=ApiConfig(),
                integrations=[
                    {"integration": "demo"},
                    {
                        "integration": "shading",
                        "windows": [{"cover": "demo.store", "azimuth": [0, 360]}],
                    },
                ],
            )
        )
        await hub.start()
        try:
            service = hub.integrations.get("shading")
            service._shaded["demo.store"] = True
            service._on_state_changed(
                "state_changed",
                {
                    "entity_id": "demo.store",
                    "new_state": {"state": "open"},
                    "source": {"kind": "user"},
                },
            )
            assert service._shaded["demo.store"] is False
            assert "demo.store" in service._released
        finally:
            await hub.stop()

    asyncio.run(check())


def test_the_automation_itself_does_not_trigger_the_lock():
    """Sonst hielte sich die Beschattung nach ihrem eigenen Öffnen für den
    Rest des Tages zurück."""

    async def check():
        hub = Hub(
            HubConfig(
                api=ApiConfig(),
                integrations=[
                    {"integration": "demo"},
                    {
                        "integration": "shading",
                        "windows": [{"cover": "demo.store", "azimuth": [0, 360]}],
                    },
                ],
            )
        )
        await hub.start()
        try:
            service = hub.integrations.get("shading")
            service._shaded["demo.store"] = True
            service._on_state_changed(
                "state_changed",
                {
                    "entity_id": "demo.store",
                    "new_state": {"state": "open"},
                    "source": {"kind": "integration"},
                },
            )
            assert service._shaded["demo.store"] is True
            assert "demo.store" not in service._released
        finally:
            await hub.stop()

    asyncio.run(check())
