"""Plex: was gerade läuft - als Karte und als Auslöser."""

from homepilot.integrations.plex import sessions_lesen, zustand

ANTWORT = {
    "MediaContainer": {
        "size": 2,
        "Metadata": [
            {
                "title": "Folge 7",
                "grandparentTitle": "Die Sendung mit der Maus",
                "type": "episode",
                "duration": 1800000,
                "viewOffset": 900000,
                "Player": {"title": "Wohnzimmer TV", "state": "playing"},
                "User": {"title": "Maja"},
            },
            {
                "title": "Heidi",
                "type": "movie",
                "duration": 6000000,
                "viewOffset": 600000,
                "Player": {"title": "iPad", "state": "paused"},
                "User": {"title": "Stefan"},
            },
        ],
    }
}


def test_bei_einer_serie_ist_die_antwort_die_serie():
    """«Folge 7» sagt nichts - die Serie ist die Auskunft."""
    sessions = sessions_lesen(ANTWORT)
    assert sessions[0]["title"] == "Die Sendung mit der Maus – Folge 7"
    assert sessions[0]["progress"] == 50
    assert sessions[1]["title"] == "Heidi"


def test_spielendes_gewinnt_gegen_pausiertes():
    """«playing» ist die Auskunft, an der Abläufe hängen."""
    stand = zustand(sessions_lesen(ANTWORT))
    assert stand["state"] == "playing"
    assert stand["title"] == "Die Sendung mit der Maus – Folge 7"
    assert stand["user"] == "Maja"
    assert stand["sessions"] == 2


def test_stille_ist_idle_und_raeumt_die_felder():
    stand = zustand([])
    assert stand["state"] == "idle"
    # Ausdrücklich None statt weggelassen: Die Registry merged, und ein
    # weggelassener Titel bliebe sonst als alter Titel stehen.
    assert stand["title"] is None
    assert stand["sessions"] == 0


def test_kaputte_antworten_werfen_nicht():
    assert sessions_lesen(None) == []
    assert sessions_lesen({"MediaContainer": {}}) == []
    assert zustand(sessions_lesen({"MediaContainer": {"Metadata": ["quatsch"]}}))[
        "state"
    ] == "idle"
