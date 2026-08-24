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
