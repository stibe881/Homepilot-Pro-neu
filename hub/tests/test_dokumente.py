"""Der Dokumentsafe kennt ein Ablaufdatum (Punkt 623).

Der Mangel: Kinderpässe gelten fünf Jahre, und der abgelaufene fiel am
Flughafen auf - Gutscheine bekamen zwei Stufen Vorwarnung, Dokumente
nichts.
"""

from datetime import date

from homepilot.core import dokumente

HEUTE = date(2026, 9, 13)


def test_three_ways_to_write_an_expiry_date():
    assert dokumente.ablauf({"expires": "2027-03-15"}) == date(2027, 3, 15)
    assert dokumente.ablauf({"expires": "15.03.2027"}) == date(2027, 3, 15)
    # Auf den Monat genau: Impfung und Vignette gelten bis Monatsende.
    assert dokumente.ablauf({"expires": "02.2028"}) == date(2028, 2, 29)
    assert dokumente.ablauf({"expires": "irgendwann"}) is None
    assert dokumente.ablauf({"expires": "31.02.2027"}) is None
    assert dokumente.ablauf({"text": "Police"}) is None
    assert dokumente.ablauf("kein dict") is None


def test_two_warning_stages_and_one_for_the_expired_document():
    assert dokumente.stufe(90) is None
    assert dokumente.stufe(60) == 60
    assert dokumente.stufe(30) == 60
    assert dokumente.stufe(14) == 14
    assert dokumente.stufe(0) == 0
    assert dokumente.stufe(-3) == 0


def test_due_documents_carry_a_mark_per_stage_and_expiry():
    rows = [
        {"id": "p1", "text": "Pass Levin", "member": "Levin", "expires": "2026-10-20"},
        {"id": "p2", "text": "Vignette", "expires": "2026-09-20"},
        {"id": "p3", "text": "Halbtax", "expires": "2026-09-10"},
        {"id": "p4", "text": "Police", "body": "im Ordner"},
        {"id": "p5", "text": "ID Lina", "expires": "2027-09-01"},
    ]
    faellig = dokumente.faellig(rows, HEUTE)
    assert [(f["row"]["id"], f["tage"], f["stufe"]) for f in faellig] == [
        ("p3", -3, 0),
        ("p2", 7, 14),
        ("p1", 37, 60),
    ]
    # Das Ablaufdatum steht in der Marke: Ein erneuerter Pass bekommt
    # für das neue Datum wieder alle Stufen.
    assert faellig[2]["marke"] == "documents:p1:2026-10-20:60"
    assert dokumente.faellig(None, HEUTE) == []


def test_the_message_names_the_person_and_the_days():
    row = {"text": "Pass Levin", "member": "Levin"}
    assert dokumente.satz(row, 37) == ("Dokument läuft ab", "Pass Levin (Levin) läuft in 37 Tagen ab.")
    assert dokumente.satz({"text": "Vignette"}, 0)[1] == "Vignette läuft heute ab."
    assert dokumente.satz({"text": "Vignette"}, 1)[1] == "Vignette läuft morgen ab."
    assert dokumente.satz({"text": "Halbtax"}, -1)[1] == "Halbtax ist seit gestern abgelaufen."
    assert dokumente.satz({"text": "Halbtax"}, -3)[1] == "Halbtax ist seit 3 Tagen abgelaufen."


def test_renewing_keeps_the_history_like_a_maintenance_log():
    row = {"id": "p1", "text": "Pass Levin", "expires": "2026-10-20"}
    neu = dokumente.erneuern(row, "2031-10-20", HEUTE, "Stefan")
    assert neu["expires"] == "2031-10-20"
    assert neu["log"] == [{"at": "2026-09-13", "by": "Stefan", "expired": "2026-10-20"}]
    # Ein zweites Mal: Der alte Eintrag rückt nach hinten.
    nochmal = dokumente.erneuern(neu, "2036-10-20", date(2031, 10, 1))
    assert [eintrag["expired"] for eintrag in nochmal["log"]] == ["2031-10-20", "2026-10-20"]
    assert nochmal["log"][0]["by"] is None


def test_the_tile_counts_what_expires_soon():
    rows = [
        {"expires": "2026-10-20"},
        {"expires": "2026-09-01"},
        {"expires": "2027-09-01"},
        {"text": "ohne"},
    ]
    assert dokumente.bald(rows, HEUTE) == 2
    assert dokumente.bald([], HEUTE) == 0
