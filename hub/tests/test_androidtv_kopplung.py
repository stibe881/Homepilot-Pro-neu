"""Die Kopplung eines Android TV - und was danach passiert.

Der gemeldete Fall: gekoppelt, es hat funktioniert - und in der App
stand weiterhin «nicht gekoppelt». Die Integration gab beim Start
endgültig auf, wenn der Fernseher die Anmeldung ablehnte; das Urteil
hielt bis zum nächsten Neustart des Hubs, auch wenn das Zertifikat
längst auf der Platte lag.
"""

import asyncio
import sys
import types

import pytest

from homepilot.integrations import androidtv


class FalscheAuth(Exception):
    """Steht für androidtvremote2.InvalidAuth."""


class FalscheFernbedienung:
    """Lehnt die ersten Anläufe ab und lässt danach zu.

    Wie der echte Fernseher: Vor dem Koppeln InvalidAuth, danach nicht
    mehr - dieselbe Datei, anderer Ausgang.
    """

    abgelehnt = 0
    erzeugt = 0

    def __init__(self, *_args, **_kwargs):
        FalscheFernbedienung.erzeugt += 1
        self.is_on = True
        self.current_app = ""
        self.volume_info = {}
        self.device_info = {}

    async def async_generate_cert_if_missing(self):
        return None

    async def async_connect(self):
        if FalscheFernbedienung.abgelehnt > 0:
            FalscheFernbedienung.abgelehnt -= 1
            raise FalscheAuth()

    def add_is_on_updated_callback(self, _cb):
        return None

    def add_current_app_updated_callback(self, _cb):
        return None

    def add_volume_info_updated_callback(self, _cb):
        return None

    def add_is_available_updated_callback(self, _cb):
        return None

    def keep_reconnecting(self, **_kwargs):
        return None


@pytest.fixture(autouse=True)
def bibliothek(monkeypatch):
    """Die Bibliothek gibt es im Prüfstand nicht - hier steht eine Attrappe."""
    modul = types.ModuleType("androidtvremote2")
    modul.AndroidTVRemote = FalscheFernbedienung
    modul.InvalidAuth = FalscheAuth
    modul.ConnectionClosed = ConnectionError
    monkeypatch.setitem(sys.modules, "androidtvremote2", modul)
    FalscheFernbedienung.abgelehnt = 0
    FalscheFernbedienung.erzeugt = 0
    yield


def test_die_meldung_nennt_den_weg_in_der_app():
    """«siehe Hub-Protokoll» half niemandem, der vor dem Fernseher steht.

    Dort steht jetzt, wo in der App zu tippen ist - der Weg, der ohne
    Terminal auskommt und nach dem die Schleife sofort wieder anläuft.
    """
    assert "Fernseher koppeln" in androidtv.NICHT_GEKOPPELT
    # Und der andere Fall bleibt der andere Fall.
    assert androidtv.absage(True) == androidtv.NICHT_ERREICHBAR
    assert androidtv.absage(False) == androidtv.NICHT_GEKOPPELT


async def test_nach_dem_koppeln_kommt_der_fernseher_von_selbst_wieder(monkeypatch):
    """Der gemeldete Fall: Gekoppelt, und die Meldung blieb trotzdem.

    Gekoppelt wurde über die Kommandozeile - der Weg, der nicht bei
    `pair_finish` vorbeikommt und die Geräteschleife deshalb nicht neu
    anwirft. Die Integration gab endgültig auf. Jetzt fragt sie später
    noch einmal, mit einer frischen Fernbedienung, denn das Zertifikat
    wird erst beim Verbinden gelesen.
    """
    # Der erste Anlauf wird abgelehnt, der zweite geht durch.
    FalscheFernbedienung.abgelehnt = 1
    monkeypatch.setattr(androidtv, "PAIR_RETRY_SEKUNDEN", 0)

    class FalscherHub:
        class registry:
            zustaende: list = []

            @staticmethod
            async def update_state(entity_id, state, available=True):
                FalscherHub.registry.zustaende.append((entity_id, available))

    integration = androidtv.AndroidTvIntegration.__new__(
        androidtv.AndroidTvIntegration
    )
    integration.hub = FalscherHub()
    integration.log = androidtv.logging.getLogger("test")
    integration._remotes = {}
    integration._gekoppelt = {}
    integration._sleep = {}
    integration._timer_of = {}

    await asyncio.wait_for(
        integration._device_loop("androidtv.tv", "10.10.1.37", "/tmp"), timeout=5
    )

    # Zwischendurch stand er als «nicht erreichbar» da - und am Ende
    # gekoppelt, ohne dass jemand den Hub neu gestartet hat.
    assert ("androidtv.tv", False) in FalscherHub.registry.zustaende
    assert integration._gekoppelt["androidtv.tv"] is True
    # Die zweite Fernbedienung ist eine neue: Das frische Zertifikat
    # wird erst beim Verbinden gelesen.
    assert FalscheFernbedienung.erzeugt == 2
