

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


def test_an_automation_from_the_file_can_be_copied_into_the_app():
    """Der fehlende Weg von der config.yaml zur Bedienbarkeit.

    Was in der Datei steht, ist in der App absichtlich nur lesbar. Bisher
    endete das dort: «Nur in der App angelegte Abläufe lassen sich
    kopieren». Damit war jeder Ablauf aus der Datei ein Ablauf, den man
    nur am Rechner ändern konnte.
    """
    from fastapi.testclient import TestClient

    from homepilot.api import create_app
    from homepilot.core.hub import Hub

    from .conftest import make_config

    aus_datei = {
        "id": "flurlicht",
        "alias": "Flurlicht",
        "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
        "action": [
            {"type": "command", "entity_id": "demo.light_livingroom", "command": "turn_on"}
        ],
    }
    hub = Hub(make_config(automations=[aus_datei]))
    with TestClient(create_app(hub)) as client:
        original = {
            entry["id"]: entry for entry in client.get("/api/automations").json()["automations"]
        }["flurlicht"]
        assert original["editable"] is False

        kopie = client.post("/api/automations/flurlicht/duplicate").json()["automation"]
        assert kopie["alias"] == "Flurlicht (Kopie)"
        assert kopie["id"].startswith("app_")
        # Ausgeschaltet: Sonst liefe derselbe Ablauf ab sofort zweimal.
        assert kopie["enabled"] is False

        danach = {entry["id"]: entry for entry in client.get("/api/automations").json()["automations"]}
        assert danach[kopie["id"]]["editable"] is True
        # Das Original in der Datei bleibt, wie es war.
        assert danach["flurlicht"]["editable"] is False
        assert danach["flurlicht"]["enabled"] is True

        # Was es nirgends gibt, bleibt ein sauberes 404.
        assert client.post("/api/automations/gibtsnicht/duplicate").status_code == 404
