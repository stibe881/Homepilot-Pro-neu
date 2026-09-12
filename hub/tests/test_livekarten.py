"""Live-Karten: aus dem Hauszustand werden Sperrbildschirm-Karten."""

import time
from types import SimpleNamespace

from homepilot.core.livekarten import (
    NACHHALL_SEKUNDEN,
    abgleich,
    ende_payload,
    hat_karte,
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
    verwaist_merken,
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
    # Die Ist-Temperatur steht seit Punkt 553 gross daneben - zweimal
    # dieselbe Zahl auf einer Karte liest niemand zweimal.
    assert grills[0]["state"]["gross"] == "182°"
    assert grills[0]["state"]["text"] == "Heizt auf 200°"
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
    # Und ein Fernseher, dessen Bild laut CEC aus ist, obwohl die
    # Cast-Sitzung weiterläuft (google_cast.cast_state_name).
    ruhe = entity("tv.standby", "media_player", "TV", state="standby", has_screen=True)
    assert karten_tv([aus, box, leerlauf, ruhe]) == []


def test_fernseher_karte_nicht_fuer_leute_unterwegs():
    tv = entity("tv.wz", "media_player", "TV", state="on", has_screen=True)
    karten = karten_tv([tv], ohne=["Stefan"])
    assert karten[0]["ohne"] == ["Stefan"]
    # Ohne Abwesende fehlt der Schlüssel ganz - wie bei den anderen Karten.
    assert "ohne" not in karten_tv([tv])[0]


def test_zwillinge_finden_sich_auch_ueber_den_namen():
    """Der gemeldete Fall, zweite Runde: Trotz Zusammenlegung lagen
    wieder zwei Karten übereinander («Fernseher Wohnzimmer,
    eingeschaltet» und «Fernseher im Wohnzimmer, YouTube»), und der
    Tipp auf die des Zuspielers öffnete die falsche Fernbedienung.
    Grund: Der Cast-Eintrag hatte keinen Raum zugeordnet, und die
    Zwillingsregel kannte nur den Raum. Jetzt zählt auch der Name bis
    auf Füllwörter - dieselbe Regel wie in der App (lib/geraeteart.ts):
    «Fernseher Wohnzimmer» und «Fernseher im Wohnzimmer» meinen
    dasselbe Gerät."""
    android = SimpleNamespace(
        id="androidtv.wz", kind="media_player", label="Fernseher Wohnzimmer",
        state={"state": "on", "has_screen": True},
        room="Wohnzimmer", commands=["dpad_up", "turn_off"],
    )
    cast_ohne_raum = SimpleNamespace(
        id="cast.wz", kind="media_player", label="Fernseher im Wohnzimmer",
        state={"state": "playing", "has_screen": True, "app": "YouTube"},
        room=None, commands=["play", "pause"],
    )
    karten = karten_tv([android, cast_ohne_raum])
    assert [k["art"] for k in karten] == ["tv:androidtv.wz"]
    assert karten[0]["state"]["text"] == "YouTube"
    assert karten[0]["state"]["url"] == "homepilot://fernbedienung/androidtv.wz"

    # Und läuft nur der Zuspieler (der Hub erreicht den Android TV
    # nicht), führt sein Tipp trotzdem zur richtigen Fernbedienung.
    android_aus = SimpleNamespace(
        id="androidtv.wz", kind="media_player", label="Fernseher Wohnzimmer",
        state={"state": "off", "has_screen": True}, available=False,
        room="Wohnzimmer", commands=["dpad_up", "turn_on"],
    )
    allein = karten_tv([android_aus, cast_ohne_raum])
    assert [k["art"] for k in allein] == ["tv:cast.wz"]
    assert allein[0]["state"]["url"] == "homepilot://fernbedienung/androidtv.wz"

    # Verschiedene Namen ohne Raum bleiben verschiedene Fernseher.
    anderer = SimpleNamespace(
        id="tv.buero", kind="media_player", label="Fernseher Büro",
        state={"state": "on", "has_screen": True},
        room=None, commands=["dpad_up"],
    )
    assert len(karten_tv([anderer, cast_ohne_raum])) == 2


def test_geisterbild_des_zuspielers_bekommt_keine_karte():
    """Der gemeldete Fall: Alle Fernseher aus - trotzdem lag «Fernseher
    im Wohnzimmer, Zattoo» auf dem Sperrbildschirm. Der Cast-Eintrag
    hält seine letzte Sitzung fest, während der Android-TV-Zwilling
    erreichbar «aus» meldet - und der weiss es besser: Seine Verbindung
    steht auch im Standby, «aus» heisst dort dunkler Bildschirm."""
    android_aus = SimpleNamespace(
        id="androidtv.wz", kind="media_player", label="Fernseher Wohnzimmer",
        state={"state": "off", "has_screen": True}, available=True,
        room="Wohnzimmer", commands=["dpad_up", "turn_on"],
    )
    zattoo_geist = SimpleNamespace(
        id="cast.wz", kind="media_player", label="Fernseher im Wohnzimmer",
        state={"state": "paused", "has_screen": True, "app": "Zattoo"},
        room=None, commands=["play", "pause"],
    )
    assert karten_tv([android_aus, zattoo_geist]) == []

    # Schaltet der Fernseher ein, ist es kein Geisterbild mehr - eine
    # Karte, mit dem Text des Zuspielers.
    android_an = SimpleNamespace(
        id="androidtv.wz", kind="media_player", label="Fernseher Wohnzimmer",
        state={"state": "on", "has_screen": True}, available=True,
        room="Wohnzimmer", commands=["dpad_up", "turn_on"],
    )
    karten = karten_tv([android_an, zattoo_geist])
    assert [k["art"] for k in karten] == ["tv:androidtv.wz"]
    assert karten[0]["state"]["text"] == "Zattoo"

    # Ohne Steuerkreuz-Zwilling weiss es niemand besser - Karte bleibt.
    assert len(karten_tv([zattoo_geist])) == 1


def test_verwaiste_karten_werden_erkannt_und_vorgemerkt():
    """Der gemeldete Fall: Der Fernseher geht aus, bevor die App das
    Token der Karte melden konnte - ihr Ende ging ohne Token ins Leere,
    die Karte blieb stundenlang liegen. Kommt das Token später an und
    es läuft zu seiner Art keine Karte mehr, ist es ein Verwaister und
    wird zum Nach-Beenden vorgemerkt (dasselbe Muster wie bei der
    Türkarte, liveaktivitaet.VERWAIST_KEY)."""
    rows = [{"user": "Stibe", "art": "tv:androidtv.wz", "activity_tokens": []}]
    assert hat_karte(rows, "Stibe", "tv:androidtv.wz") is True
    assert hat_karte(rows, "Stibe", "tv:plex.wz") is False
    assert hat_karte(rows, "Bine", "tv:androidtv.wz") is False
    assert hat_karte(None, "Stibe", "tv:androidtv.wz") is False

    merkliste = verwaist_merken(None, "Stibe", "tok-1")
    assert merkliste == [{"user": "Stibe", "token": "tok-1"}]
    # Dasselbe Token noch einmal gemeldet ersetzt, statt zu doppeln.
    merkliste = verwaist_merken(merkliste, "Stibe", "tok-1")
    assert len(merkliste) == 1


def test_die_karte_des_zuspielers_oeffnet_die_fernbedienung_des_zwillings():
    """Der gemeldete Fall: Der Tipp auf die Live-Karte öffnete eine
    andere Fernbedienung als die App. Die Karte kam vom Plex/Cast-
    Zuspieler (der Hub erreichte den Android TV gerade nicht) und
    zeigte stur auf sich selbst - die App wählt über die Raumkachel
    längst den Steuerkreuz-Zwilling. Der Zwilling zählt auch, wenn er
    «aus» ist: Genau dann kommt die Karte ja vom Zuspieler."""
    android_aus = SimpleNamespace(
        id="androidtv.wz", kind="media_player", label="Fernseher Wohnzimmer",
        # «aus», weil der Hub ihn nicht erreicht (Kopplung weg) - nur
        # dann darf der Zuspieler den Fernsehabend allein behaupten
        # (geisterbild): Erreichbar «aus» hiesse dunkler Bildschirm.
        state={"state": "off", "has_screen": True}, available=False,
        room="Wohnzimmer", commands=["dpad_up", "turn_on"],
    )
    plex = SimpleNamespace(
        id="plex.wz", kind="media_player", label="Fernseher im Wohnzimmer",
        state={"state": "playing", "has_screen": True, "app": "Plex"},
        room="Wohnzimmer", commands=["play", "pause"],
    )
    karten = karten_tv([android_aus, plex])
    assert [k["art"] for k in karten] == ["tv:plex.wz"]
    assert karten[0]["state"]["url"] == "homepilot://fernbedienung/androidtv.wz"


def test_ohne_zwilling_bleibt_die_eigene_fernbedienung():
    """Ohne Raum kein Zwilling, bei zwei Steuerkreuzen wird nicht
    geraten - und eine Musikbox im selben Raum ist keiner."""
    plex = SimpleNamespace(
        id="plex.wz", kind="media_player", label="Fernseher im Wohnzimmer",
        state={"state": "playing", "has_screen": True},
        room="Wohnzimmer", commands=["play"],
    )
    ohne_raum = SimpleNamespace(
        id="plex.sz", kind="media_player", label="TV",
        state={"state": "playing", "has_screen": True},
        room=None, commands=["play"],
    )
    kreuz_a = SimpleNamespace(
        id="tv.a", kind="media_player", label="TV A",
        state={"state": "off", "has_screen": True},
        room="Wohnzimmer", commands=["dpad_up"],
    )
    kreuz_b = SimpleNamespace(
        id="tv.b", kind="media_player", label="TV B",
        state={"state": "off", "has_screen": True},
        room="Wohnzimmer", commands=["dpad_up"],
    )
    box = SimpleNamespace(
        id="sonos.wz", kind="media_player", label="Box",
        state={"state": "playing"}, room="Wohnzimmer", commands=["play"],
    )
    zwei = karten_tv([plex, kreuz_a, kreuz_b])
    assert zwei[0]["state"]["url"] == "homepilot://fernbedienung/plex.wz"
    allein = karten_tv([ohne_raum, kreuz_a])
    assert allein[0]["state"]["url"] == "homepilot://fernbedienung/plex.sz"
    mit_box = karten_tv([plex, box])
    assert mit_box[0]["state"]["url"] == "homepilot://fernbedienung/plex.wz"


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
    assert len(beenden) == 2
    assert sorted(len(b["tokens"]) for b in beenden) == [0, 1]
    # **Beide** bleiben vorgemerkt, auch die mit Token. `abgleich`
    # rechnet nur; ob das Ende wirklich draussen war, weiss erst der
    # Takt - und nur er darf die Zeile dann austragen (`_runde`,
    # beendet). Stand das früher hier, verschwand die Zeile auch dann,
    # wenn Apple gerade nicht erreichbar war, und die Karte lag bis zum
    # Abend auf dem Sperrbildschirm, ohne dass noch jemand von ihr
    # wusste.
    assert sorted((r["user"], r.get("ende_offen")) for r in rows) == [
        ("Bine", True),
        ("Stibe", True),
    ]


def test_wer_das_haus_verlaesst_verliert_die_fernseher_karte():
    """Der Wunsch aus dem Haus: Beim Weggehen soll die Fernseher-Karte
    vom Sperrbildschirm verschwinden - eine Fernbedienung im Zug ist nur
    eine Karte im Weg. Der Fernseher läuft dabei weiter: Nicht die Karte
    ist weg, nur diese Person steht in ``ohne`` (nicht_zuhause), und ihr
    Exemplar endet sofort, ohne Nachbild."""
    rows = [
        {
            "user": "Stefan",
            "art": "tv:androidtv.wz",
            "stand": "x",
            "activity_tokens": ["tok-stefan"],
            "aktualisiert": 0.0,
        },
        {
            "user": "Bine",
            "art": "tv:androidtv.wz",
            "stand": "x",
            "activity_tokens": ["tok-bine"],
            "aktualisiert": 0.0,
        },
    ]
    karte = {
        "art": "tv:androidtv.wz",
        "user": None,
        "ohne": ["Stefan"],
        "state": {"titel": "TV", "text": "an", "symbol": "tv"},
    }
    neue, starten, aktualisieren, beenden = abgleich(
        rows, [karte], ["Stefan", "Bine"], 1000.0
    )
    # Stefans Exemplar endet sofort - Bines bleibt liegen: Sie sitzt ja
    # noch vor dem Fernseher.
    assert [auftrag["tokens"] for auftrag in beenden] == [["tok-stefan"]]
    assert beenden[0]["sichtbar"] == 0.0 and beenden[0]["state"] is None
    assert starten == []
    # Stefans Zeile bleibt vorgemerkt, bis der Takt das Ende wirklich
    # losgeworden ist (siehe test_abgleich_startet_aktualisiert_und_beendet).
    assert sorted((row["user"], row.get("ende_offen")) for row in neue) == [
        ("Bine", None),
        ("Stefan", True),
    ]

    # Kommt Stefan heim (und der Fernseher läuft noch), startet seine
    # Karte frisch: Eine vorgemerkte Zeile zählt nicht als laufend
    # (liegt_noch), sonst käme nie wieder eine Karte.
    ohne_ohne = {**karte}
    ohne_ohne.pop("ohne")
    _, wieder, _, _ = abgleich(neue, [ohne_ohne], ["Stefan", "Bine"], 2000.0)
    assert [auftrag["user"] for auftrag in wieder] == ["Stefan"]


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


def test_karten_nur_fuer_geraete_die_der_hub_erreicht():
    """Der gemeldete Fall: «Beide Geräte wurden bereits ausgeschaltet,
    aber die Live-Aktivität ist immer noch vorhanden.»

    Ein Cast-Fernseher fällt mit dem Ausschalten aus dem Netz. Die
    Integration setzt dann nur ``available=False`` und lässt den
    Zustand stehen - für den Hub lief «Relaxing Sounds» ewig weiter,
    und die Karte war nicht mehr loszuwerden."""
    weg = SimpleNamespace(
        id="cast.kueche", kind="media_player", label="Küche",
        state={"state": "playing", "has_screen": True, "app": "Relaxing Sounds"},
        available=False,
    )
    da = SimpleNamespace(
        id="cast.wz", kind="media_player", label="Wohnzimmer",
        state={"state": "playing", "has_screen": True},
        available=True,
    )
    assert [k["art"] for k in karten_tv([weg, da])] == ["tv:cast.wz"]

    # Dieselbe Regel bei Waschmaschine, Grill und Sauger.
    waesche = SimpleNamespace(
        id="shelly.wm", kind="appliance", label="Waschmaschine",
        state={"state": "running", "program": "Buntwäsche"}, available=False,
    )
    grill = SimpleNamespace(
        id="pitboss.grill", kind="appliance", label="Grill",
        state={"state": "running", "target": 110, "temperature": 80},
        available=False,
    )
    sauger = SimpleNamespace(
        id="roborock.saros", kind="vacuum", label="Saros",
        state={"state": "cleaning"}, available=False,
    )
    assert karten_geraete([waesche]) == []
    assert karten_grill([grill]) == []
    assert karten_sauger([sauger]) == []


def test_karte_ohne_token_bleibt_vorgemerkt_und_endet_beim_nachtragen():
    """Ohne Aktivitäts-Token geht das Ende ins Leere. Die Zeile trotzdem
    zu streichen hiess: Der Hub vergisst die Karte, das Telefon behält
    sie. Jetzt bleibt sie vorgemerkt, bis die App ihr Token nachmeldet."""
    wunsch = [{"art": "tv:cast.wz", "user": None, "state": {"titel": "TV", "text": "an"}}]
    rows, starten, _, _ = abgleich([], wunsch, ["Stibe"], 1000.0)
    assert len(starten) == 1

    # Fernseher aus, bevor die App ihr Token melden konnte.
    rows, _, _, beenden = abgleich(rows, [], ["Stibe"], 1100.0)
    assert beenden[0]["tokens"] == []
    # Art und Person kommen mit: Sonst stand im Protokoll nur «Ende
    # ohne Token - vorgemerkt», und beim nächsten «die Karte liegt
    # immer noch da» war daraus nicht zu lesen, um welche es ging.
    assert beenden[0]["art"] == "tv:cast.wz" and beenden[0]["user"] == "Stibe"
    assert hat_karte(rows, "Stibe", "tv:cast.wz")

    # Jetzt kommt das Token - es landet an der vorgemerkten Zeile, und
    # der Auftrag zum Beenden trägt es mit.
    rows = token_merken(rows, "Stibe", "tv:cast.wz", "act-7")
    rows, _, _, beenden = abgleich(rows, [], ["Stibe"], 1200.0)
    assert [b["tokens"] for b in beenden] == [["act-7"]]
    # Vorgemerkt bleibt sie auch jetzt noch: Ausgetragen wird sie erst,
    # wenn das Ende wirklich bei Apple angekommen ist - und das weiss
    # nur der Takt (`_runde`, beendet).
    assert [r.get("ende_offen") for r in rows] == [True]


def test_vorgemerkte_karte_faellt_nach_dem_nachhall_weg():
    """Ewig warten wäre falsch: Nach zwölf Stunden hat iOS die Karte
    ohnehin selbst abgeräumt."""
    wunsch = [{"art": "tv:cast.wz", "user": None, "state": {"titel": "TV", "text": "an"}}]
    rows, _, _, _ = abgleich([], wunsch, ["Stibe"], 1000.0)
    rows, _, _, _ = abgleich(rows, [], ["Stibe"], 1000.0 + NACHHALL_SEKUNDEN)
    assert rows == []


def test_kehrt_der_fernseher_zurueck_wird_neu_gestartet():
    """Gemeldet, nachdem der Vermerk zuerst als «läuft schon» galt: «Es
    kommt keine Live-Aktivität mehr, wenn der Fernseher eingeschaltet
    wird.»

    Eine Karte mit offenem Ende konnte der Hub nicht beenden - ob sie
    noch liegt, weiss er also nicht. Als «läuft schon» gerechnet,
    verhinderte sie jeden neuen Start, und es blieb beim Aktualisieren
    einer Karte, die niemand sieht. Lieber eine zu viel: Doppelte
    derselben Art räumt die App beim Öffnen selbst ab."""
    wunsch = [{"art": "tv:cast.wz", "user": None, "state": {"titel": "TV", "text": "an"}}]
    rows, _, _, _ = abgleich([], wunsch, ["Stibe"], 1000.0)
    rows, _, _, _ = abgleich(rows, [], ["Stibe"], 1100.0)
    assert rows[0]["ende_offen"] is True

    rows, starten, _, _ = abgleich(rows, wunsch, ["Stibe"], 1200.0)
    assert [s["art"] for s in starten] == ["tv:cast.wz"]
    assert "ende_offen" not in rows[0]


def test_eine_uralte_zeile_sperrt_die_naechste_karte_nicht():
    """Wer die Karte von Hand wegwischt, sagt es dem Hub nicht - und
    iOS beendet eine Live-Aktivität ohnehin von selbst. Eine Zeile, die
    älter ist als NACHHALL_SEKUNDEN, behauptet also eine Karte, die es
    nicht mehr gibt; als «läuft schon» gerechnet, sperrte sie einen
    halben Tag lang jede neue."""
    wunsch = [{"art": "tv:cast.wz", "user": None, "state": {"titel": "TV", "text": "an"}}]
    rows, _, _, _ = abgleich([], wunsch, ["Stibe"], 1000.0)
    rows = token_merken(rows, "Stibe", "tv:cast.wz", "act-1")

    # Kurz darauf: Es läuft, also kein zweiter Start.
    _, starten, _, _ = abgleich(rows, wunsch, ["Stibe"], 2000.0)
    assert starten == []

    # Einen halben Tag später gibt es die Aktivität sicher nicht mehr.
    rows, starten, _, _ = abgleich(rows, wunsch, ["Stibe"], 1000.0 + NACHHALL_SEKUNDEN)
    assert [s["art"] for s in starten] == ["tv:cast.wz"]
    # Und der neue Anlauf beginnt ohne die alten Tokens.
    assert rows[0]["activity_tokens"] == []


async def test_ohne_angemeldetes_telefon_werden_karten_trotzdem_beendet():
    """Der gemeldete Fall, dritte Runde: Alle Fernseher aus, der Hub
    will keine Karte mehr - und in `live_cards` stehen die Zeilen
    trotzdem unverändert weiter.

    Die Runde stieg aus, sobald kein Telefon zum Starten angemeldet
    war: `if not start_rows: return`, noch vor dem Abgleich. Damit
    blieb jede laufende Karte für immer stehen. Ein leeres Soll heisst
    aber nicht «nichts tun», sondern «nichts soll laufen»."""
    from homepilot.core import livekarten as modul
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t"}],
            integrations=[{"integration": "demo"}],
        )
    )
    await hub.start()
    try:
        hub.data.set(modul.START_KEY, [])
        hub.data.set(
            modul.KARTEN_KEY,
            [
                {
                    "user": "Stefan",
                    "art": "tv:cast.wz",
                    "stand": "{}",
                    "activity_tokens": ["act-1"],
                    "aktualisiert": time.time(),
                }
            ],
        )
        gesendet: list[dict] = []

        class Versand:
            tote: set[str] = set()

            async def senden(self, token: str, payload: dict) -> bool:
                gesendet.append({"token": token, "payload": payload})
                return True

        await modul._runde(hub, Versand())
        # Das Ende ging raus, und die Zeile ist weg.
        assert [e["payload"]["aps"]["event"] for e in gesendet] == ["end"]
        assert hub.data.get(modul.KARTEN_KEY) == []
    finally:
        await hub.stop()


async def test_ein_start_der_nie_ankam_wird_nicht_als_laufend_verbucht():
    """Gemeldet: «Es kommt keine Live-Aktivität, wenn der Fernseher
    eingeschaltet wird» - bei einem Hub, der die Karte laut tvcheck
    sehr wohl wollte und eine Zeile dafür führte.

    Die Zeile entstand mit dem *Auftrag*, nicht mit der Karte. Lehnt
    Apple den Start ab, liegt keine Karte, aber die Zeile sagt «läuft
    schon» - danach wird nur noch aktualisiert und nie mehr gestartet.
    Dazu gehört, dass ein endgültig totes Telefon ausgetragen wird."""
    from homepilot.core import livekarten as modul
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t"}],
            integrations=[{"integration": "demo"}],
        )
    )
    await hub.start()
    try:
        hub.data.set(modul.START_KEY, [{"user": "Stefan", "token": "start-1"}])
        hub.data.set(modul.KARTEN_KEY, [])
        hub.timers.start(10, "Pasta", "Stefan")

        class Versand:
            tote: set[str] = set()

            async def senden(self, token: str, payload: dict) -> bool:
                # Apple kennt dieses Telefon nicht mehr.
                self.tote.add(token)
                return False

        versand = Versand()
        await modul._runde(hub, versand)
        # Keine Karte gestartet, also auch keine Zeile - sonst käme nie
        # wieder eine.
        assert hub.data.get(modul.KARTEN_KEY) == []
        # Und das tote Telefon ist ausgetragen.
        assert hub.data.get(modul.START_KEY) == []
    finally:
        await hub.stop()


async def test_ein_ende_das_nie_ankam_wird_im_naechsten_takt_erneut_versucht():
    """Der gemeldete Fall, vierte Runde: «Die Live-Aktivität verschwindet
    immer noch nicht von alleine, wenn der Fernseher ausschaltet.»

    Die drei Runden davor drehten sich darum, ob der Hub die Karte noch
    *will* (Geisterbild, Erreichbarkeit, leeres Soll) und ob er ein
    Token zum Beenden *hat*. Beides war behoben - und die Karte lag
    trotzdem weiter da, weil niemand prüfte, ob das Ende überhaupt
    ankam.

    `senden` gibt False zurück, wenn Apple nicht erreichbar ist oder
    ablehnt. Das wurde verworfen, während die Zeile in `live_cards`
    zugleich verschwand: Danach wusste der Hub nichts mehr von der
    Karte, kein späterer Takt konnte sie abräumen, und sie lag bis zum
    Ende des Tages auf dem Sperrbildschirm. Im tvcheck sah das aus wie
    «eine Leiche aus einer früheren Fassung» - dabei entstand sie
    gerade eben.
    """
    from homepilot.core import livekarten as modul
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t"}],
            integrations=[{"integration": "demo"}],
        )
    )
    await hub.start()
    try:
        hub.data.set(modul.START_KEY, [{"user": "Stefan", "token": "start-1"}])
        hub.data.set(
            modul.KARTEN_KEY,
            [
                {
                    "user": "Stefan",
                    "art": "tv:cast.wz",
                    "stand": "{}",
                    "activity_tokens": ["act-1"],
                    "aktualisiert": time.time(),
                }
            ],
        )
        versuche: list[str] = []

        class Versand:
            """Apple ist gerade nicht erreichbar."""

            tote: set[str] = set()

            def __init__(self) -> None:
                self.klappt = False

            async def senden(self, token: str, payload: dict) -> bool:
                if payload["aps"]["event"] == "end":
                    versuche.append(token)
                return self.klappt

        versand = Versand()
        await modul._runde(hub, versand)

        # Das Ende ging raus, kam aber nicht an - die Zeile bleibt, sonst
        # weiss im nächsten Takt niemand mehr von der Karte.
        assert versuche == ["act-1"]
        zeilen = [
            row
            for row in hub.data.get(modul.KARTEN_KEY)
            if row.get("art") == "tv:cast.wz"
        ]
        assert len(zeilen) == 1
        assert zeilen[0]["ende_offen"] is True
        assert zeilen[0]["activity_tokens"] == ["act-1"]

        # Nächster Takt, Apple antwortet wieder: Jetzt geht sie weg.
        # Geprüft wird nur diese eine Zeile - was die Demo-Integration
        # daneben an eigenen Karten hervorbringt, gehört nicht zur Frage.
        versand.klappt = True
        await modul._runde(hub, versand)
        assert versuche == ["act-1", "act-1"]
        assert [
            row
            for row in hub.data.get(modul.KARTEN_KEY)
            if row.get("art") == "tv:cast.wz"
        ] == []
    finally:
        await hub.stop()


async def test_ein_totes_token_haelt_keine_karte_fest():
    """Die Gegenprobe zum Test darüber: Lehnt Apple das Token endgültig
    ab, ist die Aktivität dahinter längst vorbei. Es erneut zu versuchen
    hiesse, zwölf Stunden lang alle zwanzig Sekunden gegen eine Wand zu
    klopfen - und die Zeile bliebe dabei für immer stehen."""
    from homepilot.core import livekarten as modul
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t"}],
            integrations=[{"integration": "demo"}],
        )
    )
    await hub.start()
    try:
        hub.data.set(modul.START_KEY, [{"user": "Stefan", "token": "start-1"}])
        hub.data.set(
            modul.KARTEN_KEY,
            [
                {
                    "user": "Stefan",
                    "art": "tv:cast.wz",
                    "stand": "{}",
                    "activity_tokens": ["act-tot"],
                    "aktualisiert": time.time(),
                }
            ],
        )

        class Versand:
            def __init__(self) -> None:
                self.tote: set[str] = set()

            async def senden(self, token: str, payload: dict) -> bool:
                if payload["aps"]["event"] == "end":
                    self.tote.add(token)
                return False

        await modul._runde(hub, Versand())
        assert [
            row
            for row in hub.data.get(modul.KARTEN_KEY)
            if row.get("art") == "tv:cast.wz"
        ] == []
    finally:
        await hub.stop()


async def test_eine_haengende_karte_meldet_sich_einmal_und_nicht_alle_zwanzig_sekunden(
    caplog,
):
    """Aus dem Protokoll des Hauses, vierzig Zeilen am Stück:

        08:42:15 Live-Karte tv:androidtv.10_10_1_37 für Tablet: Ende ohne Token
        08:42:15 Live-Karte erinnerung:SoK6… für Tablet: Ende ohne Token
        08:42:15 Live-Karte tv:androidtv.10_10_1_240 für Tablet: Ende ohne Token
        08:42:35 … dieselben drei …

    Ein Wandtablet meldete zu keiner Karte je ein Token. Der Takt läuft
    alle zwanzig Sekunden, eine Zeile bleibt bis zu zwölf Stunden
    vorgemerkt - das sind über zweitausend gleiche Zeilen je Karte.
    Docker hält 3 × 10 MB; nach ein paar Tagen stand nichts anderes mehr
    darin.

    Das ist nicht bloss unschön: Es hat die Fehlersuche gekostet. Auf
    die Frage «kam das Ende bei Apple an?» hätte die Antwort im
    Protokoll gestanden - überschrieben von der Meldung über genau
    dieses Problem.
    """
    import logging

    from homepilot.core import livekarten as modul
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t"},
                # Das Wandtablet - es meldet nie ein Aktivitäts-Token.
                {"name": "Tablet", "role": "bewohner", "token": "t2"},
            ],
            integrations=[{"integration": "demo"}],
        )
    )
    await hub.start()
    try:
        hub.data.set(modul.START_KEY, [{"user": "Tablet", "token": "start-1"}])
        hub.data.set(
            modul.KARTEN_KEY,
            [
                {
                    "user": "Tablet",
                    "art": "tv:androidtv.wz",
                    "stand": "{}",
                    "activity_tokens": [],
                    "aktualisiert": time.time(),
                }
            ],
        )

        class Versand:
            tote: set[str] = set()

            async def senden(self, token: str, payload: dict) -> bool:
                return True

        versand = Versand()
        with caplog.at_level(logging.INFO, logger="homepilot.core.livekarten"):
            for _ in range(5):
                await modul._runde(hub, versand)

        gemeldet = [
            eintrag
            for eintrag in caplog.records
            if "Ende ohne Token" in eintrag.getMessage()
            and "tv:androidtv.wz" in eintrag.getMessage()
        ]
        assert len(gemeldet) == 1, [e.getMessage() for e in gemeldet]
        # Vorgemerkt bleibt sie trotzdem - geschwiegen wird über den
        # Zustand, nicht über die Karte.
        assert [
            row
            for row in hub.data.get(modul.KARTEN_KEY)
            if row.get("art") == "tv:androidtv.wz"
        ]
    finally:
        await hub.stop()


# ── Die Grillkarte in der Form der Hersteller-App (Punkt 553) ─────────────


def test_die_karte_zeigt_die_eingesteckten_fuehler():
    """Gewünscht im Haus: «Die Live-Aktivität soll so aussehen (auch
    inkl. den Kerntemperatursensoren, 4 Stk.)»"""
    grill = entity(
        "pitboss.grill", "appliance", "Smoker",
        state="running", temperature=104, target=110, unit="°C",
        probe_1=None, probe_2=36, probe_3=43, probe_4=None,
    )
    karte = karten_grill([grill])[0]["state"]
    assert karte["gross"] == "104°C"
    assert karte["text"] == "Heizt auf 110°C"
    # Nur die eingesteckten, und jeder in seiner festen Farbe.
    assert karte["werte"] == [
        {"nummer": "2", "wert": "36°C", "farbe": "gelb"},
        {"nummer": "3", "wert": "43°C", "farbe": "rot"},
    ]


def test_ohne_fuehler_bleibt_das_feld_weg():
    """Die Karte soll keinen Platz für Kreise reservieren, die es nicht
    gibt."""
    grill = entity(
        "pitboss.grill", "appliance", "Smoker",
        state="running", temperature=104, target=110, unit="°C",
    )
    assert "werte" not in karten_grill([grill])[0]["state"]


def test_auf_temperatur_heisst_haelt_und_nicht_heizt():
    """«Heizt auf 110°», während er seit einer Stunde 110° hält, wäre
    falsch - und ein Pelletgrill pendelt um seinen Sollwert."""
    grill = entity(
        "pitboss.grill", "appliance", "Smoker",
        state="running", temperature=109, target=110, unit="°C",
    )
    assert karten_grill([grill])[0]["state"]["text"] == "Hält 110°C"


def test_ein_grill_in_fahrenheit_bekommt_seine_eigene_einheit():
    """«350°C» wäre eine Behauptung über glühendes Blech."""
    grill = entity(
        "pitboss.grill", "appliance", "Smoker",
        state="running", temperature=225, target=350, unit="°F", probe_1=140,
    )
    karte = karten_grill([grill])[0]["state"]
    assert karte["gross"] == "225°F"
    assert karte["text"] == "Heizt auf 350°F"
    assert karte["werte"][0]["wert"] == "140°F"


def test_ohne_ist_temperatur_gibt_es_keine_grosse_zahl():
    """Sonst stünde dort ein leeres Feld, wo die Zahl sein müsste."""
    grill = entity(
        "pitboss.grill", "appliance", "Smoker",
        state="running", target=110, unit="°C",
    )
    karte = karten_grill([grill])[0]["state"]
    assert "gross" not in karte
    assert karte["text"] == "Ziel 110°C"
