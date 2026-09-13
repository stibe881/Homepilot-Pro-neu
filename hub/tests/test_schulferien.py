"""Schulferien: «Wecker nur an Schultagen» wird baubar."""

from datetime import date

from homepilot.core import schulferien

ROWS = [
    {"name": "Herbstferien", "from": "2026-09-26", "to": "2026-10-11"},
    {"name": "Weihnachtsferien", "from": "2026-12-19", "to": "2027-01-03"},
]


def test_die_drei_zustaende_des_tages():
    # Ein Montag mitten im Quartal.
    assert schulferien.lage(ROWS, date(2026, 9, 7))["state"] == "schultag"
    # Ein Samstag.
    assert schulferien.lage(ROWS, date(2026, 9, 5))["state"] == "wochenende"
    # Mitten in den Herbstferien.
    lage = schulferien.lage(ROWS, date(2026, 10, 1))
    assert lage["state"] == "ferien"
    assert lage["name"] == "Herbstferien"


def test_ein_feiertag_zaehlt_als_ferientag():
    """Für den Wecker ist Auffahrt dasselbe wie ein Ferientag - kein
    Schulweg."""
    lage = schulferien.lage(ROWS, date(2026, 12, 8))  # Mariä Empfängnis (LU)
    assert lage["state"] == "ferien"
    assert lage["name"] == "Feiertag"


def test_die_kachel_weiss_wann_die_naechsten_ferien_beginnen():
    lage = schulferien.lage(ROWS, date(2026, 9, 7))
    assert lage["next"] == "Herbstferien"
    assert lage["next_in_days"] == 19


def test_die_kachel_weiss_auch_wann_die_ferien_enden():
    """Punkt 619: Der Wochenplan zeigt sieben Tage und muss wissen, ob
    der Dienstag noch Ferien ist - aus «heute Ferien» allein stand
    «Schule bis 15:05» mitten in den Herbstferien."""
    lage = schulferien.lage(ROWS, date(2026, 10, 1))
    assert lage["until"] == "2026-10-11"
    assert lage["next"] == "Weihnachtsferien"
    assert lage["next_until"] == "2027-01-03"
    # An einem Schultag gibt es kein laufendes Ende, aber das der nächsten.
    lage = schulferien.lage(ROWS, date(2026, 9, 7))
    assert lage["until"] is None
    assert lage["next_until"] == "2026-10-11"
    # Ein Feiertag endet am selben Tag.
    assert schulferien.lage(ROWS, date(2026, 12, 8))["until"] == "2026-12-08"


def test_kaputte_zeilen_bringen_den_tag_nicht_durcheinander():
    rows = [{"name": "Kaputt", "from": "irgendwann", "to": "2026-10-11"}, *ROWS, "quatsch"]
    assert schulferien.lage(rows, date(2026, 10, 1))["name"] == "Herbstferien"


def test_die_antwort_der_api_wird_zur_ablage():
    payload = [
        {
            "startDate": "2027-02-06",
            "endDate": "2027-02-21",
            "name": [{"language": "DE", "text": "Sportferien"}],
        }
    ]
    assert schulferien.aus_antwort(payload) == [
        {"name": "Sportferien", "from": "2027-02-06", "to": "2027-02-21"}
    ]


def test_eine_leere_zukunft_heisst_nachladen():
    """Sonst hiesse nach dem letzten abgelegten Termin jeder Tag
    «Schule»."""
    assert schulferien.veraltet(ROWS, date(2027, 6, 1)) is True
    assert schulferien.veraltet(ROWS, date(2026, 9, 1)) is False
    assert schulferien.veraltet(None, date(2026, 9, 1)) is True
