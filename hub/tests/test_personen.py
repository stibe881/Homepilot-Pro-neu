"""Familie und Freunde: eine Liste statt drei, und Schalter je Mensch.

Der Anlass steht im Kopf von core/personen.py: Die Leute waren über
Benutzer, Ortungszonen und Life360-Mitglieder verteilt, und wer wissen
wollte, wo Maja ist, fand sie in keiner der drei Listen.
"""

from homepilot.core import personen


def test_defaults_are_complete_so_the_app_needs_no_second_copy():
    """Auch was nie eingestellt wurde, kommt mit seinem Wert zurück.

    Sonst stünde die Antwort auf «was gilt hier eigentlich» an zwei
    Orten - im Hub und in der App - und liefe auseinander, sobald eine
    Meldung dazukommt.
    """
    alle = personen.fuer([], "stefan")
    assert set(alle) == set(personen.MELDUNGEN)
    # Akku und Funkstille von selbst, Kommen und Gehen nicht: Zu viert
    # wären das an einem Werktag ein Dutzend Nachrichten.
    assert alle["battery"] is True
    assert alle["silence"] is True
    assert alle["arrive"] is False
    assert alle["leave"] is False


def test_a_switch_only_moves_for_the_person_it_belongs_to():
    rows = personen.setzen([], "stefan", "battery", False)
    assert personen.an(rows, "stefan", "battery") is False
    # Maja bleibt unangetastet.
    assert personen.an(rows, "maja", "battery") is True
    # Und die übrigen Schalter derselben Person auch.
    assert personen.an(rows, "stefan", "silence") is True


def test_switching_twice_leaves_one_row_not_two():
    rows = personen.setzen([], "stefan", "battery", False)
    rows = personen.setzen(rows, "stefan", "arrive", True)
    assert len([z for z in rows if z["zone"] == "stefan"]) == 1
    assert personen.an(rows, "stefan", "battery") is False
    assert personen.an(rows, "stefan", "arrive") is True


def test_an_unknown_switch_is_refused():
    """Ein Tippfehler soll nicht stillschweigend eine Meldung anlegen,
    die nie jemand verschickt."""
    import pytest

    with pytest.raises(ValueError):
        personen.setzen([], "stefan", "gibtsnicht", True)
    assert personen.bekannt("battery") is True
    assert personen.bekannt("gibtsnicht") is False


def test_settings_of_a_vanished_zone_are_thrown_away():
    """Sonst wächst die Datei mit jedem Umzug, und niemand sieht nach."""
    rows = personen.setzen([], "stefan", "battery", False)
    rows = personen.setzen(rows, "alterhund", "battery", False)
    sauber = personen.aufraeumen(rows, ["stefan"])
    assert [z["zone"] for z in sauber] == ["stefan"]


def test_where_someone_is_reads_like_a_sentence():
    assert personen.aufenthalt({"state": "home"}) == "zuhause"
    assert personen.aufenthalt({"state": "unknown"}) == "unbekannt"
    assert personen.aufenthalt({"state": "away"}) == "unterwegs"
    # Der Klarname schlägt alles - genau dafür holt der Hub die Orte aus
    # Life360. «bei Tanners Home» sagt mehr als «unterwegs».
    assert (
        personen.aufenthalt(
            {"state": "away", "place": "tanners_home", "place_name": "Tanners Home"}
        )
        == "bei Tanners Home"
    )
    # Ohne Klarnamen tut es die Kennung; gar nichts zu sagen wäre schlechter.
    assert personen.aufenthalt({"state": "away", "place": "schule"}) == "bei schule"


def test_the_three_kinds_of_people_all_end_up_in_one_list():
    benutzer = [
        {"name": "Stefan", "role": "besitzer", "zone": "stefan"},
        # Zugang, aber kein Telefon in der Ortung.
        {"name": "Wandtablet", "role": "bewohner", "zone": None},
    ]
    zonen = [
        {"zone": "stefan", "name": "Stefan", "where": "zuhause"},
        # Kein Hub-Benutzer, nur ein Telefon in Life360 - genau die
        # fehlte bisher in jeder Liste.
        {"zone": "maja", "name": "Maja", "where": "bei Tanners Home"},
    ]
    leute = personen.zusammenfuehren(benutzer, zonen)
    assert [p["name"] for p in leute] == ["Stefan", "Wandtablet", "Maja"]

    stefan, tablet, maja = leute
    # Benutzer und Zone in einer Zeile, nicht zweimal derselbe Mensch.
    assert stefan["zone"] == "stefan"
    assert stefan["where"] == "zuhause"
    assert stefan["household"] is True
    # Wer keine Ortung hat, steht dabei - sonst sucht man ihn -, aber
    # ohne Zone gibt es nichts zu melden.
    assert tablet["zone"] is None
    assert tablet["household"] is True
    # Und trotzdem dieselbe Form: Die App soll nicht zwei Sorten Zeile
    # auseinanderhalten müssen.
    assert set(tablet) >= set(stefan)
    assert tablet["where"] == "unbekannt"
    # Und die Geortete ohne Zugang.
    assert maja["household"] is False
    assert maja["where"] == "bei Tanners Home"


def test_zugaenge_stehen_nicht_in_der_familienliste():
    """Menschen, nicht Zugänge: Der Hub-Token (ein Zugang für Skripte)
    und die Wandpanels (geteilte Konten) standen als «Aufenthalt
    unbekannt» in der Liste - mit Schaltern, die nie etwas melden."""
    from types import SimpleNamespace

    def user(**felder):
        vorgabe = {"role": "bewohner", "enabled": True, "system": False, "shared": False}
        return SimpleNamespace(**{**vorgabe, **felder})

    assert personen.gehoert_auf_die_seite(user(name="Stefan"))
    assert not personen.gehoert_auf_die_seite(user(name="Hub-Token", system=True))
    assert not personen.gehoert_auf_die_seite(user(name="Wandpanel", shared=True))
    assert not personen.gehoert_auf_die_seite(user(name="Besuch", role="gast"))
    assert not personen.gehoert_auf_die_seite(user(name="Alt", enabled=False))
