"""Platzhalter in Nachrichtentexten (Punkt 251 der Werkbank).

Die Auflösung ist rein (core/platzhalter.py): Text plus Nachschlage-
Funktion hinein, fertiger Text heraus. Unbekanntes bleibt stehen -
eine Push mit «{tippfehler}» ist besser lesbar als ein abgestürzter
Ablauf.
"""

from homepilot.core.platzhalter import fuellen

WERTE = {
    ("demo.licht", "state"): "on",
    ("demo.licht", "brightness"): 80,
    ("sensor.aussen_temp", "state"): 21.5,
}


def nachschlagen(entity_id: str, attribut: str):
    return WERTE.get((entity_id, attribut))


def test_a_state_placeholder_becomes_the_state():
    assert (
        fuellen("Die Lampe ist {demo.licht}.", nachschlagen)
        == "Die Lampe ist on."
    )
    # Auch mitten in einer Zahl-Meldung, wie man sie wirklich tippt.
    assert (
        fuellen("Draussen sind {sensor.aussen_temp} Grad.", nachschlagen)
        == "Draussen sind 21.5 Grad."
    )


def test_an_attribute_placeholder_reads_the_single_field():
    assert (
        fuellen("Helligkeit: {demo.licht.brightness} %", nachschlagen)
        == "Helligkeit: 80 %"
    )


def test_an_unknown_placeholder_stays_untouched():
    # Der ganze Grund für diese Regel: Ein Tippfehler soll als
    # Tippfehler ankommen, nicht als ausgefallene Nachricht.
    assert (
        fuellen("Stand: {tippfehler} und {demo.licht}", nachschlagen)
        == "Stand: {tippfehler} und on"
    )
    # Auch die Platzhalter der anderen Stellen ({termin}, {raum}) gehen
    # unversehrt durch - wer zuerst dran ist, zerreisst dem anderen nichts.
    assert fuellen("Besuch: {termin}", nachschlagen) == "Besuch: {termin}"


def test_broken_braces_do_not_break_the_message():
    assert fuellen("{offen und }zu{ und {}", nachschlagen) == "{offen und }zu{ und {}"
    assert fuellen("", nachschlagen) == ""
    assert fuellen(None, nachschlagen) == ""


def test_the_time_placeholder_uses_the_given_clock():
    assert fuellen("Es ist {time}.", nachschlagen, jetzt="07:15") == "Es ist 07:15."
    # Ohne Uhrzeit bleibt er stehen - raten wäre schlimmer.
    assert fuellen("Es ist {time}.", nachschlagen) == "Es ist {time}."


def test_a_failing_lookup_leaves_the_placeholder_standing():
    def kaputt(_entity_id: str, _attribut: str):
        raise RuntimeError("Registry weg")

    assert fuellen("Stand: {demo.licht}", kaputt) == "Stand: {demo.licht}"
