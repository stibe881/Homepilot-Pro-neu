"""Die Erinnerung im Laden.

Der Fall: Man steht wegen einer Sache im Coop, und die drei anderen von
der Liste fallen einem im Auto wieder ein. Zu früh gemeldet ist sie
lästig, zu spät nutzlos - deshalb hängt hier alles an der Frage, wann
genau.
"""

from homepilot.core.shopping import (
    STAY_SECONDS,
    describe,
    due_reminders,
    open_items,
    wer_steht_dort,
)

JETZT = 1_700_000_000.0
COOP = {"id": "s1", "name": "Coop Willisau", "zone": "coop_willisau"}
OHNE_ZONE = {"id": "s2", "name": "Kaufland Lörrach"}


def da_seit(sekunden: float) -> dict:
    return {"state": "home", "changed_at": JETZT - sekunden}


def test_open_items_ignores_what_is_done():
    rows = [{"text": "Milch"}, {"text": "Brot", "done": True}, "unsinn"]
    assert [row["text"] for row in open_items(rows)] == ["Milch"]


def test_a_short_stop_does_not_remind():
    """Wer an der Ampel davor steht, kauft nicht ein."""
    zonen = {"coop_willisau": da_seit(STAY_SECONDS - 1)}
    assert due_reminders([COOP], zonen, 3, JETZT, {}) == []


def test_a_real_visit_reminds():
    zonen = {"coop_willisau": da_seit(STAY_SECONDS)}
    assert due_reminders([COOP], zonen, 3, JETZT, {}) == [COOP]


def test_an_empty_list_never_reminds():
    """Nichts zu holen heisst nichts zu melden - sonst wäre es die
    Nachricht, an der man das Ganze abschaltet."""
    zonen = {"coop_willisau": da_seit(STAY_SECONDS * 2)}
    assert due_reminders([COOP], zonen, 0, JETZT, {}) == []


def test_only_once_per_visit():
    """Sonst käme sie jede Minute erneut."""
    zonen = {"coop_willisau": da_seit(STAY_SECONDS)}
    erinnert = {"coop_willisau": zonen["coop_willisau"]["changed_at"]}
    assert due_reminders([COOP], zonen, 3, JETZT, erinnert) == []

    # Beim nächsten Besuch ist der Zeitpunkt ein anderer - und die
    # Erinnerung kommt wieder.
    spaeter = {"coop_willisau": {"state": "home", "changed_at": JETZT - 60}}
    assert due_reminders([COOP], spaeter, 3, JETZT + STAY_SECONDS, erinnert) == [COOP]


def test_leaving_stops_it():
    zonen = {"coop_willisau": {"state": "away", "changed_at": JETZT - STAY_SECONDS * 3}}
    assert due_reminders([COOP], zonen, 3, JETZT, {}) == []


def test_a_shop_without_a_zone_is_silent():
    """Ohne Zone weiss der Hub nicht, wo man ist - dann schweigt er,
    statt zu raten."""
    assert due_reminders([OHNE_ZONE], {}, 3, JETZT, {}) == []
    # Und eine Zone, von der noch nie etwas gemeldet wurde, ebenso.
    assert due_reminders([COOP], {}, 3, JETZT, {}) == []
    assert due_reminders([COOP], {"coop_willisau": {"state": "home"}}, 3, JETZT, {}) == []


def test_the_message_names_what_is_missing():
    """«5 Einträge» zwingt zum Nachsehen, die Namen beantworten es schon
    auf dem Sperrbildschirm."""
    titel, text = describe(COOP, [{"text": "Milch"}, {"text": "Brot"}])
    assert titel == "Du bist im Coop Willisau"
    assert text == "Milch, Brot"

    # Bei vielen Einträgen wird abgekürzt, statt die Nachricht zu fluten.
    viele = [{"text": f"Ding {i}"} for i in range(7)]
    _, text = describe(COOP, viele)
    assert text.endswith("und 3 weitere")
    assert text.startswith("Ding 0, Ding 1, Ding 2, Ding 3")


# ── Der Laden zeigt auf einen Ort ────────────────────────────────────────
#
# Bisher brauchte jeder Laden eine eigene Geofence-Zone, die von aussen
# auf «home» gesetzt wird - ein iOS-Kurzbefehl je Laden, von Hand
# gebastelt. Wer im Coop steht und merkt, dass die Erinnerung fehlt, baut
# den nicht. Jetzt zeigt der Laden auf einen Ort, und das Telefon meldet
# ihn ohnehin: Der Zustand der Person IST dann dieser Ort.

MIT_ORT = {"id": "s3", "name": "Coop Willisau", "place": "coop_willisau"}


def test_a_shop_pointing_at_a_place_reminds_when_someone_is_there():
    from homepilot.core.shopping import due_reminders as faellig

    # Stefan steht seit zehn Minuten im Coop, Livia ist zuhause.
    zonen = {
        "stefan": {"state": "coop_willisau", "changed_at": JETZT - 600},
        "livia": {"state": "home", "changed_at": JETZT - 3600},
    }
    assert faellig([MIT_ORT], zonen, 3, JETZT, {}) == [MIT_ORT]

    # Niemand dort: kein Wort.
    assert faellig([MIT_ORT], {"stefan": {"state": "home", "changed_at": 0}}, 3, JETZT, {}) == []


def test_a_place_shop_also_waits_the_four_minutes():
    """An der Ampel davor zu stehen ist kein Einkauf."""
    from homepilot.core.shopping import due_reminders as faellig

    zonen = {"stefan": {"state": "coop_willisau", "changed_at": JETZT - 60}}
    assert faellig([MIT_ORT], zonen, 3, JETZT, {}) == []
    zonen = {"stefan": {"state": "coop_willisau", "changed_at": JETZT - STAY_SECONDS}}
    assert faellig([MIT_ORT], zonen, 3, JETZT, {}) == [MIT_ORT]


def test_the_second_person_does_not_trigger_a_second_message():
    """Sonst käme die Erinnerung erneut, sobald jemand nachkommt."""
    from homepilot.core.shopping import due_reminders as faellig
    from homepilot.core.shopping import marke_fuer

    zonen = {
        "stefan": {"state": "coop_willisau", "changed_at": JETZT - 600},
        "livia": {"state": "coop_willisau", "changed_at": JETZT - 500},
    }
    gemerkt = {marke_fuer(MIT_ORT): JETZT - 600}
    assert faellig([MIT_ORT], zonen, 3, JETZT, gemerkt) == []


def test_the_old_way_with_its_own_zone_keeps_working():
    """Wer sich das mit einem Kurzbefehl gebaut hat, soll es behalten."""
    from homepilot.core.shopping import due_reminders as faellig

    zonen = {"coop_willisau": da_seit(600)}
    assert faellig([COOP], zonen, 3, JETZT, {}) == [COOP]


# ── Orte, die in der App entstehen ───────────────────────────────────────


def test_a_place_id_survives_a_shop_name():
    from homepilot.core.presence import ort_kennung

    assert ort_kennung("Coop Willisau") == "coop_willisau"
    assert ort_kennung("Bäckerei Müller") == "baeckerei_mueller"
    assert ort_kennung("  Migros   Sursee  ") == "migros_sursee"
    assert ort_kennung("") == ""


def test_setting_the_same_place_twice_moves_it_instead_of_doubling_it():
    """Vor dem Laden stehen und geraderücken, ohne ihn erst zu löschen."""
    from homepilot.core.presence import ort_setzen

    eins = ort_setzen([], "", "Coop Willisau", 47.1, 7.9, 120)
    zwei = ort_setzen(eins, "coop_willisau", "Coop Willisau", 47.2, 7.8, 200)
    assert len(zwei) == 1
    assert zwei[0]["latitude"] == 47.2
    assert zwei[0]["radius"] == 200


def test_a_place_radius_stays_within_reason():
    from homepilot.core.presence import ORT_MAX_RADIUS, ORT_MIN_RADIUS, ort_setzen

    eng = ort_setzen([], "", "Kiosk", 47.1, 7.9, 5)
    assert eng[0]["radius"] == ORT_MIN_RADIUS
    weit = ort_setzen([], "", "Dorf", 47.1, 7.9, 99999)
    assert weit[0]["radius"] == ORT_MAX_RADIUS


def test_the_config_keeps_its_places():
    """Ein Knopf in der App darf nicht wegräumen, was von Hand gepflegt
    wurde - und die App soll gar nicht erst anbieten, es zu löschen."""
    from homepilot.core.presence import alle_orte, ort_entfernen, ort_setzen

    aus_config = [
        {"id": "home", "name": "Zuhause", "latitude": 47.1, "longitude": 7.9, "radius": 150.0}
    ]
    gespeichert = ort_setzen([], "", "Coop Willisau", 47.2, 7.8, 120)
    # Ein Ort, den es schon in der config.yaml gibt, kommt nicht doppelt.
    gespeichert = ort_setzen(gespeichert, "home", "Zuhause (App)", 47.3, 7.7, 150)

    zusammen = alle_orte(aus_config, gespeichert)
    kennungen = [ort["id"] for ort in zusammen]
    assert sorted(kennungen) == ["coop_willisau", "home"]
    heim = next(ort for ort in zusammen if ort["id"] == "home")
    assert heim["source"] == "config"
    assert heim["latitude"] == 47.1  # die config sticht
    laden = next(ort for ort in zusammen if ort["id"] == "coop_willisau")
    assert laden["source"] == "app"

    # Löschen trifft nur den in der App angelegten.
    rest = ort_entfernen(gespeichert, "coop_willisau")
    assert [ort["id"] for ort in rest] == ["home"]


# ── Wer steht dort? ──────────────────────────────────────────────────────
#
# Die Nachricht heisst «Du bist im Märt» und ging trotzdem an alle: Wer
# im Büro sass, während jemand anders einkaufte, bekam sie auch - und
# wusste weder, dass sie nicht ihm galt, noch wem.

MAERT = {"id": "s3", "name": "Märti, Zell", "place": "maert_zell"}


def test_die_zone_kommt_mit_zurueck():
    """Ohne sie lässt sich nicht sagen, wen die Nachricht angeht."""
    zonen = {
        "stefan": {"state": "arbeit_stibe", "changed_at": JETZT - 3600},
        "bine": {"state": "maert_zell", "changed_at": JETZT - STAY_SECONDS},
    }
    zone, stand, marke = wer_steht_dort(MAERT, zonen)
    assert zone == "bine"
    assert stand is not None and stand["state"] == "maert_zell"
    assert marke == "maert_zell"


def test_wer_woanders_steht_zaehlt_nicht():
    zonen = {"stefan": {"state": "arbeit_stibe", "changed_at": JETZT - 3600}}
    assert wer_steht_dort(MAERT, zonen) == (None, None, "maert_zell")


def test_bei_zweien_gilt_der_laenger_dort_steht():
    """Sonst käme die Erinnerung erneut, sobald der Zweite hereinkommt."""
    zonen = {
        "bine": {"state": "maert_zell", "changed_at": JETZT - 600},
        "stefan": {"state": "maert_zell", "changed_at": JETZT - 60},
    }
    zone, _, _ = wer_steht_dort(MAERT, zonen)
    assert zone == "bine"


def test_die_alte_eigene_zone_nennt_sich_selbst():
    """Wer sich eine Laden-Zone gebaut hat, behält sie – samt Kennung."""
    zonen = {"coop_willisau": da_seit(STAY_SECONDS)}
    assert wer_steht_dort(COOP, zonen) == (
        "coop_willisau",
        zonen["coop_willisau"],
        "coop_willisau",
    )


def test_ohne_ort_und_ohne_zone_niemand():
    assert wer_steht_dort(OHNE_ZONE, {}) == (None, None, "")
