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
