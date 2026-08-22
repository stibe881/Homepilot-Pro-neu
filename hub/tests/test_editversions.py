"""Frühere Fassungen bearbeiteter Szenen und Abläufe.

Der Papierkorb fängt das Löschen ab - diese Tests sichern das Gegenstück
fürs Überschreiben: Vor jedem Speichern bleibt die alte Fassung liegen,
und sie lässt sich zurückholen, ohne dass dabei die jetzige verloren geht.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import editversions
from homepilot.core.hub import Hub

from .conftest import make_config


def test_versions_are_kept_per_item_and_capped():
    rows: list = []
    for lauf in range(8):
        rows = editversions.remember(
            rows, "automation", {"id": "a1", "alias": f"Fassung {lauf}"}, "stefan"
        )
    rows = editversions.remember(rows, "scene", {"id": "s1", "name": "Kino"}, "stefan")

    eigene = editversions.versions_of(rows, "automation", "a1")
    # Höchstens KEEP_PER_ITEM je Eintrag, jüngste zuerst.
    assert len(eigene) == editversions.KEEP_PER_ITEM
    assert eigene[0]["name"] == "Fassung 7"
    # Der Szenen-Eintrag zählt getrennt.
    assert len(editversions.versions_of(rows, "scene", "s1")) == 1
    # Und über den Zeitstempel ist jede Fassung wiederauffindbar.
    assert editversions.find(rows, "automation", "a1", eigene[2]["at"]) is eigene[2]


def test_saving_keeps_the_old_version_and_restore_brings_it_back():
    """Überschreiben soll so wenig endgültig sein wie Löschen."""
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        created = client.post(
            "/api/automations",
            json={
                "alias": "Abendlicht",
                "trigger": [{"type": "time", "at": "18:00"}],
                "action": [
                    {
                        "type": "command",
                        "entity_id": "demo.light_livingroom",
                        "command": "turn_on",
                    }
                ],
            },
        )
        assert created.status_code == 200
        automation_id = created.json()["automation"]["id"]

        geaendert = client.put(
            f"/api/automations/{automation_id}",
            json={
                "alias": "Abendlicht (kaputtgespielt)",
                "trigger": [{"type": "time", "at": "23:59"}],
                "action": [
                    {
                        "type": "command",
                        "entity_id": "demo.light_livingroom",
                        "command": "turn_off",
                    }
                ],
            },
        )
        assert geaendert.status_code == 200

        fassungen = client.get(f"/api/edit-history/automation/{automation_id}").json()[
            "versions"
        ]
        assert len(fassungen) == 1
        assert fassungen[0]["name"] == "Abendlicht"
        # Die Liste trägt keinen vollen Inhalt - nur Zeitpunkt und Urheber.
        assert "item" not in fassungen[0]

        wieder = client.post(
            f"/api/edit-history/automation/{automation_id}/restore",
            json={"at": fassungen[0]["at"]},
        )
        assert wieder.status_code == 200
        assert wieder.json()["restored"] == "Abendlicht"

        # Der Ablauf ist wieder der alte …
        rows = client.get("/api/automations").json()["automations"]
        meiner = next(row for row in rows if row["id"] == automation_id)
        assert meiner["alias"] == "Abendlicht"

        # … und die kaputtgespielte Fassung liegt ihrerseits als Fassung da:
        # Zurückholen ist selbst nicht endgültig.
        fassungen = client.get(f"/api/edit-history/automation/{automation_id}").json()[
            "versions"
        ]
        assert fassungen[0]["name"] == "Abendlicht (kaputtgespielt)"
