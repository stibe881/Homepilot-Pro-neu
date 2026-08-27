"""Zigbee2MQTT: Zigbee-Geräte im eigenen Netz, ohne Wolke.

Geprüft wird das Rechnen: Was ist das für ein Gerät, was kann man damit
tun, und was bedeutet, was es meldet. Die Verbindung zum Broker selbst
ist Bibliothek und wird hier nicht nachgebaut.
"""

from __future__ import annotations

import pytest

from homepilot.core.errors import ConfigError
from homepilot.integrations import zigbee2mqtt as z


# ── Kennungen ────────────────────────────────────────────────────────────


def test_die_kennung_bleibt_lesbar_und_ascii():
    """Sie steht in Adressen, Abläufen und Szenen - ein «ü» darin ist
    überall dort eine Quelle für Ärger."""
    assert z.object_id("Fenster Küche/EG") == "fenster_kueche_eg"
    assert z.object_id("  Grüne Lampe  ") == "gruene_lampe"
    assert z.object_id("Bad – Melder") == "bad_melder"
    # Nichts Brauchbares übrig: trotzdem eine Kennung, kein leerer String.
    assert z.object_id("!!!") == "geraet"
    assert z.object_id("") == "geraet"


# ── Was für ein Gerät ist das ────────────────────────────────────────────


def test_ein_licht_bringt_seine_regler_mit():
    art, befehle = z.art_und_befehle(
        [
            {
                "type": "light",
                "features": [
                    {"property": "state"},
                    {"property": "brightness"},
                    {"property": "color_temp"},
                ],
            }
        ]
    )
    assert art == "light"
    assert "set_brightness" in befehle
    assert "set_color_temp" in befehle
    # Ohne Farbe kein Farbknopf.
    assert "set_color" not in befehle


def test_eine_store_kann_auf_zu_und_halt():
    art, befehle = z.art_und_befehle(
        [{"type": "cover", "features": [{"property": "state"}, {"property": "position"}]}]
    )
    assert art == "cover"
    assert befehle == ["open", "close", "stop", "set_position"]


def test_ein_geraet_ist_das_was_man_mit_ihm_tut():
    """Ein Bewegungsmelder, der nebenbei die Temperatur misst, ist ein
    Bewegungsmelder - keine Wetterstation."""
    art, befehle = z.art_und_befehle(
        [
            {"type": "binary", "property": "occupancy"},
            {"type": "numeric", "property": "temperature"},
            {"type": "numeric", "property": "battery"},
        ]
    )
    assert art == "binary_sensor"
    assert befehle == []
    assert z.melder_klasse([{"property": "occupancy"}]) == "motion"


def test_ein_wandtaster_hat_keinen_zustand_sondern_einen_druck():
    art, befehle = z.art_und_befehle([{"type": "enum", "property": "action"}])
    assert art == "button"
    assert befehle == []


def test_ein_reiner_messfuehler():
    art, befehle = z.art_und_befehle(
        [
            {"type": "numeric", "property": "temperature"},
            {"type": "numeric", "property": "humidity"},
        ]
    )
    assert art == "sensor"
    assert befehle == []
    # Und eine Zahl steht gross auf der Kachel, nicht «unbekannt».
    assert z.hauptwert([{"property": "temperature"}, {"property": "humidity"}]) == "temperature"
    assert z.hauptwert([{"property": "linkquality"}]) is None


# ── Was das Gerät meldet ─────────────────────────────────────────────────


def test_zigbee_dreht_den_fensterkontakt_um():
    """`contact: true` heisst **zu**.

    Wer das übersieht, baut ein Haus, das nachts meldet, alle Fenster
    stünden offen, sobald sie geschlossen sind.
    """
    zu = z.zustand_aus_payload({"contact": True}, "binary_sensor", "contact", None)
    auf = z.zustand_aus_payload({"contact": False}, "binary_sensor", "contact", None)
    assert zu["state"] == "off"
    assert auf["state"] == "on"
    assert auf["device_class"] == "contact"


def test_bewegung_bleibt_herum_wie_man_es_erwartet():
    an = z.zustand_aus_payload({"occupancy": True}, "binary_sensor", "motion", None)
    assert an["state"] == "on"


def test_messwerte_kommen_mit_und_die_batterie_warnt():
    changes = z.zustand_aus_payload(
        {"temperature": 21.5, "humidity": 48, "battery": 9, "linkquality": 120},
        "sensor",
        None,
        "temperature",
    )
    assert changes["temperature"] == 21.5
    assert changes["humidity"] == 48
    assert changes["low_battery"] is True
    # Der Hauptwert steht auch als Zustand da.
    assert changes["state"] == 21.5


def test_eine_volle_batterie_warnt_nicht():
    changes = z.zustand_aus_payload({"battery": 90}, "sensor", None, "battery")
    assert changes["low_battery"] is False


def test_helligkeit_wird_in_prozent_gerechnet():
    """Zigbee zählt 0-254, der Hub in Prozent."""
    changes = z.zustand_aus_payload(
        {"state": "ON", "brightness": 254}, "light", None, None
    )
    assert changes["state"] == "on"
    assert changes["brightness"] == 100
    halb = z.zustand_aus_payload({"state": "ON", "brightness": 127}, "light", None, None)
    assert halb["brightness"] == 50


def test_eine_store_meldet_ihre_stellung():
    zu = z.zustand_aus_payload({"position": 0}, "cover", None, None)
    assert zu["state"] == "closed"
    halb = z.zustand_aus_payload({"position": 40}, "cover", None, None)
    assert halb["state"] == "open"
    assert halb["position"] == 40


def test_der_druck_ist_der_zustand_eines_tasters():
    changes = z.zustand_aus_payload({"action": "single"}, "button", None, None)
    assert changes["state"] == "single"


# ── Was der Hub schickt ──────────────────────────────────────────────────


def test_null_prozent_heisst_aus_und_nicht_an_mit_null():
    """Ein Licht, das mit 0 leuchtet, ist ein Licht, das noch Strom zieht."""
    assert z.set_nutzlast("light", "set_brightness", {"brightness": 0}) == {"state": "OFF"}
    assert z.set_nutzlast("light", "set_brightness", {"brightness": 50}) == {
        "state": "ON",
        "brightness": 127,
    }


def test_storen_und_schloesser_sprechen_ihre_eigene_sprache():
    assert z.set_nutzlast("cover", "close", {}) == {"state": "CLOSE"}
    assert z.set_nutzlast("cover", "set_position", {"position": 140}) == {"position": 100}
    assert z.set_nutzlast("lock", "lock", {}) == {"state": "LOCK"}


def test_ein_unbekanntes_kommando_wird_lesbar_abgelehnt():
    with pytest.raises(ConfigError, match="kennt das Kommando"):
        z.set_nutzlast("switch", "tanzen", {})


# ── Die Geräteliste ──────────────────────────────────────────────────────


def test_die_liste_laesst_weg_was_keine_kachel_verdient():
    liste = z.geraete_aus_bridge(
        [
            {"type": "Coordinator", "friendly_name": "Coordinator"},
            {
                "type": "EndDevice",
                "friendly_name": "Fenster Bad",
                "definition": {"exposes": [{"property": "contact"}], "description": "Aqara"},
            },
            # Zigbee2MQTT kennt es nicht - dann kann der Hub es auch nicht.
            {"type": "EndDevice", "friendly_name": "Rätsel", "supported": False},
            {"type": "Router", "friendly_name": "Repeater Keller"},
            {"type": "EndDevice", "friendly_name": ""},
        ],
        ignorieren={"repeater keller"},
    )
    assert [g["name"] for g in liste] == ["Fenster Bad"]
    assert liste[0]["id"] == "fenster_bad"


def test_die_liste_kommt_alphabetisch():
    liste = z.geraete_aus_bridge(
        [
            {"friendly_name": "Zimmer", "definition": {}},
            {"friendly_name": "Bad", "definition": {}},
        ]
    )
    assert [g["name"] for g in liste] == ["Bad", "Zimmer"]


def test_eine_kaputte_liste_ergibt_nichts_statt_eines_absturzes():
    assert z.geraete_aus_bridge(None) == []
    assert z.geraete_aus_bridge(["kein Objekt"]) == []


# ── Erreichbarkeit ───────────────────────────────────────────────────────


def test_erreichbarkeit_in_beiden_schreibweisen():
    assert z.ist_erreichbar("online") is True
    assert z.ist_erreichbar("offline") is False
    assert z.ist_erreichbar('{"state":"online"}') is True
    # Keine Auskunft heisst: beim bisherigen Stand bleiben, statt ein
    # Gerät auf Verdacht abzumelden.
    assert z.ist_erreichbar("") is None
    assert z.ist_erreichbar("was auch immer") is None
    assert z.ist_erreichbar("{kaputt") is None
