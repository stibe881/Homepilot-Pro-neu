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
    assert stand["rain"] == {
        "now": False,
        "minutes": 30,
        "mm": 2.0,
        # Und die Reihe für die kleine Grafik: der laufende Eimer plus
        # die kommenden.
        "bars": [0.0, 0.0, 2.0],
    }


async def test_gemeldet_wird_auch_wenn_alle_fenster_zu_sind():
    """Draussen liegt mehr, als der Hub sieht: Wäsche, Kissen, das Velo.
    Ein offenes Fenster ist nur der Teil davon, den er benennen kann -
    und wenn welche offen sind, stehen sie in der Meldung."""
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

        # Alles zu - und die Meldung kommt trotzdem.
        await hub.watchdog._check_regen(hub.registry.all())
        assert len(gesendet) == 1
        assert gesendet[0][0] == "Regen in etwa 30 Minuten."
        assert gesendet[0][1] == "Alle Fenster sind zu. Liegt draussen noch etwas?"

        # Und nicht noch einmal für denselben Schauer.
        await hub.watchdog._check_regen(hub.registry.all())
        assert len(gesendet) == 1
    finally:
        await hub.stop()


async def test_offene_fenster_stehen_in_der_meldung():
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
                state={"state": "Bedeckt", "rain": {"now": False, "minutes": 15, "mm": 2.0}},
            )
        )
        gesendet: list[tuple[str, str]] = []

        async def fake_notify(title, body, **kwargs):
            gesendet.append((title, body))

        hub.watchdog._notify = fake_notify  # type: ignore[assignment]
        await hub.registry.update_state("demo.window_kitchen", {"state": "on"})
        await hub.watchdog._check_regen(hub.registry.all())
        assert len(gesendet) == 1
        assert gesendet[0][1].startswith("Noch offen: ")
        assert "fenster" in gesendet[0][1].lower()
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
    stand = parse_forecast(payload)["rain"]
    assert {k: stand[k] for k in ("now", "minutes", "mm")} == {
        "now": False,
        "minutes": 30,
        "mm": 1.5,
    }


def test_die_balkenreihe_beginnt_beim_laufenden_eimer():
    from homepilot.core.regen import balken

    reihe = balken(
        viertelstunden(0.4, 0.0, 1.2, 0.0), JETZT + timedelta(minutes=10)
    )
    # Der erste Eimer läuft gerade - er zählt mit, sonst fehlte der
    # Regen, in dem man steht.
    assert reihe == [0.4, 0.0, 1.2, 0.0]
    assert balken(None, JETZT) == []
    # Mehr als acht gibt es nicht - zwei Stunden sind die Vorschau.
    assert len(balken(viertelstunden(*([0.1] * 20)), JETZT)) == 8


# ── Einmal je Schauer, und nicht alle Viertelstunde ────────────────────
#
# Der Fehler aus dem Betrieb: Die Meldung kam immer und immer wieder.
# Entprellt wurde über den *errechneten* Regenbeginn, `(jetzt + minuten *
# 60) // 900`. Das sah nach einer stabilen Kennung aus und war keine:
# `minuten` steht im Zustand der Wetter-Entität und ändert sich nur beim
# nächsten Wetterabruf, der Wächter läuft jede Minute. Der errechnete
# Beginn rückte also mit der Uhr weiter und fiel irgendwann in die
# nächste Viertelstunde.


def stand(minuten=15, jetzt_regen=False):
    return {"now": jetzt_regen, "minutes": minuten, "mm": 1.0}


def test_die_erste_vorwarnung_geht_raus():
    assert regen.melden(stand(), None, 1000.0, 30) is True


def test_eine_minute_spaeter_kommt_keine_zweite():
    # Genau das ging vorher schief.
    assert regen.melden(stand(), 1000.0, 1060.0, 30) is False


def test_auch_eine_viertelstunde_spaeter_nicht():
    assert regen.melden(stand(), 1000.0, 1000.0 + 900, 30) is False


def test_nach_der_sperre_darf_wieder_gewarnt_werden():
    zwei_stunden = regen.SPERRE_MINUTEN * 60
    assert regen.melden(stand(), 1000.0, 1000.0 + zwei_stunden, 30) is True
    assert regen.melden(stand(), 1000.0, 1000.0 + zwei_stunden - 1, 30) is False


def test_was_zu_weit_weg_ist_meldet_gar_nichts():
    assert regen.melden(stand(minuten=90), None, 1000.0, 30) is False


def test_waehrend_es_regnet_wird_nicht_vorgewarnt():
    assert regen.melden(stand(jetzt_regen=True), None, 1000.0, 30) is False


def test_ohne_vorschau_nichts_zu_melden():
    assert regen.melden(stand(minuten=None), None, 1000.0, 30) is False
    assert regen.melden(None, None, 1000.0, 30) is False


def test_der_schauer_ist_durch_wenn_es_regnet():
    # Die Warnung hat ihren Zweck erfüllt - die nächste darf wieder raus.
    assert regen.vorbei(stand(jetzt_regen=True)) is True


def test_der_schauer_ist_durch_wenn_die_vorschau_leer_ist():
    # An uns vorbeigezogen.
    assert regen.vorbei(stand(minuten=None)) is True


def test_solange_er_ansteht_ist_er_nicht_durch():
    assert regen.vorbei(stand()) is False


async def test_am_waechter_kommt_die_meldung_nur_einmal():
    """Der ganze Weg: zehn Runden des Wächters, eine Nachricht."""
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
                state={"state": "Bedeckt", "rain": {"now": False, "minutes": 15, "mm": 1.0}},
            )
        )
        gesendet: list[str] = []

        async def fake_notify(title, body, **kwargs):
            gesendet.append(title)

        hub.watchdog._notify = fake_notify  # type: ignore[assignment]
        for _ in range(10):
            await hub.watchdog._check_regen(hub.registry.all())
        assert len(gesendet) == 1
    finally:
        await hub.stop()


async def test_nach_dem_regen_warnt_der_naechste_schauer_wieder():
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
                state={"state": "Bedeckt", "rain": {"now": False, "minutes": 15, "mm": 1.0}},
            )
        )
        gesendet: list[str] = []

        async def fake_notify(title, body, **kwargs):
            gesendet.append(title)

        hub.watchdog._notify = fake_notify  # type: ignore[assignment]
        await hub.watchdog._check_regen(hub.registry.all())
        # Es regnet - damit ist die Sache erledigt.
        await hub.registry.update_state(
            "test.wetter", {"rain": {"now": True, "minutes": 20, "mm": 2.0}}
        )
        await hub.watchdog._check_regen(hub.registry.all())
        assert len(gesendet) == 1
        # Und der nächste Schauer meldet sich wieder.
        await hub.registry.update_state(
            "test.wetter", {"rain": {"now": False, "minutes": 15, "mm": 1.0}}
        )
        await hub.watchdog._check_regen(hub.registry.all())
        assert len(gesendet) == 2
    finally:
        await hub.stop()
