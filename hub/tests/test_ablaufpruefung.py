"""Ob ein Ablauf aus bekannten Bausteinen besteht (Punkt 378 der Werkbank)."""

from __future__ import annotations

from homepilot.core import ablaufpruefung


def test_ein_sauberer_ablauf_meldet_nichts():
    entry = {
        "condition": [{"type": "state", "entity_id": "x", "state": "on"}],
        "action": [{"type": "command", "entity_id": "x", "command": "turn_on"}],
        "otherwise": [{"type": "notify", "title": "x", "message": "y"}],
    }
    assert ablaufpruefung.pruefen(entry) == []


def test_ein_tippfehler_im_aktionstyp_faellt_auf():
    entry = {"action": [{"type": "nofify", "title": "x"}]}
    fehler = ablaufpruefung.pruefen(entry)
    assert len(fehler) == 1
    assert "nofify" in fehler[0]
    assert "action[0]" in fehler[0]


def test_ein_tippfehler_im_bedingungstyp_faellt_auf():
    entry = {"condition": [{"type": "zeit", "at": "22:00"}]}
    fehler = ablaufpruefung.pruefen(entry)
    assert "zeit" in fehler[0]
    assert "condition[0]" in fehler[0]


def test_fehlender_typ_gilt_als_der_bekannte_vorgabewert():
    """Wie in core/automation.py: keine Angabe heisst «command» bzw. «state»."""
    entry = {
        "action": [{"entity_id": "x", "command": "turn_on"}],
        "condition": [{"entity_id": "x", "state": "on"}],
    }
    assert ablaufpruefung.pruefen(entry) == []


def test_verschachtelt_in_if_und_repeat():
    entry = {
        "action": [
            {
                "type": "if",
                "condition": {"type": "wetter"},
                "then": [{"type": "unsinn"}],
                "else": [{"type": "command", "entity_id": "x", "command": "turn_off"}],
            },
            {"type": "repeat", "count": 2, "actions": [{"type": "auchunsinn"}]},
        ]
    }
    fehler = ablaufpruefung.pruefen(entry)
    gemeldet = {f.split("«")[1].split("»")[0] for f in fehler}
    assert gemeldet == {"wetter", "unsinn", "auchunsinn"}


def test_verschachtelt_in_gruppen():
    entry = {
        "condition": [
            {
                "type": "group",
                "match": "any",
                "conditions": [
                    {"type": "sun", "value": "night"},
                    {"type": "quatsch"},
                ],
            }
        ]
    }
    fehler = ablaufpruefung.pruefen(entry)
    assert len(fehler) == 1 and "quatsch" in fehler[0]


def test_kaputte_eintraege_werden_uebersprungen_nicht_abgestuerzt():
    entry = {"action": ["kaputt", None, 42], "condition": ["auch kaputt"]}
    assert ablaufpruefung.pruefen(entry) == []
