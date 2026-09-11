"""Der Zigbee-Teil des Stacks: Broker, Zigbee2MQTT und der Hub.

Drei Dateien beschreiben eine Kette, und keine davon kennt die anderen:
`deploy/mosquitto.conf` sagt, wer den Broker erreicht,
`deploy/zigbee2mqtt.example.yaml` sagt, womit Zigbee2MQTT redet und
wohin es schreibt, und `integrations/zigbee2mqtt.py` liest es wieder.
Läuft eine davon weg, merkt man es erst im Haus - und dort sieht es aus
wie ein defekter Dongle.

Geprüft wird nur, was wehtut: ob der Broker offen ins Netz horcht, ob
der Dongle noch übers Netz angesprochen wird, und ob die beiden Enden
dasselbe Thema meinen.
"""

from __future__ import annotations

from pathlib import Path

import yaml

WURZEL = Path(__file__).resolve().parents[2]
BEISPIEL = WURZEL / "deploy" / "zigbee2mqtt.example.yaml"
BROKERCONF = WURZEL / "deploy" / "mosquitto.conf"
COMPOSE = [
    WURZEL / "docker-compose.yml",
    WURZEL / "docker-compose.portainer.yml",
]


def _beispiel() -> dict:
    return yaml.safe_load(BEISPIEL.read_text(encoding="utf-8"))


def test_der_broker_horcht_nur_auf_diesem_rechner():
    """Der wichtigste Satz des ganzen Aufbaus.

    MQTT kennt keine Rechte je Thema: Wer den Broker erreicht, hört
    jeden Fensterkontakt mit und darf jedes Licht schalten. Deshalb
    nimmt er nur von 127.0.0.1 an - und *deshalb* darf dort auch
    `allow_anonymous` stehen. Wer den Listener öffnet, muss beides
    zusammen ändern; diese Prüfung hält genau das fest.
    """
    zeilen = [
        zeile.strip()
        for zeile in BROKERCONF.read_text(encoding="utf-8").splitlines()
        if zeile.strip() and not zeile.strip().startswith("#")
    ]
    listener = [z for z in zeilen if z.startswith("listener ")]
    assert listener, "ohne listener-Zeile startet Mosquitto 2.x taub"
    anonym = any(z.replace(" ", "") == "allow_anonymoustrue" for z in zeilen)
    offen = [z for z in listener if not z.endswith(" 127.0.0.1")]
    assert not (anonym and offen), (
        "Der Broker horcht ins Netz und lässt jeden herein: "
        f"{offen} - mit allow_anonymous true gehört das nicht zusammen."
    )


def test_der_dongle_haengt_am_netz_und_spricht_ember():
    """Zwei Stolpersteine, beide aus der Anleitung heraus falsch.

    `zstack` ist der Texas-Instruments-Stick aus den meisten Anleitungen
    im Netz - im Dongle Max sitzt ein EFR32MG24 von Silicon Labs, der
    EmberZNet spricht. Und ein `/dev/...`-Pfad hiesse USB: Dieser
    Koordinator ist kein Gerät dieses Rechners, sondern eine Adresse.
    """
    seriell = _beispiel()["serial"]
    assert seriell["adapter"] == "ember"
    assert str(seriell["port"]).startswith("tcp://")


def test_zigbee2mqtt_schreibt_dorthin_wo_der_hub_liest():
    """Beide Seiten haben eine Vorgabe, und beide dürfen sie ändern -
    nur nicht einzeln. Sonst läuft alles, und der Hub sieht kein Gerät."""
    from homepilot.integrations.zigbee2mqtt import Zigbee2MqttIntegration  # noqa: F401

    mqtt = _beispiel()["mqtt"]
    # Dieselbe Vorgabe wie in der Integration (base_topic).
    assert mqtt["base_topic"] == "zigbee2mqtt"
    # Und derselbe Rechner wie der Broker, siehe Prüfung oben.
    assert "127.0.0.1" in mqtt["server"]


def test_beide_compose_dateien_kennen_die_zwei_dienste():
    """Der Hub allein bringt kein Zigbee ins Haus - ohne diese zwei
    schreibt niemand die Themen, die er liest."""
    for pfad in COMPOSE:
        dienste = yaml.safe_load(pfad.read_text(encoding="utf-8"))["services"]
        assert "mosquitto" in dienste, pfad.name
        assert "zigbee2mqtt" in dienste, pfad.name


def test_der_schluessel_des_zigbee_netzes_bleibt_draussen():
    """In der configuration.yaml steht nach dem ersten Start der
    Netzwerkschlüssel - damit hört man das ganze Zigbee-Netz mit. Die
    Vorlage im Repo darf ihn nicht mitbringen, und der Ordner, in dem
    die echte Datei landet, gehört in die .gitignore."""
    assert _beispiel()["advanced"]["network_key"] == "GENERATE"
    ignoriert = (WURZEL / ".gitignore").read_text(encoding="utf-8")
    assert "hub/zigbee2mqtt/" in ignoriert
