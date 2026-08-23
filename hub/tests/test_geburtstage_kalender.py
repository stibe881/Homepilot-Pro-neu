"""Geburtstage aus dem Kalender, nicht nur aus den Kontakten.

Der Fall dahinter: Wer seine Geburtstage im Telefon pflegt, sieht sie
über den Geburtstags-Kalender auf der Startseite - und wurde trotzdem
nicht erinnert, weil der Wächter nur in die Kontakte sah.
"""

from datetime import date, datetime

from homepilot.core import familie

HEUTE = date(2026, 8, 23)

EVENTS = [
    {"summary": "Levin hat Geburtstag", "start": "2026-08-23", "birthday": True},
    {"summary": "Livia's birthday", "start": "2026-08-25", "birthday": True},
    {"summary": "Zahnarzt", "start": "2026-08-23T09:00:00Z"},
    {"summary": "Oma hat Geburtstag", "start": "2026-09-30", "birthday": True},
]


def test_der_name_wird_aus_dem_titel_geschaelt():
    # «Livia hat Geburtstag hat heute Geburtstag» liest niemand zweimal.
    assert familie.birthday_name("Livia hat Geburtstag") == "Livia"
    assert familie.birthday_name("Levin's birthday") == "Levin"
    assert familie.birthday_name("Geburtstag") == "Geburtstag"
    # Unbekanntes Format bleibt stehen, statt falsch gekürzt zu werden.
    assert familie.birthday_name("Livias 40.") == "Livias 40."


def test_heute_und_der_vorlauf():
    assert familie.calendar_birthdays(EVENTS, HEUTE) == [(0, "Levin")]
    assert familie.calendar_birthdays(EVENTS, HEUTE, 3) == [(0, "Levin"), (2, "Livia")]
    # Was weiter weg liegt, bleibt draussen.
    assert all(name != "Oma" for _, name in familie.calendar_birthdays(EVENTS, HEUTE, 3))


def test_ein_gewoehnlicher_termin_ist_kein_geburtstag():
    assert familie.calendar_birthdays([EVENTS[2]], HEUTE, 3) == []


def test_wer_in_beiden_steht_wird_einmal_gegruesst():
    assert familie.namen_zusammen(["Livia", "Levin"], ["livia", "Oma"]) == [
        "Livia",
        "Levin",
        "Oma",
    ]
    assert familie.namen_zusammen([], []) == []


# ── Und durch den Wächter hindurch ───────────────────────────────────────

import pytest

from homepilot.core import notifyrules
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub


async def _wach(monkeypatch, jetzt):
    """Ein Hub mit einem Geburtstags-Kalender und angehaltener Uhr."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    # Ein Kalender, wie ihn die google_calendar-Integration liefert.
    await hub.registry.add(
        Entity(
            id="google.kalender",
            kind=EntityKind.CALENDAR,
            name="Kalender",
            integration="google_calendar",
            state={"state": "frei", "events": EVENTS},
        )
    )
    hub.watchdog.rules = notifyrules.effective(None)

    class Uhr(datetime):
        @classmethod
        def now(cls, tz=None):
            return jetzt

    monkeypatch.setattr("homepilot.core.watchdog.datetime", Uhr)
    gesendet: list[tuple[str, str]] = []

    async def merken(title, body, category="outage", to=None):
        gesendet.append((title, body))

    hub.watchdog._notify = merken  # type: ignore[method-assign]
    return hub, gesendet


@pytest.mark.asyncio
async def test_der_kalender_geburtstag_kommt_am_morgen(monkeypatch):
    hub, gesendet = await _wach(monkeypatch, datetime(2026, 8, 23, 8, 0))
    try:
        await hub.watchdog._check_birthdays()
    finally:
        await hub.stop()
    assert any("Geburtstag heute" in titel for titel, _ in gesendet)
    assert any("Levin" in text for _, text in gesendet)
    # Und der Vorlauf zwei Tage vorher für Livia.
    assert any("Livia hat in 2 Tagen Geburtstag" in titel for titel, _ in gesendet)


@pytest.mark.asyncio
async def test_wer_in_kontakten_und_kalender_steht_wird_einmal_gegruesst(monkeypatch):
    hub, gesendet = await _wach(monkeypatch, datetime(2026, 8, 23, 8, 0))
    hub.data.set("family_contacts", [{"text": "Levin", "birthday": "23.08.2016"}])
    try:
        await hub.watchdog._check_birthdays()
    finally:
        await hub.stop()
    gruss = next(text for titel, text in gesendet if "heute Geburtstag" in text)
    assert gruss.count("Levin") == 1


def test_der_wochenausblick_nimmt_beide_quellen_mit():
    text = familie.week_ahead(EVENTS, [], [], [{"text": "Livia", "birthday": "25.08.1985"}], HEUTE)
    assert text is not None
    zeilen = text.split("\n")
    # Levin steht nur im Kalender, Livia in beiden - und einmal.
    assert any("Levin hat Geburtstag" in zeile for zeile in zeilen)
    assert sum("Livia hat Geburtstag" in zeile for zeile in zeilen) == 1
