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
    bewegung_haelt_an,
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
async def test_umschalten_setzt_beim_einschalten_die_vorgaben():
    """Der Wandtaster im Flur: ein Knopf, und wenn er einschaltet, dann
    bitte gedämpft und warm. Vorher musste man sich zwischen «immer an»
    und «umschalten ohne Vorgaben» entscheiden."""
    hub = await hub_mit([])
    try:
        lampe = Entity(
            id="hue.flur",
            name="Flurlicht",
            kind="light",
            integration="demo",
            state={"state": "off"},
            commands=["turn_on", "turn_off", "toggle", "set_brightness", "set_color_temp"],
        )
        await hub.registry.add(lampe)
        gesendet: list[tuple[str, str, dict]] = []

        async def merken(entity_id, command, data=None):
            gesendet.append((entity_id, command, data or {}))

        hub.integrations.dispatch_command = merken  # type: ignore[method-assign]
        schritt = {
            "type": "light",
            "entity_id": "hue.flur",
            "toggle": True,
            "brightness": 20,
            "color_temp": 400,
        }
        await hub.automations.probe_action(schritt)
        assert [befehl for _, befehl, _ in gesendet] == ["set_brightness", "set_color_temp"]
        assert gesendet[0][2]["brightness"] == 20
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_umschalten_macht_die_brennende_lampe_aus():
    hub = await hub_mit([])
    try:
        lampe = Entity(
            id="hue.flur",
            name="Flurlicht",
            kind="light",
            integration="demo",
            state={"state": "on"},
            commands=["turn_on", "turn_off", "toggle", "set_brightness"],
        )
        await hub.registry.add(lampe)
        gesendet: list[tuple[str, str, dict]] = []

        async def merken(entity_id, command, data=None):
            gesendet.append((entity_id, command, data or {}))

        hub.integrations.dispatch_command = merken  # type: ignore[method-assign]
        notiz = await hub.automations.probe_action(
            {
                "type": "light",
                "entity_id": "hue.flur",
                "toggle": True,
                "brightness": 20,
            }
        )
        # Nur aus - und keine Helligkeit hinterher, die niemand sieht.
        assert [befehl for _, befehl, _ in gesendet] == ["turn_off"]
        assert notiz is None or "aus" in str(notiz)
    finally:
        await hub.stop()


def test_der_trockenlauf_sagt_umschalten_dazu():
    # «Licht 20 %» an einem Schritt, der auch ausschalten kann, wäre die
    # halbe Wahrheit.
    satz = describe_action(
        {"type": "light", "entity_id": "hue.flur", "toggle": True, "brightness": 20},
        lambda entity_id: "Flurlicht",
    )
    assert "umschalten" in satz and "20 %" in satz


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
        # Es wird wieder ruhig - erst ab hier zählt die Nachlaufzeit
        # (Punkt 547). Vorher stand der Melder in diesem Test noch auf
        # «Bewegung», während das Licht ausging: genau der gemeldete
        # Fehler, nur als Erwartung festgeschrieben.
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_off")
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
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_off")
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


# ── Der Nachlauf zählt ab der letzten Bewegung (Punkt 547) ───────────────


def test_ein_melder_auf_on_heisst_die_bewegung_haelt_an():
    """Die Entscheidung für sich, ohne Hub."""
    melder = Entity(
        id="test.melder",
        kind="binary_sensor",
        name="Bewegung Flur",
        integration="test",
        state={"state": "on", "device_class": "motion"},
    )
    assert bewegung_haelt_an([melder], ["test.melder"]) is True
    melder.state["state"] = "off"
    assert bewegung_haelt_an([melder], ["test.melder"]) is False


def test_ein_fensterkontakt_haelt_kein_licht_an():
    """Im Zweifel nein.

    Ein Kontakt, den der Hub für einen Bewegungsmelder hielte, hielte das
    Licht an, solange das Fenster offen steht.
    """
    kontakt = Entity(
        id="test.fenster",
        kind="binary_sensor",
        name="Fenster Küche",
        integration="test",
        state={"state": "on", "device_class": "contact"},
    )
    assert bewegung_haelt_an([kontakt], ["test.fenster"]) is False


def test_ohne_melder_gilt_die_zeit_wie_bisher():
    """«Um 18:00 das Licht an» hat gar keinen Auslöser mit Zustand."""
    assert bewegung_haelt_an([], []) is False


def test_ein_melder_ohne_geraeteklasse_zaehlt_ueber_den_namen():
    # Nicht jede Integration schickt eine Klasse mit.
    melder = Entity(
        id="hm.bewegung_flur",
        kind="binary_sensor",
        name="Bewegung Flur",
        integration="homematic",
        state={"state": "on"},
    )
    assert bewegung_haelt_an([melder], ["hm.bewegung_flur"]) is True


@pytest.mark.asyncio
async def test_das_licht_bleibt_an_solange_der_melder_bewegung_meldet():
    """Der gemeldete Fall.

    «Wenn ich bei Abläufen eine Zeit angebe, wie lange es an sein soll,
    schaltet es nach dieser Zeit aus. Auch wenn in der Zwischenzeit
    wieder eine Bewegung erkannt wurde.»

    Ein echter Melder meldet einmal «on» und bleibt darauf, bis es ruhig
    wird - ein zweites «on» ist für den Hub «nichts geändert» und löst
    nichts aus. Das Licht ging deshalb mitten im Betrieb aus, und der
    Melder konnte es nicht einmal wieder anschalten, weil er nie auf
    «off» war.
    """
    hub = await hub_mit(
        [{**NACHLAUF, "action": [{**NACHLAUF["action"][0], "off_after": 0.3}]}]
    )
    try:
        licht = "demo.light_livingroom"
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        assert hub.registry.get(licht).state["state"] == "on"

        # Der Mensch steht weiter im Flur: Der Melder bleibt auf «on»,
        # ohne je erneut auszulösen.
        await asyncio.sleep(0.5)
        assert hub.registry.get("demo.motion_hall").state["state"] == "on"
        assert hub.registry.get(licht).state["state"] == "on"

        # Wird es ruhig, läuft der Nachlauf ab wie immer.
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_off")
        await asyncio.sleep(0.45)
        assert hub.registry.get(licht).state["state"] == "off"
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_die_restzeit_an_der_kachel_laeuft_nicht_auf_null_waehrend_es_brennt():
    """Sonst stünde «geht in 0 Min aus», während das Licht weiterbrennt.

    Die Restzeit ist der zweite Weg zu derselben Auskunft
    (core/abschaltung.py); verlängert sich der Nachlauf, muss sie mit.
    """
    hub = await hub_mit(
        [
            {
                **NACHLAUF,
                "countdown": True,
                "action": [{**NACHLAUF["action"][0], "off_after": 0.3}],
            }
        ]
    )
    try:
        licht = "demo.light_livingroom"
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        erst = hub.registry.get(licht).state.get("off_at")
        assert erst is not None

        await asyncio.sleep(0.45)
        spaeter = hub.registry.get(licht).state.get("off_at")
        assert spaeter is not None
        # Neu gesetzt, nicht stehengeblieben.
        assert spaeter > erst
    finally:
        await hub.stop()
