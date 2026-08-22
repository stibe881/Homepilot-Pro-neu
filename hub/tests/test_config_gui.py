"""Die Konfiguration bedienen, ohne sie umzuschreiben.

Der Punkt, um den sich hier alles dreht: Die config.yaml gehört dem
Menschen, der sie geschrieben hat. Eine Bedienoberfläche darf eine Zeile
ändern – und nicht die Datei neu formatieren, Kommentare wegwerfen oder
die gewachsene Reihenfolge umstellen.
"""

from __future__ import annotations

from homepilot.core import config_edit as ce

BEISPIEL = """# Die Konfiguration von HomePilot
api:
  host: 0.0.0.0
  port: 8123
  token: geheim

# Standort für Sonnenauf- und -untergang.
location:
  latitude: 47.1445
  longitude: 8.0675

integrations:
  # Virtuelle Geräte zum Entwickeln.
  - integration: demo

  # Die Hue-Bridge im Flur.
  - integration: hue
    host: 192.168.1.20

  # - integration: tuya
  #   devices: []

rooms:
  Wohnzimmer: [demo.light_livingroom]
"""


def test_the_outline_finds_every_section_in_order():
    abschnitte = ce.outline(BEISPIEL)
    assert [a["key"] for a in abschnitte] == ["api", "location", "integrations", "rooms"]
    assert [a["label"] for a in abschnitte][:2] == ["Zugang", "Standort"]


def test_a_section_owns_the_comment_above_it():
    abschnitte = {a["key"]: a for a in ce.outline(BEISPIEL)}
    text = ce.block_text(BEISPIEL, abschnitte["location"]["start"], abschnitte["location"]["end"])
    # Die Erklärung darüber beschreibt genau diesen Abschnitt.
    assert text.startswith("# Standort für Sonnenauf")
    assert "longitude: 8.0675" in text


def test_an_unknown_section_still_shows_up():
    """Eine Datei mit einem Schlüssel, den wir nicht kennen, darf in der
    Übersicht nicht unsichtbar werden."""
    abschnitte = ce.outline(BEISPIEL + "\nwas_auch_immer:\n  a: 1\n")
    assert abschnitte[-1]["key"] == "was_auch_immer"
    assert abschnitte[-1]["label"] == "was_auch_immer"


def test_every_integration_is_its_own_block():
    abschnitte = {a["key"]: a for a in ce.outline(BEISPIEL)}
    items = abschnitte["integrations"]["items"]
    assert [i["name"] for i in items] == ["demo", "hue", "tuya"]
    # Auskommentiert heisst abgeschaltet, nicht verschwunden.
    assert [i["enabled"] for i in items] == [True, True, False]


def test_an_integration_block_carries_its_own_comment():
    abschnitte = {a["key"]: a for a in ce.outline(BEISPIEL)}
    hue = [i for i in abschnitte["integrations"]["items"] if i["name"] == "hue"][0]
    text = ce.block_text(BEISPIEL, hue["start"], hue["end"])
    assert text.strip().startswith("# Die Hue-Bridge im Flur.")
    assert "host: 192.168.1.20" in text
    # Und nicht mehr: Der nächste Block fängt erst danach an.
    assert "tuya" not in text


def test_replacing_a_block_leaves_the_rest_untouched():
    abschnitte = {a["key"]: a for a in ce.outline(BEISPIEL)}
    hue = [i for i in abschnitte["integrations"]["items"] if i["name"] == "hue"][0]
    neu = ce.replace_block(
        BEISPIEL,
        hue["start"],
        hue["end"],
        "  # Die Hue-Bridge im Flur.\n  - integration: hue\n    host: 192.168.1.99",
    )
    assert "host: 192.168.1.99" in neu
    # Alles andere Zeichen für Zeichen wie vorher.
    assert "# Die Konfiguration von HomePilot" in neu
    assert "# - integration: tuya" in neu
    assert neu.count("- integration:") == BEISPIEL.count("- integration:")


def test_removing_a_block_removes_exactly_it():
    abschnitte = {a["key"]: a for a in ce.outline(BEISPIEL)}
    demo = abschnitte["integrations"]["items"][0]
    neu = ce.replace_block(BEISPIEL, demo["start"], demo["end"], "")
    assert "integration: demo" not in neu
    assert "integration: hue" in neu
    assert "# Die Hue-Bridge im Flur." in neu


def test_setting_a_value_keeps_every_comment():
    neu = ce.set_scalar(BEISPIEL, ["location", "address"], "Musterweg 3, 6144 Zell")
    # Das Komma bekommt Anführungszeichen – ohne sie läse YAML unter
    # Umständen eine Liste.
    assert 'address: "Musterweg 3, 6144 Zell"' in neu
    for zeile in BEISPIEL.splitlines():
        if zeile.strip().startswith("#"):
            assert zeile in neu.splitlines()


def test_setting_an_existing_value_replaces_it_in_place():
    neu = ce.set_scalar(BEISPIEL, ["api", "port"], 8080)
    zeilen = neu.splitlines()
    assert "  port: 8080" in zeilen
    assert "  port: 8123" not in zeilen
    # Die Zeile bleibt an ihrem Platz, zwischen host und token.
    assert zeilen.index("  port: 8080") == zeilen.index("  host: 0.0.0.0") + 1


def test_a_missing_section_is_created_at_the_end():
    neu = ce.set_scalar(BEISPIEL, ["push", "public_url"], "https://haus.example.ch")
    assert neu.rstrip().endswith('  public_url: "https://haus.example.ch"')
    # Mit Abstand zum vorigen Abschnitt.
    zeilen = neu.splitlines()
    assert zeilen[zeilen.index("push:") - 1] == ""


def test_none_takes_a_value_back():
    neu = ce.set_scalar(BEISPIEL, ["location", "latitude"], None)
    assert "latitude" not in neu
    assert "longitude: 8.0675" in neu
    # Was es nicht gibt, kann auch nicht weg – und ändert nichts.
    assert ce.set_scalar(BEISPIEL, ["location", "gibtsnicht"], None) == BEISPIEL


def test_values_that_yaml_could_misread_get_quotes():
    neu = ce.set_scalar(BEISPIEL, ["api", "token"], "ja: nein")
    assert '  token: "ja: nein"' in neu
    # Wahrheitswerte und Zahlen bleiben, was sie sind.
    assert "  port: 8123" in ce.set_scalar(BEISPIEL, ["api", "port"], 8123)
    assert "  debug: true" in ce.set_scalar(BEISPIEL, ["api", "debug"], True)


def test_the_trailing_newline_survives():
    assert ce.set_scalar(BEISPIEL, ["api", "port"], 9).endswith("\n")
    ohne = BEISPIEL.rstrip("\n")
    assert not ce.set_scalar(ohne, ["api", "port"], 9).endswith("\n")


def test_the_file_still_parses_after_a_round_trip():
    """Der Test, der zählt: Was hier herauskommt, muss der Hub laden."""
    import yaml

    neu = ce.set_scalar(BEISPIEL, ["location", "address"], "Musterweg 3")
    daten = yaml.safe_load(neu)
    assert daten["location"]["address"] == "Musterweg 3"
    assert daten["api"]["port"] == 8123
    assert len(daten["integrations"]) == 2


def test_switching_an_integration_off_and_on_again():
    abschnitte = {a["key"]: a for a in ce.outline(BEISPIEL)}
    hue = [i for i in abschnitte["integrations"]["items"] if i["name"] == "hue"][0]

    # Der Schalter fasst nur den Eintrag an, nicht die Erklärung davor.
    aus = ce.toggle_block(BEISPIEL, hue["code"], hue["end"], False)
    assert "  # - integration: hue" in aus
    # Das Kommentarzeichen steht in einer Spalte, die Struktur darunter
    # bleibt sichtbar – genau die Form, in der solche Blöcke in dieser
    # Datei von Hand stehen.
    assert "  #   host: 192.168.1.20" in aus
    # Der Rest bleibt in Betrieb.
    assert "  - integration: demo" in aus

    # Und wieder zurück – Zeichen für Zeichen wie vorher, samt der
    # Erklärung darüber.
    zurueck = ce.toggle_block(aus, hue["code"], hue["end"], True)
    assert zurueck == BEISPIEL


def test_switching_on_what_was_written_as_a_comment():
    abschnitte = {a["key"]: a for a in ce.outline(BEISPIEL)}
    tuya = [i for i in abschnitte["integrations"]["items"] if i["name"] == "tuya"][0]
    an = ce.toggle_block(BEISPIEL, tuya["code"], tuya["end"], True)
    assert "  - integration: tuya" in an
    assert "    devices: []" in an


def test_a_switched_off_block_still_parses():
    import yaml

    abschnitte = {a["key"]: a for a in ce.outline(BEISPIEL)}
    hue = [i for i in abschnitte["integrations"]["items"] if i["name"] == "hue"][0]
    daten = yaml.safe_load(ce.toggle_block(BEISPIEL, hue["code"], hue["end"], False))
    assert [i["integration"] for i in daten["integrations"]] == ["demo"]


def test_a_comment_inside_the_block_comes_back_as_a_comment():
    """Der Fall, der beim Bauen auffiel: Ohne die zweite Kommentarebene
    stand nach dem Einschalten «Die Bridge im Flur» als YAML da."""
    mit_kommentar = """integrations:
  - integration: hue
    # Die Bridge steht im Flur.
    host: 192.168.1.20
"""
    aus = ce.toggle_block(mit_kommentar, 1, 4, False)
    # Die zweite Kommentarebene macht das Einschalten eindeutig – und
    # die Einrückung bleibt, weil das «#» an der Blockkante steht.
    assert "  #   # Die Bridge steht im Flur." in aus
    assert ce.toggle_block(aus, 1, 4, True) == mit_kommentar


def test_sections_do_not_overlap():
    """Der Fehler, der am echten Hub auffiel: Der Kommentar über einem
    Abschnitt gehörte auch noch zum vorigen – wer beide bearbeitete,
    hatte ihn hinterher zweimal in der Datei."""
    abschnitte = ce.outline(BEISPIEL)
    for vorher, nachher in zip(abschnitte, abschnitte[1:], strict=False):
        assert vorher["end"] <= nachher["start"]
    # Und lückenlos: Jede Zeile gehört zu genau einem Abschnitt.
    assert abschnitte[0]["start"] == 0
    assert abschnitte[-1]["end"] == len(BEISPIEL.splitlines())


def test_each_section_still_owns_its_own_comment():
    abschnitte = {a["key"]: a for a in ce.outline(BEISPIEL)}
    api = ce.block_text(BEISPIEL, abschnitte["api"]["start"], abschnitte["api"]["end"])
    assert "# Standort für Sonnenauf" not in api
    location = ce.block_text(
        BEISPIEL, abschnitte["location"]["start"], abschnitte["location"]["end"]
    )
    assert location.startswith("# Standort für Sonnenauf")


def test_a_switched_off_block_at_the_end_stays_where_it_belongs():
    """Am echten Hub aufgefallen: Ein auskommentiertes «- integration:
    tuya» am Ende der Liste sah aus wie ein Kommentar über dem nächsten
    Abschnitt – und wanderte dorthin."""
    abschnitte = {a["key"]: a for a in ce.outline(BEISPIEL)}
    namen = [i["name"] for i in abschnitte["integrations"]["items"]]
    assert namen == ["demo", "hue", "tuya"]
    rooms = ce.block_text(BEISPIEL, abschnitte["rooms"]["start"], abschnitte["rooms"]["end"])
    assert "tuya" not in rooms


def test_switching_on_reaches_lines_commented_by_hand():
    """Am echten Hub aufgefallen: «- integration: hue» war wieder in
    Betrieb, «host:» darunter noch immer ein Kommentar – weil jemand
    (oder eine frühere Fassung) an der eigenen Einrückung kommentiert
    hatte."""
    gemischt = """integrations:
  # - integration: hue
    # host: 192.168.1.20
    # token: geheim
"""
    an = ce.toggle_block(gemischt, 1, 4, True)
    assert "  - integration: hue" in an
    assert "    host: 192.168.1.20" in an
    assert "    token: geheim" in an


def test_off_and_on_still_cancel_each_other_out():
    original = """integrations:
  - integration: hue
    host: 192.168.1.20
"""
    aus = ce.toggle_block(original, 1, 3, False)
    assert "  #   host: 192.168.1.20" in aus
    assert ce.toggle_block(aus, 1, 3, True) == original
