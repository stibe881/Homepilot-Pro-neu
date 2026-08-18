

def test_find_conflicts_spots_opposing_actions():
    """Wenn nachts das Licht von selbst angeht, sucht man genau diese
    Liste - und findet sie sonst erst nach einer halben Stunde Lesen."""
    from homepilot.core.automation import find_conflicts, parse_automations

    automations = parse_automations(
        [
            {
                "id": "a",
                "alias": "Abends an",
                "trigger": [{"type": "time", "at": "18:00"}],
                "action": [
                    {"type": "command", "entity_id": "hue.wohnzimmer", "command": "turn_on"}
                ],
            },
            {
                "id": "b",
                "alias": "Nachts aus",
                "trigger": [{"type": "time", "at": "23:00"}],
                "action": [
                    {"type": "command", "entity_id": "hue.wohnzimmer", "command": "turn_off"}
                ],
            },
            {
                "id": "c",
                "alias": "Anderes Gerät",
                "trigger": [{"type": "time", "at": "07:00"}],
                "action": [
                    {"type": "command", "entity_id": "hue.buero", "command": "turn_off"}
                ],
            },
        ]
    )
    conflicts = find_conflicts(automations)
    assert len(conflicts) == 1
    assert conflicts[0]["entity_id"] == "hue.wohnzimmer"
    assert conflicts[0]["commands"] == ["turn_on/turn_off"]
    assert {row["alias"] for row in conflicts[0]["automations"]} == {"Abends an", "Nachts aus"}


def test_opposing_pairs():
    from homepilot.core.automation import opposing

    assert opposing("open", "close")
    assert opposing("unlock", "lock")
    assert not opposing("turn_on", "turn_on")
    assert not opposing("turn_on", "open")
