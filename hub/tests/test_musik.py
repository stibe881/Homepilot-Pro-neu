"""Was die Musik im Haus sich merkt.

Favoriten, der Verlauf, der Schlummer-Timer und der Musikwecker - die
vier Dinge, die die Kachel allein nicht leisten kann, weil sie ein
Gedächtnis brauchen.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from homepilot.core import musik
from homepilot.core.entity import EntityKind
from homepilot.core.errors import HomePilotError

# ── Rechnen ──────────────────────────────────────────────────────────────


def test_favorit_braucht_art_und_namen():
    with pytest.raises(HomePilotError, match="keine Art"):
        musik.favorit_pruefen({"kind": "kassette", "name": "X"})
    with pytest.raises(HomePilotError, match="leere Kachel"):
        musik.favorit_pruefen({"kind": "station", "name": "  "})
    eintrag = musik.favorit_pruefen({"kind": "Station", "name": " SRF 3 "})
    assert eintrag["kind"] == "station"
    assert eintrag["name"] == "SRF 3"
    # Ohne Kennung bekommt er eine - sonst überschriebe der zweite
    # Favorit den ersten.
    assert eintrag["id"]


def test_verlauf_haelt_denselben_titel_nicht_zwanzigmal():
    """Der häufige Fall: Der Hub sieht denselben Titel bei jeder
    Lautstärkeänderung erneut."""
    verlauf = musik.verlauf_eintragen([], {"track": "Yesterday", "artist": "Beatles"})
    assert verlauf is not None and verlauf[0]["track"] == "Yesterday"
    # Derselbe Titel gleich danach: nichts zu tun.
    assert musik.verlauf_eintragen(verlauf, {"track": "Yesterday"}) is None


def test_verlauf_holt_einen_wiederholten_titel_nach_oben():
    verlauf = musik.verlauf_eintragen([], {"track": "A"})
    verlauf = musik.verlauf_eintragen(verlauf, {"track": "B"})
    verlauf = musik.verlauf_eintragen(verlauf, {"track": "A"})
    # Einmal in der Liste, oben - nicht zweimal.
    assert [zeile["track"] for zeile in verlauf] == ["A", "B"]


def test_verlauf_ohne_titel_ist_kein_eintrag():
    # Eine Box, die spielt, ohne zu sagen was (Durchsage, Testton).
    assert musik.verlauf_eintragen([], {"artist": "X"}) is None


def test_verlauf_bleibt_kurz():
    verlauf: list = []
    for nummer in range(30):
        verlauf = musik.verlauf_eintragen(verlauf, {"track": f"Titel {nummer}"})
    assert len(verlauf) == musik.VERLAUF_LIMIT
    assert verlauf[0]["track"] == "Titel 29"


def test_wecker_pruefen():
    with pytest.raises(HomePilotError, match="HH:MM"):
        musik.wecker_pruefen({"time": "früh", "player": "x"})
    with pytest.raises(HomePilotError, match="Ziel"):
        musik.wecker_pruefen({"time": "07:00", "player": ""})
    with pytest.raises(HomePilotError, match="nie klingeln"):
        musik.wecker_pruefen({"time": "07:00", "player": "x", "days": []})
    # Kein Tag genannt heisst jeden Tag - nicht «nie».
    eintrag = musik.wecker_pruefen({"time": "07:00", "player": "x"})
    assert eintrag["days"] == [0, 1, 2, 3, 4, 5, 6]
    assert eintrag["volume"] == 35


def test_faellig_nur_einmal_pro_minute():
    """Der Takt schaut öfter als einmal pro Minute nach - ohne die Marke
    ginge derselbe Wecker mehrfach los."""
    wecker = musik.wecker_pruefen({"time": "07:15", "player": "x", "days": [0]})
    minute = musik.uhrzeit("07:15")
    assert musik.faellig(wecker, minute, 0, None) is True
    assert musik.faellig(wecker, minute, 0, f"0:{minute}") is False
    # Am falschen Tag und zur falschen Minute nicht.
    assert musik.faellig(wecker, minute, 1, None) is False
    assert musik.faellig(wecker, minute + 1, 0, None) is False
    # Abgeschaltet heisst abgeschaltet.
    assert musik.faellig({**wecker, "on": False}, minute, 0, None) is False


# ── Mit Hub ──────────────────────────────────────────────────────────────


class _Protokoll:
    def __init__(self) -> None:
        self.befehle: list[tuple[str, str, dict]] = []


async def _radio_bauen(hub):
    from homepilot.core.integration import Integration

    protokoll = _Protokoll()

    class TestRadio(Integration):
        name = "testradio"

        async def setup(self) -> None:
            await self.add_entity(
                "radio",
                EntityKind.MEDIA_PLAYER,
                "Radio",
                state={"state": "idle"},
                commands=["play", "pause", "play_radio", "play_on", "set_volume"],
            )
            await self.add_entity(
                "box",
                EntityKind.MEDIA_PLAYER,
                "Küche",
                state={"state": "playing", "volume": 40},
                commands=["play", "pause", "set_volume"],
            )

        async def handle_command(self, entity, command, data):
            protokoll.befehle.append((entity.id, command, dict(data)))
            if command == "set_volume":
                await self.hub.registry.update_state(
                    entity.id, {**entity.state, "volume": int(data["volume"])}
                )

    integration = TestRadio(hub, {})
    hub.integrations._integrations["testradio"] = integration
    await integration.setup()
    return protokoll


async def test_favorit_speichern_und_abspielen(hub):
    protokoll = await _radio_bauen(hub)
    eintrag = hub.musik.favorit_setzen(
        {"kind": "station", "name": "SRF 3", "player": "testradio.radio"}
    )
    assert hub.musik.favoriten()[0]["name"] == "SRF 3"

    await hub.musik.favorit_abspielen(eintrag["id"], device="Küche")
    assert protokoll.befehle == [
        ("testradio.radio", "play_radio", {"station": "SRF 3", "device": "Küche"})
    ]


async def test_favorit_findet_den_player_auch_ohne_angabe(hub):
    """Ein Favorit muss nicht wissen, wo Spotify hängt - der Hub sucht
    sich den, der das Kommando kann."""
    eintrag = hub.musik.favorit_setzen({"kind": "playlist", "name": "Party"})
    await hub.musik.favorit_abspielen(eintrag["id"])


async def test_eine_art_die_der_hub_nicht_kennt(hub):
    with pytest.raises(HomePilotError, match="nichts anfangen"):
        await hub.musik.abspielen({"kind": "kassette", "name": "Mixtape"})


async def test_favorit_entfernen(hub):
    eintrag = hub.musik.favorit_setzen({"kind": "station", "name": "SRF 1"})
    assert hub.musik.favorit_entfernen(eintrag["id"]) is True
    assert hub.musik.favorit_entfernen(eintrag["id"]) is False


async def test_verlauf_faengt_ein_was_gespielt_hat(hub):
    await _radio_bauen(hub)
    await hub.registry.update_state(
        "testradio.box", {"state": "playing", "track": "Shivers", "artist": "Ed Sheeran"}
    )
    await asyncio.sleep(0)
    verlauf = hub.musik.verlauf()
    assert verlauf and verlauf[0]["track"] == "Shivers"
    assert verlauf[0]["player"] == "Küche"


async def test_schlummer_blendet_aus_und_pausiert(hub):
    protokoll = await _radio_bauen(hub)
    # Der Timer wartet sonst Minuten - hier reicht der letzte Abschnitt.
    await hub.ton.ausblenden("testradio.box", dauer=0.2)
    lautstaerken = [
        int(daten["volume"])
        for eid, befehl, daten in protokoll.befehle
        if befehl == "set_volume" and eid == "testradio.box"
    ]
    # Erst leiser …
    assert lautstaerken[0] == 40
    assert min(lautstaerken) == 0
    # … dann Pause …
    assert ("testradio.box", "pause", {}) in protokoll.befehle
    # … und am Ende steht die alte Lautstärke wieder da, sonst wäre die
    # Box beim nächsten Einschalten stumm.
    assert lautstaerken[-1] == 40


async def test_schlummer_laesst_sich_abbrechen(hub):
    await _radio_bauen(hub)
    stand = hub.musik.schlummer("testradio.box", 30)
    assert stand["ends_at"] > time.time()
    assert len(hub.musik.schlummer_stand()) == 1
    assert hub.musik.schlummer_abbrechen("testradio.box") is True
    assert hub.musik.schlummer_stand() == []


async def test_schlummer_auf_eine_unbekannte_box(hub):
    with pytest.raises(HomePilotError, match="kennt der Hub nicht"):
        hub.musik.schlummer("gibt.es.nicht", 30)


async def test_musikwecker_geht_zur_richtigen_zeit_los(hub):
    protokoll = await _radio_bauen(hub)
    stand = time.localtime()
    hub.musik.wecker_setzen(
        {
            "time": time.strftime("%H:%M", stand),
            "days": [stand.tm_wday],
            "player": "testradio.radio",
            "device": "Küche",
            "kind": "station",
            "name": "SRF 3",
            "volume": 30,
        }
    )
    gelaufen = await hub.musik.wecker_pruefung()
    assert len(gelaufen) == 1
    assert ("testradio.radio", "play_radio", {"station": "SRF 3", "device": "Küche"}) in protokoll.befehle

    # Ein zweiter Blick in derselben Minute weckt nicht noch einmal.
    assert await hub.musik.wecker_pruefung() == []


async def test_musikwecker_blendet_ein(hub):
    protokoll = await _radio_bauen(hub)
    stand = time.localtime()
    hub.musik.wecker_setzen(
        {
            "time": time.strftime("%H:%M", stand),
            "days": [stand.tm_wday],
            "player": "testradio.radio",
            "device": "Küche",
            "kind": "station",
            "name": "SRF 3",
            "volume": 30,
            "fade": 0.2,
        }
    )
    await hub.musik.wecker_pruefung()
    for _ in range(80):
        await asyncio.sleep(0.02)
        lautstaerken = [
            int(daten["volume"])
            for eid, befehl, daten in protokoll.befehle
            if befehl == "set_volume" and eid == "testradio.box"
        ]
        if lautstaerken and lautstaerken[-1] == 30:
            break
    # Von leise nach laut - der Unterschied zwischen geweckt und
    # erschreckt.
    assert lautstaerken[0] == 0
    assert lautstaerken[-1] == 30


# ── Nachbesserung: der Schlummer-Timer über einen Neustart ───────────────


async def test_schlummer_wird_nach_dem_neustart_wieder_gestellt(hub):
    await _radio_bauen(hub)
    hub.musik.schlummer("testradio.box", 30)
    gespeichert = hub.data.get("musik_schlummer")
    assert gespeichert and gespeichert[0]["entity_id"] == "testradio.box"

    # Der Neustart: ein frisches Musikbuch auf derselben Datendatei.
    from homepilot.core.musik import Musikbuch

    neu = Musikbuch(hub)
    hub.musik = neu
    await neu._schlummer_nachholen()
    assert [zeile["entity_id"] for zeile in neu.schlummer_stand()] == ["testradio.box"]
    await neu.stop()


async def test_ein_faelliger_schlummer_wird_nachgeholt(hub):
    protokoll = await _radio_bauen(hub)
    hub.data.set(
        "musik_schlummer",
        [{"entity_id": "testradio.box", "ends_at": time.time() - 60}],
    )
    from homepilot.core.musik import Musikbuch

    neu = Musikbuch(hub)
    hub.musik = neu
    await neu._schlummer_nachholen()
    # Die Musik sollte aus sein - der Wunsch galt vor einer Minute.
    assert ("testradio.box", "pause", {}) in protokoll.befehle
    await neu.stop()


async def test_ein_uralter_schlummer_wird_vergessen(hub):
    """Musik, die zwölf Stunden später von selbst aufhört, ist kein
    Dienst, sondern ein Spuk."""
    protokoll = await _radio_bauen(hub)
    hub.data.set(
        "musik_schlummer",
        [{"entity_id": "testradio.box", "ends_at": time.time() - 86400}],
    )
    from homepilot.core.musik import Musikbuch

    neu = Musikbuch(hub)
    hub.musik = neu
    await neu._schlummer_nachholen()
    assert all(befehl != "pause" for _, befehl, _ in protokoll.befehle)
    assert hub.data.get("musik_schlummer") == []
    await neu.stop()


# ── Musik als Schritt in einem Ablauf ────────────────────────────────────
#
# Alles davon gab es schon - als Knopf in der App, nicht als Schritt in
# einem Ablauf. «Wenn alle weg sind: Musik aus» ging deshalb nur über den
# nackten Pause-Befehl je Box, und wer eine Box vergass, merkte es erst
# beim Heimkommen.


def test_musik_satz_ist_lesbar():
    from homepilot.core.automation import musik_satz

    def named(entity_id):
        return "Küche" if entity_id == "cast.kueche" else str(entity_id)

    assert musik_satz({"do": "pause_all"}, named) == "überall Pause"
    assert musik_satz({"do": "night"}, named) == "Nachtruhe ein"
    assert musik_satz({"do": "night", "on": False}, named) == "Nachtruhe aus"
    assert musik_satz({"do": "favorite", "favorite": "SRF 3"}, named) == (
        "Favorit «SRF 3» abspielen"
    )
    assert musik_satz(
        {"do": "favorite", "favorite": "SRF 3", "device": "Bad"}, named
    ) == "Favorit «SRF 3» abspielen auf Bad"
    assert musik_satz(
        {"do": "sleep", "entity_id": "cast.kueche", "minutes": 45}, named
    ) == "Küche: nach 45 Min ausblenden"
    assert musik_satz({"do": "fade", "entity_id": "cast.kueche"}, named) == (
        "Küche: leise starten bis 30 %"
    )
    # Ein Tippfehler soll im Trockenlauf auffallen, nicht erst nachts.
    assert "unbekannt" in musik_satz({"do": "quatsch"}, named)


async def _ablauf_laufen_lassen(hub, aktion):
    """Einen einzelnen Schritt durch die Ablauf-Maschinerie schicken."""
    from homepilot.core.automation import Automation

    automation = Automation(
        id="test", alias="Test", triggers=[], conditions=[], actions=[aktion], enabled=True
    )
    return await hub.automations._execute_action(automation, aktion, None)


async def test_ablauf_pausiert_ueberall(hub):
    protokoll = await _radio_bauen(hub)
    await hub.registry.update_state("testradio.box", {"state": "playing", "volume": 40})

    await _ablauf_laufen_lassen(hub, {"type": "music", "do": "pause_all"})
    assert ("testradio.box", "pause", {}) in protokoll.befehle


async def test_ablauf_meldet_wenn_nichts_lief(hub):
    """Kein Fehler, aber eine Notiz: «hat nichts getan» und «konnte
    nichts tun» sind im Protokoll zwei verschiedene Zeilen."""
    await _radio_bauen(hub)
    await hub.registry.update_state("testradio.box", {"state": "paused"})
    notiz = await _ablauf_laufen_lassen(hub, {"type": "music", "do": "pause_all"})
    assert notiz == "es lief nichts"


async def test_ablauf_spielt_einen_favoriten(hub):
    protokoll = await _radio_bauen(hub)
    hub.musik.favorit_setzen(
        {"kind": "station", "name": "SRF 3", "player": "testradio.radio"}
    )
    await _ablauf_laufen_lassen(
        hub, {"type": "music", "do": "favorite", "favorite": "SRF 3"}
    )
    assert ("testradio.radio", "play_radio", {"station": "SRF 3"}) in protokoll.befehle


async def test_ein_geloeschter_favorit_haelt_den_ablauf_nicht_an(hub):
    await _radio_bauen(hub)
    notiz = await _ablauf_laufen_lassen(
        hub, {"type": "music", "do": "favorite", "favorite": "Gibt es nicht"}
    )
    assert notiz is not None and "gibt es nicht mehr" in notiz


async def test_ablauf_schaltet_die_nachtruhe(hub):
    assert hub.ton.nachtruhe()["on"] is False
    await _ablauf_laufen_lassen(hub, {"type": "music", "do": "night", "on": True})
    assert hub.ton.nachtruhe()["on"] is True
    await _ablauf_laufen_lassen(hub, {"type": "music", "do": "night", "on": False})
    assert hub.ton.nachtruhe()["on"] is False


async def test_ablauf_stellt_einen_schlummer_timer(hub):
    await _radio_bauen(hub)
    await _ablauf_laufen_lassen(
        hub,
        {"type": "music", "do": "sleep", "entity_id": "testradio.box", "minutes": 45},
    )
    assert [zeile["entity_id"] for zeile in hub.musik.schlummer_stand()] == [
        "testradio.box"
    ]
