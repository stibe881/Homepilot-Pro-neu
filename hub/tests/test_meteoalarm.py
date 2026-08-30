from homepilot.integrations.meteoalarm import (
    bis_wann,
    filter_by_location,
    ist_wind,
    max_severity,
    parse_feed,
    parse_polygon,
    point_in_polygon,
    schlagzeile,
)

SAMPLE_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <title>MeteoAlarm Switzerland</title>
  <entry>
    <title>Gewitter Warnung</title>
    <cap:event>Thunderstorm</cap:event>
    <cap:severity>Moderate</cap:severity>
    <cap:onset>2026-08-14T12:00:00+02:00</cap:onset>
    <cap:expires>2026-08-14T20:00:00+02:00</cap:expires>
    <cap:areaDesc>Zentralschweiz</cap:areaDesc>
  </entry>
  <entry>
    <title>Sturm Warnung</title>
    <cap:event>Wind</cap:event>
    <cap:severity>Severe</cap:severity>
    <cap:areaDesc>Alpen</cap:areaDesc>
  </entry>
</feed>
"""


def test_parse_feed():
    alerts = parse_feed(SAMPLE_FEED)
    assert len(alerts) == 2
    assert alerts[0]["event"] == "Thunderstorm"
    assert alerts[0]["severity"] == "Moderate"
    assert alerts[0]["area"] == "Zentralschweiz"
    assert alerts[1]["expires"] is None


def test_max_severity():
    alerts = parse_feed(SAMPLE_FEED)
    assert max_severity(alerts) == "Severe"
    assert max_severity([]) is None


def test_parse_polygon_skips_broken_pieces():
    """Ein kaputter Punkt im Umriss darf die Warnung nicht verwerfen."""
    assert parse_polygon("47.0,8.0 47.2,8.0 quatsch 47.2,8.2 47.0,abc") == [
        (47.0, 8.0),
        (47.2, 8.0),
        (47.2, 8.2),
    ]
    assert parse_polygon("") == []


def test_point_in_polygon():
    """Zell LU liegt im eigenen Rechteck, nicht im Nachbarrechteck."""
    hinterland = [(47.0, 7.9), (47.3, 7.9), (47.3, 8.2), (47.0, 8.2)]
    vierwaldstaettersee = [(46.9, 8.3), (47.1, 8.3), (47.1, 8.5), (46.9, 8.5)]
    zell = (47.1445, 8.0675)
    assert point_in_polygon(*zell, hinterland) is True
    assert point_in_polygon(*zell, vierwaldstaettersee) is False


def test_filter_by_location_keeps_only_the_own_region():
    """Der Fall aus der Praxis: «Luzern» im Namensfilter traf auch
    «Luzern-Alpnach» am Vierwaldstättersee. Mit dem Polygon zählt nur noch,
    ob der eigene Standort im Warngebiet liegt."""
    alpnach = {
        "area": "Luzern-Alpnach",
        "polygons": [[(46.9, 8.3), (47.1, 8.3), (47.1, 8.5), (46.9, 8.5)]],
    }
    daheim = {
        "area": "Entlebuch",
        "polygons": [[(47.0, 7.9), (47.3, 7.9), (47.3, 8.2), (47.0, 8.2)]],
    }
    # Landesweite Warnung ohne Umriss: lieber behalten als unterschlagen.
    ohne_umriss = {"area": "Schweiz", "polygons": []}

    kept = filter_by_location([alpnach, daheim, ohne_umriss], 47.1445, 8.0675, [])
    assert [alert["area"] for alert in kept] == ["Entlebuch", "Schweiz"]

    # Mit Namensfilter als Rückfallebene wird auch die umrisslose geprüft.
    kept = filter_by_location([alpnach, ohne_umriss], 47.1445, 8.0675, ["Entlebuch"])
    assert kept == []


def test_wind_wird_von_regen_unterschieden():
    """Nur bei Wind gehören die Storen hoch.

    Bei Hitze, Regen oder Glatteis ändert sich an ihnen nichts – ein
    Sturmschutz, der bei jeder Warnung anspringt, fährt die Storen
    mehrmals im Sommer grundlos hoch und wird abgeschaltet.
    """
    assert ist_wind([{"event": "Wind", "title": "Sturm Warnung"}])
    assert not ist_wind([{"event": "Thunderstorm", "title": "Gewitter Warnung"}])
    assert not ist_wind([])


def test_wind_auch_wenn_die_art_nur_im_titel_steht():
    # Manche Länder tragen in `event` bloss «Warning» ein.
    assert ist_wind([{"event": "Warning", "title": "Orkanböen im Mittelland"}])
    # Und der Schweizer Feed liefert französische Einträge daneben.
    assert ist_wind([{"event": "Vent", "title": "Avis de tempête"}])


def test_schlagzeile_nimmt_die_staerkste_warnung():
    """Läuft gleichzeitig eine mässige und eine starke, ist die starke
    die Nachricht – nicht die, die zufällig zuerst im Feed steht."""
    alerts = parse_feed(SAMPLE_FEED)
    assert schlagzeile(alerts) == "Wind, stark"


def test_schlagzeile_nennt_das_ende_wenn_es_bekannt_ist():
    satz = schlagzeile(
        [
            {
                "event": "Sturm",
                "severity": "Severe",
                "expires": "2026-08-14T20:00:00+00:00",
            }
        ]
    )
    assert satz.startswith("Sturm, stark, bis ")


def test_ohne_warnung_keine_schlagzeile():
    assert schlagzeile([]) == ""


def test_unlesbares_ende_faellt_weg_statt_kaputt_dazustehen():
    assert bis_wann("") == ""
    assert bis_wann("bald") == ""
    assert bis_wann("2026-08-14T20:00:00+00:00") != ""
