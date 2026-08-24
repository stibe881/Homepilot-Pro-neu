"""Geofence: die Sammelfrage «ist noch jemand zuhause?».

Die Einzelzustände je Person gab es schon. Was fehlte, war die Antwort
auf die Frage, nach der ein Ablauf tatsächlich fragt - «alles aus» hängt
nicht an Stefan, sondern daran, dass niemand mehr da ist.
"""

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.integrations.geofence import GeofenceIntegration


async def make_geofence() -> tuple[Hub, GeofenceIntegration]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    integration = GeofenceIntegration(
        hub,
        {
            "integration": "geofence",
            "zones": [
                {"id": "stefan", "name": "Stefan"},
                {"id": "livia", "name": "Livia"},
            ],
        },
    )
    await integration.setup()
    return hub, integration


async def test_anyone_home_folgt_den_personen() -> None:
    hub, geo = await make_geofence()
    try:
        sammel = hub.registry.get("geofence.anyone_home")
        assert sammel is not None
        # Noch hat niemand gemeldet: Nichtwissen zählt als «da».
        assert sammel.state["state"] == "on"

        await geo.report("stefan", "leave")
        assert hub.registry.get("geofence.anyone_home").state["state"] == "on"

        # Erst wenn beide ausdrücklich weg sind, wird es «off».
        await geo.report("livia", "leave")
        sammel = hub.registry.get("geofence.anyone_home")
        assert sammel.state["state"] == "off"
        assert sorted(sammel.state["away"]) == ["Livia", "Stefan"]

        # Und einer, der zurückkommt, genügt für «on».
        await geo.report("livia", "enter")
        assert hub.registry.get("geofence.anyone_home").state["state"] == "on"
    finally:
        await hub.stop()


async def test_anyone_home_meldet_nur_echte_wechsel() -> None:
    """Sonst liefe «alles aus» bei jeder Ortsmeldung erneut.

    Wer schon weg ist und im Vorbeifahren die Quartierszone verlässt,
    schickt eine weitere Meldung - der Zustand ändert sich dabei nicht.
    Ein Ablauf darauf würde den Saugroboter ein zweites Mal losschicken.
    """
    hub, geo = await make_geofence()
    try:
        await geo.report("stefan", "leave")
        await geo.report("livia", "leave")
        vorher = hub.registry.get("geofence.anyone_home").state
        stempel = vorher.get("changed_at")

        await geo.report("stefan", "leave", place="quartier")
        nachher = hub.registry.get("geofence.anyone_home").state
        assert nachher["state"] == "off"
        assert nachher.get("changed_at") == stempel
    finally:
        await hub.stop()


# ── Das WLAN entscheidet nichts ──────────────────────────────────────────
#
# Auf der Startseite stand «jemand da», während das Fenster darunter
# niemanden führte: Der Chip las den WLAN-Fühler, die Liste die Ortung.
# Seither gibt es genau eine Quelle, und diese Tests halten sie fest.


async def test_a_device_in_the_wifi_does_not_make_a_person_present() -> None:
    """Früher schlug eine frische UniFi-Anmeldung die Ortsmeldung.

    Genau daran zerbrach die Anzeige: Das iPad hängt auch dann im WLAN,
    wenn alle weg sind. «Weg» muss «weg» bleiben.
    """
    import time

    from homepilot.core.entity import Entity, EntityKind

    hub, geo = await make_geofence()
    try:
        await hub.registry.add(
            Entity(
                id="unifi.iphone_stefan",
                kind=EntityKind.BINARY_SENSOR,
                name="iPhone Stefan",
                integration="unifi",
                state={"state": "on", "changed_at": time.time()},
            )
        )
        await geo.report("stefan", "leave")
        zusammen = geo.merged("stefan")
        assert zusammen["state"] == "away"
        assert zusammen["source"] == "geofence"
    finally:
        await hub.stop()


async def test_an_old_wifi_option_does_not_stop_the_hub_from_starting() -> None:
    """Wer `wifi:` noch in der config.yaml hat, soll starten können."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    try:
        integration = GeofenceIntegration(
            hub,
            {
                "integration": "geofence",
                "zones": [{"id": "stefan", "name": "Stefan", "wifi": "unifi.iphone"}],
            },
        )
        await integration.setup()
        await integration.report("stefan", "leave")
        assert integration.merged("stefan")["state"] == "away"
    finally:
        await hub.stop()


async def test_the_unifi_collection_sensor_no_longer_claims_to_be_presence() -> None:
    """`unifi.anyone_home` heisst «Geräte im WLAN» und trägt
    `device_class: connectivity` – damit sucht niemand mehr dort nach
    Anwesenheit. Die Kennung bleibt, sonst brechen alte Abläufe."""
    from homepilot.integrations.unifi import UnifiIntegration

    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    try:
        unifi = UnifiIntegration(
            hub,
            {
                "integration": "unifi",
                "host": "10.0.0.1",
                "username": "u",
                "password": "p",
                "track": [{"mac": "aa:bb:cc:dd:ee:ff", "name": "iPhone Stefan"}],
            },
        )
        # Anmelden und Abfragen brauchen einen Controller, den es hier
        # nicht gibt; die Entitäten legt setup() auch ohne ihn an.
        async def kein_login() -> None:
            return None

        unifi._login = kein_login  # type: ignore[method-assign]
        unifi.start_polling = lambda *a, **k: None  # type: ignore[method-assign]
        await unifi.setup()

        entity = hub.registry.get("unifi.anyone_home")
        assert entity is not None
        assert entity.name == "Geräte im WLAN"
        assert entity.state["device_class"] == "connectivity"
        # Und nichts daran nennt sich «zuhause».
        assert "zuhause" not in entity.name.lower()
    finally:
        await hub.stop()


# ── Ein Neustart macht niemanden verschollen ─────────────────────────────
#
# Der gemeldete Fall: «Das habe ich schon mehrmals gemacht. Dann
# funktioniert es und plötzlich – vielleicht nach dem Update oder nach
# dem Neustart vom Hub – steht wieder ‹Hat sich noch nie gemeldet›.»
#
# Der Grund: Das Telefon meldet nur Übertritte. Wer zuhause sitzt,
# kreuzt keine Zonengrenze, und der Hub legte die Zone bei jedem Start
# bei null an.


async def _hub_mit_zonen(daten=None):
    from homepilot.core.config import ApiConfig, HubConfig

    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    if daten is not None:
        hub.data.set("presence_last", daten)
    geo = GeofenceIntegration(
        hub,
        {"integration": "geofence", "zones": [{"id": "stefan", "name": "Stefan"}]},
    )
    await geo.setup()
    return hub, geo


async def test_nach_dem_neustart_ist_wer_zuhause_war_noch_zuhause() -> None:
    hub, geo = await _hub_mit_zonen()
    try:
        await geo.report("stefan", "enter", place="home", battery=80)
        gemerkt = hub.data.get("presence_last")
        assert gemerkt and gemerkt[0]["state"] == "home"
    finally:
        await hub.stop()

    # Neustart: derselbe gespeicherte Stand, frischer Hub.
    hub, geo = await _hub_mit_zonen(gemerkt)
    try:
        entity = hub.registry.get("geofence.stefan")
        assert entity.state["state"] == "home"
        assert entity.state["source"] == "geofence"
        assert entity.state["battery"] == 80
        # Und die Diagnose behauptet nicht mehr, es sei nie etwas gekommen.
        assert "noch nie gemeldet" not in geo.diagnose()[0]["hint"]
        # Auch die Orte, in denen die Zone steckt, sind zurück.
        assert geo._inside["stefan"] == ["home"]
    finally:
        await hub.stop()


async def test_ein_alter_stand_wird_nicht_wiederbelebt() -> None:
    """Ein Hub, der eine Woche stand, soll niemanden zuhause wähnen."""
    import time as zeit

    alt = [
        {
            "zone": "stefan",
            "state": "home",
            "place": "home",
            "source": "geofence",
            "changed_at": zeit.time() - 20 * 3600,
        }
    ]
    hub, geo = await _hub_mit_zonen(alt)
    try:
        assert hub.registry.get("geofence.stefan").state["state"] == "unknown"
        assert geo._inside["stefan"] == []
    finally:
        await hub.stop()


async def test_ohne_gemerkten_stand_bleibt_es_beim_ehrlichen_unbekannt() -> None:
    hub, geo = await _hub_mit_zonen()
    try:
        entity = hub.registry.get("geofence.stefan")
        assert entity.state["state"] == "unknown"
        assert entity.state["source"] == "none"
        assert "noch nie gemeldet" in geo.diagnose()[0]["hint"]
    finally:
        await hub.stop()


async def test_der_ort_von_life360_ueberlebt_den_neustart() -> None:
    hub, geo = await _hub_mit_zonen()
    try:
        await geo.report(
            "stefan", "enter", place="tanners_home",
            source="life360", place_name="Tanners Home",
        )
        gemerkt = hub.data.get("presence_last")
    finally:
        await hub.stop()

    hub, _ = await _hub_mit_zonen(gemerkt)
    try:
        zustand = hub.registry.get("geofence.stefan").state
        assert zustand["state"] == "tanners_home"
        assert zustand["place_name"] == "Tanners Home"
        assert zustand["source"] == "life360"
    finally:
        await hub.stop()


# ── Zonen aus der Benutzerliste ──────────────────────────────────────────
#
# Bis hierher musste jede Person zweimal angelegt werden: einmal als
# Benutzer in der App, einmal als Zone in der config.yaml. Wer das zweite
# vergass - und das vergisst jeder -, bekam beim Melden «Der Hub kennt
# keine Zone». Zwei Listen derselben Menschen an zwei Orten zu pflegen ist
# eine Aufgabe, die niemand gewinnt.

from dataclasses import dataclass

from homepilot.integrations.geofence import (
    zonen_aus_benutzern,
    zonen_zusammenfuehren,
    zonenkennung,
)


@dataclass
class FakeUser:
    name: str
    role: str = "bewohner"
    system: bool = False
    shared: bool = False


def test_the_zone_id_is_the_first_name_lowercased():
    # Genau diese Regel rechnet auch die App aus. Weichen die beiden
    # voneinander ab, meldet jedes Telefon an eine Zone, die es nicht gibt.
    assert zonenkennung("Bine") == "bine"
    assert zonenkennung("Stefan Gross") == "stefan"
    assert zonenkennung("  Livia  ") == "livia"


def test_umlauts_become_something_a_url_survives():
    assert zonenkennung("Björn") == "bjoern"
    assert zonenkennung("Müller") == "mueller"
    assert zonenkennung("Zoë") == "zoe"
    assert zonenkennung("Anne-Marie") == "annemarie"
    assert zonenkennung("") == ""
    assert zonenkennung("!!!") == ""


def test_only_people_get_a_zone():
    # Ein Gast ortet nicht (in der App ist die Ortung für ihn aus), das
    # Wandtablet ist kein Mensch, und das Systemtoken erst recht nicht.
    # Für sie stünde nur ein ewiges «unbekannt» in der Übersicht.
    zonen = zonen_aus_benutzern(
        [
            FakeUser("Stefan", role="besitzer"),
            FakeUser("Bine", role="bewohner"),
            FakeUser("Onkel Kurt", role="gast"),
            FakeUser("Wandtablet", shared=True),
            FakeUser("Hub-Token", system=True),
        ]
    )
    assert zonen == [
        {"id": "stefan", "name": "Stefan"},
        {"id": "bine", "name": "Bine"},
    ]


def test_two_people_with_the_same_first_name_do_not_collide():
    # Die zweite Livia bekäme sonst die Zone der ersten - und beide
    # Telefone schrieben in denselben Zustand.
    zonen = zonen_aus_benutzern([FakeUser("Livia"), FakeUser("Livia Meier")])
    assert [zone["id"] for zone in zonen] == ["livia"]


def test_the_config_wins_over_the_derived_zone():
    # Wer in der config.yaml einen anderen Namen hinterlegt hat, hat das
    # mit Absicht getan.
    zusammen = zonen_zusammenfuehren(
        [{"id": "stefan", "name": "Stefan (Handy)"}],
        [{"id": "stefan", "name": "Stefan"}, {"id": "bine", "name": "Bine"}],
    )
    assert zusammen == [
        {"id": "stefan", "name": "Stefan (Handy)"},
        {"id": "bine", "name": "Bine"},
    ]


async def _hub_mit_benutzern(users, zones=None):
    from homepilot.core.config import ApiConfig, HubConfig

    hub = Hub(
        HubConfig(api=ApiConfig(), integrations=[], automations=[], users=users)
    )
    await hub.start()
    config: dict = {"integration": "geofence"}
    if zones is not None:
        config["zones"] = zones
    geo = GeofenceIntegration(hub, config)
    await geo.setup()
    return hub, geo


async def test_users_alone_are_enough_to_start() -> None:
    """Ohne 'zones:' in der config.yaml - der häufigste Fall."""
    hub, geo = await _hub_mit_benutzern(
        [
            {"name": "Stefan", "role": "besitzer", "token": "t1"},
            {"name": "Bine", "role": "bewohner", "token": "t2"},
        ]
    )
    try:
        assert sorted(geo.zone_ids()) == ["bine", "stefan"]
        assert hub.registry.get("geofence.bine") is not None
        assert await geo.report("bine", "enter") == "home"
    finally:
        await hub.stop()


async def test_a_new_housemate_needs_no_restart() -> None:
    """Der Fall, um den es geht: Benutzer in der App angelegt, Telefon
    meldet - und der Hub weist es ab, weil die Zone erst beim nächsten
    Start entstünde."""
    from homepilot.core.users import User

    hub, geo = await _hub_mit_benutzern(
        [{"name": "Stefan", "role": "besitzer", "token": "t1"}]
    )
    try:
        assert geo.zone_ids() == ["stefan"]
        hub.users.add(User(name="Bine", role="bewohner", token="t2", editable=True))
        # Kein Neustart, kein Eingriff in die config.yaml: Die Meldung
        # selbst legt die Zone an.
        assert await geo.report("bine", "enter") == "home"
        assert hub.registry.get("geofence.bine") is not None
    finally:
        await hub.stop()


async def test_a_departed_user_loses_the_zone_but_the_config_keeps_hers() -> None:
    """Eine stehengebliebene Zone auf «zuhause» hiesse: «niemand mehr
    zuhause» tritt nie wieder ein."""
    from homepilot.core.users import User

    hub, geo = await _hub_mit_benutzern(
        [{"name": "Stefan", "role": "besitzer", "token": "t1"}],
        zones=[{"id": "gast", "name": "Gästezimmer"}],
    )
    try:
        # In der App angelegt (editable) - nur so lässt er sich auch
        # wieder entfernen; wer in der config.yaml steht, bleibt dort.
        hub.users.add(User(name="Bine", role="bewohner", token="t2", editable=True))
        await geo._zonen_abgleichen()
        assert sorted(geo.zone_ids()) == ["bine", "gast", "stefan"]

        hub.users.remove("Bine")
        await geo._zonen_abgleichen()
        assert sorted(geo.zone_ids()) == ["gast", "stefan"]
        assert hub.registry.get("geofence.bine") is None
        # Was in der config.yaml steht, bleibt - dort hat es jemand
        # hingeschrieben, und keine Benutzerliste darf es wegräumen.
        assert hub.registry.get("geofence.gast") is not None
    finally:
        await hub.stop()
