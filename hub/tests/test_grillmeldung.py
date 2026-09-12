"""Der Grill meldet sich: «auf Temperatur» und «Fleisch ist so weit».

Gewünscht im Haus (Punkt 554): «Wenn der Grill die Zieltemperatur
erreicht hat, aber auch, wenn ein Kerntemperaturmesser das Ziel erreicht
hat.»
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from homepilot.core import grillmeldung as gm
from homepilot.core.watchdog import GRILLZIELE_KEY, Watchdog


def test_der_spielraum_faengt_das_pendeln_ab():
    """Ein Pelletgrill regelt über die Förderschnecke und pendelt.

    Ohne Spielraum käme die Meldung erst beim ersten Überschwinger - und
    die Live-Karte sagte derweil längst «Hält 110°».
    """
    assert gm.auf_temperatur(108, 110) is True
    assert gm.auf_temperatur(110, 110) is True
    assert gm.auf_temperatur(105, 110) is False


def test_ohne_werte_gilt_nichts_als_erreicht():
    """Ein Grill ohne Messwert hat sein Ziel nicht erreicht - er
    schweigt bloss."""
    assert gm.auf_temperatur(None, 110) is False
    assert gm.auf_temperatur(108, None) is False


def test_erst_deutlich_darunter_darf_es_wieder_melden():
    """Sonst stünde die Meldung beim Pendeln im Wechsel an und aus."""
    assert gm.wieder_offen(105, 110) is False
    assert gm.wieder_offen(100, 110) is True
    # Wer den Sollwert hochdreht, bekommt die Meldung erneut - gemessen
    # am Abstand zum Ziel, nicht an einer festen Temperatur.
    assert gm.wieder_offen(110, 160) is True


def test_die_saetze_nennen_zahl_und_einheit():
    titel, text = gm.grillsatz("Smoker", 110, "°C")
    assert titel == "Smoker ist auf Temperatur"
    assert "110°C" in text

    titel, text = gm.aussatz("Smoker", 110, "°C")
    assert titel == "Smoker ist aus"
    assert "zuletzt 110°C" in text
    # Ohne Messwert kein «zuletzt None».
    assert gm.aussatz("Smoker", None, "°C")[1] == "Smoker wurde ausgeschaltet."

    titel, text = gm.fuehlersatz("Smoker", 2, 64, 63, "°C")
    assert titel == "Fühler 2 ist so weit"
    # Der Ist-Wert steht mit im Satz: Zwischen dem Erreichen und dem
    # Blick aufs Telefon steigt die Kerntemperatur weiter.
    assert "64°C" in text
    assert "63°C" in text


def test_die_ziele_liegen_als_zeilen_und_nicht_als_woerterbuch():
    """Der Fehler, den erst der laufende Hub zeigte.

    `hub.data` führt Listen von Zeilen (core/persistence.py): `get`
    macht aus allem anderen `list(...)`. Ein Wörterbuch dort abzulegen
    ergab beim Lesen eine Liste seiner *Schlüssel* - der Wert war weg,
    und die Meldung kam nie. Der erste Test hatte dasselbe Wörterbuch
    angenommen wie der Code und war darum grün.
    """
    zeilen = [
        {"entity_id": "pitboss.grill", "nummer": 1, "ziel": 63},
        {"entity_id": "pitboss.grill", "nummer": 3, "ziel": "70"},
    ]
    assert gm.fuehlerziele(zeilen, "pitboss.grill") == {1: 63.0, 3: 70.0}
    # Und die Gegenprobe: Was `hub.data` aus einem Wörterbuch macht,
    # ergibt keine Ziele - statt heimlich die Schlüssel zu lesen.
    assert gm.fuehlerziele(list({"pitboss.grill": {"1": 63}}), "pitboss.grill") == {}


def test_unsinn_in_der_datendatei_faellt_weg():
    """Eine kaputte Zeile darf den Grill nicht am Melden hindern."""
    zeilen = [
        {"entity_id": "g", "nummer": 1, "ziel": "warm"},
        {"entity_id": "g", "nummer": 9, "ziel": 63},
        {"entity_id": "g", "nummer": 2, "ziel": 63},
        "kaputt",
    ]
    assert gm.fuehlerziele(zeilen, "g") == {2: 63.0}
    assert gm.fuehlerziele(None, "g") == {}
    assert gm.fuehlerziele([{"entity_id": "anderer", "nummer": 1, "ziel": 63}], "g") == {}


def test_ein_ziel_setzen_aendern_und_wegnehmen():
    zeilen = gm.ziel_setzen([], "g", 2, 63)
    assert zeilen == [{"entity_id": "g", "nummer": 2, "ziel": 63.0}]
    # Dasselbe Ziel noch einmal: ersetzt, nicht verdoppelt.
    zeilen = gm.ziel_setzen(zeilen, "g", 2, 70)
    assert zeilen == [{"entity_id": "g", "nummer": 2, "ziel": 70.0}]
    # Ein zweiter Fühler kommt dazu.
    zeilen = gm.ziel_setzen(zeilen, "g", 1, 54)
    assert len(zeilen) == 2
    # Und weg damit - «kein Ziel» ist ein gültiger Wunsch.
    zeilen = gm.ziel_setzen(zeilen, "g", 2, None)
    assert zeilen == [{"entity_id": "g", "nummer": 1, "ziel": 54.0}]


def test_ein_anderer_grill_bleibt_unberuehrt():
    """Zwei Grills stehen nebeneinander auf der Terrasse."""
    zeilen = gm.ziel_setzen(
        [{"entity_id": "schrank", "nummer": 1, "ziel": 63}], "smoker", 1, 70
    )
    assert gm.fuehlerziele(zeilen, "schrank") == {1: 63.0}
    assert gm.fuehlerziele(zeilen, "smoker") == {1: 70.0}


# ── Die Flanke im Wächter ──────────────────────────────────────────────────


class _Hub:
    def __init__(self, ziele):
        self.data = SimpleNamespace(
            get=lambda schluessel: ziele if schluessel == GRILLZIELE_KEY else [],
            set=lambda *_: None,
        )


def grill(**state):
    voll = {"state": "running", "unit": "°C"}
    voll.update(state)
    return SimpleNamespace(
        id="pitboss.grill", kind="appliance", label="Smoker", state=voll
    )


def wache(ziele=None):
    """Ein Wächter ohne Hub-Start - nur die Regel soll laufen."""
    w = Watchdog.__new__(Watchdog)
    w.hub = _Hub(ziele or [])
    w._grill_gemeldet = set()
    gesendet: list[tuple[str, str, str]] = []

    async def notify(titel, text, kategorie, entity_id=None):
        gesendet.append((titel, text, kategorie))

    w._notify = notify  # type: ignore[assignment]
    return w, gesendet


def lauf(w, entities):
    asyncio.run(w._check_grill(entities))


def test_auf_temperatur_meldet_genau_einmal():
    """«Ist über dem Ziel» bleibt zwanzig Minuten wahr - und zwanzig
    Minuten lang zu melden wäre kein Hinweis, sondern ein Wecker."""
    w, gesendet = wache()
    lauf(w, [grill(temperature=80, target=110)])
    assert gesendet == []

    lauf(w, [grill(temperature=109, target=110)])
    assert len(gesendet) == 1
    assert gesendet[0][0] == "Smoker ist auf Temperatur"
    assert gesendet[0][2] == "grill"

    # Und danach Ruhe, obwohl die Bedingung weiter gilt.
    for _ in range(5):
        lauf(w, [grill(temperature=112, target=110)])
    assert len(gesendet) == 1


def test_nach_dem_ausgehen_meldet_er_wieder():
    """Beim nächsten Anzünden soll die Meldung kommen, auch wenn der
    Grill noch warm ist - und das Ausgehen selbst ist eine Meldung
    (Punkt 560)."""
    w, gesendet = wache()
    lauf(w, [grill(temperature=110, target=110)])
    lauf(w, [grill(state="off", temperature=110, target=110)])
    lauf(w, [grill(temperature=110, target=110)])
    assert [titel for titel, _, _ in gesendet] == [
        "Smoker ist auf Temperatur",
        "Smoker ist aus",
        "Smoker ist auf Temperatur",
    ]


def test_beim_ausschalten_kommt_eine_meldung():
    """«Es soll auch eine Push geben, wenn er sich ausschaltet.» Ein
    Pelletgrill geht auch von selbst aus, und wer drinnen sitzt, merkt
    es erst am kalten Fleisch."""
    w, gesendet = wache()
    lauf(w, [grill(temperature=80, target=110)])
    lauf(w, [grill(state="off", temperature=60, target=110)])
    assert len(gesendet) == 1
    titel, text, kategorie = gesendet[0]
    assert titel == "Smoker ist aus"
    assert "60°C" in text
    assert kategorie == "grill"
    # Einmal, nicht in jeder Runde, solange er aus ist.
    lauf(w, [grill(state="off", temperature=50, target=110)])
    assert len(gesendet) == 1


def test_ein_kalter_grill_beim_start_meldet_nichts():
    """Der Hub startet oft zwischen zwei Grillabenden - «ist aus» wäre
    dann keine Nachricht, sondern Lärm."""
    w, gesendet = wache()
    lauf(w, [grill(state="off", temperature=21, target=110)])
    lauf(w, [grill(state="unknown", target=None)])
    assert gesendet == []


def test_die_meldung_kommt_auch_wenn_der_kalte_grill_kein_ziel_mehr_meldet():
    """Manche Platinen melden ohne Feuer keinen Sollwert - das Ausgehen
    darf daran nicht scheitern."""
    w, gesendet = wache()
    lauf(w, [grill(temperature=100, target=110)])
    lauf(w, [grill(state="off", temperature=95, target=None)])
    assert [t for t, _, _ in gesendet] == ["Smoker ist aus"]


def test_ein_hoeherer_sollwert_meldet_erneut():
    w, gesendet = wache()
    lauf(w, [grill(temperature=110, target=110)])
    assert len(gesendet) == 1
    # Hochgedreht - und schon ist der Grill wieder am Aufheizen.
    lauf(w, [grill(temperature=110, target=160)])
    lauf(w, [grill(temperature=159, target=160)])
    assert len(gesendet) == 2
    assert "160°C" in gesendet[1][1]


def test_der_fuehler_meldet_an_seinem_ziel():
    """Die Meldung, für die man beim Grillen aufs Telefon sieht."""
    w, gesendet = wache([{"entity_id": "pitboss.grill", "nummer": 2, "ziel": 63}])
    lauf(w, [grill(temperature=110, target=110, probe_2=50)])
    # Der Grill meldet sich, der Fühler noch nicht.
    assert [t for t, _, _ in gesendet] == ["Smoker ist auf Temperatur"]

    lauf(w, [grill(temperature=110, target=110, probe_2=64)])
    assert [t for t, _, _ in gesendet] == [
        "Smoker ist auf Temperatur",
        "Fühler 2 ist so weit",
    ]
    assert "64°C" in gesendet[1][1]


def test_ohne_ziel_schweigt_der_fuehler():
    """Ein eingesteckter Fühler ohne Ziel ist eine Zahl, kein Wecker."""
    w, gesendet = wache()
    lauf(w, [grill(temperature=110, target=110, probe_1=90)])
    assert [t for t, _, _ in gesendet] == ["Smoker ist auf Temperatur"]


def test_ein_ausgesteckter_fuehler_meldet_beim_naechsten_stueck_wieder():
    """Wer den Fühler ins nächste Stück steckt, soll die Meldung
    bekommen."""
    w, gesendet = wache([{"entity_id": "pitboss.grill", "nummer": 1, "ziel": 63}])
    lauf(w, [grill(temperature=110, target=110, probe_1=65)])
    assert len(gesendet) == 2
    # Herausgezogen - die Platine meldet den Fühler nicht mehr.
    lauf(w, [grill(temperature=110, target=110)])
    # Neues Stück, kalt, dann wieder gar.
    lauf(w, [grill(temperature=110, target=110, probe_1=20)])
    lauf(w, [grill(temperature=110, target=110, probe_1=63)])
    assert len(gesendet) == 3
    assert gesendet[2][0] == "Fühler 1 ist so weit"


def test_die_waschmaschine_bleibt_verschont():
    """Erkannt am Temperaturziel - dieselbe Regel wie bei der
    Live-Karte. Eine Waschmaschine hat keines."""
    w, gesendet = wache()
    maschine = SimpleNamespace(
        id="vzug.wm", kind="appliance", label="Waschmaschine",
        state={"state": "running", "program": "Buntwäsche"},
    )
    lauf(w, [maschine])
    assert gesendet == []


@pytest.mark.parametrize("nummer", [1, 2, 3, 4])
def test_alle_vier_fuehler_koennen_melden(nummer):
    """Vier Stück, wie gewünscht."""
    w, gesendet = wache(
        [{"entity_id": "pitboss.grill", "nummer": nummer, "ziel": 63}]
    )
    lauf(w, [grill(temperature=80, target=110, **{f"probe_{nummer}": 70})])
    assert [t for t, _, _ in gesendet] == [f"Fühler {nummer} ist so weit"]
