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
