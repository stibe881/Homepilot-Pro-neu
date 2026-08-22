"""Ein Gerät durch ein anderes ersetzen.

Der Wert dieser Funktion liegt nicht darin, dass sie eine Kennung
umschreibt - das kann jede Suchen-und-Ersetzen-Funktion. Er liegt darin,
dass sie KEINE Stelle vergisst. Nichts davon wirft nämlich einen Fehler:
Der Hub überspringt stillschweigend, was er nicht kennt, und man merkt es
Wochen später, wenn abends ein Licht nicht mehr angeht.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.core.replace import (
    swap_in_actions,
    swap_in_automation,
    swap_in_light_groups,
    swap_in_list,
    swap_in_rows,
)

from .conftest import make_config


def test_an_automation_is_rewritten_in_all_four_places():
    """Auslöser, Bedingung, Aktion und der Sonst-Zweig. Letzterer ist der,
    den man beim Suchen von Hand am ehesten übersieht."""
    # Die Einzahl-Form, in der die Abläufe wirklich gespeichert werden.
    ablauf = {
        "trigger": [{"entity_id": "hue.alt", "to": "on"}],
        "condition": [{"entity_id": "hue.alt", "state": "on"}],
        "action": [{"entity_id": "hue.alt", "command": "turn_on"}],
        "otherwise": [{"entity_id": "hue.alt", "command": "turn_off"}],
    }
    assert swap_in_automation(ablauf, "hue.alt", "hue.neu") == 4
    assert ablauf["trigger"][0]["entity_id"] == "hue.neu"
    assert ablauf["condition"][0]["entity_id"] == "hue.neu"
    assert ablauf["action"][0]["entity_id"] == "hue.neu"
    assert ablauf["otherwise"][0]["entity_id"] == "hue.neu"


def test_a_condition_group_is_rewritten_in_depth():
    """Bedingungsgruppen schachteln – ein flacher Durchlauf liesse genau
    die Verweise stehen, die in der Gruppe stecken."""
    ablauf = {
        "condition": [
            {
                "type": "group",
                "match": "any",
                "conditions": [
                    {"entity_id": "hue.alt", "equals": "on"},
                    {
                        "type": "group",
                        "conditions": [{"entity_id": "hue.alt", "equals": "off"}],
                    },
                ],
            }
        ],
    }
    assert swap_in_automation(ablauf, "hue.alt", "hue.neu") == 2
    gruppe = ablauf["condition"][0]
    assert gruppe["conditions"][0]["entity_id"] == "hue.neu"
    assert gruppe["conditions"][1]["conditions"][0]["entity_id"] == "hue.neu"


def test_untouched_entries_stay_untouched():
    """Ein Ersetzen, das Nachbareinträge mitnimmt, wäre schlimmer als
    keines - dann steht die halbe Wohnung falsch."""
    aktionen = [
        {"entity_id": "hue.alt", "command": "turn_on"},
        {"entity_id": "hue.andere", "command": "turn_on"},
        {"command": "scene"},
    ]
    assert swap_in_actions(aktionen, "hue.alt", "hue.neu") == 1
    assert aktionen[1]["entity_id"] == "hue.andere"


def test_a_lamp_keeps_its_place_in_a_combined_light():
    """In einer Deckenlampe mit fünf Spots ist die Reihenfolge die
    räumliche - die neue Lampe rutscht an die Stelle der alten, statt
    hinten angehängt zu werden."""
    leuchten = [{"members": ["hue.a", "hue.alt", "hue.c"]}]
    assert swap_in_light_groups(leuchten, "hue.alt", "hue.neu") == 1
    assert leuchten[0]["members"] == ["hue.a", "hue.neu", "hue.c"]


def test_a_favourite_does_not_become_a_duplicate():
    """Steht die neue Kennung schon in der Liste, fällt die alte weg -
    sonst stünde dieselbe Lampe zweimal in den Favoriten."""
    favoriten = ["hue.alt", "hue.neu"]
    assert swap_in_list(favoriten, "hue.alt", "hue.neu") == 1
    assert favoriten == ["hue.neu"]

    andere = ["hue.alt", "hue.x"]
    assert swap_in_list(andere, "hue.alt", "hue.neu") == 1
    assert andere == ["hue.neu", "hue.x"]


def test_rows_are_rewritten_by_their_id_field():
    zeilen = [{"entity_id": "hue.alt", "room": "Küche"}, {"entity_id": "hue.x"}]
    assert swap_in_rows(zeilen, "hue.alt", "hue.neu") == 1
    assert zeilen[0] == {"entity_id": "hue.neu", "room": "Küche"}


def _hub():
    return Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
            integrations=[{"integration": "demo"}],
        )
    )


def test_replacing_moves_scene_automation_and_room_in_one_go():
    """Der ganze Weg: Was in Szene, Ablauf und Raumzuordnung stand, zeigt
    danach auf das neue Gerät - und der Hub schaltet es sofort, ohne
    Neustart."""
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        alt = "demo.light_livingroom"
        neu = "demo.light_bedroom"

        client.post(
            "/api/scenes",
            json={
                "id": "abend",
                "name": "Abend",
                "actions": [{"entity_id": alt, "command": "turn_on"}],
            },
            headers=headers,
        )
        client.post(
            "/api/automations",
            json={
                "alias": "Licht an",
                "trigger": [{"entity_id": alt, "to": "on"}],
                "action": [{"entity_id": alt, "command": "turn_on"}],
            },
            headers=headers,
        )
        client.put(f"/api/entities/{alt}/room", json={"room": "Stube"}, headers=headers)

        antwort = client.post(f"/api/entities/{alt}/replace/{neu}", headers=headers)
        assert antwort.status_code == 200
        geaendert = antwort.json()["changed"]
        assert geaendert["Szenen"] == 1
        assert geaendert["Abläufe"] == 2
        assert geaendert["Raumzuordnung"] == 1

        szene = client.get("/api/scenes", headers=headers).json()[0]
        assert szene["entity_ids"] == [neu]

        ablauf = client.get("/api/automations", headers=headers).json()["automations"][0]
        assert ablauf["triggers"][0]["entity_id"] == neu
        assert ablauf["actions"][0]["entity_id"] == neu


        # Der Raum sitzt danach am neuen Gerät, nicht nur in der Datei.
        entities = {e["id"]: e for e in client.get("/api/entities", headers=headers).json()}
        assert entities[neu]["room"] == "Stube"


def test_replacing_refuses_the_impossible():
    hub = _hub()
    with TestClient(create_app(hub)) as client:
        headers = {"Authorization": "Bearer t-stefan"}
        assert (
            client.post(
                "/api/entities/demo.light_livingroom/replace/demo.light_livingroom",
                headers=headers,
            ).status_code
            == 400
        )
        assert (
            client.post(
                "/api/entities/demo.light_livingroom/replace/gibt.es.nicht",
                headers=headers,
            ).status_code
            == 404
        )


def test_orphaned_entries_are_found_but_offline_integrations_are_spared():
    """Verwaist heisst: Gerät weg, Integration läuft. Eine Bridge, die
    heute nicht hochkam, darf ihre Namen und Räume behalten."""
    from homepilot.core.replace import stale_entity_rows

    rows = [
        {"entity_id": "hue.alt", "room": "Stube"},        # hue läuft, Gerät weg
        {"entity_id": "hue.neu", "room": "Stube"},        # existiert
        {"entity_id": "ring.tuer", "room": "Eingang"},    # ring ist heute aus
        {"entity_id": "", "room": "kaputt"},
    ]
    weg = stale_entity_rows(rows, known={"hue.neu"}, loaded={"hue", "demo"})
    assert weg == ["hue.alt"]


def test_cleanup_endpoint_removes_only_true_orphans():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        hub.data.set(
            "entity_meta",
            [
                {"entity_id": "demo.gibtsnicht", "name": "Alt"},
                {"entity_id": "demo.light_livingroom", "name": "Stehlampe"},
                {"entity_id": "ring.tuer", "name": "Klingel"},  # ring läuft nicht
            ],
        )
        orphans = client.get("/api/entities/orphans").json()
        assert orphans["meta"] == ["demo.gibtsnicht"]

        result = client.post("/api/entities/orphans/cleanup").json()
        assert result["removed"] == {"entity_meta": 1}
        rest = {row["entity_id"] for row in hub.data.get("entity_meta")}
        assert rest == {"demo.light_livingroom", "ring.tuer"}
