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
    health_detail,
    meldungen_fuer,
    namen_je_zone,
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
        # Ohne gespeicherten Ort schickt Life360 keinen Namen mit.
        "place": None,
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
        self.quellen: list[str] = []
        self.namen: list[str | None] = []
        self.punkte: list[tuple] = []

    async def report(
        self,
        zone,
        event,
        place=None,
        battery=None,
        source="geofence",
        place_name=None,
        latitude=None,
        longitude=None,
    ):
        if zone not in self.zonen:
            raise KeyError(zone)
        self.gemeldet.append((zone, event, place, battery))
        self.quellen.append(source)
        self.namen.append(place_name)
        # Für «noch 4 km»: Der Geofence rechnet daraus die Entfernung.
        self.punkte.append((latitude, longitude))
        return "home" if event == "enter" else "away"


def _integration() -> Life360Integration:
    dienst = Life360Integration.__new__(Life360Integration)
    dienst._members = parse_members({"Oma": "oma"})
    # Das Gedächtnis für den zuletzt gemeldeten Life360-Ort legt sonst
    # setup() an, das hier bewusst nicht läuft.
    dienst._letzter_ort = {}
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


def test_life360_meldet_sich_als_life360_und_nicht_als_geofence():
    """Sonst steht in der Diagnose bei allen «geofence».

    Die Frage, die man dort stellt, ist «liefert Life360 überhaupt?» –
    und die war nicht zu beantworten, weil die Meldung durch dieselbe
    Türe kommt wie die des Telefons und die Herkunft unterwegs verlor.
    """
    import asyncio

    dienst = _integration()
    dienst.log = _Log()
    geofence = StubGeofence()
    asyncio.run(
        dienst._melden(
            geofence,
            {
                "firstName": "Oma",
                "location": {
                    "latitude": "47.13844",
                    "longitude": "7.92059",
                    "timestamp": str(time.time()),
                    "battery": "72",
                },
            },
            time.time(),
        )
    )
    assert geofence.quellen
    assert set(geofence.quellen) == {"life360"}


# ── Die gespeicherten Orte von Life360 ───────────────────────────────────
#
# «Maja ist bei Tanners Home» ist die Antwort, die man auf der
# Familienseite lesen will. «unterwegs» ist dort die halbe Wahrheit:
# Life360 weiss den Namen, der Hub warf ihn bloss weg.


def test_ortsschluessel_macht_aus_dem_namen_eine_kennung():
    from homepilot.integrations.life360 import ortsschluessel

    # Dieselbe Machart wie `home` und `quartier` – darauf hört ein Ablauf.
    assert ortsschluessel("Tanners Home") == "tanners_home"
    assert ortsschluessel("  Schule   Zell ") == "schule_zell"
    assert ortsschluessel("Oma & Opa") == "oma_opa"
    # Was nach dem Aussieben nichts übrig lässt, gibt keine Kennung –
    # der Aufrufer lässt den Ort dann weg.
    assert ortsschluessel("🏠") == ""
    assert ortsschluessel("") == ""


def test_der_name_des_ortes_kommt_aus_den_mitgliedsdaten():
    position = parse_position(
        {
            "location": {
                "latitude": "47.20",
                "longitude": "8.10",
                "timestamp": str(time.time()),
                "name": "Tanners Home",
            }
        }
    )
    assert position["place"] == "Tanners Home"


@pytest.mark.asyncio
async def test_ein_gespeicherter_ort_wird_mit_klarnamen_gemeldet():
    dienst = _integration()
    dienst.log = _Log()
    geofence = StubGeofence()
    await dienst._melden(
        geofence,
        {
            "firstName": "Oma",
            # Weit weg von Haus und Quartier – dort greift kein eigener Ort.
            "location": {
                "latitude": "47.30",
                "longitude": "8.40",
                "timestamp": str(time.time()),
                "name": "Tanners Home",
            },
        },
        time.time(),
    )
    ankunft = [zeile for zeile in geofence.gemeldet if zeile[1] == "enter"]
    assert ankunft == [("oma", "enter", "tanners_home", None)]
    # Der Klarname reist mit, sonst stünde in der App die Kennung.
    assert "Tanners Home" in geofence.namen


@pytest.mark.asyncio
async def test_das_eigene_zuhause_schlaegt_den_namen_von_life360():
    """Sonst hinge die Alarmanlage an einem Namen aus einer fremden App.

    Steht jemand im Hausradius, heisst das «zuhause» – auch wenn der Ort
    bei Life360 «Tanners Home» heisst.
    """
    dienst = _integration()
    dienst.log = _Log()
    geofence = StubGeofence()
    await dienst._melden(
        geofence,
        {
            "firstName": "Oma",
            # Mitten im Hausradius – die Vorgabe HAUS von oben.
            "location": {
                "latitude": str(HAUS["latitude"]),
                "longitude": str(HAUS["longitude"]),
                "timestamp": str(time.time()),
                "name": "Tanners Home",
            },
        },
        time.time(),
    )
    orte = [zeile[2] for zeile in geofence.gemeldet if zeile[1] == "enter"]
    assert "home" in orte
    assert "tanners_home" not in orte


@pytest.mark.asyncio
async def test_wer_weiterfaehrt_verlaesst_den_alten_ort_wieder():
    """Ohne Abmeldung bliebe «Tanners Home» für immer stehen.

    Der Geofence führt je Zone eine Liste der Orte, in denen sie steckt,
    und räumt sie nur auf Meldung.
    """
    dienst = _integration()
    dienst.log = _Log()
    geofence = StubGeofence()
    weit = {
        "firstName": "Oma",
        "location": {"latitude": "47.30", "longitude": "8.40",
                     "timestamp": str(time.time()), "name": "Tanners Home"},
    }
    await dienst._melden(geofence, weit, time.time())
    assert dienst._letzter_ort["oma"] == "tanners_home"

    # Jetzt unterwegs, ohne gespeicherten Ort.
    unterwegs = {
        "firstName": "Oma",
        "location": {"latitude": "47.31", "longitude": "8.41",
                     "timestamp": str(time.time())},
    }
    geofence.gemeldet.clear()
    await dienst._melden(geofence, unterwegs, time.time())
    assert ("oma", "leave", "tanners_home", None) in geofence.gemeldet
    assert "oma" not in dienst._letzter_ort


# ── «Quartier» ist kein Aufenthaltsort ───────────────────────────────────
#
# Der gemeldete Fall: «Ausserdem stimmt hier ‹Quartier› auch nicht. Z.B.
# Maja ist bei ‹Tanners Home›.» Die Vorlaufzone ist drei Kilometer weit
# und verschluckte damit jeden benannten Ort im Dorf.


@pytest.mark.asyncio
async def test_ein_benannter_ort_schlaegt_die_weite_vorlaufzone():
    dienst = _integration()
    dienst.log = _Log()
    geofence = StubGeofence()
    # Zwei Kilometer vom Haus: im Quartier (3 km), aber nicht zuhause.
    await dienst._melden(
        geofence,
        {
            "firstName": "Oma",
            "location": {
                "latitude": str(HAUS["latitude"] + 0.018),
                "longitude": str(HAUS["longitude"]),
                "timestamp": str(time.time()),
                "name": "Tanners Home",
            },
        },
        time.time(),
    )
    ankunft = [zeile[2] for zeile in geofence.gemeldet if zeile[1] == "enter"]
    # Beides wird gemeldet – der Vorlauf bleibt als Auslöser erhalten.
    assert "quartier" in ankunft
    assert "tanners_home" in ankunft


def test_place_state_stellt_den_benannten_ort_vor_das_quartier():
    from homepilot.core import presence

    orte = presence.parse_places(
        [
            {"id": "home", "name": "Zuhause", "latitude": 47.1, "longitude": 8.0,
             "radius": 150},
            {"id": "quartier", "name": "Quartier", "latitude": 47.1, "longitude": 8.0,
             "radius": 3000},
        ]
    )
    # Im Quartier und bei einem benannten Ort: Der Name gewinnt.
    assert presence.place_state(["quartier", "tanners_home"], orte) == (
        "tanners_home",
        "tanners_home",
    )
    # Zuhause bleibt zuhause – daran hängen Alarmanlage und Abläufe.
    assert presence.place_state(["home", "quartier", "tanners_home"], orte) == (
        "home",
        "home",
    )
    # Und ohne fremden Namen bleibt alles wie bisher.
    assert presence.place_state(["quartier"], orte) == ("quartier", "quartier")


# ── Was die Diagnose sagt ────────────────────────────────────────────────
#
# Die Integration legt keine eigenen Entitäten an - im System-Bildschirm
# stand deshalb «0 Geräte», was wie eine Störung aussieht und die eine
# Frage nicht beantwortet, für die man dort hinschaut.


def test_der_name_zur_zone_bleibt_wie_er_in_der_konfiguration_steht():
    namen = namen_je_zone({"Levin Gross": "levin", "Oma ": " oma ", "  ": "x"})
    assert namen == {"levin": "Levin Gross", "oma": "Oma"}


def test_ohne_geofence_ist_alles_andere_gegenstandslos():
    satz = health_detail(2, 2, geofence=False)
    assert "geofence" in satz
    # Keine Zahlen: Sie wären wahr und trotzdem irreführend.
    assert "2 von 2" not in satz


def test_eine_sperre_steht_vor_den_zahlen():
    satz = health_detail(1, 1, fehler=2, grund="Life360 antwortet mit 429")
    assert "429" in satz
    assert f"{PAUSEN[1]:.0f} s" in satz
    assert "1 von 1" not in satz


def test_der_normalfall_zaehlt_die_personen_nicht_die_geraete():
    assert health_detail(2, 2) == "2 von 2 Personen gemeldet"
    assert health_detail(1, 1) == "1 von 1 Person gemeldet"
    assert health_detail(1, 0, abgefragt=False) == "Erste Abfrage steht noch aus."


def test_wer_im_kreis_fehlt_und_wer_nur_schweigt_stehen_getrennt():
    # Verschiedene Ursachen, verschiedene Abhilfe: Schreibweise
    # korrigieren oder Akku laden.
    satz = health_detail(3, 1, unbekannt=["Oma"], still=["Levin"])
    assert "im Kreis nicht gefunden: Oma" in satz
    assert "ohne frische Ortsmeldung: Levin" in satz


def test_die_diagnose_antwortet_auch_wenn_setup_nie_lief():
    # Scheitert setup() an einer fehlenden Zugangsangabe, fragt die
    # Diagnose trotzdem - und darf dabei nicht werfen.
    dienst = Life360Integration.__new__(Life360Integration)
    zustand = dienst.health()
    assert zustand["ok"] is True
    assert zustand["last_event"] is None


def test_die_diagnose_erkennt_den_namen_der_nirgends_steht():
    dienst = _integration()
    dienst._members = parse_members({"Oma": "oma", "Levin": "levin"})
    dienst._namen = namen_je_zone({"Oma": "oma", "Levin": "levin"})
    dienst._letzte_abfrage = time.time()
    dienst._gesehen = {"oma"}
    dienst._gemeldet = {"oma"}
    zustand = dienst.health()
    # Levin steht in der config.yaml und in keinem Kreis - das ist eine
    # Störung, auch wenn die Verbindung tadellos steht.
    assert zustand["ok"] is False
    assert "Levin" in zustand["detail"]
    assert "1 von 2 Personen gemeldet" in zustand["detail"]


@pytest.mark.asyncio
async def test_gemeldet_heisst_es_ging_wirklich_etwas_hinaus():
    dienst = _integration()
    dienst.log = _Log()
    geofence = StubGeofence()
    zuhause = {
        "firstName": "Oma",
        "location": {"latitude": "47.1381", "longitude": "7.9228",
                     "timestamp": str(time.time()), "battery": "72"},
    }
    assert await dienst._melden(geofence, zuhause, time.time()) is True
    # Eine Stunde alte Messung: Der Geofence hört nichts, also gilt sie
    # auch in der Diagnose nicht als Meldung.
    alt = {
        "firstName": "Oma",
        "location": {"latitude": "47.1381", "longitude": "7.9228",
                     "timestamp": str(time.time() - MAX_ALTER - 10)},
    }
    assert await dienst._melden(geofence, alt, time.time()) is False
    # Und wer gar nicht eingetragen ist, erst recht nicht.
    fremd = {"firstName": "Wer-auch-immer", "location": zuhause["location"]}
    assert await dienst._melden(geofence, fremd, time.time()) is False


# ── Die gespeicherten Orte von Life360 ───────────────────────────────────
#
# Bisher kannte der Hub einen fremden Ort erst, wenn jemand darin stand -
# Life360 schreibt den Namen dann in die Positionsmeldung. Für die
# Anzeige genügte das, für einen Ablauf nicht: «wenn Livia bei der Schule
# ankommt» braucht die Orte, bevor jemand dort ist.


def test_orte_werden_zu_gewoehnlichen_orten_des_hubs():
    from homepilot.integrations.life360 import parse_orte

    orte = parse_orte(
        {
            "places": [
                {
                    "id": "abc",
                    "name": "Schule Zell",
                    "latitude": "47.1502",
                    "longitude": "8.0641",
                    "radius": "200",
                }
            ]
        }
    )
    assert orte == [
        {
            "id": "schule_zell",
            "name": "Schule Zell",
            "latitude": 47.1502,
            "longitude": 8.0641,
            "radius": 200.0,
        }
    ]


def test_die_kennung_kommt_vom_namen_nicht_von_life360():
    from homepilot.integrations.life360 import parse_orte

    # Damit ein Ablauf «schule_zell» trägt und nicht «abc» - und damit
    # Orte, die früher über die Positionsmeldung hereinkamen, dieselbe
    # Kennung behalten.
    (ort,) = parse_orte(
        {"places": [{"id": "abc", "name": "Schule Zell", "latitude": "1", "longitude": "2"}]}
    )
    assert ort["id"] == "schule_zell"


def test_zu_enge_orte_werden_aufgeweitet():
    from homepilot.integrations.life360 import MIN_RADIUS, parse_orte

    # Ein Radius von 15 m trifft keine Handy-Ortung zuverlässig; der Ort
    # meldete sich sonst nie und niemand wüsste warum.
    (ort,) = parse_orte(
        {"places": [{"name": "Briefkasten", "latitude": "1", "longitude": "2", "radius": "15"}]}
    )
    assert ort["radius"] == MIN_RADIUS


def test_orte_ohne_koordinate_oder_namen_fallen_weg():
    from homepilot.integrations.life360 import parse_orte

    orte = parse_orte(
        {
            "places": [
                {"name": "Ohne Punkt", "radius": "100"},
                {"name": "", "latitude": "1", "longitude": "2"},
                {"name": "🎈", "latitude": "1", "longitude": "2"},
                {"name": "Krumm", "latitude": "keine Zahl", "longitude": "2"},
                {"name": "Gut", "latitude": "1", "longitude": "2", "radius": "100"},
            ]
        }
    )
    assert [ort["id"] for ort in orte] == ["gut"]


def test_derselbe_name_zweimal_kommt_einmal():
    from homepilot.integrations.life360 import parse_orte

    orte = parse_orte(
        {
            "places": [
                {"name": "Schule", "latitude": "1", "longitude": "2", "radius": "100"},
                {"name": "schule", "latitude": "9", "longitude": "9", "radius": "100"},
            ]
        }
    )
    assert len(orte) == 1


def test_leere_antwort_ist_kein_fehler():
    from homepilot.integrations.life360 import parse_orte

    assert parse_orte({}) == []
    assert parse_orte({"places": None}) == []
    assert parse_orte(None) == []
