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
                "conditions": [{"type": "wetter"}],
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


def test_die_kontext_bedingungen_gelten_als_bekannt():
    """Punkt 594 der Werkbank: «nur wenn Livia daheim ist» wurde beim
    Speichern abgewiesen, weil die vier Kontext-Bedingungen einen Tag
    nach dieser Liste in den Motor kamen."""
    entry = {
        "condition": [
            {"type": "presence", "person": "livia", "state": "present"},
            {"type": "availability", "entity_id": "x", "available": True},
            {"type": "weather_warning", "active": True},
            {"type": "calendar", "contains": "Gäste"},
        ]
    }
    assert ablaufpruefung.pruefen(entry) == []


def test_die_bedingungsliste_deckt_alle_zweige_des_motors():
    """Die Liste ist bewusst von Hand gepflegt (siehe Modulkommentar) -
    dieser Test sagt, wenn der Motor einen Zweig kennt, den sie nicht
    kennt, und umgekehrt."""
    import inspect
    import re

    from homepilot.core.automation import AutomationEngine

    quelle = inspect.getsource(AutomationEngine._check_condition)
    zweige = set(re.findall(r'if ctype == "([a-z_]+)"', quelle))
    assert zweige == set(ablaufpruefung.CONDITION_TYPES)


def test_die_bedingungen_einer_verzweigung_werden_geprueft():
    """Der Motor liest am «wenn»-Schritt ``conditions`` - die Prüfung
    las ``condition`` und sah darum nie hinein (Punkt 594)."""
    entry = {
        "action": [{"type": "if", "conditions": [{"type": "quatsch"}], "then": []}]
    }
    fehler = ablaufpruefung.pruefen(entry)
    assert len(fehler) == 1 and "quatsch" in fehler[0]
    assert "action[0].conditions[0]" in fehler[0]
