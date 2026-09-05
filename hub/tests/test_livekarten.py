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
    karten_tv,
    nicht_zuhause,
    raum_url,
    registrieren,
    sauger_knoepfe,
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


def test_fernseher_karte_fuehrt_zur_fernbedienung():
    """Man sitzt vor dem Fernseher, das Telefon daneben - die
    Fernbedienung soll einen Tipp weit auf dem Sperrbildschirm liegen,
    nicht vier Tipps tief in der App."""
    tv = entity(
        "androidtv.wohnzimmer", "media_player", "Wohnzimmer TV",
        state="on", has_screen=True, app="Netflix",
    )
    karten = karten_tv([tv])
    assert karten[0]["art"] == "tv:androidtv.wohnzimmer"
    # Die laufende App als Text: «Netflix» sagt mehr als «an».
    assert karten[0]["state"]["text"] == "Netflix"
    assert karten[0]["state"]["symbol"] == "tv"
    # Der Tipp öffnet die Fernbedienung genau dieses Geräts.
    assert karten[0]["state"]["url"] == "homepilot://fernbedienung/androidtv.wohnzimmer"


def test_fernseher_karte_nur_fuer_laufende_fernseher():
    aus = entity("tv.aus", "media_player", "TV", state="off", has_screen=True)
    # Eine Musikbox hat keinen Bildschirm - und keine Fernbedienung.
    box = entity("sonos.kueche", "media_player", "Küche", state="playing")
    # Ein Cast-Fernseher im Hintergrundbild ist kein Fernsehabend.
    leerlauf = entity("tv.idle", "media_player", "TV", state="idle", has_screen=True)
    assert karten_tv([aus, box, leerlauf]) == []


def test_fernseher_karte_nicht_fuer_leute_unterwegs():
    tv = entity("tv.wz", "media_player", "TV", state="on", has_screen=True)
    karten = karten_tv([tv], ohne=["Stefan"])
    assert karten[0]["ohne"] == ["Stefan"]
    # Ohne Abwesende fehlt der Schlüssel ganz - wie bei den anderen Karten.
    assert "ohne" not in karten_tv([tv])[0]


def test_die_fernseher_karte_traegt_den_kino_griff():
    """Der Film beginnt, das Licht ist noch hell - die Szene «Kino»
    gehört als Knopf neben die Fernbedienung, nicht vier Tipps tief in
    die App. Gefunden wird sie über ihren Namen; die Schreibweise ist
    egal."""
    tv = entity("tv.wz", "media_player", "TV", state="on", has_screen=True)
    szene = SimpleNamespace(id="szene.kino", name="Kino")
    karten = karten_tv([tv], szenen=[szene, SimpleNamespace(id="s2", name="Alles aus")])
    assert karten[0]["state"]["knoepfe"] == [
        {"symbol": "film.fill", "pfad": "/api/scenes/szene.kino/activate", "body": ""}
    ]
    assert karten_tv([tv], szenen=[SimpleNamespace(id="s", name="KINO ")])[0]["state"][
        "knoepfe"
    ][0]["pfad"] == "/api/scenes/s/activate"


def test_ohne_kino_szene_kein_knopf_und_bei_zweien_auch_nicht():
    """Heisst keine Szene so, gibt es keinen Knopf - und heissen zwei
    so, auch nicht: lieber keiner als der falsche."""
    tv = entity("tv.wz", "media_player", "TV", state="on", has_screen=True)
    assert "knoepfe" not in karten_tv([tv])[0]["state"]
    assert "knoepfe" not in karten_tv(
        [tv], szenen=[SimpleNamespace(id="s1", name="Abend")]
    )[0]["state"]
    doppelt = [SimpleNamespace(id="s1", name="Kino"), SimpleNamespace(id="s2", name="kino")]
    assert "knoepfe" not in karten_tv([tv], szenen=doppelt)[0]["state"]


def test_fernseher_zwillinge_geben_eine_karte():
    """Der gemeldete Fall: «Fernseher Wohnzimmer, eingeschaltet» lag
    über «Fernseher im Wohnzimmer, Plex» - derselbe Bildschirm, einmal
    als Android TV (mit Steuerkreuz), einmal als Zuspieler. Eine Karte,
    und zwar die mit der Fernbedienung - der Text kommt vom Zuspieler,
    denn der weiss, was läuft."""
    android = SimpleNamespace(
        id="androidtv.wz", kind="media_player", label="Fernseher Wohnzimmer",
        state={"state": "on", "has_screen": True},
        room="Wohnzimmer", commands=["dpad_up", "turn_off"],
    )
    plex = SimpleNamespace(
        id="plex.wz", kind="media_player", label="Fernseher im Wohnzimmer",
        state={"state": "playing", "has_screen": True, "app": "Plex"},
        room="Wohnzimmer", commands=["play", "pause"],
    )
    karten = karten_tv([android, plex])
    assert [k["art"] for k in karten] == ["tv:androidtv.wz"]
    assert karten[0]["state"]["text"] == "Plex"
    assert karten[0]["state"]["url"] == "homepilot://fernbedienung/androidtv.wz"


def test_fernseher_zwillinge_nur_im_selben_raum_und_ohne_raten():
    """Zwei echte Fernseher in zwei Räumen bleiben zwei Karten - und bei
    zwei Steuerkreuzen im selben Raum wird nicht geraten (dieselbe
    Vorsicht wie auf der Raumkachel, lib/raumkarte.ts)."""
    wohnzimmer = SimpleNamespace(
        id="tv.wz", kind="media_player", label="Wohnzimmer",
        state={"state": "on", "has_screen": True},
        room="Wohnzimmer", commands=["dpad_up"],
    )
    schlafzimmer = SimpleNamespace(
        id="tv.sz", kind="media_player", label="Schlafzimmer",
        state={"state": "on", "has_screen": True},
        room="Schlafzimmer", commands=["play"],
    )
    assert len(karten_tv([wohnzimmer, schlafzimmer])) == 2

    zweiter = SimpleNamespace(
        id="tv.wz2", kind="media_player", label="Beamer",
        state={"state": "on", "has_screen": True},
        room="Wohnzimmer", commands=["dpad_up"],
    )
    assert len(karten_tv([wohnzimmer, zweiter])) == 2

    # Läuft nur der Zuspieler, bleibt seine Karte - besser die ohne
    # Steuerkreuz als gar keine.
    zuspieler = SimpleNamespace(
        id="plex.wz", kind="media_player", label="Fernseher im Wohnzimmer",
        state={"state": "playing", "has_screen": True, "app": "Plex"},
        room="Wohnzimmer", commands=["play"],
    )
    allein = karten_tv([zuspieler])
    assert [k["art"] for k in allein] == ["tv:plex.wz"]


def test_nicht_zuhause_zaehlt_nur_nachweislich_abwesende():
    """Unbekannt zählt als zuhause: Wessen Telefon nichts meldet (oder
    wer keine Ortung hat), soll die Karte trotzdem bekommen - im Zweifel
    liegt lieber eine Karte zu viel."""
    zustaende = {"Stefan": "away", "Livia": "schule", "Bine": "home", "Gast": "unknown"}
    assert nicht_zuhause(["Stefan", "Livia", "Bine", "Gast", "Neu"], zustaende) == [
        "Stefan",
        "Livia",
    ]


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


def test_anmeldung_mit_namen_raeumt_namenlose_zeilen_weg():
    """Wie bei der Haustür-Karte: Zeilen aus Fassungen vor den
    Gerätenamen blieben ewig stehen, und dasselbe Telefon bekam je
    Karte zwei Start-Pushes."""
    rows = registrieren([], "Stibe", "tok-uralt")
    rows = registrieren(rows, "Bine", "tok-bine")
    rows = registrieren(rows, "Stibe", "tok-neu", "Stibes iPhone")
    assert [row["token"] for row in rows if row["user"] == "Stibe"] == ["tok-neu"]
    # Die namenlose Zeile eines anderen Kontos bleibt.
    assert [row["token"] for row in rows if row["user"] == "Bine"] == ["tok-bine"]


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


def test_ein_tipp_auf_die_geraetekarte_fuehrt_in_den_raum():
    """Geschirrspüler → Küche, Waschmaschine → Waschküche.

    Vorher trug die Geräte-Karte gar keine Adresse: Ein Tipp öffnete
    bloss die Startseite, und man suchte die Maschine von Hand. Der
    Raumname reist kodiert («Waschküche» trägt einen Umlaut) und auch
    auf dem «Fertig»-Stand mit - gerade dann will man zur Maschine.
    """
    maschine = SimpleNamespace(
        id="vzug.wm", kind="appliance", label="Waschmaschine",
        room="Waschküche",
        state={"state": "running", "program": "Buntwäsche", "minutes_left": 40},
    )
    karten = karten_geraete([maschine])
    assert karten[0]["state"]["url"] == "homepilot://raum/Waschk%C3%BCche"
    assert karten[0]["ende"]["state"]["url"] == "homepilot://raum/Waschk%C3%BCche"

    # Ohne Raum keine Adresse - lieber die Startseite als der falsche Raum.
    ohne = SimpleNamespace(
        id="vzug.gs", kind="appliance", label="Geschirrspüler", room=None,
        state={"state": "running", "program": "Eco"},
    )
    assert "url" not in karten_geraete([ohne])[0]["state"]
    assert raum_url(ohne) is None
    assert raum_url(maschine) == "homepilot://raum/Waschk%C3%BCche"


def test_auch_grill_und_sauger_fuehren_in_ihren_raum():
    grill = SimpleNamespace(
        id="pitboss.grill", kind="appliance", label="Grill", room="Terrasse",
        state={"state": "running", "target": 200, "temperature": 150},
    )
    sauger = SimpleNamespace(
        id="roborock.s7", kind="vacuum", label="Sauger", room="Flur",
        state={"state": "cleaning", "battery": 80},
    )
    assert karten_grill([grill])[0]["state"]["url"] == "homepilot://raum/Terrasse"
    assert karten_sauger([sauger])[0]["state"]["url"] == "homepilot://raum/Flur"


def test_die_saugerkarte_traegt_pause_weiter_und_station():
    """Die Griffe direkt auf der Karte: Pause bzw. Weiter, zur Station.

    Das Widget versteht die Knöpfe nicht - es zeichnet das Symbol und
    ruft auf, was der Hub ihm hinlegt. Deshalb steht hier fest, was der
    Hub hinlegt: saugend Pause und Station, pausiert Weiter und Station.
    Und die Karte überlebt die Pause - verschwände sie, nähme der eine
    Knopf den anderen mit.
    """
    def sauger(zustand: str, commands=("start", "pause", "dock")):
        return SimpleNamespace(
            id="roborock.s7", kind="vacuum", label="Sauger", room="Flur",
            commands=list(commands), state={"state": zustand, "battery": 80},
        )

    saugend = karten_sauger([sauger("cleaning")])[0]["state"]
    assert [k["symbol"] for k in saugend["knoepfe"]] == ["pause.fill", "house.fill"]
    assert saugend["knoepfe"][0]["pfad"] == "/api/entities/roborock.s7/command"
    assert '"pause"' in saugend["knoepfe"][0]["body"]

    pausiert = karten_sauger([sauger("paused")])[0]["state"]
    assert pausiert["text"].startswith("pausiert")
    assert [k["symbol"] for k in pausiert["knoepfe"]] == ["play.fill", "house.fill"]

    # Nur Befehle, die der Sauger wirklich kennt - und ohne Befehle
    # keine Knopfliste, statt einer leeren.
    nur_dock = sauger_knoepfe(sauger("cleaning", commands=("dock",)))
    assert [k["symbol"] for k in nur_dock] == ["house.fill"]
    assert "knoepfe" not in karten_sauger([sauger("cleaning", commands=())])[0]["state"]

    # Angedockt oder unterwegs zur Station: keine Karte - wie bisher.
    assert karten_sauger([sauger("docked")]) == []
    assert karten_sauger([sauger("returning")]) == []
