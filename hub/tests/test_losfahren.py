"""Der Losfahr-Wecker: rechnet aus Ort und Uhrzeit den richtigen Moment."""

from datetime import datetime, timedelta

from homepilot.core.losfahren import (
    erinnert_lesen,
    erinnert_zeilen,
    faellig,
    fahrminuten,
    kandidaten,
    luftlinie_km,
    ort_kurz,
    orte_lesen,
    orte_zeilen,
    wecker_satz,
)

JETZT = datetime(2026, 8, 30, 16, 0)


def _termin(**extra):
    return {
        "id": "t1",
        "summary": "Fussballtraining",
        "start": "2026-08-30T17:30:00",
        "location": "Sportplatz, 6210 Sursee",
        "all_day": False,
        "birthday": False,
        **extra,
    }


def test_kandidaten_nimmt_nur_kommende_termine_mit_ort():
    events = [
        _termin(),
        _termin(id="ohne_ort", location=""),
        _termin(id="ganztags", all_day=True),
        _termin(id="geburtstag", birthday=True),
        _termin(id="vorbei", start="2026-08-30T15:00:00"),
        _termin(id="zu_weit_weg", start="2026-08-31T09:00:00"),
        "kein dict",
    ]
    treffer = kandidaten(events, JETZT)
    assert [t["kennung"] for t in treffer] == ["t1"]
    assert treffer[0]["ort"] == "Sportplatz, 6210 Sursee"
    assert treffer[0]["start"] == datetime(2026, 8, 30, 17, 30)
    # Ohne Person am Kalender geht der Wecker an alle (Punkt 586).
    assert treffer[0]["person"] is None
    assert kandidaten([_termin(person="Stefan")], JETZT)[0]["person"] == "Stefan"


def test_kandidaten_vertraegt_zeitzonen_mischung():
    # Der Kalender liefert Zeiten mit Zone, der Wächter fragt mit einer
    # bewussten Zone nach - das darf nicht in einem TypeError enden.
    jetzt = datetime.fromisoformat("2026-08-30T16:00:00+02:00")
    events = [_termin(start="2026-08-30T17:30:00+02:00")]
    treffer = kandidaten(events, jetzt)
    assert len(treffer) == 1


def test_luftlinie_zell_nach_sursee():
    # Zell LU → Sursee sind gut zehn Kilometer Luftlinie.
    km = luftlinie_km(47.135, 7.925, 47.171, 8.111)
    assert 13 < km < 16


def test_fahrminuten_rundet_auf_und_kennt_zwei_tempi():
    # Kurz: 10 km Luftlinie → 13 km Strasse bei 40 km/h → 20 Minuten.
    assert fahrminuten(10.0) == 20
    # Lang: ab 15 km hilft die Autobahn.
    assert fahrminuten(50.0) == 60
    assert fahrminuten(0.1) >= 1


def test_faellig_nur_zwischen_abfahrt_und_beginn():
    start = JETZT + timedelta(minutes=30)
    assert not faellig(start, 20, JETZT)  # noch Zeit
    assert faellig(start, 30, JETZT)  # jetzt aber los
    assert faellig(start, 45, JETZT)  # eigentlich schon knapp
    assert not faellig(JETZT - timedelta(minutes=1), 30, JETZT)  # vorbei


def test_wecker_satz():
    titel, text = wecker_satz(
        "Fussballtraining", "Sportplatz, 6210 Sursee", JETZT.replace(hour=17, minute=30), 25
    )
    assert titel == "Jetzt losfahren"
    assert text == (
        "Fussballtraining um 17:30 in Sportplatz – Fahrzeit etwa 25 Minuten."
    )
    assert ort_kurz("6210 Sursee") == "6210 Sursee"
    assert ort_kurz("") == ""


def test_erinnert_zeilen_ergaenzt_und_raeumt_auf():
    jetzt = 1_000_000.0
    zeilen = erinnert_zeilen([], {"t1"}, jetzt)
    assert erinnert_lesen(zeilen) == {"t1"}
    # Ein alter Eintrag fliegt raus - und kommt nicht durch die
    # Hintertüre mit frischem Stempel zurück.
    alt = [{"kennung": "gestern", "at": jetzt - 25 * 3600}]
    zeilen = erinnert_zeilen(alt + zeilen, {"t2"}, jetzt)
    assert erinnert_lesen(zeilen) == {"t1", "t2"}


def test_orte_vorrat_merkt_auch_nicht_gefundenes():
    orte = {"Sportplatz, 6210 Sursee": (47.17, 8.11), "Nirgendwo 99": None}
    gelesen = orte_lesen(orte_zeilen(orte))
    assert gelesen["Sportplatz, 6210 Sursee"] == (47.17, 8.11)
    assert gelesen["Nirgendwo 99"] is None
    assert orte_lesen("kein dict") == {}


# ── Die Wöchentlichen der Kinder (Punkt 621) ─────────────────────────────


def test_activities_with_a_place_become_departure_candidates():
    """Punkt 621: Der Wecker las nur Kalendertermine, obwohl Fussball in
    Sursee am Dienstag um 17:30 den Ort längst hatte. Hinbringen und
    Abholen sind zwei Fahrten mit je ihrer Person."""
    from homepilot.core.losfahren import aktivitaeten_heute

    # JETZT ist Sonntag, 30.8.2026, 16:00 (KW 35, ungerade → Woche A).
    activities = [
        {
            "id": "f1", "member": "Levin", "day": "So", "text": "Fussball",
            "from": "17:30", "to": "19:00", "ort": "Sportplatz, 6210 Sursee",
            "bringt": "Stefan", "holt": "Anna",
        },
        {"id": "ohne_ort", "member": "Levin", "day": "So", "text": "Jugi", "from": "18:00"},
        {"id": "anderer_tag", "member": "Lina", "day": "Mo", "text": "Ballett",
         "from": "17:00", "ort": "Zell"},
        {"id": "vorbei", "member": "Lina", "day": "So", "text": "Turnen",
         "from": "10:00", "ort": "Zell"},
        {"id": "woche_b", "member": "Lina", "day": "So", "text": "Flöte",
         "from": "18:00", "ort": "Zell", "week": "B"},
        {"id": "ferien_ok", "member": "Lina", "day": "So", "text": "Reiten",
         "from": "18:30", "ort": "Hof", "holidays": True},
        "kein dict",
    ]
    treffer = aktivitaeten_heute(activities, JETZT)
    assert [t["kennung"] for t in treffer] == [
        "aktivitaet:f1:2026-08-30:bringt",
        "aktivitaet:f1:2026-08-30:holt",
        "aktivitaet:ferien_ok:2026-08-30:bringt",
    ]
    assert treffer[0]["summary"] == "Fussball"
    assert treffer[0]["person"] == "Stefan"
    assert treffer[0]["start"] == datetime(2026, 8, 30, 17, 30)
    assert treffer[1]["summary"] == "Fussball abholen"
    assert treffer[1]["person"] == "Anna"
    assert treffer[1]["start"] == datetime(2026, 8, 30, 19, 0)
    # Ohne Person geht der Wecker an alle - wie bisher.
    assert treffer[2]["person"] is None
    # In den Ferien bleibt nur, was den Schalter trägt (Punkt 620).
    assert [t["kennung"] for t in aktivitaeten_heute(activities, JETZT, ferien=True)] == [
        "aktivitaet:ferien_ok:2026-08-30:bringt"
    ]
    assert aktivitaeten_heute(None, JETZT) == []


# ── Winter: Schnee und Glatteis (Punkt 585) ──────────────────────────────


def test_im_winter_rechnet_der_wecker_laenger_und_kratzt_zuerst():
    from homepilot.core.losfahren import winterlage

    # 10 km im Sommer: 20 Minuten. Im Winter mal 1.4 plus zehn Minuten
    # Kratzen - bisher rechnete der Wecker im Januar wie im Juli.
    assert fahrminuten(10.0) == 20
    assert fahrminuten(10.0, winter=True) == 38
    _, text = wecker_satz(
        "Fussball", "Sportplatz, 6210 Sursee", datetime(2026, 1, 12, 17, 30), 38, True
    )
    assert text.endswith("Fahrzeit etwa 38 Minuten (Schnee).")
    # Die Winterlage kommt aus der Wetter-Entität: Neuschnee ab 2 cm
    # oder ein Schnee-/Glatteis-Code. Ohne Wetter: kein Winter.
    assert winterlage({"snow_tonight_cm": 6.0, "winter_code": None}) is True
    assert winterlage({"snow_tonight_cm": 0.5, "winter_code": 66}) is True
    assert winterlage({"snow_tonight_cm": 0.5, "winter_code": None}) is False
    assert winterlage(None) is False
