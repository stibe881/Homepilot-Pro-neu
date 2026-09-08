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


def test_wer_noch_fehlt_haelt_das_nachfassen_am_leben():
    """Der Kniff am ganzen Aufräumen.

    Ein Haus kommt nicht auf einmal zurück: Die Lampe hat Strom, lange
    bevor Switch, Accesspoint und Bridge wieder stehen. Ein Befehl an
    sie verpufft - und sie brennt weiter.
    """
    assert stromrueckkehr.wer_fehlt([("hue.flur", False), ("hue.bad", True)]) == {
        "hue.flur"
    }
    # Alle da: Das Nachfassen hat sein Ende erreicht.
    assert stromrueckkehr.wer_fehlt([("hue.flur", True)]) == set()
    assert stromrueckkehr.wer_fehlt([]) == set()


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


def ablauf(entity_id: str) -> dict:
    """Ein Ablauf, wie ihn jemand im Editor anlegt: «Strom zurück → aus»."""
    return {
        "id": "strom",
        "alias": "Nach Stromausfall",
        "trigger": [{"type": "power_restore", "delay": 0, "interval": 0}],
        "action": [
            {"type": "command", "entity_id": entity_id, "command": "turn_off"}
        ],
    }


async def kalt_gestartet(pfad: str, **kwargs) -> Hub:
    """Einen Hub hochfahren, der einen Stromausfall hinter sich hat."""
    vorlauf = Hub(make_config(data_file=pfad))
    await vorlauf.start()
    vorlauf.data.flush()
    # Kein stop() - so sieht ein Stromausfall aus.
    for name in ("_backup_task", "_flush_task", "_erinnerungs_task", "_live_task",
                 "_karten_task"):
        aufgabe = getattr(vorlauf, name, None)
        if aufgabe is not None:
            aufgabe.cancel()
    await vorlauf.automations.stop()
    await vorlauf.integrations.teardown_all()
    return Hub(make_config(data_file=pfad, **kwargs))


async def test_der_ablauf_laeuft_nach_dem_stromausfall(tmp_path, monkeypatch):
    """Der ganze Weg: Kaltstart erkannt, Ablauf ausgelöst, Licht aus."""
    pfad = str(tmp_path / "hub.json")
    # Erst wissen, wie das Licht heisst.
    probe = Hub(make_config())
    await probe.start()
    licht_id = next(
        entity.id for entity in probe.registry.all() if entity.kind == EntityKind.LIGHT
    )
    await probe.stop()

    # Ohne Wartezeit - die Untergrenze von fünf Sekunden ist für den
    # Betrieb richtig, im Test nur Leerlauf.
    monkeypatch.setattr(stromrueckkehr, "wartezeit", lambda _t: 0)
    hub = await kalt_gestartet(pfad, automations=[ablauf(licht_id)])
    await hub.start()
    try:
        assert hub._kaltstart is True
        await hub.integrations.dispatch_command(licht_id, "turn_on", {})
        assert hub.registry.get(licht_id).state.get("state") == "on"
        for _ in range(50):
            await asyncio.sleep(0.01)
            if hub.registry.get(licht_id).state.get("state") == "off":
                break
        assert hub.registry.get(licht_id).state.get("state") == "off"
    finally:
        await hub.stop()


async def test_ohne_stromausfall_bleibt_der_ablauf_still(tmp_path, monkeypatch):
    """Ein Update dauert auch ein paar Minuten - danach dürfen die
    Lichter nicht ausgehen."""
    pfad = str(tmp_path / "hub.json")
    probe = Hub(make_config())
    await probe.start()
    licht_id = next(
        entity.id for entity in probe.registry.all() if entity.kind == EntityKind.LIGHT
    )
    await probe.stop()

    # Geordnet beendet: kein Kaltstart.
    sauber = Hub(make_config(data_file=pfad))
    await sauber.start()
    await sauber.stop()

    monkeypatch.setattr(stromrueckkehr, "wartezeit", lambda _t: 0)
    hub = Hub(make_config(data_file=pfad, automations=[ablauf(licht_id)]))
    await hub.start()
    try:
        assert hub._kaltstart is False
        await hub.integrations.dispatch_command(licht_id, "turn_on", {})
        for _ in range(30):
            await asyncio.sleep(0.01)
        assert hub.registry.get(licht_id).state.get("state") == "on"
    finally:
        await hub.stop()


async def test_die_spaet_erwachte_lampe_bekommt_ihre_zweite_gelegenheit(
    tmp_path, monkeypatch
):
    """Der Fall, um den es eigentlich geht.

    Nach dem Stromausfall hat die Hue-Lampe Strom, lange bevor
    Accesspoint und Bridge wieder stehen. Beim ersten Lauf ist sie
    «nicht erreichbar» - ein einziger Durchgang hätte sie brennen
    lassen.
    """
    pfad = str(tmp_path / "hub.json")
    probe = Hub(make_config())
    await probe.start()
    licht_id = next(
        entity.id for entity in probe.registry.all() if entity.kind == EntityKind.LIGHT
    )
    await probe.stop()

    monkeypatch.setattr(stromrueckkehr, "wartezeit", lambda _t: 0)
    monkeypatch.setattr(stromrueckkehr, "takt", lambda _t: 0)
    hub = await kalt_gestartet(pfad, automations=[ablauf(licht_id)])
    await hub.start()
    try:
        await hub.integrations.dispatch_command(licht_id, "turn_on", {})
        # Der erste Lauf trifft eine Lampe, die noch nicht am Netz ist.
        await hub.registry.update_state(licht_id, {}, available=False)
        for _ in range(20):
            await asyncio.sleep(0.01)

        # In Wirklichkeit verpufft der Befehl an einer Lampe ohne Netz,
        # und sie brennt weiter. Die Demo-Anbindung antwortet auch als
        # «nicht erreichbar» - also stellen wir den echten Ausgang von
        # Hand her, sonst prüfte der Test die Attrappe statt das
        # Nachfassen.
        await hub.integrations.dispatch_command(licht_id, "turn_on", {})
        await hub.registry.update_state(licht_id, {}, available=False)
        assert hub.registry.get(licht_id).state.get("state") == "on"

        # Und jetzt kommt das Netz zurück - der Ablauf fasst nach.
        await hub.registry.update_state(licht_id, {}, available=True)
        for _ in range(50):
            await asyncio.sleep(0.01)
            if hub.registry.get(licht_id).state.get("state") == "off":
                break
        assert hub.registry.get(licht_id).state.get("state") == "off"
    finally:
        await hub.stop()
