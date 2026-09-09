"""Licht-Schritt: Helligkeit, Farbe, Weissanteil – und die Anpassung an die Lux.

Der Fall dahinter: Ein Bewegungslicht kannte nur «an» und eine feste
Prozentzahl. Nachts blendet dieselbe Zahl, die am trüben Nachmittag
unsichtbar ist – dabei misst der Melder die Umgebungshelligkeit längst.
"""

import asyncio
from datetime import datetime

import pytest

from homepilot.core.automation import (
    PENDING_KEY,
    describe_action,
    find_conflicts,
    parse_automations,
)
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity
from homepilot.core.hub import Hub
from homepilot.core.light import (
    FULL_LUX,
    MAX_PERCENT,
    MIN_PERCENT,
    NACHT_BEGINN,
    NACHT_ENDE,
    TAG_BEGINN,
    TAG_ENDE,
    brightness_from_lux,
    brightness_from_time,
    raum_lux,
)


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


# ── Nach der Uhr ──────────────────────────────────────────────────────
#
# Die zweite Antwort auf dieselbe Frage. Sie weiss weniger als der
# Fühler - ein Gewitternachmittag ist ihr so hell wie ein Julitag -,
# aber sie braucht keinen, und in den meisten Räumen des Hauses steht
# keiner.


def test_nachts_bleibt_es_beim_nachtlicht():
    assert brightness_from_time(3) == MIN_PERCENT
    assert brightness_from_time(23, 30) == MIN_PERCENT
    assert brightness_from_time(NACHT_ENDE - 0.1) == MIN_PERCENT


def test_mitten_am_tag_gibt_die_volle_lampe():
    assert brightness_from_time(TAG_BEGINN) == MAX_PERCENT
    assert brightness_from_time(13) == MAX_PERCENT
    assert brightness_from_time(TAG_ENDE - 0.1) == MAX_PERCENT


def test_morgens_hoch_und_abends_wieder_hinunter():
    morgen = [brightness_from_time(std) for std in (6, 6.5, 7, 7.5, 8)]
    assert morgen == sorted(morgen)
    abend = [brightness_from_time(std) for std in (18, 19, 20, 21, 21.9)]
    assert abend == sorted(abend, reverse=True)
    assert brightness_from_time(NACHT_BEGINN) == MIN_PERCENT


def test_die_uhr_laeuft_rundherum_und_unsinn_blendet_nicht():
    # 25 Uhr ist ein Uhr. Und ein kaputter Wert soll die Lampe nicht
    # dunkel lassen - lieber zu hell als scheinbar tot.
    assert brightness_from_time(25) == brightness_from_time(1)
    assert brightness_from_time("keine Zahl") == MAX_PERCENT  # type: ignore[arg-type]
    assert brightness_from_time(float("nan")) == MAX_PERCENT


# ── Der Fühler im Raum ────────────────────────────────────────────────


def test_raum_lux_nimmt_den_fuehler_im_selben_zimmer():
    from types import SimpleNamespace

    entities = [
        SimpleNamespace(room="Küche", state={"illumination": 300}),
        SimpleNamespace(room="Flur", state={"illumination": 12}),
        SimpleNamespace(room="Flur", state={}),
    ]
    assert raum_lux(entities, "Flur") == 12.0
    # Ein Fühler zwei Zimmer weiter sagt nichts über das Licht hier.
    assert raum_lux(entities, "Bad") is None
    assert raum_lux(entities, None) is None


def test_beschreibung_nennt_die_anpassung():
    zeile = describe_action(
        {"type": "light", "entity_id": "hue.flur", "brightness": "adaptive"}
    )
    assert zeile == "hue.flur: Licht an die Raumhelligkeit angepasst"


def test_beschreibung_nennt_die_tageszeit():
    """Der zweite Weg zur Helligkeit - der ohne Fühler."""
    zeile = describe_action(
        {"type": "light", "entity_id": "hue.flur", "brightness": "tageszeit"}
    )
    assert zeile == "hue.flur: Licht nach Tageszeit"


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


async def hub_mit(automations, illumination=None, rooms=None):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            automations=automations,
            rooms=rooms or {},
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


LICHT_NACH_UHR = {
    "id": "abendlicht",
    "alias": "Wohnzimmer am Abend",
    "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
    "action": [
        {
            "type": "light",
            "entity_id": "demo.light_livingroom",
            "brightness": "tageszeit",
        }
    ],
}


@pytest.mark.asyncio
async def test_nach_tageszeit_braucht_gar_keinen_fuehler(monkeypatch):
    """Der Weg für die Räume ohne Helligkeitsfühler - also für die meisten."""
    import homepilot.core.automation as automation_modul

    class Nacht(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 1, 5, 3, 0)

    monkeypatch.setattr(automation_modul, "datetime", Nacht)
    hub = await hub_mit([LICHT_NACH_UHR])
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        licht = hub.registry.get("demo.light_livingroom")
        assert licht.state["state"] == "on"
        # Drei Uhr nachts: Nachtlicht, nicht Flutlicht.
        assert licht.state["brightness"] == MIN_PERCENT
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_die_raumhelligkeit_zaehlt_auch_ohne_ausloesenden_melder():
    """Ein Ablauf «um 18:00 das Wohnzimmer an» hat keinen Melder, der
    auslöst - vorher war «an die Helligkeit angepasst» dort wirkungslos."""
    hub = await hub_mit(
        [LICHT_ANGEPASST], rooms={"Wohnzimmer": ["demo.light_livingroom"]}
    )
    try:
        # Der Fühler steht im Raum der Lampe, nicht im Auslöser.
        lampe = hub.registry.get("demo.light_livingroom")
        assert lampe.room == "Wohnzimmer"
        fuehler = Entity(
            id="demo.lux_livingroom",
            kind="sensor",
            name="Helligkeit Wohnzimmer",
            integration="demo",
            state={"illumination": 0.0},
            room=lampe.room,
        )
        await hub.registry.add(fuehler)
        await hub.registry.update_state("demo.motion_hall", {"illumination": None})
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["brightness"] == MIN_PERCENT
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


# ── Nachlauf: wie lange bleibt das Licht an? ───────────────────────────────


def test_beschreibung_nennt_den_nachlauf():
    zeile = describe_action(
        {"type": "light", "entity_id": "hue.flur", "off_after": 240}
    )
    assert zeile == "hue.flur: Licht an, in 4 Min wieder aus"


NACHLAUF = {
    "id": "flurlicht",
    "alias": "Flurlicht bei Bewegung",
    "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
    "action": [
        {
            "type": "light",
            "entity_id": "demo.light_livingroom",
            "brightness": 60,
            "off_after": 0.05,
        }
    ],
}


@pytest.mark.asyncio
async def test_das_licht_geht_nach_der_nachlaufzeit_von_selbst_aus():
    hub = await hub_mit([NACHLAUF])
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
        await asyncio.sleep(0.1)
        assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_der_ablauf_wartet_nicht_auf_den_nachlauf():
    # Der Punkt gegenüber «an, warten, aus»: Der nächste Schritt ist sofort
    # dran, und ein zweiter Auslöser findet den Ablauf nicht beschäftigt.
    hub = await hub_mit(
        [
            {
                **NACHLAUF,
                "action": [
                    NACHLAUF["action"][0],
                    {
                        "type": "command",
                        "entity_id": "demo.switch_coffee",
                        "command": "turn_on",
                    },
                ],
            }
        ]
    )
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get("demo.switch_coffee").state["state"] == "on"
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_neue_bewegung_verlaengert_statt_zweimal_zu_zaehlen():
    hub = await hub_mit([{**NACHLAUF, "action": [{**NACHLAUF["action"][0], "off_after": 0.15}]}])
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        await asyncio.sleep(0.1)
        # Jemand ist noch da: Der Melder feuert erneut.
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_off")
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        await asyncio.sleep(0.1)
        # Wäre der erste Zeitgeber stehen geblieben, wäre es jetzt dunkel.
        assert hub.registry.get("demo.light_livingroom").state["state"] == "on"
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_wer_selbst_ausschaltet_wird_nicht_ueberstimmt():
    hub = await hub_mit([{**NACHLAUF, "action": [{**NACHLAUF["action"][0], "off_after": 0.05}]}])
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        await hub.integrations.dispatch_command("demo.light_livingroom", "turn_on")
        await hub.registry.update_state("demo.light_livingroom", {"brightness": 100})
        await asyncio.sleep(0.1)
        # Der Zeitgeber schaltet aus, was noch an ist - mehr nicht.
        assert hub.registry.get("demo.light_livingroom").state["state"] == "off"
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_ein_offener_nachlauf_ueberlebt_den_halt():
    # Sonst bliebe nach jeder Auslieferung irgendwo ein Licht an, bis es
    # jemand bemerkt.
    hub = await hub_mit([{**NACHLAUF, "action": [{**NACHLAUF["action"][0], "off_after": 60}]}])
    await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
    await settle()
    await hub.stop()
    offen = hub.data.get(PENDING_KEY)
    eintrag = next(e for e in offen if str(e["automation_id"]).startswith("nachlauf:"))
    assert eintrag["actions"] == [
        {
            "type": "command",
            "entity_id": "demo.light_livingroom",
            "command": "turn_off",
        }
    ]
