import pytest

from homepilot.core.entity import Entity, EntityKind
from homepilot.core.errors import UnknownEntityError
from homepilot.core.events import EventBus
from homepilot.core.registry import EntityRegistry


def make_light() -> Entity:
    return Entity(
        id="demo.light",
        kind=EntityKind.LIGHT,
        name="Testlicht",
        integration="demo",
        state={"state": "off"},
        commands=["turn_on"],
    )


async def test_add_and_get():
    registry = EntityRegistry(EventBus())
    await registry.add(make_light())
    assert registry.get("demo.light").name == "Testlicht"
    assert len(registry.all()) == 1


async def test_update_state_publishes_event():
    bus = EventBus()
    registry = EntityRegistry(bus)
    events = []
    bus.subscribe("state_changed", lambda t, d: events.append(d))

    await registry.add(make_light())
    await registry.update_state("demo.light", {"state": "on", "brightness": 50})

    assert len(events) == 1
    assert events[0]["old_state"] == {"state": "off"}
    assert events[0]["new_state"] == {"state": "on", "brightness": 50}
    assert registry.get("demo.light").state["brightness"] == 50


async def test_no_event_when_nothing_changed():
    bus = EventBus()
    registry = EntityRegistry(bus)
    events = []
    bus.subscribe("state_changed", lambda t, d: events.append(d))

    await registry.add(make_light())
    await registry.update_state("demo.light", {"state": "off"})
    assert events == []


async def test_unknown_entity_raises():
    registry = EntityRegistry(EventBus())
    with pytest.raises(UnknownEntityError):
        await registry.update_state("nope.nope", {"state": "on"})


async def test_room_provider_assigns_room():
    bus = EventBus()
    registry = EntityRegistry(bus)
    registry.rooms_provider = {"demo.light": ["Wohnzimmer"]}.get

    events = []
    bus.subscribe("entity_added", lambda t, d: events.append(d["entity"]))
    await registry.add(make_light())

    assert registry.get("demo.light").room == "Wohnzimmer"
    # Der Raum muss auch im Snapshot für die App stehen.
    assert events[0]["room"] == "Wohnzimmer"


async def test_ein_geraet_kann_in_mehreren_zimmern_zaehlen():
    """Punkt 539: Ein Klimafühler im offenen Wohnbereich gehört in beide
    Zimmer. Bisher gewann wortlos das zuletzt genannte."""
    bus = EventBus()
    registry = EntityRegistry(bus)
    registry.rooms_provider = {"demo.light": ["Wohnzimmer", "Esszimmer"]}.get

    events = []
    bus.subscribe("entity_added", lambda t, d: events.append(d["entity"]))
    await registry.add(make_light())

    entity = registry.get("demo.light")
    assert entity.rooms == ["Wohnzimmer", "Esszimmer"]
    # Der Standort bleibt das erste Zimmer - dort liegt seine Kachel.
    assert entity.room == "Wohnzimmer"
    assert events[0]["rooms"] == ["Wohnzimmer", "Esszimmer"]


async def test_ein_zimmer_aus_der_integration_steht_auch_in_der_liste():
    """Die meisten Integrationen setzen nur `room`. Ohne diese Zeile
    müsste jede Abfrage beide Felder zusammensuchen."""
    bus = EventBus()
    registry = EntityRegistry(bus)
    licht = make_light()
    licht.room = "Bad"
    await registry.add(licht)
    assert registry.get("demo.light").rooms == ["Bad"]


async def test_set_room_nimmt_mehrere_und_meldet_es_der_app():
    bus = EventBus()
    registry = EntityRegistry(bus)
    await registry.add(make_light())
    events = []
    bus.subscribe("state_changed", lambda t, d: events.append(d["entity"]))

    await registry.set_room("demo.light", ["Wohnzimmer", "Esszimmer"])
    assert registry.get("demo.light").rooms == ["Wohnzimmer", "Esszimmer"]
    assert events[-1]["rooms"] == ["Wohnzimmer", "Esszimmer"]

    # Ein einzelner Name geht weiter - so ruft die ältere App.
    await registry.set_room("demo.light", "Bad")
    assert registry.get("demo.light").rooms == ["Bad"]
    assert registry.get("demo.light").room == "Bad"

    # Und nichts nimmt es aus allen Zimmern.
    await registry.set_room("demo.light", None)
    assert registry.get("demo.light").rooms == []
    assert registry.get("demo.light").room is None


async def test_entity_without_room_stays_none():
    registry = EntityRegistry(EventBus())
    registry.rooms_provider = {}.get
    await registry.add(make_light())
    assert registry.get("demo.light").room is None


async def test_last_seen_follows_reporting_not_changing():
    """Ein Licht, das seit Tagen brennt, ist nicht «seit Tagen nicht gesehen».

    Der Fall aus dem Betrieb: Die Homematic meldet alle fünf Minuten
    denselben Zustand. Weil sich nichts *ändert*, blieb «zuletzt gesehen»
    auf dem letzten Schaltvorgang stehen – und die App zeigte bei einem
    kerngesunden Gerät «vor 7 Tagen».
    """
    registry = EntityRegistry(EventBus())
    await registry.add(make_light())
    await registry.update_state("demo.light", {"state": "on"})
    zuerst = registry.get("demo.light").last_seen
    assert zuerst is not None

    # Dieselbe Meldung noch einmal: kein Ereignis, aber ein Lebenszeichen.
    registry.get("demo.light").last_seen = zuerst - 3600
    await registry.update_state("demo.light", {"state": "on"})
    assert registry.get("demo.light").last_seen > zuerst - 3600


async def test_last_seen_stays_put_while_the_device_is_gone():
    registry = EntityRegistry(EventBus())
    await registry.add(make_light())
    await registry.update_state("demo.light", {"state": "on"})
    await registry.update_state("demo.light", {}, available=False)
    weg = registry.get("demo.light").last_seen

    # Der Abruf läuft weiter und meldet weiterhin «nicht erreichbar» –
    # das darf den Zeitpunkt nicht fortschreiben, sonst steht bei einem
    # seit Wochen toten Gerät «gerade eben».
    await registry.update_state("demo.light", {}, available=False)
    assert registry.get("demo.light").last_seen == weg


async def test_the_entity_remembers_why_it_changed():
    """«Warum ist das Licht um drei Uhr angegangen?»

    Die Antwort stand nur im Protokoll, einen eigenen Abruf je Gerät
    entfernt. Jetzt reist sie am Zustand mit - über dieselbe Leitung,
    die den Zustand ohnehin bringt.
    """
    from homepilot.core.source import as_source

    hub_registry = EntityRegistry(EventBus())
    await hub_registry.add(
        Entity(
            id="demo.licht",
            kind=EntityKind.LIGHT,
            name="Licht",
            integration="demo",
            state={"state": "off"},
        )
    )

    with as_source({"kind": "automation", "label": "Bewegung Flur"}):
        await hub_registry.update_state("demo.licht", {"state": "on"})
    licht = hub_registry.get("demo.licht")
    assert licht.last_source == {"kind": "automation", "label": "Bewegung Flur"}
    assert licht.last_change is not None
    gemerkt = licht.last_change

    # Eine neue Helligkeit am schon brennenden Licht ist kein Wechsel -
    # sonst stünde dort gleich «gerade eben», obwohl niemand geschaltet hat.
    await hub_registry.update_state("demo.licht", {"brightness": 40})
    assert hub_registry.get("demo.licht").last_change == gemerkt
    assert hub_registry.get("demo.licht").last_source["label"] == "Bewegung Flur"

    # Und was nicht über den Hub kam, meldet sich als Gerät - der
    # Wandschalter, die Hersteller-App, eine Zeitschaltung im Gerät.
    await hub_registry.update_state("demo.licht", {"state": "off"})
    assert hub_registry.get("demo.licht").last_source == {
        "kind": "device",
        "label": "Gerät",
    }


async def test_meta_marks_a_sensor_as_counting_only_for_its_room():
    """«Gilt für: nur diesen Raum» kommt aus dem Meta-Speicher.

    Vorgabe ist «das ganze Haus»; gespeichert wird nur die Abweichung,
    damit der Eintrag klein bleibt (siehe hub.set_entity_meta). Und sie
    muss im Schnappschuss für die App stehen - dort hängt die Zeile im
    Anpassen-Blatt daran.
    """
    registry = EntityRegistry(EventBus())
    registry.meta_provider = {"demo.light": {"room_only": True}}.get
    events: list[dict] = []
    registry.bus.subscribe("entity_added", lambda t, d: events.append(d["entity"]))
    await registry.add(make_light())

    assert registry.get("demo.light").room_only is True
    assert events[0]["room_only"] is True


async def test_a_sensor_counts_house_wide_unless_someone_says_otherwise():
    registry = EntityRegistry(EventBus())
    registry.meta_provider = {}.get
    await registry.add(make_light())
    assert registry.get("demo.light").room_only is False


async def test_meta_says_whether_a_contact_hangs_on_a_window_or_a_door():
    """Homematic meldet beides als «contact» - hier steht, was gilt.

    Geraten wird sonst am Namen, und ein Kontakt namens «Waschküche»
    galt damit als Fenster. Was jemand einträgt, muss stärker sein als
    das Raten - und alles ausser «window» und «door» heisst «weiss ich
    nicht».
    """
    registry = EntityRegistry(EventBus())
    registry.meta_provider = {"demo.light": {"contact_kind": "door"}}.get
    await registry.add(make_light())
    assert registry.get("demo.light").contact_kind == "door"

    zweite = EntityRegistry(EventBus())
    zweite.meta_provider = {"demo.light": {"contact_kind": "tuer"}}.get
    await zweite.add(make_light())
    assert zweite.get("demo.light").contact_kind is None
