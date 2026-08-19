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
