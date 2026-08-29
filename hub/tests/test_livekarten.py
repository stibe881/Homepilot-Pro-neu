"""Live-Karten: aus dem Hauszustand werden Sperrbildschirm-Karten."""

from types import SimpleNamespace

from homepilot.core.livekarten import (
    abgleich,
    ende_payload,
    karten_alarm,
    karten_erinnerungen,
    karten_geraete,
    karten_grill,
    karten_sauger,
    karten_timer,
    registrieren,
    start_payload,
    token_merken,
)


def entity(id: str, kind: str, label: str, **state):
    return SimpleNamespace(id=id, kind=kind, label=label, state=state)


def test_timer_karte_traegt_den_countdown():
    karten = karten_timer([{"id": "t1", "text": "Pasta", "ends_at": 1000.0}])
    assert karten[0]["art"] == "timer:t1"
    assert karten[0]["state"]["endet"] == 1000.0
    assert karten[0]["state"]["text"] == "Pasta"
    assert karten_timer([]) == []


def test_waschmaschine_ja_grill_nein():
    """Der Grill ist auch ein appliance - erkennbar am Temperaturziel
    bekommt er seine eigene Karte statt der Wäsche-Karte."""
    maschine = entity(
        "vzug.wm", "appliance", "Waschmaschine",
        state="running", program="Buntwäsche", minutes_left=40,
    )
    grill = entity(
        "pitboss.grill", "appliance", "Grill",
        state="running", temperature=182, target=200,
    )
    still = entity("vzug.gs", "appliance", "Geschirrspüler", state="idle")

    geraete = karten_geraete([maschine, grill, still], jetzt_s=1000.0)
    assert [k["art"] for k in geraete] == ["geraet:vzug.wm"]
    # Nur das Programm im Text: Die Minuten stehen als Countdown daneben
    # und liefen sonst zweimal - einmal davon veraltet.
    assert geraete[0]["state"]["text"] == "Buntwäsche"
    assert geraete[0]["state"]["endet"] == 1000.0 + 40 * 60
    # Beim Ende bleibt kurz «Fertig» stehen - der Moment, um den es geht.
    assert geraete[0]["ende"]["state"]["text"] == "Fertig - ausräumen"
    assert geraete[0]["ende"]["sichtbar"] == 900

    grills = karten_grill([maschine, grill, still])
    assert [k["art"] for k in grills] == ["grill:pitboss.grill"]
    assert grills[0]["state"]["text"] == "182° → 200°"
    assert 0.9 < grills[0]["state"]["fortschritt"] < 0.92


def test_ohne_restzeit_bleibt_es_beim_wort():
    """Manche Maschinen nennen keine Restzeit. Dann gibt es keinen
    Countdown - und die Karte behauptet auch keinen."""
    maschine = entity(
        "vzug.wm", "appliance", "Waschmaschine", state="running", program="Kurz"
    )
    karten = karten_geraete([maschine], jetzt_s=1000.0)
    assert karten[0]["state"]["text"] == "Kurz"
    assert "endet" not in karten[0]["state"]
    assert "fortschritt" not in karten[0]["state"]


def test_der_balken_kommt_aus_den_letzten_laeufen():
    """Die Programmdauer wird nicht geraten: Ohne genug aufgezeichnete
    Läufe bleibt der Balken weg, mit ihnen steht er ehrlich da."""
    maschine = entity(
        "vzug.wm", "appliance", "Waschmaschine",
        state="running", program="Buntwäsche", minutes_left=30,
    )
    ohne = karten_geraete([maschine], [], jetzt_s=1000.0)
    assert "fortschritt" not in ohne[0]["state"]

    cycles = [
        {"entity_id": "vzug.wm", "seconds": 3600},
        {"entity_id": "vzug.wm", "seconds": 3600},
    ]
    mit = karten_geraete([maschine], cycles, jetzt_s=1000.0)
    # Eine Stunde üblich, dreissig Minuten übrig: die Hälfte.
    assert mit[0]["state"]["fortschritt"] == 0.5


def test_sauger_karte_nur_beim_saugen():
    unterwegs = entity(
        "roborock.saros", "vacuum", "Saros Z70",
        state="cleaning", battery=80, clean_area_m2=12.5,
    )
    daheim = entity("roborock.zwei", "vacuum", "Zweiter", state="docked")
    karten = karten_sauger([unterwegs, daheim])
    assert [k["art"] for k in karten] == ["sauger:roborock.saros"]
    assert karten[0]["state"]["text"] == "saugt · 12.5 m² · Akku 80 %"


def test_erinnerungs_karte_folgt_den_regeln_des_vollbilds():
    reminders = [
        {"id": "a", "text": "Ofen aus", "at": 100, "quittiert": ["Stibe"]},
        {"id": "b", "text": "Nur Push", "at": 100, "anzeigen": False},
        {"id": "c", "text": "Erledigt", "at": 100, "done": True},
        {"id": "d", "text": "Später", "at": 5000},
    ]
    karten = karten_erinnerungen(reminders, 200)
    assert [k["art"] for k in karten] == ["erinnerung:a"]
    # Wer für sich quittiert hat, bekommt keine Karte - die anderen schon.
    assert karten[0]["ohne"] == ["Stibe"]


def test_alarm_karte_countdown_und_rot():
    schaltend = entity(
        "alarm.haus", "alarm", "Alarmanlage", state="scharfschaltend", seconds_left=30
    )
    karten = karten_alarm([schaltend], jetzt_s=1000.0)
    assert karten[0]["state"]["endet"] == 1030.0

    los = entity("alarm.haus", "alarm", "Alarmanlage", state="ausgeloest")
    karten = karten_alarm([los], jetzt_s=1000.0)
    assert karten[0]["state"]["farbe"] == "rot"
    start = start_payload("alarm:x", karten[0]["state"], 1000.0)
    assert start["aps"]["relevance-score"] == 100
    # Pflichtfeld beim Start - ohne alert verwirft iOS den Push still
    # (der Fall steht in test_liveaktivitaet.test_payloads_tragen_das_noetige).
    assert start["aps"]["alert"]["title"] == karten[0]["state"]["titel"]
    assert start["aps"]["alert"]["body"] == karten[0]["state"]["text"]

    # «scharf» bekommt bewusst keine Karte - eine Nacht ist länger als
    # die zwölf Stunden, die iOS einer Aktivität gibt.
    scharf = entity("alarm.haus", "alarm", "Alarmanlage", state="scharf")
    assert karten_alarm([scharf], jetzt_s=1000.0) == []


def test_abgleich_startet_aktualisiert_und_beendet():
    wunsch = [
        {"art": "timer:t1", "user": None, "state": {"titel": "Timer", "text": "Pasta"}}
    ]
    rows, starten, aktualisieren, beenden = abgleich([], wunsch, ["Stibe", "Bine"], 1000.0)
    assert {(s["user"], s["art"]) for s in starten} == {
        ("Stibe", "timer:t1"),
        ("Bine", "timer:t1"),
    }

    # Die App meldet ein Aktivitäts-Token nach; dann ändert sich der Text.
    rows = token_merken(rows, "Stibe", "timer:t1", "act-1")
    wunsch[0]["state"] = {"titel": "Timer", "text": "Tee"}
    rows, starten, aktualisieren, beenden = abgleich(rows, wunsch, ["Stibe", "Bine"], 2000.0)
    assert starten == [] and beenden == []
    # Nur die Karte mit Token lässt sich aktualisieren.
    assert [a["tokens"] for a in aktualisieren] == [["act-1"]]

    # Timer weg: beide Karten enden - auch die ohne Token (leere Liste).
    rows, starten, aktualisieren, beenden = abgleich(rows, [], ["Stibe", "Bine"], 3000.0)
    assert rows == [] and len(beenden) == 2
    assert sorted(len(b["tokens"]) for b in beenden) == [0, 1]


def test_abgleich_drosselt_updates():
    """Der Grill meldet im Sekundentakt - Apple deckelt das Budget, also
    frühestens alle UPDATE_ABSTAND Sekunden. Ein verworfenes Update ist
    nicht verloren: Der gespeicherte Stand zieht erst beim Senden nach."""
    wunsch = [{"art": "grill:g", "user": None, "state": {"text": "180°"}}]
    rows, *_ = abgleich([], wunsch, ["Stibe"], 1000.0)
    rows = token_merken(rows, "Stibe", "grill:g", "act-1")

    wunsch[0]["state"] = {"text": "182°"}
    rows, _, aktualisieren, _ = abgleich(rows, wunsch, ["Stibe"], 1010.0)
    assert aktualisieren == []
    # Später kommt es durch - mit dem dann aktuellen Stand.
    wunsch[0]["state"] = {"text": "185°"}
    rows, _, aktualisieren, _ = abgleich(rows, wunsch, ["Stibe"], 1060.0)
    assert [a["state"]["text"] for a in aktualisieren] == ["185°"]


def test_ende_payload_laesst_fertig_stehen():
    aps = ende_payload({"text": "Fertig"}, 900, 1000.0)["aps"]
    assert aps["event"] == "end"
    assert aps["dismissal-date"] == 1900
    assert aps["content-state"] == {"text": "Fertig"}
    # Ohne Schluss-Bild: sofort weg.
    sofort = ende_payload(None, 0, 1000.0)["aps"]
    assert sofort["dismissal-date"] == 1000
    assert "content-state" not in sofort


def test_registrieren_ersetzt_dasselbe_telefon():
    rows = registrieren([], "Stibe", "tok-1", "iPhone")
    rows = registrieren(rows, "Stibe", "tok-1", "iPhone")
    assert len(rows) == 1


def test_einzelne_kartenarten_lassen_sich_abbestellen():
    """Feinregelung wie bei den Benachrichtigungen: Wer «grill» in seiner
    liveAus-Liste hat, bekommt keine Grill-Karte mehr - eine laufende
    endet in derselben Runde. Die anderen Karten bleiben unberührt."""
    from homepilot.core.liveaktivitaet import abbestellte

    prefs = [
        {"user": "Stibe", "prefs": {"liveAus": ["grill", "timer"]}},
        {"user": "Bine", "prefs": {"liveAus": []}},
        {"user": "Tablet", "prefs": {}},
    ]
    assert abbestellte(prefs) == {"Stibe": {"grill", "timer"}, "Bine": set()}

    wunsch = [
        {"art": "grill:g", "user": None, "state": {"text": "180°"}},
        {"art": "sauger:s", "user": None, "state": {"text": "saugt"}},
    ]
    ab = abbestellte(prefs)
    rows, starten, *_ = abgleich([], wunsch, ["Stibe", "Bine"], 1000.0, abbestellt=ab)
    # Stibe bekommt nur den Sauger, Bine beides.
    assert {(s["user"], s["art"]) for s in starten} == {
        ("Stibe", "sauger:s"),
        ("Bine", "grill:g"),
        ("Bine", "sauger:s"),
    }

    # Bestellt Bine den Grill später ab, endet ihre laufende Karte.
    rows = token_merken(rows, "Bine", "grill:g", "act-1")
    ab = abbestellte([{"user": "Bine", "prefs": {"liveAus": ["grill"]}}])
    rows, starten, _, beenden = abgleich(
        rows, wunsch, ["Stibe", "Bine"], 2000.0, abbestellt=ab
    )
    assert [b["tokens"] for b in beenden if b["tokens"]] == [["act-1"]]
