"""Life360 als Standortquelle für Telefone ohne HomePilot.

Der eigene Weg bleibt der bessere - die App meldet den Übertritt selbst.
Diese Integration ist für die Geräte, auf denen sie nie laufen wird: das
Telefon der Grosseltern, ein Kindergerät. Weil Life360 keine offene
Schnittstelle hat und Fremdzugriffe zeitweise sperrt, steht hier vor
allem, was bei Gegenwind passiert.
"""

import time

import pytest

from homepilot.integrations.life360 import (
    MAX_ALTER,
    PAUSEN,
    Life360Integration,
    abstand_meter,
    meldungen_fuer,
    parse_members,
    parse_position,
    pause_nach,
    zone_fuer_mitglied,
    zu_alt,
)

HAUS = {"id": "home", "name": "Zuhause", "latitude": 47.1381, "longitude": 7.9228,
        "radius": 150.0}
QUARTIER = {**HAUS, "id": "quartier", "radius": 3000.0}


def test_zuordnung_verlangt_beide_seiten():
    zuordnung = parse_members({"Oma": "oma", "  ": "x", "Levin": "  ", "Lina": "lina"})
    assert zuordnung == {"oma": "oma", "lina": "lina"}


def test_das_mitglied_findet_seine_zone_ueber_den_vornamen():
    zuordnung = parse_members({"Levin": "levin"})
    assert zone_fuer_mitglied({"firstName": "Levin", "lastName": "Gross"}, zuordnung) == (
        "levin"
    )
    # Und über den ganzen Namen, wenn er so eingetragen ist.
    ganz = parse_members({"Levin Gross": "levin"})
    assert zone_fuer_mitglied({"firstName": "Levin", "lastName": "Gross"}, ganz) == "levin"


def test_wer_nicht_eingetragen_ist_meldet_nichts():
    # Kein automatisches Anlegen: Der Hub soll nicht jeden Eintrag eines
    # fremden Kreises zu einer Anwesenheit machen.
    assert zone_fuer_mitglied({"firstName": "Fremd"}, parse_members({"Oma": "oma"})) is None


def test_position_kommt_als_text_und_wird_zu_zahlen():
    position = parse_position(
        {"location": {"latitude": "47.1381", "longitude": "7.9228",
                      "timestamp": "1787500000", "battery": "84"}}
    )
    assert position == {
        "latitude": 47.1381,
        "longitude": 7.9228,
        "timestamp": 1787500000.0,
        "battery": 84,
    }


def test_ohne_ort_gibt_es_nichts_zu_melden():
    assert parse_position({"location": {}}) is None
    # 0/0 ist der Atlantik, nicht «unbekannt».
    assert parse_position({"location": {"latitude": "0", "longitude": "0"}}) is None


def test_abstand_stimmt_ungefaehr():
    meter = abstand_meter(47.1381, 7.9228, 47.1481, 7.9228)
    assert 1090 < meter < 1130


def test_es_wird_auch_das_verlassen_gemeldet():
    # Sonst bliebe der alte Eintrag beim Geofence stehen, bis jemand den
    # Hub neu startet.
    drin = meldungen_fuer([HAUS, QUARTIER], 47.1381, 7.9228)
    assert drin == [("home", "enter"), ("quartier", "enter")]
    weg = meldungen_fuer([HAUS, QUARTIER], 47.2381, 7.9228)
    assert weg == [("home", "leave"), ("quartier", "leave")]


def test_ein_kaputter_ort_nimmt_die_anderen_nicht_mit():
    assert meldungen_fuer([{"id": "kaputt"}, HAUS], 47.1381, 7.9228) == [("home", "enter")]


def test_die_pause_waechst_und_hoert_irgendwo_auf():
    assert pause_nach(0) == 0.0
    assert pause_nach(1) == PAUSEN[0]
    assert pause_nach(3) == PAUSEN[2]
    # Wer gegen eine Sperre anrennt, verlängert sie - aber unendlich
    # lange Pausen wären auch keine Antwort.
    assert pause_nach(99) == PAUSEN[-1]


def test_eine_alte_ortsmeldung_zaehlt_nicht():
    jetzt = time.time()
    assert zu_alt(jetzt - 60, jetzt) is False
    assert zu_alt(jetzt - MAX_ALTER - 1, jetzt) is True
    # Ohne Zeitstempel wird nichts verworfen - manche Konten liefern keinen.
    assert zu_alt(0, jetzt) is False


# ── Was beim Melden wirklich passiert ────────────────────────────────────


class StubGeofence:
    """Ein Geofence, der mitschreibt statt zu schalten."""

    def __init__(self, zonen=("oma",)):
        self.places = [HAUS, QUARTIER]
        self.zonen = zonen
        self.gemeldet: list[tuple] = []

    async def report(self, zone, event, place=None, battery=None):
        if zone not in self.zonen:
            raise KeyError(zone)
        self.gemeldet.append((zone, event, place, battery))
        return "home" if event == "enter" else "away"


def _integration() -> Life360Integration:
    dienst = Life360Integration.__new__(Life360Integration)
    dienst._members = parse_members({"Oma": "oma"})
    return dienst


class _Log:
    def __init__(self):
        self.zeilen = []

    def info(self, *args):
        self.zeilen.append(args[0] % args[1:] if len(args) > 1 else args[0])

    warning = info


@pytest.mark.asyncio
async def test_zuhause_wird_je_ort_gemeldet():
    dienst = _integration()
    dienst.log = _Log()
    geofence = StubGeofence()
    await dienst._melden(
        geofence,
        {
            "firstName": "Oma",
            "location": {"latitude": "47.1381", "longitude": "7.9228",
                         "timestamp": str(time.time()), "battery": "72"},
        },
        time.time(),
    )
    assert geofence.gemeldet == [
        ("oma", "enter", "home", 72),
        ("oma", "enter", "quartier", 72),
    ]


@pytest.mark.asyncio
async def test_eine_stunde_alte_meldung_wird_nicht_uebernommen():
    dienst = _integration()
    dienst.log = _Log()
    geofence = StubGeofence()
    await dienst._melden(
        geofence,
        {
            "firstName": "Oma",
            "location": {"latitude": "47.1381", "longitude": "7.9228",
                         "timestamp": str(time.time() - 7200)},
        },
        time.time(),
    )
    assert geofence.gemeldet == []


@pytest.mark.asyncio
async def test_eine_fehlende_zone_sagt_was_zu_tun_ist():
    dienst = _integration()
    dienst.log = _Log()
    geofence = StubGeofence(zonen=())
    await dienst._melden(
        geofence,
        {
            "firstName": "Oma",
            "location": {"latitude": "47.1381", "longitude": "7.9228",
                         "timestamp": str(time.time())},
        },
        time.time(),
    )
    assert geofence.gemeldet == []
    assert any("zones" in zeile for zeile in dienst.log.zeilen)


class _Integrationen:
    """Die Integrations-Verwaltung des Hubs, so weit sie hier gebraucht wird."""

    def __init__(self, geofence=None):
        self._geofence = geofence

    def get(self, name):
        return self._geofence if name == "geofence" else None


class _Hub:
    def __init__(self, geofence=None):
        self.integrations = _Integrationen(geofence)


@pytest.mark.asyncio
async def test_ohne_geofence_wird_seltener_gefragt_statt_zu_scheitern():
    # Die geofence-Integration kann nachträglich dazukommen; ein Hub, der
    # deswegen nicht hochfährt, nimmt einem das ganze Haus.
    dienst = _integration()
    dienst.log = _Log()
    dienst.hub = _Hub(None)
    dienst._interval = 60.0
    assert await dienst._runde() >= 300.0


@pytest.mark.asyncio
async def test_eine_sperre_verlaengert_die_pause_statt_der_abfragen():
    import aiohttp

    dienst = _integration()
    dienst.log = _Log()
    dienst.hub = _Hub(StubGeofence())
    dienst._interval = 60.0
    dienst._fehler = 0

    async def sperre():
        raise aiohttp.ClientResponseError(None, (), status=429)

    dienst._mitglieder = sperre
    assert await dienst._runde() == PAUSEN[0]
    assert await dienst._runde() == PAUSEN[1]
    assert await dienst._runde() == PAUSEN[2]
    # Und der Grund steht im Protokoll, nicht bloss «Fehler».
    assert any("429" in zeile for zeile in dienst.log.zeilen)


@pytest.mark.asyncio
async def test_nach_einer_guten_antwort_ist_die_pause_wieder_kurz():
    dienst = _integration()
    dienst.log = _Log()
    geofence = StubGeofence()
    dienst.hub = _Hub(geofence)
    dienst._interval = 60.0
    dienst._fehler = 3

    async def antwort():
        return [
            {
                "firstName": "Oma",
                "location": {
                    "latitude": "47.1381",
                    "longitude": "7.9228",
                    "timestamp": str(time.time()),
                    "battery": "50",
                },
            }
        ]

    dienst._mitglieder = antwort
    assert await dienst._runde() == 60.0
    assert geofence.gemeldet[0] == ("oma", "enter", "home", 50)
