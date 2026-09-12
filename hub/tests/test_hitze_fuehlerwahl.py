"""Welche Fühler der Hitze-Hinweis berücksichtigt (Punkt 540 der Werkbank).

Der gemeldete Fall kam als Bild von einer Push: «Im Haus sind es 28.8 °C
und die Sonne steht hoch.» Dazu der Satz: «Es sollen nicht alle Sensoren
berücksichtigt werden.»

Gemittelt wurde über *jeden* Fühler mit einem Raum - und darunter sind
welche, die nichts über die Wohnstube sagen: der im Serverschrank, der
an der Fussbodenheizung, der im Estrich unterm Ziegeldach. Einer davon
hebt das Mittel um Grade.
"""

import pytest

from homepilot.core import storenwaechter


class Fuehler:
    def __init__(self, kennung, name, state, room="Wohnzimmer", room_only=False, kind="sensor"):
        self.id = kennung
        self.name = name
        self.state = state
        self.room = room
        self.room_only = room_only
        self.kind = kind


def grad(kennung, wert, **rest):
    return Fuehler(kennung, kennung, {"state": wert, "unit": "°C"}, **rest)


def prozent(kennung, wert, **rest):
    return Fuehler(kennung, kennung, {"state": wert, "unit": "%"}, **rest)


def test_ohne_auswahl_zaehlen_alle_wie_bisher():
    """Damit der Hinweis auch ohne jede Einstellung wirkt - dieselbe
    Regel wie bei den Storen."""
    geraete = [grad("stube", 22), grad("kueche", 24)]
    assert storenwaechter.innentemperatur(geraete) == 23.0
    assert storenwaechter.innentemperatur(geraete, []) == 23.0


def test_die_auswahl_haelt_den_heissen_ausreisser_draussen():
    """Genau der gemeldete Fall: Ein Fühler im Serverschrank zieht das
    Mittel über die Schwelle, und die Push kommt an einem Tag, an dem es
    drinnen angenehm ist."""
    geraete = [grad("stube", 22), grad("kueche", 23), grad("serverschrank", 41)]
    assert storenwaechter.innentemperatur(geraete) == 28.7
    assert storenwaechter.innentemperatur(geraete, ["stube", "kueche"]) == 22.5


def test_eine_auswahl_auf_ein_totes_geraet_meldet_nichts_statt_irgendetwas():
    """Wer einen Fühler anhakt, der nicht mehr meldet, bekommt keinen
    Hinweis - nicht den Mittelwert der übrigen. Ein Hinweis aus Fühlern,
    die man abgewählt hat, wäre die Sorte Auskunft, die man nicht mehr
    abstellen kann."""
    geraete = [grad("stube", 22), grad("kueche", 40)]
    assert storenwaechter.innentemperatur(geraete, ["weg"]) is None


def test_die_feuchte_geht_denselben_weg():
    geraete = [prozent("stube", 44), prozent("bad", 70)]
    assert storenwaechter.innenfeuchte(geraete) == 57.0
    assert storenwaechter.innenfeuchte(geraete, ["stube"]) == 44.0


def test_der_akkustand_ist_keine_luftfeuchtigkeit():
    """Prozent zählt auch der Akku - und der Sendespeicher des Funkmoduls.
    Stünde er in der Auswahlliste, liesse er sich anhaken, und danach
    stünde die Ladung einer Batterie als Luftfeuchtigkeit in der Push."""
    geraete = [prozent("stube", 44), prozent("Batterie Melder", 95)]
    assert storenwaechter.innenfeuchte(geraete) == 44.0
    namen = [e.id for e in storenwaechter.klimafuehler(geraete, "humidity")]
    assert namen == ["stube"]


def test_ein_thermostat_zaehlt_auch_ohne_eigene_einheit():
    """Es trägt seine Werte als Attribut neben dem Zustand, nicht als
    Zustand mit Einheit."""
    thermostat = Fuehler(
        "hm.thermostat",
        "Thermostat Stube",
        {"state": "heat", "temperature": 21.0, "humidity": 48},
        kind="climate",
    )
    assert storenwaechter.innentemperatur([thermostat]) == 21.0
    assert storenwaechter.innenfeuchte([thermostat]) == 48.0


@pytest.mark.parametrize(
    "raum, room_only",
    [("Balkon", False), ("Garten", False), ("Waschküche", True), ("", False)],
)
def test_die_liste_bietet_nur_an_was_auch_zaehlt(raum, room_only):
    """Sonst hakte man etwas an, das danach doch nicht mitgerechnet wird -
    und die Einstellung sähe aus, als täte sie nichts."""
    draussen = grad("weg", 30, room=raum, room_only=room_only)
    stube = grad("stube", 22)
    kandidaten = [e.id for e in storenwaechter.klimafuehler([stube, draussen], "temperature")]
    assert kandidaten == ["stube"]


def test_unplausible_werte_bleiben_draussen():
    """Der Backofen misst 180 Grad, die Grillsonde 90."""
    geraete = [grad("stube", 22), grad("backofen", 180)]
    assert storenwaechter.innentemperatur(geraete) == 22.0
    assert [e.id for e in storenwaechter.klimafuehler(geraete, "temperature")] == ["stube"]


# ── Und was in der Nachricht landet ───────────────────────────────────


class HubAttrappe:
    """Gerade so viel Hub, wie der Hitze-Hinweis anfasst."""

    def __init__(self, gewaehlt):
        self.data = Ablage(gewaehlt)
        self.config = Konfig()


class Ablage:
    def __init__(self, gewaehlt):
        self._gewaehlt = gewaehlt

    def get(self, key):
        return [self._gewaehlt] if key == "cover_guard" and self._gewaehlt else []


class Konfig:
    location = {"latitude": 47.13844, "longitude": 8.06887}


async def _hinweis(entities, gewaehlt):
    """Den Hitze-Hinweis einmal laufen lassen und zurückgeben, was er sagt."""
    from homepilot.core.watchdog import Watchdog

    wache = Watchdog.__new__(Watchdog)
    wache.hub = HubAttrappe(gewaehlt)
    wache.rules = {"heat_covers": {"enabled": True, "params": {"innen_ab": 25}}}
    gesagt = []

    async def merken(titel, text, category="outage", **rest):
        gesagt.append(text)

    wache._notify = merken
    wache._einmal = lambda marke: True
    # Die Sonne steht hoch und es ist Nachmittag - sonst kommt der
    # Hinweis gar nicht (storenwaechter.hitze_tagsueber).
    wache._sonnenhoehe = lambda: 40.0
    import homepilot.core.watchdog as modul

    class Nachmittag:
        @staticmethod
        def now():
            import datetime as _dt

            return _dt.datetime(2026, 7, 15, 14, 0)

    echt = modul.datetime
    modul.datetime = Nachmittag
    try:
        await wache._check_heat_covers(entities)
    finally:
        modul.datetime = echt
    return gesagt


async def test_ohne_feuchtefuehler_steht_keine_feuchte_in_der_nachricht():
    """So war es bisher, und so bleibt es ohne Zutun: Eine Zahl, die
    niemand ausgesucht hat, gehört nicht in die Push."""
    geraete = [Fuehler("stube", "Stube", {"state": 28.0, "unit": "°C", "humidity": 61})]
    gesagt = await _hinweis(geraete, None)
    assert gesagt and "28 °C" in gesagt[0]
    assert "Luftfeuchtigkeit" not in gesagt[0]


async def test_mit_gewaehltem_feuchtefuehler_steht_sie_dabei():
    """Bei 28 Grad ist es gerade die Feuchte, die «warm» von «schwül»
    unterscheidet - wer den Fühler anhakt, will sie lesen."""
    geraete = [Fuehler("stube", "Stube", {"state": 28.0, "unit": "°C", "humidity": 61})]
    gesagt = await _hinweis(geraete, {"humidity": ["stube"]})
    assert gesagt and "61 % Luftfeuchtigkeit" in gesagt[0]


async def test_der_abgewaehlte_fuehler_hebt_das_mittel_nicht_mehr():
    """Der gemeldete Fall, einmal ganz durch: Ohne Auswahl zieht der
    Serverschrank das Mittel über die Schwelle, mit Auswahl nicht."""
    geraete = [
        Fuehler("stube", "Stube", {"state": 22.0, "unit": "°C"}),
        Fuehler("rack", "Serverschrank", {"state": 41.0, "unit": "°C"}, room="Büro"),
    ]
    assert await _hinweis(geraete, None), "ohne Auswahl kam die Push"
    assert await _hinweis(geraete, {"temp": ["stube"]}) == []

