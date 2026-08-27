"""Bluetooth-Anhänger: wo liegt der Schlüssel?

Und die Frage davor, die genauso wichtig ist: warum nicht mit einem
AirTag. Der sendet seine Kennung verschlüsselt und wechselt sie
ständig - wiedererkennen kann ihn nur, wer den privaten Schlüssel des
Besitzers hat.
"""

from homepilot.core import bletag
from homepilot.integrations.bletags import object_id, tags_lesen


def test_nur_geraetemeldungen_werden_gelesen():
    assert bletag.thema_lesen("espresense/devices/tile:ab/Buero") == ("tile:ab", "Buero")
    # Telemetrie, Einstellungen, fremde Themen: nichts davon ist ein Anhänger.
    assert bletag.thema_lesen("espresense/rooms/Buero/telemetry") is None
    assert bletag.thema_lesen("espresense/devices/tile:ab") is None
    assert bletag.thema_lesen("zigbee2mqtt/devices/x/y") is None


def test_ohne_entfernung_ist_die_meldung_wertlos():
    """Aus blosser Signalstärke ohne Kalibrierung eine Entfernung zu
    raten wäre eine erfundene Zahl."""
    assert bletag.abstand({"distance": 3.24}) == 3.2
    assert bletag.abstand({"rssi": -70}) is None
    assert bletag.abstand({"distance": "weit"}) is None
    assert bletag.abstand(None) is None
    # Unsinnig weit heisst: nicht brauchbar.
    assert bletag.abstand({"distance": 500}) is None


def test_das_naechste_zimmer_gewinnt():
    stand = bletag.melden({}, "Buero", 6.0, 1000)
    stand = bletag.melden(stand, "Kueche", 1.5, 1000)
    assert bletag.zustand(stand, 1000) == {
        "state": "Kueche",
        "room": "Kueche",
        "distance": 1.5,
    }


def test_ein_knapper_unterschied_laesst_das_zimmer_stehen():
    """Sonst springt der Schlüssel auf dem Küchentisch die halbe Nacht
    zwischen Küche und Wohnzimmer."""
    stand = bletag.melden({}, "Kueche", 2.4, 1000)
    stand = bletag.melden(stand, "Wohnzimmer", 2.0, 1000)
    assert bletag.zustand(stand, 1000, bisher="Kueche")["room"] == "Kueche"
    # Deutlich näher wechselt trotzdem.
    stand = bletag.melden(stand, "Wohnzimmer", 0.6, 1000)
    assert bletag.zustand(stand, 1000, bisher="Kueche")["room"] == "Wohnzimmer"


def test_alte_meldungen_zaehlen_nicht_mehr():
    """Ein Empfänger, der seit fünf Minuten schweigt, sagt nichts
    darüber, wo der Anhänger jetzt liegt."""
    stand = bletag.melden({}, "Buero", 1.0, 1000)
    assert bletag.zustand(stand, 1000 + bletag.FRIST + 1) == {
        "state": "weg",
        "room": None,
        "distance": None,
    }


def test_ohne_kennung_kein_anhaenger():
    """Sie ist das Einzige, woran der Hub ihn wiedererkennt."""
    assert tags_lesen([{"name": "Schlüssel"}]) == []
    assert tags_lesen([{"id": "tile:ab"}]) == [{"id": "tile:ab", "name": "tile:ab"}]
    assert tags_lesen(None) == []


def test_aus_der_kennung_wird_eine_brauchbare_entitaets_id():
    assert object_id("tile:abcd-12") == "tile_abcd_12"
    assert object_id("!!!") == "tag"


async def test_die_kacheln_stehen_da_bevor_der_erste_empfaenger_meldet():
    """Ein Anhänger, von dem der Hub noch nichts gehört hat, ist nicht
    «nirgends» - er ist unbekannt. Das ist der Unterschied zwischen
    einer leeren Kachel und gar keiner."""
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            integrations=[
                {
                    "integration": "bletags",
                    # Kein Broker in Reichweite: Die Verbindungsschleife
                    # versucht es im Hintergrund weiter, die Kacheln
                    # stehen trotzdem.
                    "broker": "127.0.0.1",
                    "port": 1,
                    "tags": [{"id": "tile:abcd", "name": "Schlüsselbund"}],
                }
            ]
        )
    )
    await hub.start()
    try:
        entity = hub.registry.get("bletags.tile_abcd")
        assert entity is not None
        assert entity.name == "Schlüsselbund"
        assert entity.state["state"] == "weg"
        assert entity.available is False
    finally:
        await hub.stop()


async def test_ohne_tags_bleibt_die_anbindung_weg_statt_leer_dazustehen():
    """Eine Anbindung ohne einen einzigen Anhänger kann nichts zeigen.
    Der Hub lässt sie darum gar nicht erst hochkommen - die Meldung im
    Protokoll sagt, wo die Kennungen herkommen."""
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            integrations=[{"integration": "bletags", "broker": "127.0.0.1"}]
        )
    )
    await hub.start()
    try:
        assert hub.integrations.get("bletags") is None
        assert not [e for e in hub.registry.all() if e.integration == "bletags"]
    finally:
        await hub.stop()
