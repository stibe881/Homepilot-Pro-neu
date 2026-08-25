"""Ton: einblenden, dämpfen, deckeln, verschieben.

Die vier Dinge, die an der Lautstärke einer Box hängen. Das Rechnen
steht als reine Funktion da und wird hier ohne Hub geprüft; darunter
die drei Wege, die einen Hub brauchen.
"""

from __future__ import annotations

import asyncio

import pytest

from homepilot.core import ton
from homepilot.core.entity import EntityKind
from homepilot.core.errors import HomePilotError

# ── Rechnen ──────────────────────────────────────────────────────────────


def test_uhrzeit_lesen():
    assert ton.minuten("22:00") == 1320
    assert ton.minuten("07:30") == 450
    assert ton.minuten("00:00") == 0
    # Unsinn ergibt None, nicht Null - sonst wäre «kaputt» dasselbe wie
    # «Mitternacht».
    assert ton.minuten("25:00") is None
    assert ton.minuten("22") is None
    assert ton.minuten("") is None
    assert ton.minuten(None) is None


def test_fenster_ueber_mitternacht():
    """Der Fall, an dem eine naive Rechnung scheitert.

    22:00 bis 07:00 ist kein Zahlenbereich, sondern zwei - «von <= jetzt
    < bis» hätte die Nachtruhe genau nachts nicht angewandt.
    """
    von, bis = ton.minuten("22:00"), ton.minuten("07:00")
    assert ton.im_fenster(ton.minuten("23:30"), von, bis) is True
    assert ton.im_fenster(ton.minuten("02:00"), von, bis) is True
    assert ton.im_fenster(ton.minuten("06:59"), von, bis) is True
    assert ton.im_fenster(ton.minuten("07:00"), von, bis) is False
    assert ton.im_fenster(ton.minuten("15:00"), von, bis) is False
    # Ein Fenster am Tag rechnet sich normal.
    assert ton.im_fenster(ton.minuten("13:00"), ton.minuten("12:00"), ton.minuten("14:00"))
    # Ein Fenster ohne Breite ist keines.
    assert ton.im_fenster(600, 600, 600) is False


def test_deckel_gilt_nur_wenn_er_eingeschaltet_ist():
    nacht = {"on": False, "from": "22:00", "to": "07:00", "max": 30}
    assert ton.deckel_jetzt(nacht, ton.minuten("23:00")) is None
    assert ton.deckel_jetzt({**nacht, "on": True}, ton.minuten("23:00")) == 30
    assert ton.deckel_jetzt({**nacht, "on": True}, ton.minuten("12:00")) is None
    assert ton.deckel_jetzt(None, 0) is None


def test_unleserliche_zeiten_deckeln_nicht_stillschweigend():
    """Ein kaputter Eintrag darf nicht dazu führen, dass tagsüber alles
    leise ist - ohne dass irgendwo stünde, warum."""
    assert ton.deckel_jetzt({"on": True, "from": "quatsch", "to": "07:00"}, 100) is None
    assert ton.deckel_jetzt({"on": True, "from": "22:00", "to": "07:00", "max": "laut"}, 100) is None


def test_deckeln_begrenzt_nur_nach_oben():
    assert ton.gedeckelt(80, 30) == 30
    assert ton.gedeckelt(20, 30) == 20
    assert ton.gedeckelt(80, None) == 80
    # Ausserhalb 0-100 gibt es nichts.
    assert ton.gedeckelt(140, None) == 100
    assert ton.gedeckelt(-3, None) == 0
    assert ton.gedeckelt("laut", 30) is None


def test_rampe_faengt_bei_null_an_und_endet_am_ziel():
    stufen = ton.rampe(0, 40)
    assert stufen[0] == 0
    assert stufen[-1] == 40
    # Monoton steigend und ohne Doppelte - sonst hörte man Stufen oder
    # es gäbe Befehle, die nichts ändern.
    assert stufen == sorted(stufen)
    assert len(set(stufen)) == len(stufen)


def test_rampe_bei_gleichem_ziel():
    # Nichts zu tun ist ein Schritt, kein Fehler.
    assert ton.rampe(30, 30) == [30]
    # Ein sehr kleines Ziel darf nicht in einer leeren Liste enden.
    assert ton.rampe(0, 1)[-1] == 1


def test_daempfen_macht_leiser_aber_nicht_aus():
    assert ton.duck_ziel(60) == 15
    # Nie unter das Minimum: Ganz weg wäre «aus», nicht «leiser».
    assert ton.duck_ziel(8) == ton.DUCK_MINIMUM
    # Wer schon leiser ist als das Ziel, bleibt, wo er ist.
    assert ton.duck_ziel(4) is None
    assert ton.duck_ziel(None) is None


def test_nachtruhe_pruefen_meldet_unsinn():
    with pytest.raises(HomePilotError, match="HH:MM"):
        ton.nachtruhe_pruefen({"on": True, "from": "abends"})
    with pytest.raises(HomePilotError, match="0 und 100"):
        ton.nachtruhe_pruefen({"on": True, "max": 300})
    geprueft = ton.nachtruhe_pruefen({"on": True, "from": "23:00", "max": 25})
    assert geprueft["on"] is True
    assert geprueft["from"] == "23:00"
    assert geprueft["max"] == 25
    # Was nicht mitkommt, bleibt bei der Vorgabe.
    assert geprueft["to"] == ton.STANDARD_NACHTRUHE["to"]


# ── Mit Hub ──────────────────────────────────────────────────────────────


class _Box:
    """Eine Box, die sich merkt, welche Lautstärken sie bekommen hat."""

    def __init__(self) -> None:
        self.lautstaerken: list[int] = []
        self.befehle: list[tuple[str, dict]] = []


async def _box_bauen(hub, name="Küche", zustand=None):
    from homepilot.core.integration import Integration

    protokoll = _Box()

    class TestBoxen(Integration):
        name = "testboxen"

        async def setup(self) -> None:
            await self.add_entity(
                "box",
                EntityKind.MEDIA_PLAYER,
                name,
                state=zustand or {"state": "playing", "volume": 60},
                commands=["play", "pause", "set_volume", "volume_up", "play_url"],
            )

        async def handle_command(self, entity, command, data):
            protokoll.befehle.append((command, dict(data)))
            if command == "set_volume":
                protokoll.lautstaerken.append(int(data["volume"]))
                await self.hub.registry.update_state(
                    entity.id, {**entity.state, "volume": int(data["volume"])}
                )

    integration = TestBoxen(hub, {})
    hub.integrations._integrations["testboxen"] = integration
    await integration.setup()
    return protokoll, "testboxen.box"


async def test_nachtruhe_deckelt_einen_lautstaerkewunsch(hub, monkeypatch):
    protokoll, box_id = await _box_bauen(hub)
    hub.ton.nachtruhe_setzen({"on": True, "from": "22:00", "to": "07:00", "max": 30})
    monkeypatch.setattr(hub.ton, "deckel", lambda jetzt=None: 30)

    await hub.integrations.dispatch_command(box_id, "set_volume", {"volume": 80})
    assert protokoll.lautstaerken == [30]


async def test_ohne_nachtruhe_bleibt_der_wunsch_stehen(hub):
    protokoll, box_id = await _box_bauen(hub)
    await hub.integrations.dispatch_command(box_id, "set_volume", {"volume": 80})
    assert protokoll.lautstaerken == [80]


async def test_lauter_ohne_zahl_wird_nicht_gedeckelt(hub, monkeypatch):
    """«Lauter» kennt der Hub nicht als Zahl - die Integration schon.

    Ein Deckel, der ein Lauter in ein Leiser verwandelt, wäre schlimmer
    als keiner.
    """
    protokoll, box_id = await _box_bauen(hub)
    monkeypatch.setattr(hub.ton, "deckel", lambda jetzt=None: 10)
    await hub.integrations.dispatch_command(box_id, "play", {})
    assert protokoll.befehle == [("play", {})]


async def test_klingeln_daempft_die_musik_und_stellt_sie_zurueck(hub, monkeypatch):
    protokoll, _ = await _box_bauen(hub)
    monkeypatch.setattr(ton, "DUCK_DAUER", 0.0)

    gedaempft = await hub.ton.daempfen(dauer=0.0)
    assert gedaempft == ["Küche"]
    assert protokoll.lautstaerken[0] == 15

    # Danach steht sie wieder, wo sie war.
    for _ in range(40):
        await asyncio.sleep(0.05)
        if len(protokoll.lautstaerken) > 1:
            break
    assert protokoll.lautstaerken[-1] == 60


async def test_daempfen_laesst_stille_boxen_in_ruhe(hub):
    await _box_bauen(hub, name="Bad", zustand={"state": "paused", "volume": 40})
    assert await hub.ton.daempfen(dauer=0.0) == []


async def test_daempfen_kann_abgeschaltet_werden(hub):
    hub.ton.daempfen_setzen(False)
    assert hub.ton.daempfen_an() is False
    hub.ton.daempfen_setzen(True)
    assert hub.ton.daempfen_an() is True


async def test_einblenden_geht_von_leise_nach_laut(hub):
    protokoll, box_id = await _box_bauen(hub)
    await hub.ton.einblenden(box_id, 40, dauer=0.2)
    for _ in range(60):
        await asyncio.sleep(0.02)
        if protokoll.lautstaerken and protokoll.lautstaerken[-1] == 40:
            break
    assert protokoll.lautstaerken[0] == 0
    assert protokoll.lautstaerken[-1] == 40
    assert protokoll.lautstaerken == sorted(protokoll.lautstaerken)


async def test_verschieben_sagt_wenn_es_nicht_geht(hub):
    _, box_id = await _box_bauen(hub)
    with pytest.raises(HomePilotError, match="Spotify oder Radio"):
        await hub.ton.verschieben(box_id, "Wohnzimmer")


async def test_verschieben_unbekannte_box(hub):
    with pytest.raises(HomePilotError, match="kennt der Hub nicht"):
        await hub.ton.verschieben("gibt.es.nicht", "Wohnzimmer")


async def test_verschieben_ohne_ziel(hub):
    _, box_id = await _box_bauen(hub)
    with pytest.raises(HomePilotError, match="Wohin"):
        await hub.ton.verschieben(box_id, "  ")


async def _player_bauen(hub, box_name="Küche"):
    """Ein Player nach Art von Spotify/Radio: spielt auf eine Box."""
    from homepilot.core.integration import Integration

    protokoll = _Box()

    class TestPlayer(Integration):
        name = "testplayer"

        async def setup(self) -> None:
            await self.add_entity(
                "radio",
                EntityKind.MEDIA_PLAYER,
                "Radio",
                state={"state": "playing", "device": box_name, "volume": 50},
                commands=["play", "pause", "play_on", "set_volume"],
            )

        async def handle_command(self, entity, command, data):
            protokoll.befehle.append((command, dict(data)))

    integration = TestPlayer(hub, {})
    hub.integrations._integrations["testplayer"] = integration
    await integration.setup()
    return protokoll, "testplayer.radio"


async def test_verschieben_zieht_die_wiedergabe_um(hub):
    """Der Fall aus dem Alltag: Es läuft in der Küche, man geht ins
    Wohnzimmer. Umziehen kann nicht die Box, sondern der Player, der auf
    sie spielt - deshalb sucht der Hub ihn."""
    await _box_bauen(hub)
    protokoll, _ = await _player_bauen(hub)

    ergebnis = await hub.ton.verschieben("testboxen.box", "Wohnzimmer")
    assert protokoll.befehle == [("play_on", {"device": "Wohnzimmer"})]
    assert ergebnis == {"from": "Küche", "to": "Wohnzimmer", "player": "Radio"}


async def test_durchsage_stellt_lautstaerke_und_musik_wieder_her(hub):
    """Punkt 20: Vorher blieb die Box auf der Lautstärke der Durchsage
    stehen und die Musik aus."""
    protokoll, box_id = await _box_bauen(hub)
    gemerkt = hub.ton.zustand_merken([box_id])
    assert gemerkt[box_id]["volume"] == 60
    assert gemerkt[box_id]["state"] == "playing"

    # Die Durchsage läuft und dreht auf.
    await hub.integrations.dispatch_command(box_id, "set_volume", {"volume": 90})
    await hub.registry.update_state(box_id, {"state": "standby", "volume": 90})

    await hub.ton.durchsage_zurueck(gemerkt, frist=2.0)
    assert protokoll.lautstaerken[-1] == 60
    assert ("play", {}) in protokoll.befehle


# ── Nachbesserungen: der Deckel und das Gedächtnis ───────────────────────


async def test_lauter_wird_am_deckel_zum_setzen(hub, monkeypatch):
    """Hier stand einmal, der Hub kenne die aktuelle Lautstärke nicht.

    Er kennt sie - sie steht im Zustand der Box. Ein «Lauter», das über
    den Deckel führen würde, wird deshalb zu einem Setzen auf den Deckel.
    """
    protokoll, box_id = await _box_bauen(hub, zustand={"state": "playing", "volume": 55})
    monkeypatch.setattr(hub.ton, "deckel", lambda jetzt=None: 30)

    await hub.integrations.dispatch_command(box_id, "volume_up", {})
    assert protokoll.befehle == [("set_volume", {"volume": 30})]


async def test_lauter_unter_dem_deckel_bleibt_lauter(hub, monkeypatch):
    protokoll, box_id = await _box_bauen(hub, zustand={"state": "playing", "volume": 20})
    monkeypatch.setattr(hub.ton, "deckel", lambda jetzt=None: 30)

    await hub.integrations.dispatch_command(box_id, "volume_up", {})
    assert protokoll.befehle == [("volume_up", {})]


async def test_ohne_bekannte_lautstaerke_wird_nicht_geraten(hub, monkeypatch):
    protokoll, box_id = await _box_bauen(hub, zustand={"state": "playing"})
    monkeypatch.setattr(hub.ton, "deckel", lambda jetzt=None: 30)

    await hub.integrations.dispatch_command(box_id, "volume_up", {})
    assert protokoll.befehle == [("volume_up", {})]


async def test_daempfung_ueberlebt_einen_neustart(hub):
    """Der Hub kann zwischen «leiser» und «wieder lauter» neu starten -
    ein Update reicht dafür. Ohne Gedächtnis bliebe die Box leise."""
    protokoll, box_id = await _box_bauen(hub)
    await hub.ton.daempfen(dauer=600.0)
    assert protokoll.lautstaerken == [15]

    # Der Neustart: ein frischer Tonmeister auf derselben Datendatei.
    from homepilot.core.ton import Tonmeister

    neu = Tonmeister(hub)
    hub.ton = neu
    await neu._daempfung_nachholen()
    assert protokoll.lautstaerken[-1] == 60

    # Und danach ist der Eintrag weg - sonst würde jeder weitere Start
    # die Lautstärke erneut «zurückstellen».
    assert hub.data.get("ton_daempfung_laeuft") == []
