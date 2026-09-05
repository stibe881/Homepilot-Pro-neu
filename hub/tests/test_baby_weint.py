"""Die eingebaute Nachricht «Ein Baby weint».

Der Fall dahinter, wörtlich gemeldet: «Wenn ein Baby weint, bekomme ich
keinen Push.» Die Kamera hörte das Weinen, der Hub führte das Feld - und
trotzdem kam nichts an, weil die Nachricht an einem selbst gebauten
Ablauf hing. Ein Ablauf ist eine Verdrahtung, die man versehentlich
falsch setzt - dieselbe Geschichte wie bei der Klingel (test_klingel.py),
also dieselbe Antwort: Die Nachricht ist eingebaut.

Und sie läuft nicht in der Minuten-Runde mit: Ein Baby, das weint, hat
keine Minute Zeit.
"""

import asyncio

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.core.watchdog import Watchdog


async def _hub_mit_kamera() -> tuple[Hub, Watchdog, list]:
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    await hub.registry.add(
        Entity(
            id="unifi_protect.kinderzimmer",
            kind=EntityKind.CAMERA,
            name="Kinderzimmer",
            integration="unifi_protect",
            state={"state": "online", "detected_baby_cry": "off"},
            commands=["set_privacy"],
            room="Linas Zimmer",
        )
    )
    wache = Watchdog(hub)
    gemeldet: list = []

    async def merken(title, body, category="outage", to=None, data=None, entity_id=None):
        gemeldet.append(
            {
                "title": title,
                "body": body,
                "category": category,
                "data": data,
                "entity_id": entity_id,
            }
        )

    wache._notify = merken  # type: ignore[method-assign]
    wache.start()
    return hub, wache, gemeldet


async def test_a_crying_baby_reaches_the_phone_without_an_automation():
    hub, wache, gemeldet = await _hub_mit_kamera()
    try:
        await hub.registry.update_state(
            "unifi_protect.kinderzimmer", {"detected_baby_cry": "on"}
        )
        # Der Bus ruft synchron, die Nachricht geht als eigene Aufgabe
        # hinaus - ihr einmal Zeit lassen.
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(gemeldet) == 1
        # Der Raum steht im Titel: Er sagt, wohin man geht.
        assert gemeldet[0]["title"] == "Ein Baby weint: Linas Zimmer"
        assert gemeldet[0]["category"] == "baby_cry"
        assert gemeldet[0]["data"] == {
            "type": "baby_cry",
            "entity_id": "unifi_protect.kinderzimmer",
        }
        # Über das Gerät setzt _notify das Ziel: die Kamera im Vollbild.
        assert gemeldet[0]["entity_id"] == "unifi_protect.kinderzimmer"
    finally:
        await wache.stop()
        await hub.stop()


async def test_without_a_room_the_camera_name_says_where():
    hub, wache, gemeldet = await _hub_mit_kamera()
    try:
        await hub.registry.add(
            Entity(
                id="unifi_protect.stubenkamera",
                kind=EntityKind.CAMERA,
                name="Stubenkamera",
                integration="unifi_protect",
                state={"state": "online", "detected_baby_cry": "off"},
                commands=["set_privacy"],
            )
        )
        await hub.registry.update_state(
            "unifi_protect.stubenkamera", {"detected_baby_cry": "on"}
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(gemeldet) == 1
        assert gemeldet[0]["title"] == "Ein Baby weint: Stubenkamera"
    finally:
        await wache.stop()
        await hub.stop()


async def test_the_same_detection_is_reported_once():
    """Solange das Feld auf «on» steht, läuft jede weitere Meldung der
    Kamera durch denselben Weg. Ohne Gedächtnis käme eine Nachricht je
    Meldung."""
    hub, wache, gemeldet = await _hub_mit_kamera()
    try:
        await hub.registry.update_state(
            "unifi_protect.kinderzimmer", {"detected_baby_cry": "on"}
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await hub.registry.update_state(
            "unifi_protect.kinderzimmer",
            {"detected_baby_cry": "on", "motion": "on"},
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(gemeldet) == 1
    finally:
        await wache.stop()
        await hub.stop()


async def test_short_sobs_do_not_multiply_the_message():
    """Protect meldet ein anhaltendes Weinen als mehrere kurze
    Ereignisse: an, aus, an, aus. Die Sperrfrist macht daraus eine
    Nachricht."""
    hub, wache, gemeldet = await _hub_mit_kamera()
    try:
        for _ in range(4):
            await hub.registry.update_state(
                "unifi_protect.kinderzimmer", {"detected_baby_cry": "on"}
            )
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            await hub.registry.update_state(
                "unifi_protect.kinderzimmer", {"detected_baby_cry": "off"}
            )
            await asyncio.sleep(0)
        assert len(gemeldet) == 1
    finally:
        await wache.stop()
        await hub.stop()


async def test_after_the_pause_a_still_crying_baby_is_reported_again():
    """Nach der Sperrfrist ist die Nachricht wieder scharf - hier wird
    die Uhr zurückgedreht, statt im Test zwei Minuten zu warten."""
    from homepilot.core.watchrules import WEIN_SPERRE

    hub, wache, gemeldet = await _hub_mit_kamera()
    try:
        await hub.registry.update_state(
            "unifi_protect.kinderzimmer", {"detected_baby_cry": "on"}
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(gemeldet) == 1

        await hub.registry.update_state(
            "unifi_protect.kinderzimmer", {"detected_baby_cry": "off"}
        )
        await asyncio.sleep(0)
        wache._wein_gemeldet["unifi_protect.kinderzimmer"] -= WEIN_SPERRE + 1

        await hub.registry.update_state(
            "unifi_protect.kinderzimmer", {"detected_baby_cry": "on"}
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(gemeldet) == 2
    finally:
        await wache.stop()
        await hub.stop()


async def test_other_detections_stay_quiet():
    """Bewegung und eine erkannte Person sind kein Weinen."""
    hub, wache, gemeldet = await _hub_mit_kamera()
    try:
        await hub.registry.update_state(
            "unifi_protect.kinderzimmer",
            {"motion": "on", "detected_person": "on"},
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert gemeldet == []
    finally:
        await wache.stop()
        await hub.stop()


def test_the_rule_can_be_switched_off_like_the_others():
    from homepilot.core import notifyrules, push

    schluessel = [regel["key"] for regel in notifyrules.describe(None)]
    assert "baby_cry" in schluessel
    assert "baby_cry" in push.CATEGORIES
    # Bei der Familie, nicht im Sammeltopf: Gesucht wird die Nachricht
    # dort, wo die Kinder sind.
    regel = next(r for r in notifyrules.describe(None) if r["key"] == "baby_cry")
    assert regel["group"] == "Familie"


def test_the_message_is_urgent_and_must_come_at_night():
    """Genau die Nachricht, die nachts durchkommen muss - sie darf nie
    in der leisen Klasse landen (core/push.py: LEISE)."""
    from homepilot.core.push import LEISE, dringlichkeit

    assert "baby_cry" not in LEISE
    stufe = dringlichkeit("baby_cry")
    assert stufe["priority"] == "high"
    assert stufe["interruptionLevel"] == "time-sensitive"


def test_a_tap_opens_the_camera():
    """Man will sehen und hören, was im Zimmer los ist - der Tipp führt
    ins Kamera-Vollbild, nicht bloss in die App."""
    from homepilot.core.pushziel import ziel_fuer

    assert (
        ziel_fuer("baby_cry", "unifi_protect.kinderzimmer")
        == "kamera:unifi_protect.kinderzimmer"
    )
    # Ohne Gerät bleibt die Startseite - besser als gar kein Ziel.
    assert ziel_fuer("baby_cry") == "start"


# ── Der Riegel an der letzten Stelle ────────────────────────────────────

from homepilot.core.watchrules import WEIN_SPERRE, wein_gesperrt


def test_a_second_message_within_the_pause_is_blocked():
    jetzt = 1_700_000_000.0
    assert wein_gesperrt(jetzt, jetzt + 0.2) is True
    assert wein_gesperrt(jetzt, jetzt + WEIN_SPERRE - 0.1) is True


def test_a_baby_still_crying_after_the_pause_gets_through():
    jetzt = 1_700_000_000.0
    assert wein_gesperrt(jetzt, jetzt + WEIN_SPERRE) is False


def test_the_first_cry_is_never_blocked():
    assert wein_gesperrt(None, 1_700_000_000.0) is False
