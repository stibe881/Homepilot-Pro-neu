"""Der Sauger-Check: liest er aus der API-Antwort das Richtige heraus?

Geprüft wird, was ohne laufenden Hub prüfbar ist - die Übersetzung von
der API-Antwort in die Problemliste. Der Abruf selbst braucht einen Hub
und gehört ins Haus, nicht in die Testreihe (wie bei storencheck).
"""

from homepilot import saugercheck
from homepilot.core.watchrules import sauger_probleme


def test_die_antwort_der_api_wird_zur_problemliste():
    """Das Werkzeug muss dieselbe Wirklichkeit sehen wie die App.

    Deshalb läuft die Regel hier über die API-Antwort und nicht über die
    Registry: Ein Werkzeug, das eine andere Quelle liest als die, um die
    es geht, beruhigt genau dann, wenn es nicht darf.
    """
    roh = {
        "id": "roborock.saros",
        "name": "Saros Z70",
        "kind": "vacuum",
        "state": {
            "state": "docked",
            "battery": 88,
            "dock": {"error": "ok", "dirty_water": "full_not_installed"},
        },
    }
    geraet = saugercheck._Gerät(roh)
    assert geraet.kind == "vacuum" and geraet.label == "Saros Z70"

    probleme = sauger_probleme([geraet])
    assert [text for _, _, text in probleme] == [
        "Der Schmutzwassertank ist voll oder nicht eingesetzt."
    ]


def test_ein_gerät_ohne_namen_faellt_auf_seine_kennung_zurueck():
    geraet = saugercheck._Gerät({"id": "roborock.x", "kind": "vacuum"})
    assert geraet.label == "roborock.x"
    assert geraet.state == {}


def test_ein_unvollstaendiger_lauf_ist_eine_nachricht_wert():
    """Gemeldet: Die Roborock-App schrieb «Reinigungsweg ungewöhnlich.
    Alle reinigbaren Bereiche wurden gereinigt.» - im HomePilot kam
    nichts.

    Kein Wunder: Der Hub las nur den Fehlercode des Roboters und die
    Stände der Station. Wie eine *Fahrt* ausgegangen ist, führt der
    Sauger in einem eigenen Protokoll."""
    from homepilot.core.watchrules import lauf_meldung

    schluessel, satz = lauf_meldung(
        {"last_run": {"at": 1000, "complete": False, "area_m2": 23.4, "minutes": 41}}
    )
    assert schluessel == "lauf:1000"
    assert satz == "Der Sauger ist fertig, hat aber nicht alles geschafft (23.4 m² in 41 min)."


def test_eine_gelungene_fahrt_schweigt():
    """«Fertig» ist keine Störung - eine Nachricht nach jeder Fahrt wäre
    in einer Woche abbestellt."""
    from homepilot.core.watchrules import lauf_meldung

    assert lauf_meldung({"last_run": {"at": 1, "complete": True}}) is None
    # Und ohne Angabe wird nichts behauptet.
    assert lauf_meldung({"last_run": {"at": 1, "complete": None}}) is None
    assert lauf_meldung({}) is None
    assert lauf_meldung(None) is None


def test_jede_fahrt_bekommt_hoechstens_eine_nachricht():
    """Der Schlüssel trägt den Zeitpunkt: Dieselbe Fahrt meldet nicht
    zweimal, die nächste wieder."""
    from homepilot.core.watchrules import lauf_meldung

    erste = lauf_meldung({"last_run": {"at": 1000, "complete": False}})
    zweite = lauf_meldung({"last_run": {"at": 2000, "complete": False}})
    assert erste is not None and zweite is not None
    assert erste[0] != zweite[0]
    # Ohne Umfang bleibt der Satz trotzdem ein Satz.
    assert erste[1] == "Der Sauger ist fertig, hat aber nicht alles geschafft."


def test_der_lauf_kommt_aus_dem_protokoll_der_bibliothek():
    """`lauf_state` liest das CleanRecord der Bibliothek - Fläche in mm²,
    Dauer in Sekunden, `complete` als 0/1."""
    from types import SimpleNamespace

    from homepilot.integrations.roborock import lauf_state

    lauf = lauf_state(
        SimpleNamespace(
            end=1788000000, complete=0, finish_reason=64,
            area=23_400_000, duration=2460,
        )
    )
    assert lauf == {
        "at": 1788000000.0,
        "complete": False,
        "reason": 64,
        "area_m2": 23.4,
        "minutes": 41,
    }
    assert lauf_state(None) is None
