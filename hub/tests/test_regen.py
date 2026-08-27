"""Regen-Vorwarnung: die einzige Zahl, die man am Fenster braucht.

«60 % Regenwahrscheinlichkeit heute» beantwortet die Frage «muss ich
die Wäsche jetzt hereinholen?» nicht.
"""

from datetime import datetime, timedelta

from homepilot.core import regen
from homepilot.integrations.weather import parse_forecast

JETZT = datetime(2026, 8, 27, 20, 0)


def viertelstunden(*mm: float, ab: datetime = JETZT) -> dict:
    """Viertelstundenwerte ab jetzt, wie Open-Meteo sie liefert."""
    return {
        "time": [(ab + timedelta(minutes=15 * i)).isoformat() for i in range(len(mm))],
        "precipitation": list(mm),
    }


def test_ohne_werte_wird_nichts_behauptet():
    assert regen.analyse(None, JETZT) == {"now": False, "minutes": None, "mm": 0.0}
    assert regen.satz(regen.analyse(None, JETZT)) is None


def test_der_naechste_schauer_steht_mit_seiner_wartezeit_da():
    stand = regen.analyse(viertelstunden(0.0, 0.0, 0.0, 1.2), JETZT)
    assert stand == {"now": False, "minutes": 45, "mm": 1.2}
    assert regen.satz(stand) == "Regen in etwa 45 Minuten."


def test_ein_paar_tropfen_sind_kein_regen():
    """Darunter ist es feucht - für nasse Wäsche reicht das nicht, und
    eine Meldung darüber wäre eine, die man abschaltet."""
    stand = regen.analyse(viertelstunden(0.0, 0.1, 0.1), JETZT)
    assert stand["minutes"] is None


def test_was_erst_in_vier_stunden_kommt_ist_keine_vorwarnung():
    werte = [0.0] * 20 + [3.0]
    assert regen.analyse(viertelstunden(*werte), JETZT)["minutes"] is None


def test_wenn_es_schon_regnet_zaehlt_die_andere_haelfte_der_frage():
    """Wie lange muss ich warten?"""
    stand = regen.analyse(viertelstunden(0.8, 0.8, 0.0), JETZT)
    assert stand["now"] is True
    assert stand["minutes"] == 30
    assert regen.satz(stand) == "Es regnet noch etwa 30 Minuten."


def test_dauerregen_ohne_absehbares_ende():
    stand = regen.analyse(viertelstunden(1.0, 1.0, 1.0), JETZT)
    assert stand == {"now": True, "minutes": None, "mm": 1.0}
    assert regen.satz(stand) == "Es regnet."


def test_gleich_heisst_gleich():
    stand = regen.analyse(viertelstunden(0.0, 0.9), JETZT + timedelta(minutes=12))
    assert regen.satz(stand) == "Es fängt gleich an zu regnen."


def test_die_wetterentitaet_traegt_die_vorwarnung_mit():
    """Die App zeigt sie auf der Karte, der Wächter meldet sie - beide
    lesen dieselbe Entität."""
    payload = {
        "current": {"temperature_2m": 18.4, "weather_code": 3},
        "daily": {"time": ["2026-08-27"], "weather_code": [3]},
        "minutely_15": viertelstunden(0.0, 0.0, 2.0),
    }
    stand = parse_forecast(payload, JETZT)
    assert stand["rain"] == {"now": False, "minutes": 30, "mm": 2.0}


async def test_gemeldet_wird_nur_wenn_dabei_ein_fenster_offen_steht():
    """«Es regnet gleich» allein wäre eine Meldung, die man nach drei
    Tagen abschaltet."""
    from homepilot.core.entity import Entity
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(make_config(integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        await hub.registry.add(
            Entity(
                id="test.wetter",
                kind="weather",
                name="Wetter",
                integration="test",
                state={"state": "Bedeckt", "rain": {"now": False, "minutes": 30, "mm": 1.0}},
            )
        )
        gesendet: list[tuple[str, str]] = []

        async def fake_notify(title, body, **kwargs):
            gesendet.append((title, body))

        hub.watchdog._notify = fake_notify  # type: ignore[assignment]

        # Alles zu: keine Meldung.
        await hub.watchdog._check_regen(hub.registry.all())
        assert gesendet == []

        # Fenster auf: jetzt schon.
        await hub.registry.update_state("demo.window_kitchen", {"state": "on"})
        await hub.watchdog._check_regen(hub.registry.all())
        assert len(gesendet) == 1
        assert gesendet[0][0] == "Regen in etwa 30 Minuten."
        assert "Küchenfenster" in gesendet[0][1] or "fenster" in gesendet[0][1].lower()

        # Und nicht noch einmal für denselben Schauer.
        await hub.watchdog._check_regen(hub.registry.all())
        assert len(gesendet) == 1
    finally:
        await hub.stop()


def test_die_uhr_der_antwort_zaehlt_nicht_die_des_hubs():
    """Open-Meteo liefert seine Zeiten in der angefragten Zone. Ein Hub
    im Container auf UTC läge damit zwei Stunden daneben - jeder Schauer
    sähe aus, als käme er erst in zwei Stunden."""
    payload = {
        "current": {"time": "2026-08-27T22:15", "temperature_2m": 20.3},
        "daily": {"time": [], "weather_code": []},
        "minutely_15": viertelstunden(
            0.0, 0.0, 1.5, ab=datetime(2026, 8, 27, 22, 15)
        ),
    }
    # Ohne ausdrückliches «jetzt»: Die Zeit steht in der Antwort selbst.
    assert parse_forecast(payload)["rain"] == {"now": False, "minutes": 30, "mm": 1.5}
