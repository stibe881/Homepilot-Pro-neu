"""Kam die Meldung zu spät - oder erst das Ereignis?"""

from homepilot.pushcheck import passendes_ereignis, spanne, uhr


def test_die_spanne_traegt_ihr_vorzeichen():
    """Die Richtung ist die halbe Auskunft: Eine Meldung *vor* ihrem
    Ereignis gibt es nicht - steht da ein Minus, gehen zwei Uhren
    auseinander."""
    assert spanne(3) == "+3 s"
    assert spanne(-4) == "-4 s"
    assert spanne(600) == "+10 min"
    # Der gemeldete Fall, und genau so soll er dastehen.
    assert spanne(3600) == "+60 min"
    assert spanne(3720) == "+62 min"
    assert spanne(7260) == "+2 Std 1 min"


def test_unlesbare_zeit_bleibt_ein_fragezeichen():
    """Lieber ein Fragezeichen als eine erfundene Uhrzeit."""
    assert uhr(None) == "?"
    assert uhr("kaputt") == "?"


def test_zum_klingeln_gehoert_die_klingel_und_zum_alarm_die_anlage():
    ereignisse = [
        {"entity_id": "unifi.klingel", "kind": "binary_sensor", "name": "Klingel", "at": 1000},
        {"entity_id": "hm.fenster", "kind": "binary_sensor", "name": "Fenster", "at": 1100},
        {"entity_id": "alarm.haus", "kind": "alarm", "name": "Alarmanlage", "at": 1200},
    ]
    klingeln = passendes_ereignis({"category": "doorbell", "at": 1300}, ereignisse)
    assert klingeln is not None and klingeln["entity_id"] == "unifi.klingel"
    alarm = passendes_ereignis({"category": "alarm", "at": 1300}, ereignisse)
    assert alarm is not None and alarm["entity_id"] == "alarm.haus"


def test_nur_was_vor_der_meldung_liegt():
    """Ein Ereignis nach der Meldung kann sie nicht ausgelöst haben -
    sonst rechnete die Spalte «Verzug» einen negativen Wert aus und
    behauptete eine falsche Uhr."""
    ereignisse = [
        {"entity_id": "alarm.haus", "kind": "alarm", "name": "Alarmanlage", "at": 2000}
    ]
    assert passendes_ereignis({"category": "alarm", "at": 1000}, ereignisse) is None


def test_ohne_passende_art_bleibt_die_zeile_ohne_ereignis():
    """Für alles ausser Klingel und Alarm wäre jede Zuordnung geraten -
    und eine falsche ist schlechter als keine."""
    ereignisse = [{"entity_id": "x", "kind": "alarm", "name": "A", "at": 100}]
    assert passendes_ereignis({"category": "battery", "at": 200}, ereignisse) is None


def test_art_und_name_kommen_aus_der_geraetetabelle():
    """Die erste Messung aus dem Haus blieb in der Spalte «Verzug» bei
    jeder Zeile leer, obwohl Klingel und Alarm sauber im Protokoll
    standen: `/api/log` liefert `events` und `devices` getrennt, damit
    derselbe Gerätename nicht hundertmal über die Leitung geht - und
    dieses Werkzeug las `kind` direkt am Ereignis, wo nie etwas steht."""
    from homepilot.pushcheck import mit_geraeten, passendes_ereignis

    antwort = {
        "events": [{"entity_id": "unifi.klingel", "state": "on", "at": 1000}],
        "devices": {"unifi.klingel": {"name": "Haustüre", "kind": "binary_sensor"}},
    }
    ereignisse = mit_geraeten(antwort)
    assert ereignisse[0]["kind"] == "binary_sensor"
    treffer = passendes_ereignis({"category": "doorbell", "at": 1002}, ereignisse)
    assert treffer is not None and treffer["entity_id"] == "unifi.klingel"


def test_ohne_geraetetabelle_bleibt_die_liste_lesbar():
    from homepilot.pushcheck import mit_geraeten

    assert mit_geraeten({}) == []
    assert mit_geraeten({"events": [{"entity_id": "x", "at": 1}]}) == [
        {"entity_id": "x", "at": 1}
    ]
