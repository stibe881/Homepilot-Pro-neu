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


def test_benutzer_umbenennen_zieht_empfaenger_und_quittierungen_mit():
    """Ein Push an den alten Namen erreicht niemanden, und eine schon
    weggedrückte Erinnerung erschiene wieder - beides zieht mit um."""
    from homepilot.core.erinnerungen import benutzer_umbenennen

    rows = [
        {"id": "a", "push_an": ["Stefan", "Bine"], "quittiert": ["Stefan"]},
        {"id": "b", "push_an": ["Bine"]},
        "kaputt",
    ]
    neu = benutzer_umbenennen(rows, "Stefan", "Stefano")
    assert neu[0]["push_an"] == ["Stefano", "Bine"]
    assert neu[0]["quittiert"] == ["Stefano"]
    assert neu[1]["push_an"] == ["Bine"]
    assert neu[2] == "kaputt"
    # Die Eingabe bleibt unangetastet - der Aufrufer speichert das Ergebnis.
    assert rows[0]["push_an"] == ["Stefan", "Bine"]


def test_naechste_faelligkeit_ueberspringt_verpasstes_und_kennt_den_kalender():
    """Das Spiegelbild der App-Funktion - beide Seiten müssen denselben
    Termin ausrechnen, sonst stellt der Hub anders weiter als die App."""
    from datetime import datetime

    from homepilot.core.erinnerungen import naechste_faelligkeit

    def um(j, m, t, h=7):
        return datetime(j, m, t, h).timestamp() * 1000

    # Dienstag 7:00, erst am Freitagmittag bestätigt: Samstag 7:00 -
    # nicht drei nachgeholte auf einmal.
    assert naechste_faelligkeit(um(2026, 8, 25), "daily", um(2026, 8, 28, 12)) == um(
        2026, 8, 29
    )
    # Der 31. rutscht im Februar auf den 28. und kehrt danach zurück.
    assert naechste_faelligkeit(um(2026, 1, 31), "monthly", um(2026, 1, 31)) == um(
        2026, 2, 28
    )
    assert naechste_faelligkeit(um(2026, 1, 31), "monthly", um(2026, 2, 28, 8)) == um(
        2026, 3, 31
    )
    assert naechste_faelligkeit(um(2028, 2, 29), "yearly", um(2028, 2, 29)) == um(
        2029, 2, 28
    )
    # Unbekannte Wiederholung oder kaputter Zeitpunkt: kein Termin.
    assert naechste_faelligkeit(um(2026, 8, 25), "none", 0) is None
    assert naechste_faelligkeit("quatsch", "daily", 0) is None


def test_eine_wiederkehrende_nur_push_erinnerung_stellt_sich_selbst_weiter():
    """Ohne Bildschirm bestätigt niemand - nach dem Versand stellt der
    Hub selbst weiter, frisch, damit der nächste Push wieder rausgeht."""
    from datetime import datetime

    from homepilot.core.erinnerungen import nach_versand

    jetzt = datetime(2026, 8, 27, 8).timestamp() * 1000
    rows = [
        {
            "id": "a",
            "at": datetime(2026, 8, 27, 7).timestamp() * 1000,
            "anzeigen": False,
            "push": True,
            "repeat": "daily",
            "quittiert": ["Stefan"],
        },
        # Mit Bildschirm: nur pushed - weitergestellt wird beim Bestätigen.
        {
            "id": "b",
            "at": 1000.0,
            "anzeigen": True,
            "push": True,
            "repeat": "daily",
        },
    ]
    neu = nach_versand(rows, {"a", "b"}, jetzt_ms=jetzt)
    assert neu[0]["at"] == datetime(2026, 8, 28, 7).timestamp() * 1000
    assert neu[0]["pushed"] is False
    assert neu[0]["quittiert"] == []
    assert "done" not in neu[0]
    assert neu[1] == {**rows[1], "pushed": True}
