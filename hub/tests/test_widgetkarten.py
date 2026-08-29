"""Was ein einzelnes Widget über sein Gerät wissen muss.

Ein Widget, das «on» anzeigt, hat den Weg von der Steckdose bis zum
Homescreen umsonst gemacht - hier steht, dass daraus «an» wird.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import widgetkarten
from homepilot.core.entity import Entity
from homepilot.core.hub import Hub

from .conftest import make_config


def geraet(entity_id: str, kind: str, state: dict, name: str = "Küchenlicht") -> Entity:
    return Entity(id=entity_id, kind=kind, name=name, integration="demo", state=state)


# ── Zustand in Worten ──────────────────────────────────────────────────────


def test_an_und_aus():
    assert widgetkarten.zustand_text(geraet("a", "light", {"state": "on"})) == "an"
    assert widgetkarten.zustand_text(geraet("a", "light", {"state": "off"})) == "aus"


def test_kontakt_und_schloss():
    assert widgetkarten.zustand_text(geraet("a", "binary_sensor", {"state": "open"})) == "offen"
    assert widgetkarten.zustand_text(geraet("a", "lock", {"state": "locked"})) == "verriegelt"


def test_messwert_bekommt_seine_einheit():
    """«21» ist ein Rätsel, «21 °C» eine Aussage."""
    zeile = geraet("a", "sensor", {"state": 21.0, "unit": "°C"})
    assert widgetkarten.zustand_text(zeile) == "21 °C"


def test_messwert_wird_gekuerzt():
    zeile = geraet("a", "sensor", {"state": 21.47, "unit": "°C"})
    assert widgetkarten.zustand_text(zeile) == "21,5 °C"


def test_unbekanntes_geht_unveraendert_durch():
    """Lieber ein englisches Wort als ein leeres Feld."""
    assert widgetkarten.zustand_text(geraet("a", "vacuum", {"state": "mopping"})) == "mopping"


def test_ohne_zustand_ein_strich():
    assert widgetkarten.zustand_text(geraet("a", "button", {})) == "–"


def test_ist_an_kennt_mehr_als_licht():
    assert widgetkarten.ist_an("playing") is True
    assert widgetkarten.ist_an("cleaning") is True
    assert widgetkarten.ist_an("docked") is False


# ── Die gefragten Kennungen ────────────────────────────────────────────────


def test_ids_werden_getrimmt_und_entdoppelt():
    assert widgetkarten.gefragte_ids(" a , b ,a, c ") == ["a", "b", "c"]


def test_ids_sind_gedeckelt():
    viele = ",".join(str(n) for n in range(50))
    assert len(widgetkarten.gefragte_ids(viele)) == 12


def test_ohne_ids_nichts():
    assert widgetkarten.gefragte_ids(None) == []
    assert widgetkarten.gefragte_ids("") == []


# ── Die Zeilen ─────────────────────────────────────────────────────────────


def test_zeilen_folgen_der_frage_nicht_dem_bestand():
    """Das Widget hat seine Karten in einer bestimmten Ordnung."""
    bestand = [
        geraet("demo.a", "light", {"state": "on"}, "Erstes"),
        geraet("demo.b", "light", {"state": "off"}, "Zweites"),
    ]
    zeilen = widgetkarten.zeilen(bestand, ["demo.b", "demo.a"])
    assert [z["name"] for z in zeilen] == ["Zweites", "Erstes"]
    assert [z["on"] for z in zeilen] == [False, True]


def test_abgebautes_geraet_faellt_still_heraus():
    """Und nicht: das nächstbeste anzeigen."""
    bestand = [geraet("demo.a", "light", {"state": "on"})]
    assert widgetkarten.zeilen(bestand, ["demo.weg"]) == []


# ── Über die Route ─────────────────────────────────────────────────────────


def test_glance_ohne_ids_traegt_keine_geraete():
    """Die alte Knopfleiste soll keine Zeile mehr übertragen als bisher."""
    with TestClient(create_app(Hub(make_config()))) as client:
        daten = client.get("/api/glance").json()
        assert "entities" not in daten
        assert "doors_open" in daten


def test_glance_mit_ids_traegt_die_gefragten():
    with TestClient(create_app(Hub(make_config()))) as hub_client:
        alle = hub_client.get("/api/entities").json()
        licht = next(e for e in alle if e["kind"] == "light")
        daten = hub_client.get(f"/api/glance?ids={licht['id']}").json()
        assert [z["id"] for z in daten["entities"]] == [licht["id"]]
        assert daten["entities"][0]["name"]
        assert isinstance(daten["entities"][0]["on"], bool)
