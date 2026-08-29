"""Einen Menschen im Datenbestand umbenennen – überall auf einmal.

Der Fall aus dem Betrieb: «Ich habe meinen Namen von Stefan in stibe
geändert» – in der config.yaml, also an einer Stelle, die der Hub nicht
mitverfolgen kann. Danach: kein Zugang, zwei Zeilen in der Anwesenheit,
und die Ämtli hingen an einem Namen, den es nicht mehr gab.
"""

from homepilot.core.umzug import bericht_zeilen, umziehen

BESTAND = {
    "users": [{"name": "Stefan", "role": "besitzer"}, {"name": "Bine"}],
    "emails": [{"name": "Stefan", "email": "s@example.ch"}],
    "sessions": [{"user": "Stefan", "hash": "abc"}, {"user": "Bine", "hash": "def"}],
    "user_prefs": [{"user": "Stefan", "prefs": {"favoriten": ["licht.flur"]}}],
    "push_devices": [{"user": "Stefan", "token": "ExponentPushToken[x]"}],
    "push_prefs": [{"user": "Stefan", "aus": ["battery"]}],
    "person_prefs": [{"zone": "stefan", "meldungen": {"leave": True}}],
    "presence_last": [{"zone": "stefan", "state": "home"}],
    "presence_history": [{"person": "stefan", "state": "home", "at": 100.0}],
    "family_chores": [
        {"text": "Abfall", "member": "Stefan", "members": ["Stefan", "Bine"]}
    ],
    "family_rewards": [{"member": "Stefan", "points": 5}],
    "family_polls": [{"text": "Pizza?", "votes": {"Stefan": "ja", "Bine": "nein"}}],
    "audit": [{"user": "Stefan", "command": "turn_on"}],
}


def test_der_zugang_zieht_mit():
    neu, _ = umziehen(BESTAND, "Stefan", "Stibe", "stefan", "stibe")
    assert [row["name"] for row in neu["users"]] == ["Stibe", "Bine"]
    assert neu["emails"] == [{"name": "Stibe", "email": "s@example.ch"}]
    assert [row["user"] for row in neu["sessions"]] == ["Stibe", "Bine"]


def test_was_einem_gehoert_zieht_mit():
    """Favoriten, Kachel-Reihenfolgen, angemeldete Telefone."""
    neu, _ = umziehen(BESTAND, "Stefan", "Stibe", "stefan", "stibe")
    assert neu["user_prefs"][0]["user"] == "Stibe"
    assert neu["user_prefs"][0]["prefs"] == {"favoriten": ["licht.flur"]}
    assert neu["push_devices"][0]["user"] == "Stibe"
    assert neu["push_prefs"][0]["user"] == "Stibe"


def test_die_ortungszone_zieht_mit():
    """Sie heisst nach dem Vornamen und ist kleingeschrieben."""
    neu, _ = umziehen(BESTAND, "Stefan", "Stibe", "stefan", "stibe")
    assert neu["person_prefs"] == [{"zone": "stibe", "meldungen": {"leave": True}}]
    assert neu["presence_last"] == [{"zone": "stibe", "state": "home"}]
    assert neu["presence_history"][0]["person"] == "stibe"


def test_was_einem_zugeteilt_ist_zieht_mit():
    """Ämtli, Punkte, die Reihe, in der man dran ist - und Abstimmungen,
    bei denen der Name im Schlüssel steht."""
    neu, _ = umziehen(BESTAND, "Stefan", "Stibe", "stefan", "stibe")
    amtli = neu["family_chores"][0]
    assert amtli["member"] == "Stibe"
    assert amtli["members"] == ["Stibe", "Bine"]
    assert neu["family_rewards"][0]["member"] == "Stibe"
    assert neu["family_polls"][0]["votes"] == {"Stibe": "ja", "Bine": "nein"}


def test_das_protokoll_bleibt_wie_es_war():
    """Das Zugriffsprotokoll hält fest, was geschehen ist. Wer es
    nachträglich umschreibt, macht aus einem Protokoll eine Behauptung."""
    neu, _ = umziehen(BESTAND, "Stefan", "Stibe", "stefan", "stibe")
    assert neu["audit"] == [{"user": "Stefan", "command": "turn_on"}]


def test_der_bericht_zaehlt_jede_liste():
    _, bericht = umziehen(BESTAND, "Stefan", "Stibe", "stefan", "stibe")
    assert bericht["users"] == 1
    assert bericht["family_chores"] == 1
    assert "audit" not in bericht
    assert "  users: 1" in bericht_zeilen(bericht)


def test_ohne_treffer_wird_nichts_angefasst():
    neu, bericht = umziehen(BESTAND, "Niemand", "Wer", "niemand", "wer")
    assert bericht == {}
    assert bericht_zeilen(bericht) == [
        "Nichts gefunden – kein Eintrag trägt diesen Namen."
    ]
    assert neu["users"] == BESTAND["users"]


def test_derselbe_name_und_leere_angaben_sind_kein_umzug():
    assert umziehen(BESTAND, "Stefan", "Stefan")[1] == {}
    assert umziehen(BESTAND, "", "Stibe")[1] == {}
    assert umziehen({}, "Stefan", "Stibe")[1] == {}


def test_die_zonen_bleiben_ohne_angabe_unberuehrt():
    """Ohne Zonenkennung ist nicht klar, welche Zeile gemeint ist - dann
    lieber nichts anfassen als die falsche."""
    neu, bericht = umziehen(BESTAND, "Stefan", "Stibe")
    assert "person_prefs" not in bericht
    assert neu["person_prefs"] == BESTAND["person_prefs"]
