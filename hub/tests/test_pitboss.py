"""Pit-Boss-Pelletgrill.

Getestet wird das, was der Hub aus dem Rohzustand der Steuerplatine macht –
ohne Grill und ohne die Bibliothek. Genau das ist der Teil, der beim
Grillen zählt: ob «Pellets leer» ankommt, bevor das Fleisch kalt wird.
"""

from homepilot.integrations.pitboss import (
    faults,
    grill_state,
    probe_temperatures,
    slug,
    yaml_block,
    zustandszeilen,
)


def test_slug_makes_a_usable_id():
    assert slug("Grill Terrasse") == "grill_terrasse"
    assert slug("  Grill!  ") == "grill"
    # Ohne brauchbaren Namen trotzdem eine Kennung – ein Gerät ohne
    # Kennung liesse sich nirgends zuordnen.
    assert slug("---") == "grill"


def test_only_plugged_probes_count():
    """Ein nicht eingesteckter Fühler meldet None.

    Ihn trotzdem zu führen hiesse: eine Kachel, die dauerhaft «–» zeigt.
    """
    state = {"p1Temp": 62, "p2Temp": None, "p3Temp": 0, "p4Temp": None}
    # 0 Grad ist ein Messwert, kein fehlender Fühler.
    assert probe_temperatures(state) == {1: 62, 3: 0}
    assert probe_temperatures({}) == {}


def test_faults_are_named_not_just_counted():
    """«Störung» genügt nicht - Pellets nachfüllen und ein defektes
    Gebläse führen zu ganz verschiedenen Schritten."""
    assert faults({}) == []
    assert faults({"noPellets": True}) == ["Pellets leer"]
    many = faults({"noPellets": True, "fanErr": True, "err2": True})
    assert many == ["Pellets leer", "Gebläse", "Fühler 2"]


def test_grill_state_shape():
    raw = {
        "moduleIsOn": True,
        "grillTemp": 107,
        "grillSetTemp": 121,
        "isFahrenheit": False,
        "hotState": False,
        "fanState": True,
        "motorState": True,
        "lightState": False,
        "p1Temp": 62,
        "p2Temp": None,
    }
    shaped = grill_state(raw)
    assert shaped["state"] == "running"
    assert shaped["temperature"] == 107
    assert shaped["target"] == 121
    assert shaped["unit"] == "°C"
    assert shaped["fan"] is True
    assert shaped["igniter"] is False
    assert shaped["probes"] == {1: 62}
    assert shaped["problem"] is None

    # Ein stromloser Grill zwischen zwei Grillabenden.
    assert grill_state({"moduleIsOn": False})["state"] == "off"
    # Fahrenheit-Geräte melden ihre Einheit selbst.
    assert grill_state({"isFahrenheit": True})["unit"] == "°F"
    # Die erste Störung steht vorne, damit die Kachel sie zeigen kann.
    assert grill_state({"noPellets": True})["problem"] == "Pellets leer"


# --- Der Einrichtungs-Helfer -------------------------------------------
#
# `python -m homepilot.integrations.pitboss` prüft die Verbindung, bevor
# irgendetwas in die config.yaml wandert. Das Verbinden selbst braucht
# einen Grill; was der Helfer daraus macht, nicht.

def test_yaml_block_takes_the_local_way_when_there_is_a_host():
    block = yaml_block("Grill", "PBV4PS2", host="10.10.1.60")
    assert block.splitlines() == [
        "  - integration: pitboss",
        "    name: Grill",
        "    model: PBV4PS2",
        "    host: 10.10.1.60",
        "    scan_interval: 30",
    ]
    # Ohne die Zeile gibt es den Fernstart gar nicht – das soll man dem
    # Vorschlag ansehen und nicht erst in der Anleitung nachlesen.
    assert "allow_remote_start" not in block


def test_yaml_block_quotes_the_cloud_id():
    """Die Kennung aus der App ist eine lange Ziffernfolge.

    Ohne Anführungszeichen liest YAML sie als Zahl – und dann fehlen
    führende Nullen.
    """
    block = yaml_block("Grill", "LG0800BL", grill_id="0123456789")
    assert '    grill_id: "0123456789"' in block
    assert "scan_interval" not in block


def test_yaml_block_carries_the_remote_start_when_asked():
    block = yaml_block("Grill", "PBV4PS2", host="10.10.1.60", allow_remote_start=True)
    assert block.endswith("    allow_remote_start: true")


def test_state_lines_show_what_matters_at_the_grill():
    zeilen = zustandszeilen(
        grill_state(
            {
                "moduleIsOn": True,
                "grillTemp": 110,
                "grillSetTemp": 120,
                "p1Temp": 63,
                "noPellets": True,
            }
        )
    )
    assert zeilen[0] == "Zustand:     läuft"
    assert zeilen[1] == "Garraum:     110 °C  (Ziel 120 °C)"
    assert zeilen[2] == "Fühler:      1: 63 °C"
    assert zeilen[3] == "Störungen:   Pellets leer"


def test_state_lines_say_when_no_probe_is_plugged():
    """Ein leeres Gerüst und ein Grill ohne Fühler sehen sonst gleich aus."""
    zeilen = zustandszeilen(grill_state({"moduleIsOn": False}))
    assert zeilen[0] == "Zustand:     aus"
    assert "Fühler:      keiner eingesteckt" in zeilen
    assert "Störungen:   keine" in zeilen
