"""Anwesenheit: zwei Quellen, eine Antwort – und ein ehrliches «weiss nicht»."""

from __future__ import annotations

import time

from homepilot.core import presence
from homepilot.integrations import geofence


def test_places_without_coordinates_are_dropped():
    orte = presence.parse_places(
        [
            {"id": "home", "latitude": 47.1, "longitude": 8.0, "radius": 150},
            {"id": "ohne", "name": "Ohne Koordinaten"},
            {"nur": "unsinn"},
        ]
    )
    assert [ort["id"] for ort in orte] == ["home"]


def test_places_are_sorted_narrowest_first():
    orte = presence.parse_places(
        [
            {"id": "quartier", "latitude": 47.1, "longitude": 8.0, "radius": 3000},
            {"id": "home", "latitude": 47.1, "longitude": 8.0, "radius": 150},
        ]
    )
    assert [ort["id"] for ort in orte] == ["home", "quartier"]


def test_the_narrowest_place_wins_over_the_wide_one():
    orte = presence.parse_places(
        [
            {"id": "home", "latitude": 47.1, "longitude": 8.0, "radius": 150},
            {"id": "quartier", "latitude": 47.1, "longitude": 8.0, "radius": 3000},
        ]
    )
    # Wer zuhause ist, ist auch im Quartier - angezeigt wird «zuhause».
    assert presence.place_state(["quartier", "home"], orte) == ("home", "home")
    assert presence.place_state(["quartier"], orte) == ("quartier", "quartier")
    assert presence.place_state([], orte) == ("away", None)


def test_a_second_zone_becomes_its_own_state():
    orte = presence.parse_places(
        [{"id": "schule", "latitude": 47.1, "longitude": 8.0, "radius": 200}]
    )
    assert presence.place_state(["schule"], orte) == ("schule", "schule")


def test_the_wifi_is_no_longer_a_presence_source():
    """Es gab einmal merge_presence, das eine WLAN-Anmeldung über die
    Ortsmeldung stellte. «Gerät im Netz» ist nicht «Mensch zuhause» –
    darum gibt es die Funktion nicht mehr, und der Test hält fest, dass
    sie nicht zurückkommt."""
    assert not hasattr(presence, "merge_presence")
    assert not hasattr(presence, "WIFI_FRESH")


def test_an_empty_battery_is_not_nobody_home():
    jetzt = 1_000_000.0
    alt = {"state": "away", "changed_at": jetzt - 13 * 3600}
    beruhigt = presence.settle(alt, jetzt)
    assert beruhigt["state"] == "unknown"
    assert beruhigt["stale"] is True


def test_someone_who_reported_recently_stays_away():
    jetzt = 1_000_000.0
    alt = {"state": "away", "changed_at": jetzt - 3600}
    assert presence.settle(alt, jetzt)["state"] == "away"


def test_history_forgets_after_a_week():
    jetzt = 1_000_000.0
    rows = [
        {"person": "stefan", "state": "home", "at": jetzt - 3600},
        {"person": "stefan", "state": "away", "at": jetzt - 8 * 24 * 3600},
    ]
    behalten = presence.trim_history(rows, jetzt)
    assert len(behalten) == 1


def test_the_same_state_twice_is_not_two_entries():
    jetzt = 1_000_000.0
    rows = presence.remember([], "stefan", "home", jetzt, "home")
    nochmal = presence.remember(rows, "stefan", "home", jetzt + 10, "home")
    assert len(nochmal) == 1


def test_battery_alert_only_below_the_limit():
    assert presence.battery_alert("Livia", 12) is not None
    assert presence.battery_alert("Livia", 40) is None
    assert presence.battery_alert("Livia", None) is None


def test_holiday_question_needs_everyone_away_for_a_day():
    jetzt = 1_000_000.0
    weg = [{"state": "away", "changed_at": jetzt - 30 * 3600}]
    assert presence.holiday_question(weg, False, jetzt) is True
    # Läuft die Simulation schon, gibt es nichts zu fragen.
    assert presence.holiday_question(weg, True, jetzt) is False
    # Eine unbekannte Person genügt, um zu schweigen.
    gemischt = [*weg, {"state": "unknown", "changed_at": jetzt}]
    assert presence.holiday_question(gemischt, False, jetzt) is False


def test_diagnose_names_the_silence():
    jetzt = time.time()
    zeile = presence.diagnose(
        "Livia", {"state": "away", "changed_at": jetzt - 20 * 3600}, jetzt
    )
    assert zeile["silent"] is True
    assert "Funkstille" in zeile["hint"]

    nie = presence.diagnose("Livia", {}, jetzt)
    assert nie["last_seen"] is None
    assert "Kurzbefehl" in nie["hint"]


def test_the_default_location_is_the_actual_house():
    """Die Voreinstellung muss im Zonenradius des echten Hauses liegen.

    Zweimal passiert: Erst lag sie 11 km neben Zell, dann – nach der
    ersten Korrektur – immer noch 170 m daneben. Bei 150 m Radius heisst
    das «unterwegs», während man in der Küche steht, und niemand sieht
    der Zahl im Code an, dass sie das falsche Haus meint. Der Abstand
    hier ist die Prüfung, die ein Blick auf die Koordinaten nicht ist.
    """
    from homepilot.integrations.life360 import abstand_meter

    meter = abstand_meter(
        geofence.DEFAULT_LAT, geofence.DEFAULT_LON, 47.1384361, 7.9205897
    )
    assert meter < geofence.DEFAULT_RADIUS / 2


def test_default_places_come_from_the_house_location():
    orte = geofence.default_places({"latitude": 47.2, "longitude": 8.1})
    assert [ort["id"] for ort in orte] == ["home", "quartier"]
    assert orte[0]["latitude"] == 47.2
    # Die weite Zone ist der Vorlauf: zehn Minuten statt zwei.
    assert orte[1]["radius"] > orte[0]["radius"]


def test_an_old_wifi_entry_is_read_over_instead_of_breaking_the_start():
    """Wer `wifi:` in der config.yaml stehen hat, soll nach dem Update
    keinen Startfehler bekommen – die Zeile gilt nur nicht mehr."""
    zones = geofence.parse_zones([{"id": "stefan", "wifi": "unifi.iphone_stefan"}])
    assert zones == [{"id": "stefan", "name": "stefan"}]


# ── Welche Zone gehört zu welchem Benutzer ───────────────────────────────


def test_a_user_finds_the_zone_with_the_same_name():
    from homepilot.core.presence import zone_fuer

    assert zone_fuer("Stefan", {"stefan": "Stefan", "livia": "Livia"}) == "stefan"


def test_upper_and_lower_case_and_spaces_do_not_matter():
    from homepilot.core.presence import zone_fuer

    # «  stefan  » und «Stefan» sind dieselbe Person; alles andere wäre
    # eine Falle beim Eintippen in der config.yaml.
    assert zone_fuer("  stefan ", {"z1": "STEFAN"}) == "z1"


def test_without_a_name_on_the_zone_the_id_counts():
    from homepilot.core.presence import zone_fuer

    # «- id: stefan» ohne 'name': soll trotzdem passen.
    assert zone_fuer("Stefan", {"stefan": ""}) == "stefan"


def test_the_name_beats_the_id():
    from homepilot.core.presence import zone_fuer

    # Sonst gewönne eine Zone, die zufällig so heisst wie eine fremde
    # Kennung.
    zonen = {"livia": "Stefan", "stefan": "Jemand anders"}
    assert zone_fuer("Stefan", zonen) == "livia"


def test_a_user_without_a_zone_gets_nothing():
    from homepilot.core.presence import zone_fuer

    assert zone_fuer("Sandra", {"stefan": "Stefan"}) is None
    assert zone_fuer("", {"stefan": "Stefan"}) is None
    assert zone_fuer("Stefan", {}) is None
def test_anyone_home_state() -> None:
    """Ein leerer Akku ist kein «niemand zuhause».

    Die Vorsicht ist der ganze Punkt: Aus dieser Entität wird «alles
    aus, Alarm scharf». Wer daraus bei Nichtwissen ein «weg» macht,
    schaltet irgendwann das Haus ab, während jemand darin sitzt.
    """
    from homepilot.core.presence import anyone_home_state

    assert anyone_home_state(["home", "away"]) == "on"
    assert anyone_home_state(["away", "away"]) == "off"
    # Ein anderer Ort ist auch weg - nur eben ein benannter.
    assert anyone_home_state(["schule", "away"]) == "off"
    assert anyone_home_state(["unknown", "away"]) == "on"
    assert anyone_home_state(["", "away"]) == "on"
    assert anyone_home_state([]) == "on"
    assert anyone_home_state(None) == "on"


def test_der_hausstandort_kommt_von_dort_wo_man_steht() -> None:
    """Der stille Einrichtungsfehler, den man sonst nie findet.

    Steht der Hauskreis auf einer Vorgabe aus dem Quelltext oder auf
    einem vertippten Wert, ist man dauerhaft «unterwegs», während man in
    der Stube sitzt - und nichts sieht kaputt aus. Was jemand vor Ort
    gesetzt hat, sticht deshalb die config.yaml: Es ist die jüngere und
    die nachweislich gemessene Angabe.
    """
    from homepilot.core.presence import home_location, read_home, store_home

    config = {"latitude": 47.1445, "longitude": 8.0675}
    assert home_location(None, config)["source"] == "config"
    assert home_location(None, config)["longitude"] == 8.0675

    gesetzt = store_home(47.1381, 7.9228, 150, 1_700_000_000.0)
    heimat = home_location(gesetzt, config)
    assert heimat["source"] == "app"
    assert heimat["latitude"] == 47.1381
    assert heimat["at"] == 1_700_000_000.0

    # Ohne alles: ehrlich nichts, statt einer Vorgabe aus dem Quelltext.
    # Ein Haus, das der Hub am falschen Ort vermutet, ist schlimmer als
    # eines, von dem er zugibt, es nicht zu kennen.
    leer = home_location(None, None)
    assert leer["source"] == "none" and leer["latitude"] is None

    # Kaputtes wird nicht halb übernommen.
    assert read_home({"latitude": "hier"}) is None
    assert read_home(None) is None


def test_der_radius_bleibt_in_vernuenftigen_grenzen() -> None:
    """Ein Bauernhof braucht mehr als eine Wohnung im Block – aber ein
    Hauskreis von zwanzig Kilometern ist kein Zuhause mehr."""
    from homepilot.core.presence import read_home, store_home

    assert read_home(store_home(47.0, 8.0, 5, 1.0))["radius"] == 25.0
    assert read_home(store_home(47.0, 8.0, 20_000, 1.0))["radius"] == 2000.0
    assert read_home(store_home(47.0, 8.0, 400, 1.0))["radius"] == 400.0


# ── Das Gedächtnis über den Neustart hinweg ──────────────────────────────


def test_merke_stand_haelt_je_zone_nur_die_neueste_zeile():
    """Ein Gedächtnis, kein Verlauf – sonst wüchse die Datei endlos."""
    rows = presence.merke_stand([], "stefan", {"state": "home", "changed_at": 1})
    rows = presence.merke_stand(rows, "livia", {"state": "away", "changed_at": 2})
    rows = presence.merke_stand(rows, "stefan", {"state": "away", "changed_at": 3})
    assert len(rows) == 2
    stefan = next(row for row in rows if row["zone"] == "stefan")
    assert stefan["state"] == "away"
    assert stefan["changed_at"] == 3


def test_wieder_aufnehmen_verträgt_kaputte_zeilen():
    jetzt = 1_000_000.0
    # Nichts gemerkt, unbekannt gemerkt, Zeitstempel als Unsinn – alle
    # drei führen zum ehrlichen «unbekannt» statt zu einer Behauptung.
    for zeilen in (
        [],
        [{"zone": "stefan", "state": "unknown", "changed_at": jetzt}],
        [{"zone": "stefan", "state": "home", "changed_at": "gestern"}],
        [{"zone": "stefan", "state": "home"}],
        ["kein Mapping"],
    ):
        stand = presence.wieder_aufnehmen(zeilen, "stefan", jetzt)
        assert stand["state"] == presence.UNKNOWN
        assert stand["source"] == "none"


# ── Orte, die von Life360 kommen ─────────────────────────────────────────


def test_fremde_orte_kommen_hinter_die_eigenen():
    from homepilot.core.presence import orte_ergaenzen

    eigene = [{"id": "home", "name": "Zuhause", "radius": 150.0, "source": "config"}]
    dazu = [{"id": "schule", "name": "Schule", "radius": 200.0}]
    zusammen = orte_ergaenzen(eigene, dazu, "life360")
    assert [ort["id"] for ort in zusammen] == ["home", "schule"]
    # Woher ein Ort kommt, entscheidet, ob die App ihn löschen darf.
    assert zusammen[1]["source"] == "life360"


def test_ein_eigener_ort_wird_nicht_ueberschrieben():
    from homepilot.core.presence import orte_ergaenzen

    # Wer den Ort hier von Hand gepflegt hat, meinte genau diesen Radius.
    eigene = [{"id": "schule", "name": "Schule", "radius": 200.0, "source": "config"}]
    dazu = [{"id": "schule", "name": "Schule Zell", "radius": 900.0}]
    zusammen = orte_ergaenzen(eigene, dazu, "life360")
    assert zusammen == eigene


def test_nach_radius_sortiert_damit_der_engste_gewinnt():
    from homepilot.core.presence import orte_ergaenzen, place_state

    eigene = [
        {"id": "home", "name": "Zuhause", "radius": 150.0, "source": "config"},
        {"id": "quartier", "name": "Quartier", "radius": 3000.0, "source": "config"},
    ]
    orte = orte_ergaenzen(eigene, [{"id": "schule", "name": "Schule", "radius": 200.0}], "life360")
    assert [ort["id"] for ort in orte] == ["home", "schule", "quartier"]
    # Der benannte Ort schlägt die weite Vorlaufzone - genau darum die
    # Sortierung.
    zustand, engster = place_state(["quartier", "schule"], orte)
    assert engster == "schule" and zustand == "schule"


def test_zuhause_schlaegt_auch_einen_engeren_fremden_ort():
    from homepilot.core.presence import HOME, orte_ergaenzen, place_state

    orte = orte_ergaenzen(
        [{"id": "home", "name": "Zuhause", "radius": 150.0, "source": "config"}],
        [{"id": "tanners_home", "name": "Tanners Home", "radius": 80.0}],
        "life360",
    )
    # Daran hängen Alarmanlage und Abläufe; ein Name aus einer fremden
    # App darf «zuhause» nicht verdrängen.
    zustand, _ = place_state(["tanners_home", "home"], orte)
    assert zustand == HOME


# ── Eine Quelle je Person ────────────────────────────────────────────────
#
# Der gemeldete Fall: «Es wird angezeigt, dass ich unterwegs bin, obwohl
# ich längst zuhause bin.» Life360 meldete «zuhause», und auf einem
# Telefon lief die Ortung der App weiter und schob aus dem Hintergrund
# ein «weg» nach. Wer zuletzt sprach, bekam recht.


def test_wer_niemandem_gehoert_darf_melden():
    from homepilot.core.presence import meldung_annehmen

    assert meldung_annehmen("geofence", {}, "stefan") is True


def test_die_fuehrende_quelle_darf_melden():
    from homepilot.core.presence import meldung_annehmen

    assert meldung_annehmen("life360", {"stefan": "life360"}, "stefan") is True


def test_eine_zweite_quelle_wird_ueberhoert():
    from homepilot.core.presence import meldung_annehmen

    # Genau der Fall: Das Telefon meldet noch, Life360 führt die Person.
    assert meldung_annehmen("geofence", {"stefan": "life360"}, "stefan") is False


def test_der_anspruch_gilt_nur_fuer_die_eigene_person():
    from homepilot.core.presence import meldung_annehmen

    # Wer nicht bei Life360 eingetragen ist, meldet weiter selbst - etwa
    # ein Besuch mit Kurzbefehl.
    assert meldung_annehmen("geofence", {"stefan": "life360"}, "livia") is True


# ── Der Diagnose-Satz darf nicht beruhigen, wo nichts beruhigt ───────────
#
# «Meldet sich regelmässig» stand auch neben einer 83 Minuten alten
# «weg»-Meldung, während die Person längst im Haus sass. Das Telefon
# meldet nur beim Kommen und Gehen - bleibt die Ankunft aus (iOS weckt
# die App nicht), sieht das genauso aus wie jemand, der wegblieb.


def test_telefonquelle_nennt_alter_und_ausweg():
    from homepilot.core.presence import diagnose

    jetzt = 10_000.0
    zeile = diagnose(
        "Stefan",
        {"state": "away", "source": "geofence", "last_seen": jetzt - 83 * 60},
        jetzt,
    )
    assert "83 Min." in zeile["hint"]
    assert "weg" in zeile["hint"]
    assert "Jetzt melden" in zeile["hint"]
    assert "regelmässig" not in zeile["hint"]


def test_life360_darf_regelmaessig_sagen():
    from homepilot.core.presence import diagnose

    zeile = diagnose(
        "Maja",
        {"state": "home", "source": "life360", "last_seen": 9_940.0},
        10_000.0,
    )
    assert zeile["hint"] == "Meldet sich regelmässig (über Life360)."


def test_aeltere_meldungen_stehen_in_stunden():
    from homepilot.core.presence import diagnose

    jetzt = 100_000.0
    zeile = diagnose(
        "Bine",
        {"state": "home", "source": "geofence", "last_seen": jetzt - 3 * 3600},
        jetzt,
    )
    assert "vor 3 Std." in zeile["hint"]
    assert "(da)" in zeile["hint"]
