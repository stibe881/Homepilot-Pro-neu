"""Eine Box in die config.yaml eintragen, ohne den Rest anzurühren.

Die Datei gehört dem Menschen, der sie geschrieben hat: Kommentare,
Reihenfolge und Einrückung müssen die Bearbeitung überleben.
"""

import yaml

from homepilot.core.config_edit import add_cast_device, block_range, has_host, quote

CONFIG = """\
# Mein Zuhause
api:
  port: 8080

integrations:
  # Fernseher und Boxen
  - integration: google_cast
    devices:
      - host: 10.10.1.20
        name: Wohnzimmer TV

  - integration: spotify
    client_id: abc
"""


def test_quote_only_where_it_is_needed():
    assert quote("Terrasse") == "Terrasse"
    assert quote("Küche") == "Küche"
    # Doppelpunkt und Raute würde YAML als Struktur bzw. Kommentar lesen.
    assert quote("Bad: oben") == '"Bad: oben"'
    assert quote("Sofa #2") == '"Sofa #2"'
    assert quote(" Rand ") == '" Rand "'


def test_block_range_finds_the_integration():
    lines = CONFIG.splitlines()
    start, end = block_range(lines, "google_cast")
    assert lines[start].strip() == "- integration: google_cast"
    assert lines[end].strip() == "- integration: spotify"
    assert block_range(lines, "homematic") is None


def test_has_host_is_limited_to_the_given_lines():
    lines = CONFIG.splitlines()
    start, end = block_range(lines, "google_cast")
    assert has_host(lines[start:end], "10.10.1.20")
    assert not has_host(lines[start:end], "10.10.1.99")


def test_adding_a_device_keeps_comments_and_order():
    result = add_cast_device(CONFIG, "Terrasse", "10.10.1.25")
    assert "# Mein Zuhause" in result
    assert "# Fernseher und Boxen" in result
    # Der neue Eintrag steht im richtigen Block, nicht bei Spotify.
    cast = result.split("- integration: spotify")[0]
    assert "host: 10.10.1.25" in cast
    assert "name: Terrasse" in cast
    # Und die Datei ist danach immer noch gültiges YAML mit beiden Boxen.
    parsed = yaml.safe_load(result)
    devices = parsed["integrations"][0]["devices"]
    assert [entry["name"] for entry in devices] == ["Wohnzimmer TV", "Terrasse"]


def test_adding_twice_changes_nothing():
    """Ein zweiter Klick darf nicht zwei gleiche Geräte erzeugen – der Hub
    käme damit beim Start durcheinander."""
    once = add_cast_device(CONFIG, "Terrasse", "10.10.1.25")
    assert add_cast_device(once, "Terrasse", "10.10.1.25") == once


def test_names_with_colons_survive():
    result = add_cast_device(CONFIG, "Bad: oben", "10.10.1.30")
    parsed = yaml.safe_load(result)
    assert parsed["integrations"][0]["devices"][-1]["name"] == "Bad: oben"


def test_block_without_a_device_list_gets_one():
    config = "integrations:\n  - integration: google_cast\n"
    parsed = yaml.safe_load(add_cast_device(config, "Küche", "10.10.1.31"))
    assert parsed["integrations"][0]["devices"] == [
        {"host": "10.10.1.31", "name": "Küche"}
    ]


def test_without_the_integration_a_whole_block_is_added():
    config = "integrations:\n  - integration: spotify\n    client_id: abc\n"
    parsed = yaml.safe_load(add_cast_device(config, "Küche", "10.10.1.32"))
    names = [entry["integration"] for entry in parsed["integrations"]]
    assert names == ["spotify", "google_cast"]
    assert parsed["integrations"][1]["devices"][0]["host"] == "10.10.1.32"


def test_unusual_indentation_is_copied_not_corrected():
    config = (
        "integrations:\n"
        "- integration: google_cast\n"
        "  devices:\n"
        "  - host: 10.10.1.20\n"
        "    name: TV\n"
    )
    result = add_cast_device(config, "Terrasse", "10.10.1.25")
    parsed = yaml.safe_load(result)
    assert len(parsed["integrations"][0]["devices"]) == 2
    # Die vorhandene Schreibweise bleibt, statt auf eine eigene umgestellt
    # zu werden.
    assert "\n  - host: 10.10.1.25\n    name: Terrasse\n" in result


def test_a_new_block_lands_in_the_integrations_list():
    """Nicht am Dateiende: Darunter stehen meist noch Benutzer und Szenen –
    ein Integrationsblock dort wäre kein gültiger Eintrag mehr."""
    config = (
        "integrations:\n"
        "  - integration: demo\n"
        "users:\n"
        "  - name: Stefan\n"
        "    role: besitzer\n"
    )
    parsed = yaml.safe_load(add_cast_device(config, "Küche", "10.10.1.33"))
    assert [entry["integration"] for entry in parsed["integrations"]] == [
        "demo",
        "google_cast",
    ]
    assert parsed["users"][0]["name"] == "Stefan"
