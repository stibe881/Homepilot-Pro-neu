"""Was der Anlage die Sicht nimmt, während sie scharf ist.

Der Fall dahinter tarnt sich als Ruhe: Ein Funkkontakt am Kellerfenster
meldet sich nicht mehr, die Anlage steht weiter auf «scharf», und
niemand erfährt, dass dort seit vier Stunden nichts überwacht wird.
"""

from __future__ import annotations

from homepilot.core import alarmwache


def sensor(entity_id: str, *, label="", available=True, **zustand):
    return type(
        "E",
        (),
        {
            "id": entity_id,
            "label": label or entity_id,
            "available": available,
            "state": dict(zustand),
        },
    )()


def test_ein_stiller_sensor_faellt_erst_nach_der_frist_auf() -> None:
    """Ein Aussetzer ist der Normalfall - eine Meldung bei jedem davon
    liest nach einer Woche niemand mehr."""
    weg = sensor("hm.keller", available=False)
    assert alarmwache.befund(weg, 1000.0, seit=990.0) is None
    assert alarmwache.befund(weg, 1000.0, seit=600.0) == alarmwache.FUNKSTILLE


def test_ohne_vorgeschichte_zaehlt_der_ausfall_sofort() -> None:
    """Wer erst beim Scharfschalten hinsieht, hat keine - und ein
    Sensor, der in diesem Moment schon weg ist, ist weg."""
    weg = sensor("hm.keller", available=False)
    assert alarmwache.befund(weg, 1000.0) == alarmwache.FUNKSTILLE


def test_ein_sabotagemelder_sagt_es_selbst() -> None:
    melder = sensor("zb.tamper", device_class="tamper", state="on")
    assert alarmwache.befund(melder, 1000.0) == alarmwache.SABOTAGE


def test_ein_ruhiger_sabotagemelder_ist_kein_befund() -> None:
    melder = sensor("zb.tamper", device_class="tamper", state="off")
    assert alarmwache.befund(melder, 1000.0) is None


def test_die_leere_batterie_zaehlt_auch() -> None:
    schwach = sensor("hm.bad", low_battery=True)
    assert alarmwache.befund(schwach, 1000.0) == alarmwache.BATTERIE


def test_sabotage_steht_vor_funkstille_vor_batterie() -> None:
    """Die Nachricht zeigt nur die ersten - also müssen die richtigen
    vorne stehen."""
    stellen = alarmwache.blindstellen(
        [
            sensor("a", label="Bad", low_battery=True),
            sensor("b", label="Keller", available=False),
            sensor("c", label="Türe", device_class="tamper", state="on"),
        ],
        1000.0,
    )
    assert [zeile["art"] for zeile in stellen] == [
        alarmwache.SABOTAGE,
        alarmwache.FUNKSTILLE,
        alarmwache.BATTERIE,
    ]


def test_der_satz_nennt_die_art_und_nicht_nur_den_namen() -> None:
    """«Kellerfenster» allein liesse offen, ob es offen steht oder ob
    niemand mehr hinsieht - und das ist der ganze Unterschied."""
    stellen = alarmwache.blindstellen([sensor("b", label="Keller", available=False)], 1000.0)
    assert alarmwache.satz(stellen) == "Keller: antwortet nicht mehr"


def test_lange_listen_werden_gezaehlt() -> None:
    stellen = alarmwache.blindstellen(
        [sensor(f"s{n}", label=f"Raum {n}", available=False) for n in range(6)], 1000.0
    )
    assert alarmwache.satz(stellen).endswith("und 3 weitere")


def test_der_titel_richtet_sich_nach_dem_schlimmsten() -> None:
    """Sabotage gehört in die Zeile, die man auf dem Sperrbildschirm
    liest - nicht in den Text darunter, den man aufklappen muss."""
    mit_sabotage = alarmwache.blindstellen(
        [
            sensor("a", label="Bad", low_battery=True),
            sensor("c", label="Türe", device_class="tamper", state="on"),
        ],
        1000.0,
    )
    assert alarmwache.titel(mit_sabotage) == "Sabotage an der Alarmanlage"


def test_der_titel_zaehlt_stille_sensoren() -> None:
    zwei = alarmwache.blindstellen(
        [sensor("a", available=False), sensor("b", available=False)], 1000.0
    )
    assert alarmwache.titel(zwei) == "Alarmanlage: 2 Sensoren antworten nicht"
    eine = alarmwache.blindstellen([sensor("a", available=False)], 1000.0)
    assert alarmwache.titel(eine) == "Alarmanlage: ein Sensor antwortet nicht"


def test_die_sirene_bleibt_ohne_schalter_still() -> None:
    """Um drei Uhr nachts wegen einer Knopfzelle geweckt zu werden, ist
    der schnellste Weg zu einer Anlage, die niemand mehr scharf
    schaltet."""
    stellen = alarmwache.blindstellen(
        [sensor("c", device_class="tamper", state="on")], 1000.0
    )
    assert not alarmwache.loest_aus(stellen, {})
    assert alarmwache.loest_aus(stellen, {"sabotage_alarm": True})


def test_funkstille_loest_auch_mit_schalter_nicht_aus() -> None:
    """Sie ist von einer leeren Batterie nicht zu unterscheiden."""
    stellen = alarmwache.blindstellen([sensor("b", available=False)], 1000.0)
    assert not alarmwache.loest_aus(stellen, {"sabotage_alarm": True})
