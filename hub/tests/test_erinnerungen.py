"""Erinnerungen: Der Hub schickt den Push - und nur er.

Die Bildschirm-Fälligkeit rechnen die Geräte selbst; hier steht die
Logik, die entscheidet, wer wann eine Push-Nachricht bekommt und was
danach in der Liste steht.
"""

from homepilot.core.erinnerungen import empfaenger, nach_versand, zu_pushen


def test_gepusht_wird_was_faellig_ist_und_push_traegt():
    rows = [
        {"id": "a", "at": 1000, "push": True},
        {"id": "b", "at": 1000},                      # nur Bildschirm
        {"id": "c", "at": 5000, "push": True},        # noch nicht so weit
        {"id": "d", "at": 1000, "push": True, "done": True},
        {"id": "e", "at": 1000, "push": True, "pushed": True},
        {"id": "f", "at": "kaputt", "push": True},
    ]
    assert [row["id"] for row in zu_pushen(rows, 2000)] == ["a"]


def test_leere_und_fremde_zeilen_stoeren_nicht():
    assert zu_pushen(None, 1) == []
    assert zu_pushen([{"push": True, "at": 0}, "unsinn", {}], 1) == []


def test_empfaenger_sind_die_gewaehlten_namen():
    assert empfaenger({"push_an": ["Stefan", " Bine ", ""]}) == ["Stefan", "Bine"]
    # Leer heisst «alle» - die Entscheidung trifft der Versand.
    assert empfaenger({}) == []
    assert empfaenger({"push_an": "Stefan"}) == []


def test_nach_dem_versand_ist_nur_push_erledigt():
    rows = [
        # Push und Bildschirm: bleibt offen, bis jemand bestätigt.
        {"id": "a", "at": 1, "push": True, "anzeigen": True},
        # Nur Push: erledigt - es gibt keinen Schirm, der bestätigen könnte.
        {"id": "b", "at": 1, "push": True, "anzeigen": False},
        # Ohne Angabe gilt anzeigen - alte Einträge kennen das Feld nicht.
        {"id": "c", "at": 1, "push": True},
        {"id": "d", "at": 9, "push": True},  # nicht dabei
    ]
    neue = nach_versand(rows, {"a", "b", "c"})
    je_id = {row["id"]: row for row in neue}
    assert je_id["a"]["pushed"] is True and "done" not in je_id["a"]
    assert je_id["b"]["done"] is True
    assert je_id["c"].get("done") is None or "done" not in je_id["c"]
    assert "pushed" not in je_id["d"]
