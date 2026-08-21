"""Wie oft eine Integration nachfragt – eine Tabelle statt fünfzehn Zahlen.

Die Werte standen je einzeln in ihrer Integration. Was hier geprüft wird,
ist nicht die Zahl selbst, sondern dass die Reihenfolge stimmt (config
sticht Tabelle sticht Vorgabe) und dass ein Tippfehler in der config.yaml
keine Schleife ohne Pause baut.
"""

from typing import Any

from homepilot.core.integration import (
    FALLBACK_INTERVAL,
    SCAN_INTERVALS,
    Integration,
)


class Fake(Integration):
    name = "weather"

    async def setup(self) -> None:  # pragma: no cover - hier nie gerufen
        pass


class Namenlos(Integration):
    name = "gibt-es-nicht"

    async def setup(self) -> None:  # pragma: no cover - hier nie gerufen
        pass


def bau(klasse: type[Integration], config: dict[str, Any]) -> Integration:
    return klasse(hub=None, config=config)  # type: ignore[arg-type]


def test_config_sticht_die_tabelle():
    assert bau(Fake, {"scan_interval": 45}).scan_interval() == 45


def test_ohne_angabe_gilt_die_tabelle():
    assert bau(Fake, {}).scan_interval() == SCAN_INTERVALS["weather"]


def test_unbekannte_integration_bekommt_die_vorgabe():
    assert bau(Namenlos, {}).scan_interval() == FALLBACK_INTERVAL


def test_null_und_negativ_bauen_keine_schleife_ohne_pause():
    for unsinn in (0, -5):
        assert bau(Fake, {"scan_interval": unsinn}).scan_interval() == (
            SCAN_INTERVALS["weather"]
        )


def test_text_statt_zahl_faellt_auf_die_tabelle_zurueck():
    assert bau(Fake, {"scan_interval": "alle Jubeljahre"}).scan_interval() == (
        SCAN_INTERVALS["weather"]
    )
