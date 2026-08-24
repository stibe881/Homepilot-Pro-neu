"""Dass eine Nachricht sofort kommt, ist kein Zufall, sondern ein Feld.

Die Störung, die dahintersteht: Ohne ``priority`` schickt Expo mit
normaler Dringlichkeit, Android hält das in Doze zurück, und es klingelt
zwar an der Tür, aber nicht am Telefon. Von aussen sah das aus, als sei
der Hub langsam.
"""

from __future__ import annotations

from homepilot.core.push import (
    CATEGORIES,
    KANAL_DRINGEND,
    KANAL_LEISE,
    LEISE,
    dringlichkeit,
)


def test_ohne_kategorie_dringend() -> None:
    """Die Voreinstellung ist die, bei der niemand etwas verpasst."""
    stufe = dringlichkeit(None)
    assert stufe["priority"] == "high"
    assert stufe["channelId"] == KANAL_DRINGEND


def test_alarm_ist_dringend() -> None:
    assert dringlichkeit("alarm")["priority"] == "high"


def test_klingel_aus_einem_ablauf_ist_dringend() -> None:
    """Der eigentliche Fall: Die Klingel meldet über einen selbst
    gebauten Ablauf, ihr Schlüssel steht also in keiner Liste."""
    assert dringlichkeit("automation:tuerklingel")["priority"] == "high"


def test_batterie_darf_warten() -> None:
    stufe = dringlichkeit("battery")
    assert stufe["priority"] == "normal"
    assert stufe["channelId"] == KANAL_LEISE
    # Nichts, was durch einen Fokus bricht - eine schwache Batterie
    # weckt niemanden.
    assert "interruptionLevel" not in stufe


def test_dringendes_bricht_durch_den_fokus() -> None:
    """Ohne das nützt die hohe Priorität nichts, sobald ein Fokus läuft:
    Die Nachricht ist sofort da und wird bloss nicht gezeigt."""
    assert dringlichkeit("alarm")["interruptionLevel"] == "timeSensitive"


def test_leise_kategorien_gibt_es_wirklich() -> None:
    """Ein Tippfehler in LEISE fiele sonst nie auf: Die Kategorie wäre
    einfach dringend, und das sieht man keiner Nachricht an."""
    assert set(CATEGORIES) >= LEISE


def test_die_dringenden_sind_die_mehrheit() -> None:
    """Kein Test einer Zahl, sondern der Richtung: Wer LEISE aus
    Bequemlichkeit füllt, kippt die Voreinstellung um."""
    assert len(LEISE) < len(CATEGORIES) / 2
