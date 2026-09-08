"""Nach dem Stromausfall: nur das Licht, das man vorgegeben hat.

Kommt der Strom zurück, gehen die meisten Lampen von selbst an - das
entscheidet das Leuchtmittel, nicht der Hub. Um drei Uhr nachts steht
damit das ganze Haus in vollem Licht.
"""

import asyncio

from homepilot.core import stromrueckkehr
from homepilot.core.entity import EntityKind
from homepilot.core.hub import Hub

from .conftest import make_config


def test_nur_ein_abgebrochener_lauf_gilt_als_stromausfall():
    """Am sauberen Ende erkannt, nicht an der Uhr.

    Ein Update dauert auch ein paar Minuten - danach dürfen die Lichter
    nicht ausgehen.
    """
    assert stromrueckkehr.kaltstart({"state": "laeuft"}) is True
    assert stromrueckkehr.kaltstart({"state": "beendet"}) is False


def test_ohne_vermerk_wird_nichts_abgeraeumt():
    """Beim allerersten Start fehlt er - und ein frisch eingerichteter
    Hub soll nicht als Erstes das Haus abräumen."""
    assert stromrueckkehr.kaltstart(None) is False
    assert stromrueckkehr.kaltstart({}) is False
    assert stromrueckkehr.kaltstart("laeuft") is False


def test_gestellt_wird_nur_was_sich_aendert():
    """Eine Lampe, die ohnehin aus ist, bekommt kein zweites «aus».

    Nicht aus Sparsamkeit: Manche Bridge quittiert einen Schwung Befehle
    mit einer Denkpause, und dann kommt der eine, auf den es ankommt, zu
    spät.
    """
    lichter = [("hue.flur", "on", True), ("hue.bad", "off", True), ("hue.stube", "on", True)]
    assert stromrueckkehr.zu_stellen(lichter, ["hue.stube"]) == [
        ("hue.flur", "turn_off")
    ]


def test_das_vorgegebene_licht_geht_an_wenn_es_aus_blieb():
    """Manche Lampe bleibt nach dem Stromausfall dunkel - dann ist sie
    der eine Fall, in dem der Hub einschaltet."""
    assert stromrueckkehr.zu_stellen([("hue.stube", "off", True)], ["hue.stube"]) == [
        ("hue.stube", "turn_on")
    ]


def test_ohne_vorgabe_geht_alles_licht_aus():
    lichter = [("hue.flur", "on", True), ("hue.bad", "on", True)]
    assert stromrueckkehr.zu_stellen(lichter, []) == [
        ("hue.flur", "turn_off"),
        ("hue.bad", "turn_off"),
    ]


def test_wer_noch_nicht_erreichbar_ist_kommt_spaeter_dran():
    """Der eigentliche Fall nach einem Stromausfall.

    Die Lampe hat Strom, lange bevor Accesspoint und Bridge wieder
    stehen. Ein Befehl an sie verpufft - und sie brennt weiter. Also
    überspringen, nicht aufgeben.
    """
    assert stromrueckkehr.zu_stellen([("hue.flur", "on", False)], []) == []
    # Eine Runde später ist sie da.
    assert stromrueckkehr.zu_stellen([("hue.flur", "on", True)], []) == [
        ("hue.flur", "turn_off")
    ]


def test_jede_lampe_nur_einmal():
    """Sonst wäre der Hub zehn Minuten lang ein Gegner: Wer im Dunkeln
    Licht macht, während noch aufgeräumt wird, bekäme es sofort wieder
    ausgeschaltet."""
    lichter = [("hue.flur", "on", True)]
    assert stromrueckkehr.zu_stellen(lichter, [], {"hue.flur"}) == []


def test_takt_und_fenster_bleiben_in_vernuenftigen_grenzen():
    """Nach dem Fenster ist eine Lampe, die angeht, wieder jemandes
    Entscheidung - ein Hub, der eine Stunde später noch eigenmächtig
    ausschaltet, wäre ein Gespenst."""
    assert stromrueckkehr.fenster({}) == stromrueckkehr.FENSTER_SEKUNDEN
    assert stromrueckkehr.fenster({"window": 5}) == 30
    assert stromrueckkehr.fenster({"window": 99999}) == 3600
    assert stromrueckkehr.takt({"interval": 1}) == 5
    assert stromrueckkehr.takt({"interval": "bald"}) == stromrueckkehr.TAKT_SEKUNDEN


def test_die_wartezeit_bleibt_in_vernuenftigen_grenzen():
    """Sofort wäre zu früh (die Anbindungen stehen noch nicht), eine
    Stunde zu spät - dann ist längst jemand durchs Haus gegangen."""
    assert stromrueckkehr.wartezeit({}) == stromrueckkehr.WARTEN_SEKUNDEN
    assert stromrueckkehr.wartezeit({"delay": 30}) == 30
    assert stromrueckkehr.wartezeit({"delay": 0}) == 5
    assert stromrueckkehr.wartezeit({"delay": 99999}) == 3600
    assert stromrueckkehr.wartezeit({"delay": "gleich"}) == stromrueckkehr.WARTEN_SEKUNDEN


def test_eine_einzelne_lampe_darf_ohne_liste_dastehen():
    assert stromrueckkehr.gewuenschte_lichter({"lights_on": "hue.stube"}) == [
        "hue.stube"
    ]
    assert stromrueckkehr.gewuenschte_lichter({}) == []
    assert stromrueckkehr.gewuenschte_lichter(None) == []


async def test_ein_geordnetes_ende_hinterlaesst_seinen_vermerk(tmp_path):
    """Und der nächste Start liest daraus «kein Stromausfall»."""
    config = make_config(data_file=str(tmp_path / "hub.json"))
    hub = Hub(config)
    await hub.start()
    # Solange er läuft, steht dort «laeuft» - stirbt er jetzt, weiss es
    # der nächste Start.
    assert hub.data.get("lauf")[0]["state"] == "laeuft"
    await hub.stop()
    assert hub.data.get("lauf")[0]["state"] == "beendet"

    zweiter = Hub(make_config(data_file=str(tmp_path / "hub.json")))
    await zweiter.start()
    try:
        assert zweiter._kaltstart is False
    finally:
        await zweiter.stop()


async def test_nach_einem_abbruch_meldet_der_naechste_start_den_kaltstart(tmp_path):
    """Kein stop() - so sieht ein Stromausfall aus."""
    pfad = str(tmp_path / "hub.json")
    hub = Hub(make_config(data_file=pfad))
    await hub.start()
    hub.data.flush()
    # Und jetzt fällt der Strom aus: kein stop(), nur weg.
    for task in ("_backup_task", "_flush_task", "_erinnerungs_task", "_live_task",
                 "_karten_task", "_strom_task"):
        aufgabe = getattr(hub, task, None)
        if aufgabe is not None:
            aufgabe.cancel()
    await hub.integrations.teardown_all()
    await asyncio.sleep(0)

    zweiter = Hub(make_config(data_file=pfad))
    await zweiter.start()
    try:
        assert zweiter._kaltstart is True
    finally:
        await zweiter.stop()


def test_nur_licht_wird_angefasst():
    """Am selben Strang hängen Gefriertruhe, Pumpe und Router - ein «aus»
    nach dem Stromausfall wäre dort gefährlich."""
    assert EntityKind.LIGHT == "light"


async def test_der_hub_raeumt_nach_dem_stromausfall_wirklich_auf(tmp_path, monkeypatch):
    """Der ganze Weg, nicht nur die Rechnung.

    Die reinen Funktionen liessen sich prüfen, ohne dass die Schleife im
    Hub je lief - und genau dort steckte beim Bauen ein fehlender Import,
    den erst ruff fand. Ein Test, der den Weg nicht geht, deckt ihn nicht.
    """
    pfad = str(tmp_path / "hub.json")
    vorlauf = Hub(make_config(data_file=pfad))
    await vorlauf.start()
    vorlauf.data.flush()
    for name in ("_backup_task", "_flush_task", "_erinnerungs_task", "_live_task",
                 "_karten_task", "_strom_task"):
        aufgabe = getattr(vorlauf, name, None)
        if aufgabe is not None:
            aufgabe.cancel()
    await vorlauf.integrations.teardown_all()

    # Der Demo-Hub bringt ein Licht mit; es soll ausgehen.
    hub = Hub(
        make_config(
            data_file=pfad,
            power_restore={"lights_on": [], "delay": 5},
        )
    )
    await hub.start()
    try:
        assert hub._kaltstart is True
        licht = next(
            entity for entity in hub.registry.all() if entity.kind == EntityKind.LIGHT
        )
        await hub.integrations.dispatch_command(licht.id, "turn_on", {})
        assert hub.registry.get(licht.id).state.get("state") == "on"

        # Nicht die fünf Sekunden abwarten - die Schleife selbst aufrufen.
        hub._strom_task.cancel()
        monkeypatch.setattr(stromrueckkehr, "wartezeit", lambda _c: 0)
        await hub._stromrueckkehr()

        assert hub.registry.get(licht.id).state.get("state") == "off"
    finally:
        await hub.stop()


async def test_die_spaet_erwachte_lampe_wird_in_einer_spaeteren_runde_gestellt(
    tmp_path, monkeypatch
):
    """Der Fall, um den es eigentlich geht.

    Nach dem Stromausfall hat die Hue-Lampe Strom, lange bevor
    Accesspoint und Bridge wieder stehen. In der ersten Runde ist sie
    «nicht erreichbar» - eine einzelne Aufräumrunde hätte sie brennen
    lassen.
    """
    pfad = str(tmp_path / "hub.json")
    vorlauf = Hub(make_config(data_file=pfad))
    await vorlauf.start()
    vorlauf.data.flush()
    for name in ("_backup_task", "_flush_task", "_erinnerungs_task", "_live_task",
                 "_karten_task", "_strom_task"):
        aufgabe = getattr(vorlauf, name, None)
        if aufgabe is not None:
            aufgabe.cancel()
    await vorlauf.integrations.teardown_all()

    hub = Hub(make_config(data_file=pfad, power_restore={"lights_on": []}))
    await hub.start()
    hub._strom_task.cancel()
    try:
        licht = next(
            entity for entity in hub.registry.all() if entity.kind == EntityKind.LIGHT
        )
        await hub.integrations.dispatch_command(licht.id, "turn_on", {})
        # Runde eins: Die Lampe brennt, ist aber noch nicht erreichbar.
        await hub.registry.update_state(licht.id, {}, available=False)

        # Ohne Wartezeiten - und über monkeypatch, damit die echten
        # Werte nach dem Test wieder stehen: Ein Test, der sie liegen
        # lässt, verändert die Nachbarn.
        monkeypatch.setattr(stromrueckkehr, "wartezeit", lambda _c: 0)
        monkeypatch.setattr(stromrueckkehr, "takt", lambda _c: 0)
        aufgabe = asyncio.create_task(hub._stromrueckkehr())
        await asyncio.sleep(0)
        assert hub.registry.get(licht.id).state.get("state") == "on"

        # Und jetzt kommt das Netz zurück.
        await hub.registry.update_state(licht.id, {}, available=True)
        await aufgabe
        assert hub.registry.get(licht.id).state.get("state") == "off"
    finally:
        await hub.stop()
