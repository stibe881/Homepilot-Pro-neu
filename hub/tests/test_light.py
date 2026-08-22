"""Licht-Schritt: Helligkeit, Farbe, Weissanteil – und die Anpassung an die Lux.

Der Fall dahinter: Ein Bewegungslicht kannte nur «an» und eine feste
Prozentzahl. Nachts blendet dieselbe Zahl, die am trüben Nachmittag
unsichtbar ist – dabei misst der Melder die Umgebungshelligkeit längst.
"""

import asyncio

import pytest

from homepilot.core.automation import describe_action, find_conflicts, parse_automations
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity
from homepilot.core.hub import Hub
from homepilot.core.light import FULL_LUX, MAX_PERCENT, MIN_PERCENT, brightness_from_lux


def test_stockdunkel_gibt_das_minimum():
    # Der Gang zur Toilette um drei braucht ein Nachtlicht, kein Flutlicht.
    assert brightness_from_lux(0) == MIN_PERCENT
    assert brightness_from_lux(-3) == MIN_PERCENT


def test_heller_tag_gibt_die_volle_lampe():
    # Gegen Tageslicht kommt eine gedimmte Lampe nicht an.
    assert brightness_from_lux(FULL_LUX) == MAX_PERCENT
    assert brightness_from_lux(5000) == MAX_PERCENT


def test_dazwischen_steigt_es_an():
    stufen = [brightness_from_lux(lux) for lux in (0, 2, 10, 40, 100, 150)]
    assert stufen == sorted(stufen)
    # Und keine Stufe fällt aus dem erlaubten Bereich.
    assert all(MIN_PERCENT <= wert <= MAX_PERCENT for wert in stufen)


def test_logarithmisch_statt_linear():
    # Von 1 auf 10 Lux ist gefühlt derselbe Sprung wie von 10 auf 100 –
    # beide Verzehnfachungen bekommen darum ähnlich viel Kennlinie. Linear
    # gerechnet wären es 6 gegen 51 Prozentpunkte, und die halbe Kurve läge
    # in einem Bereich, in dem ohnehin kein Licht nötig ist.
    unten = brightness_from_lux(10) - brightness_from_lux(1)
    oben = brightness_from_lux(100) - brightness_from_lux(10)
    assert 0.5 <= unten / oben <= 2


def test_unsinn_macht_die_lampe_nicht_dunkel():
    # Lieber volle Helligkeit als eine Lampe, die wegen eines kaputten
    # Messwerts scheinbar nicht reagiert.
    assert brightness_from_lux(float("nan")) == MIN_PERCENT
    assert brightness_from_lux("keine Zahl") == MAX_PERCENT  # type: ignore[arg-type]


def test_beschreibung_nennt_die_anpassung():
    zeile = describe_action(
        {"type": "light", "entity_id": "hue.flur", "brightness": "adaptive"}
    )
    assert zeile == "hue.flur: Licht an die Umgebung angepasst"


def test_beschreibung_nennt_prozent_und_kelvin():
    zeile = describe_action(
        {"type": "light", "entity_id": "hue.flur", "brightness": 40, "color_temp": 370}
    )
    assert "40 %" in zeile and "2703 K" in zeile


def test_licht_schritt_zaehlt_als_einschalten():
    # Sonst fände «wer macht nachts das Licht an?» genau den nicht.
    ablaeufe = parse_automations(
        [
            {
                "id": "a",
                "alias": "Licht an",
                "trigger": [],
                "action": [{"type": "light", "entity_id": "hue.flur"}],
            },
            {
                "id": "b",
                "alias": "Licht aus",
                "trigger": [],
                "action": [
                    {"type": "command", "entity_id": "hue.flur", "command": "turn_off"}
                ],
            },
        ]
    )
    konflikte = find_conflicts(ablaeufe)
    assert konflikte and konflikte[0]["entity_id"] == "hue.flur"


# ── Der Schritt im laufenden Hub ───────────────────────────────────────────


async def hub_mit(automations, illumination=None):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            automations=automations,
        )
    )
    await hub.start()
    if illumination is not None:
        await hub.registry.update_state(
            "demo.motion_hall", {"illumination": illumination}
        )
    return hub


async def settle():
    for _ in range(10):
        await asyncio.sleep(0)


LICHT_ANGEPASST = {
    "id": "flurlicht",
    "alias": "Flurlicht bei Bewegung",
    "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
    "action": [
        {
            "type": "light",
            "entity_id": "demo.light_livingroom",
            "brightness": "adaptive",
        }
    ],
}


@pytest.mark.asyncio
async def test_angepasstes_licht_nimmt_die_lux_des_melders():
    hub = await hub_mit([LICHT_ANGEPASST], illumination=0.0)
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        licht = hub.registry.get("demo.light_livingroom")
        assert licht.state["state"] == "on"
        # Stockdunkel: gedämpft, nicht voll.
        assert licht.state["brightness"] == MIN_PERCENT
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_am_hellen_nachmittag_geht_dieselbe_lampe_voll_an():
    hub = await hub_mit([LICHT_ANGEPASST], illumination=200.0)
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["brightness"] == 100
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_ohne_helligkeitsfuehler_geht_das_licht_trotzdem_an():
    # Ein Bewegungslicht, das wegen eines stummen Fühlers dunkel bleibt,
    # wäre schlimmer als eines in Vorgabehelligkeit.
    hub = await hub_mit([LICHT_ANGEPASST])
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_feste_helligkeit_farbe_und_weiss_gehen_in_einem_zug():
    hub = await hub_mit([])
    try:
        lampe = Entity(
            id="hue.stehlampe",
            name="Stehlampe",
            kind="light",
            integration="demo",
            state={"state": "off"},
            commands=["turn_on", "set_brightness", "set_color", "set_color_temp"],
        )
        await hub.registry.add(lampe)
        gesendet: list[tuple[str, str, dict]] = []

        async def merken(entity_id, command, data=None):
            gesendet.append((entity_id, command, data or {}))

        hub.integrations.dispatch_command = merken  # type: ignore[method-assign]
        await hub.automations.probe_action(
            {
                "type": "light",
                "entity_id": "hue.stehlampe",
                "brightness": 40,
                "color": "#FFD9A0",
            }
        )
        assert [befehl for _, befehl, _ in gesendet] == ["set_brightness", "set_color"]
        assert gesendet[0][2]["brightness"] == 40
        assert gesendet[1][2]["color"] == "#FFD9A0"
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_farbe_schlaegt_weiss_statt_beides_zu_setzen():
    # Beides hintereinander hiesse: Die Lampe springt sichtbar um, und was
    # am Ende leuchtet, hinge an der Reihenfolge im Ablauf.
    hub = await hub_mit([])
    try:
        await hub.registry.add(
            Entity(
                id="hue.stehlampe",
                name="Stehlampe",
                kind="light",
                integration="demo",
                state={"state": "off"},
                commands=["turn_on", "set_brightness", "set_color", "set_color_temp"],
            )
        )
        gesendet: list[str] = []

        async def merken(entity_id, command, data=None):
            gesendet.append(command)

        hub.integrations.dispatch_command = merken  # type: ignore[method-assign]
        await hub.automations.probe_action(
            {
                "type": "light",
                "entity_id": "hue.stehlampe",
                "color": "#FF2D2D",
                "color_temp": 370,
            }
        )
        assert gesendet == ["turn_on", "set_color"]
    finally:
        await hub.stop()
