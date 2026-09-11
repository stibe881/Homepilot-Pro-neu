"""Der Gremlin: absichtlich unzuverlässige Geräte für die Fehlerpfade.

Der Wert liegt in der Planbarkeit: Jeder dritte Befehl scheitert
gezählt, nicht gewürfelt - so lässt sich «das Gerät hat nicht reagiert»
gezielt vorführen, statt auf einen echten Ausfall zu warten.
"""

import asyncio

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.errors import HomePilotError
from homepilot.core.hub import Hub
from homepilot.integrations import gremlin


def make_hub(pace: float = 0.05) -> Hub:
    return Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "gremlin", "pace": pace, "seed": 7}],
        )
    )


def test_every_third_command_is_swallowed():
    async def check():
        hub = make_hub(pace=999)  # der Stundenplan soll hier nicht dazwischenfunken
        await hub.start()
        try:
            licht = hub.registry.get("gremlin.light_moody")
            assert licht is not None and licht.state["state"] == "off"

            await hub.integrations.dispatch_command("gremlin.light_moody", "turn_on", {})
            await hub.integrations.dispatch_command("gremlin.light_moody", "turn_off", {})
            with pytest.raises(HomePilotError, match="verschluckt"):
                await hub.integrations.dispatch_command(
                    "gremlin.light_moody", "turn_on", {}
                )
            # Nach dem Schlucken geht es normal weiter.
            await hub.integrations.dispatch_command("gremlin.light_moody", "turn_on", {})
            assert hub.registry.get("gremlin.light_moody").state["state"] == "on"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_the_dropout_sensor_disappears_and_returns():
    """Genau die Flanke, auf die «verstummt»/«wiederkommt»-Auslöser und
    der Wächter hören."""

    async def check():
        hub = make_hub(pace=0.02)
        await hub.start()
        try:
            gesehen: set[bool] = set()
            for _ in range(200):
                await asyncio.sleep(0.02)
                sensor = hub.registry.get("gremlin.sensor_dropout")
                assert sensor is not None
                gesehen.add(sensor.available)
                if gesehen == {True, False}:
                    break
            assert gesehen == {True, False}
        finally:
            await hub.stop()

    asyncio.run(check())


# ── Die Geschwister des Gremlins (Punkt 504) ──────────────────────────────
#
# Drei Ausfallarten, die es im Haus gibt und auf keinem Prüfstand: die
# Store, die eine alte Stellung behauptet; der Sensor, der Unsinn statt
# einer Zahl meldet; der Schalter, der sich Zeit lässt.


def test_die_gestrige_store_nimmt_den_befehl_an_und_tut_nichts():
    """Der gemeldete Fall: «Das Gateway gibt seit Stunden dieselbe alte
    Stellung heraus.» Kein Fehler - genau das ist der Befund, und deshalb
    faellt er ohne diese Store durch jede Pruefung."""

    async def check():
        hub = make_hub(pace=999)
        await hub.start()
        try:
            store = hub.registry.get("gremlin.cover_gestrig")
            assert store is not None
            vorher = dict(store.state)
            await hub.integrations.dispatch_command(
                "gremlin.cover_gestrig", "close", {}
            )
            await hub.integrations.dispatch_command(
                "gremlin.cover_gestrig", "set_position", {"position": 0}
            )
            danach = hub.registry.get("gremlin.cover_gestrig")
            assert danach is not None
            assert danach.state == vorher
        finally:
            await hub.stop()

    asyncio.run(check())


def test_der_lahme_schalter_antwortet_erst_spaeter(monkeypatch):
    """Zwischen Tastendruck und Antwort steht die Kachel auf «wird
    geschaltet». Dass sie danach den richtigen Zustand zeigt und nicht in
    ihrer Vermutung haengen bleibt, sah man bisher nur am Funkgeraet im
    Keller."""
    monkeypatch.setattr(gremlin, "LAHM_SEKUNDEN", 0.02)

    async def check():
        hub = make_hub(pace=999)
        await hub.start()
        try:
            await hub.integrations.dispatch_command(
                "gremlin.schalter_lahm", "turn_on", {}
            )
            # Sofort danach steht noch der alte Zustand da.
            sofort = hub.registry.get("gremlin.schalter_lahm")
            assert sofort is not None and sofort.state["state"] == "off"
            await asyncio.sleep(0.2)
            spaeter = hub.registry.get("gremlin.schalter_lahm")
            assert spaeter is not None and spaeter.state["state"] == "on"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_der_lahme_schalter_umgeht_das_verschlucken_nicht_versehentlich():
    """Er zaehlt beim launischen Licht nicht mit: Sonst verschoebe ein
    Druck auf den lahmen Schalter, welcher Befehl des Lichts der dritte
    ist - und der Test daneben schluege je nach Reihenfolge fehl."""

    async def check():
        hub = make_hub(pace=999)
        await hub.start()
        try:
            for _ in range(4):
                await hub.integrations.dispatch_command(
                    "gremlin.schalter_lahm", "toggle", {}
                )
            # Das Licht schluckt weiterhin erst seinen eigenen dritten.
            await hub.integrations.dispatch_command("gremlin.light_moody", "turn_on", {})
            await hub.integrations.dispatch_command("gremlin.light_moody", "turn_off", {})
            with pytest.raises(HomePilotError, match="verschluckt"):
                await hub.integrations.dispatch_command(
                    "gremlin.light_moody", "turn_on", {}
                )
        finally:
            await hub.stop()

    asyncio.run(check())


def test_der_luegner_kennt_jede_sorte_unsinn():
    """Jeder Eintrag stammt aus einem Fehler, der hier wirklich passiert
    ist - ein Text, eine unmoegliche Zahl, ein leeres Feld, ein None."""
    assert "--" in gremlin.UNSINN
    assert None in gremlin.UNSINN
    assert "" in gremlin.UNSINN
    assert any(isinstance(wert, float) and wert < -100 for wert in gremlin.UNSINN)


def test_der_luegner_meldet_reihum_jede_sorte_statt_immer_dieselbe():
    """Reihum, nicht gewuerfelt: Sonst bliebe eine Sorte wochenlang aus -
    und genau die enthielte den Fehler."""

    async def check():
        hub = make_hub(pace=0.01)
        await hub.start()
        try:
            gesehen: list[object] = []
            for _ in range(400):
                await asyncio.sleep(0.01)
                sensor = hub.registry.get("gremlin.sensor_luegner")
                assert sensor is not None
                wert = sensor.state.get("state")
                if wert in gremlin.UNSINN and wert not in gesehen:
                    gesehen.append(wert)
                if len(gesehen) == len(gremlin.UNSINN):
                    break
            assert set(gesehen) == set(gremlin.UNSINN)
        finally:
            await hub.stop()

    asyncio.run(check())
