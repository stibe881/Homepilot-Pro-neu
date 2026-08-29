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
    Die Nachricht ist sofort da und wird bloss nicht gezeigt.

    Der Wert wird mit Bindestrich geschrieben - Apples eigener Schlüssel
    heisst «timeSensitive», Expo nimmt an dieser Stelle aber nur
    'time-sensitive' entgegen und weist sonst die ganze Sendung ab.
    """
    assert dringlichkeit("alarm")["interruptionLevel"] == "time-sensitive"


def test_leise_kategorien_gibt_es_wirklich() -> None:
    """Ein Tippfehler in LEISE fiele sonst nie auf: Die Kategorie wäre
    einfach dringend, und das sieht man keiner Nachricht an."""
    assert set(CATEGORIES) >= LEISE


def test_die_dringenden_sind_die_mehrheit() -> None:
    """Kein Test einer Zahl, sondern der Richtung: Wer LEISE aus
    Bequemlichkeit füllt, kippt die Voreinstellung um."""
    assert len(LEISE) < len(CATEGORIES) / 2


# ── Der Schreibfehler, der jede Push verhinderte ────────────────────────
#
# Apples eigener Schlüssel heisst «timeSensitive», und genau so stand er
# hier. Expo nimmt an dieser Stelle nur 'active', 'critical', 'passive'
# oder 'time-sensitive' entgegen - und weist bei etwas anderem die ganze
# Sendung mit 400 ab. Nicht diese eine Nachricht: die ganze, denn es ist
# ein Schema-Fehler und kein Zustellfehler. Damit kam von diesem Hub
# keine einzige Benachrichtigung mehr an, auch der Push-Test nicht.

#: Was Expo an dieser Stelle gelten lässt (gegen die API geprüft).
ERLAUBT = {"active", "critical", "passive", "time-sensitive"}


def test_das_dringlichkeitsfeld_haelt_sich_an_expos_liste() -> None:
    for kategorie in (None, "alarm", "doorbell", "automation:tuerklingel"):
        stufe = dringlichkeit(kategorie)
        wert = stufe.get("interruptionLevel")
        if wert is None:
            continue
        assert wert in ERLAUBT, f"{kategorie}: {wert}"


def test_die_dringende_stufe_ist_zeitkritisch() -> None:
    # Mit Bindestrich - ohne ihn weist Expo die ganze Sendung ab.
    assert dringlichkeit(None)["interruptionLevel"] == "time-sensitive"


def test_der_grund_einer_abweisung_wird_nicht_abgeschnitten() -> None:
    """Hier standen 120 Zeichen, und Expos Meldung beginnt mit hundert
    Zeichen JSON-Gerüst: Abgeschnitten wurde genau der Satz, der sagt,
    was falsch ist."""
    from homepilot.core.push import push_fehlertext

    roh = (
        '{"errors":[{"code":"VALIDATION_ERROR","type":"USER","message":'
        '"Must correct one of the following issues: [\\"$\\": Expected object, '
        'received array, \\"0.interruptionLevel\\": Invalid enum value. '
        "Expected 'active' | 'critical' | 'passive' | 'time-sensitive', "
        "received 'timeSensitive'].\"}]}"
    )
    satz = push_fehlertext(400, roh)
    assert "interruptionLevel" in satz
    assert "time-sensitive" in satz
    assert "VALIDATION_ERROR" in satz


def test_eine_antwort_ohne_json_geht_trotzdem_durch() -> None:
    from homepilot.core.push import push_fehlertext

    assert "502" in push_fehlertext(502, "<html>Bad Gateway</html>")
    assert "Bad Gateway" in push_fehlertext(502, "<html>Bad Gateway</html>")
    # Und eine leere Antwort stürzt nicht ab.
    assert "500" in push_fehlertext(500, "")
