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


# ── Wenn der Datenpunkt anders heisst ────────────────────────────────────
#
# «000ED709B2834F:1 liefert kein ACTUAL_TEMPERATURE (Fault -5: Unknown
# Parameter …)» beantwortet die Frage nicht, die man dann hat: Wie heisst
# der Wert bei *diesem* Gerät? Die CCU weiss es - man muss sie nur fragen.

import xmlrpc.client

from homepilot.integrations.homematic import unknown_parameter


def test_nur_der_unbekannte_name_loest_die_nachfrage_aus():
    assert unknown_parameter(
        xmlrpc.client.Fault(-5, "Unknown Parameter value for value key: ACTUAL_TEMPERATURE")
    )
    # «Ungültig» heisst oft bloss «gerade nicht lesbar» - das ist eine
    # andere Geschichte.
    assert not unknown_parameter(xmlrpc.client.Fault(-5, "Invalid parameter or value"))
    assert not unknown_parameter(TimeoutError("kaputt"))


class _CCUOhneDatenpunkt:
    """Eine CCU, die den Datenpunkt nicht kennt - aber sagen kann, welche
    Namen der Kanal hat."""

    def __init__(self):
        self.gefragt: list[str] = []

    async def call(self, method, *args, port: int = 0):
        self.gefragt.append(method)
        if method == "listDevices":
            return [{"ADDRESS": "000ED709B2834F:1", "TYPE": "HmIP-STHO",
                     "PARENT": "000ED709B2834F"}]
        if method == "getValue":
            raise xmlrpc.client.Fault(
                -5, f"Unknown Parameter value for value key: {args[1]}"
            )
        if method == "getParamsetDescription":
            return {"ACTUAL_TEMPERATURE": {}, "HUMIDITY": {}, "SET_POINT_TEMPERATURE": {}}
        return ""


async def test_die_warnung_nennt_die_datenpunkte_des_kanals(hub, caplog):
    ccu = _CCUOhneDatenpunkt()
    integration = HomematicIntegration(
        hub,
        {
            "integration": "homematic",
            "host": "127.0.0.1",
            "port": 2010,
            "callback_port": 0,
            "devices": [
                {
                    "address": "000ED709B2834F:1",
                    "port": 2010,
                    "name": "Temperatur Rack",
                    "kind": "sensor",
                    "datapoint": "TEMPERATURE",
                }
            ],
        },
    )
    integration._call = ccu.call  # type: ignore[method-assign]
    with caplog.at_level("WARNING"):
        await integration.setup()
    try:
        zeilen = [satz.getMessage() for satz in caplog.records]
        passend = [zeile for zeile in zeilen if "liefert kein TEMPERATURE" in zeile]
        assert passend, zeilen
        # Die Antwort steht in derselben Zeile: die Namen, die es gibt.
        assert (
            "dieser Kanal kennt: ACTUAL_TEMPERATURE, HUMIDITY, "
            "SET_POINT_TEMPERATURE" in passend[0]
        )
    finally:
        await integration.teardown()


# ── Warum kommt nichts an? ───────────────────────────────────────────────
#
# Der gemeldete Fall: «Luftfeuchtigkeit Rack» und «Temperatur Rack»
# stehen auf «nie gesehen», alle anderen Homematic-Geräte laufen. Im Log
# stand längst, woran es liegt – auf der Kachel aber nur, dass etwas
# fehlt. Das ist eine Sackgasse: Man sieht das Problem und nicht den Weg.


class _KaputterKanal:
    """Eine CCU, die den Datenpunkt nicht kennt, aber sagt, was sie hat."""

    def __init__(self, adresse="000ED709B2834F:1"):
        self.adresse = adresse

    async def call(self, method, *args, port: int = 0):
        if method == "listDevices":
            return [
                {"ADDRESS": self.adresse, "TYPE": "HmIP-STHO",
                 "PARENT": self.adresse.split(":")[0]}
            ]
        if method == "getValue":
            raise RuntimeError("Fault -5: Unknown Parameter ACTUAL_TEMPERATURE")
        if method == "getParamsetDescription":
            return {"HUMIDITY": {}, "ACTUAL_TEMPERATURE_STATUS": {}}
        return ""


async def test_der_grund_steht_am_geraet_nicht_nur_im_log(hub):
    """Auf der Kachel soll stehen, wie der Wert wirklich heisst."""
    ccu = _KaputterKanal()
    integration = HomematicIntegration(
        hub,
        {
            "integration": "homematic",
            "host": "127.0.0.1",
            "devices": [
                {
                    "address": ccu.adresse,
                    "name": "Temperatur Rack",
                    "kind": "sensor",
                    "datapoint": "ACTUAL_TEMPERATURE",
                }
            ],
        },
    )
    integration._call = ccu.call  # type: ignore[method-assign]
    await integration.setup()
    await integration._refresh_all()

    entity = next(
        e for e in hub.registry.all() if e.integration == "homematic"
    )
    assert entity.available is False
    grund = str(entity.state.get("problem") or "")
    # Nicht nur «geht nicht», sondern die Namen, die der Kanal wirklich hat.
    assert "ACTUAL_TEMPERATURE" in grund
    assert "HUMIDITY" in grund
