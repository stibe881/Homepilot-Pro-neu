"""Szenen vorschlagen, statt sie erfinden zu lassen."""

from datetime import datetime

from homepilot.core.suggest import describe, find_pattern


def _ereignis(tag: int, stunde: int, gerät: str, quelle: str = "app", state: str = "on"):
    zeit = datetime(2026, 8, tag, stunde, 14).timestamp()
    return {
        "entity_id": gerät,
        "state": state,
        "at": zeit,
        "source": {"kind": quelle, "label": "Stefan"},
    }


def test_three_evenings_with_the_same_lamps_become_a_suggestion():
    ereignisse = []
    for tag in (17, 18, 19):
        ereignisse.append(_ereignis(tag, 19, "hue.stehlampe"))
        ereignisse.append(_ereignis(tag, 19, "hue.decke"))
    muster = find_pattern(ereignisse)
    assert muster is not None
    assert muster["hour"] == 19
    assert set(muster["entity_ids"]) == {"hue.stehlampe", "hue.decke"}
    assert muster["days"] == 3


def test_twice_is_coincidence():
    """Zwei Abende sind kein Muster - sonst schlägt der Hub nach jedem
    Wochenende etwas vor, und man hört auf hinzuschauen."""
    ereignisse = []
    for tag in (17, 18):
        ereignisse.append(_ereignis(tag, 19, "hue.stehlampe"))
        ereignisse.append(_ereignis(tag, 19, "hue.decke"))
    assert find_pattern(ereignisse) is None


def test_a_single_lamp_is_a_switch_not_a_scene():
    ereignisse = [_ereignis(tag, 19, "hue.stehlampe") for tag in (17, 18, 19)]
    assert find_pattern(ereignisse) is None


def test_what_an_automation_did_does_not_count():
    """Sonst schlüge der Hub vor, zu automatisieren, was er selbst
    geschaltet hat - ein Zirkel, der sich selbst bestätigt."""
    ereignisse = []
    for tag in (17, 18, 19):
        ereignisse.append(_ereignis(tag, 19, "hue.stehlampe", quelle="automation"))
        ereignisse.append(_ereignis(tag, 19, "hue.decke", quelle="automation"))
    assert find_pattern(ereignisse) is None


def test_switching_off_is_not_a_scene_worth_suggesting():
    ereignisse = []
    for tag in (17, 18, 19):
        ereignisse.append(_ereignis(tag, 19, "hue.stehlampe", state="off"))
        ereignisse.append(_ereignis(tag, 19, "hue.decke", state="off"))
    assert find_pattern(ereignisse) is None


def test_the_weakest_member_decides_the_strength():
    """Ein einzelnes häufiges Gerät soll keinen schwachen Vorschlag nach
    oben ziehen: Was zählt, ist die Zahl der Tage, an denen ALLE dabei
    waren."""
    ereignisse = []
    for tag in (10, 11, 12, 13, 14, 15):
        ereignisse.append(_ereignis(tag, 19, "hue.stehlampe"))
    for tag in (13, 14, 15):
        ereignisse.append(_ereignis(tag, 19, "hue.decke"))
    muster = find_pattern(ereignisse)
    assert muster is not None
    assert muster["days"] == 3


def test_the_sentence_reads_like_a_sentence():
    satz = describe(
        {"hour": 19, "entity_ids": ["a", "b", "c"], "days": 4},
        {"a": "Stehlampe", "b": "Decke", "c": "Ecke"},
    )
    assert "An 4 Tagen" in satz
    assert "19 Uhr" in satz
    assert "Stehlampe, Decke und Ecke" in satz
