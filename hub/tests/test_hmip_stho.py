"""Ein Gerät mit zwei Messwerten: der Aussenfühler HmIP-STHO.

Er legt Temperatur *und* Luftfeuchtigkeit auf denselben Kanal. Zwei
Einträge mit derselben Adresse ergaben zweimal dieselbe Kennung - der
zweite überschrieb den ersten, lautlos. Und ohne Einheit fand die
Klima-Zeile der App den Fühler nicht.
"""

from homepilot.integrations.homematic import (
    HomematicIntegration,
    guess_device_class,
    unit_for,
)


class _FakeCCU:
    def __init__(self, values):
        self.values = values

    async def call(self, method, *args, port: int = 0):
        if method == "listDevices":
            return [
                {"ADDRESS": address, "TYPE": "HmIP-STHO", "PARENT": address.split(":")[0]}
                for address, _ in self.values
            ]
        if method == "getValue":
            return self.values[(args[0], args[1])]
        return ""


def test_die_einheit_kommt_vom_datenpunkt():
    assert unit_for("ACTUAL_TEMPERATURE") == "°C"
    assert unit_for("HUMIDITY") == "%"
    assert unit_for("ILLUMINATION") == "lx"
    # Nichts zu wissen ist besser als zu raten.
    assert unit_for("STATE") is None
    assert unit_for(None) is None


async def test_beide_messwerte_eines_kanals_werden_zu_zwei_geraeten(hub):
    ccu = _FakeCCU(
        {
            ("0006D8A9B12345:1", "ACTUAL_TEMPERATURE"): 12.4,
            ("0006D8A9B12345:1", "HUMIDITY"): 78,
        }
    )
    integration = HomematicIntegration(
        hub,
        {
            "integration": "homematic",
            "host": "127.0.0.1",
            "port": 2010,
            "callback_port": 0,
            "devices": [
                {
                    "address": "0006D8A9B12345:1",
                    "port": 2010,
                    "name": "Temperatur aussen",
                    "kind": "sensor",
                    "datapoint": "ACTUAL_TEMPERATURE",
                },
                {
                    "address": "0006D8A9B12345:1",
                    "port": 2010,
                    "name": "Luftfeuchtigkeit aussen",
                    "kind": "sensor",
                    "datapoint": "HUMIDITY",
                },
            ],
        },
    )
    integration._call = ccu.call  # type: ignore[method-assign]
    await integration.setup()
    try:
        temperatur = hub.registry.get("homematic.0006D8A9B12345_1")
        feuchte = hub.registry.get("homematic.0006D8A9B12345_1_humidity")
        assert temperatur is not None and feuchte is not None
        assert temperatur.state["state"] == 12.4
        assert temperatur.state["unit"] == "°C"
        assert temperatur.state["device_class"] == "temperature"
        assert feuchte.state["state"] == 78
        assert feuchte.state["unit"] == "%"
        assert feuchte.state["device_class"] == "humidity"
    finally:
        await integration.teardown()


def test_die_klima_zeile_der_app_findet_beides():
    # Die App sucht über device_class und Einheit (lib/klimachip.ts) -
    # beides kommt jetzt vom Datenpunkt, ohne dass es jemand hinschreibt.
    assert (guess_device_class("ACTUAL_TEMPERATURE"), unit_for("ACTUAL_TEMPERATURE")) == (
        "temperature",
        "°C",
    )
    assert (guess_device_class("HUMIDITY"), unit_for("HUMIDITY")) == ("humidity", "%")
