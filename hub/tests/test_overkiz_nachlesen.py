"""Das Gateway muss gebeten werden, die Storen wirklich zu fragen.

Der Fall aus dem Haus: «Es sind alle Storen geöffnet, es zeigt aber fast
alle als geschlossen an. In der TaHoma-App werden alle Storen und
Lamellen als geöffnet angezeigt.»

Beide fragen dasselbe Gateway. Der Unterschied: ``get_devices()``
liefert dessen *Zwischenspeicher*, und der wird nur aufgefrischt, wenn
jemand ausdrücklich «lies neu» sagt - was die TaHoma-App beim Öffnen tut
und der Hub bisher nie. Wer nur am Ereigniskanal zuhört, bekommt mit,
was passiert, *während* er zuhört; was er verpasst hat (Neustart,
unterbrochener Kanal, Bedienung am Wandschalter), bleibt für ihn für
immer beim alten Wert - der zuletzt selbst gefahrenen Stellung.
"""

import asyncio
import time

import pytest

from homepilot.integrations.overkiz import OverkizIntegration


class FakeClient:
    """Ein Gateway, das mitzählt, wonach gefragt wurde."""

    def __init__(self, kann_nachlesen: bool = True, nachlesen_kaputt: bool = False):
        self.nachgelesen = 0
        self.geraete_gefragt = 0
        self._kaputt = nachlesen_kaputt
        if kann_nachlesen:
            self.refresh_states = self._refresh_states

    async def _refresh_states(self):
        self.nachgelesen += 1
        if self._kaputt:
            raise RuntimeError("Somfy bremst gerade")

    async def get_devices(self):
        self.geraete_gefragt += 1
        return []


def _integration(hub, client) -> OverkizIntegration:
    integration = OverkizIntegration(hub, {})
    integration._client = client
    integration._devices = {}
    integration._abwesend = {}
    return integration


async def test_jeder_takt_stoesst_ein_nachlesen_an(hub):
    """Ohne Anstoss bleibt der Zwischenspeicher des Gateways stehen - dann
    zeigt der Hub bis zum Neustart den Stand von gestern Abend."""
    client = FakeClient()
    integration = _integration(hub, client)
    await integration._geraete_auffrischen()
    assert client.nachgelesen == 1
    assert client.geraete_gefragt == 1


async def test_ein_gebremstes_nachlesen_haelt_den_takt_nicht_auf(hub):
    """Somfy bremst den Aufruf, wenn er zu oft kommt. Dann bleibt es beim
    bisherigen Verhalten - der übrige Takt läuft weiter."""
    client = FakeClient(nachlesen_kaputt=True)
    integration = _integration(hub, client)
    await integration._geraete_auffrischen()
    assert client.nachgelesen == 1
    assert client.geraete_gefragt == 1


async def test_eine_aeltere_bibliothek_kennt_den_aufruf_nicht(hub):
    """Ohne refresh_states darf nichts abbrechen - dann ist der Hub eben
    wieder auf den Ereigniskanal allein angewiesen."""
    client = FakeClient(kann_nachlesen=False)
    integration = _integration(hub, client)
    await integration._geraete_auffrischen()
    assert client.geraete_gefragt == 1


async def test_abbruch_geht_durch(hub):
    """Beim Herunterfahren soll der Takt sofort enden, nicht schweigend
    weiterlaufen."""

    class Abbrecher(FakeClient):
        async def _refresh_states(self):
            raise asyncio.CancelledError()

    integration = _integration(hub, Abbrecher())
    with pytest.raises(asyncio.CancelledError):
        await integration._zustaende_nachlesen()


def test_die_stellung_wird_weiterhin_richtig_gedreht():
    """Die Gegenprobe zur Umrechnung: Ein offener Behang meldet
    closure 0, und daraus muss «100 % offen» werden - sonst stünde eine
    offene Store als «zu» da, und genau darum ging die Meldung."""
    from homepilot.integrations.overkiz import cover_state

    offen = cover_state({"core:ClosureState": 0, "core:SlateOrientationState": 100})
    assert offen["position"] == 100
    assert offen["state"] == "open"
    zu = cover_state({"core:ClosureState": 100, "core:SlateOrientationState": 0})
    assert zu["position"] == 0
    assert zu["state"] == "closed"


def test_ein_leeres_ereignis_erfindet_keine_stellung():
    """Meldet das Gateway nichts, darf daraus keine Stellung werden -
    sonst überschriebe der Takt den letzten bekannten Stand mit nichts."""
    from homepilot.integrations.overkiz import cover_state

    assert cover_state({}) == {}
    assert "position" not in cover_state({"core:StatusState": "available"})


async def test_erst_lesen_dann_nachlesen_lassen(hub):
    """Die Reihenfolge ist der ganze Fix.

    Der Fall aus dem Haus: Nach dem Nachlesen standen alle sechs Storen
    auf «offen», auch die vier heruntergefahrenen - alle mit demselben
    Wert. So etwas kommt nicht von sechs Geräten, sondern aus einem
    Zwischenspeicher, der gerade mitten in der Auffrischung steckte.
    Deshalb liest jeder Takt, was das Nachlesen des *vorigen* ergab.
    """
    reihenfolge: list[str] = []

    class MerkenderClient(FakeClient):
        async def _refresh_states(self):
            reihenfolge.append("nachgelesen")
            return await super()._refresh_states()

        async def get_devices(self):
            reihenfolge.append("gelesen")
            return await super().get_devices()

    integration = _integration(hub, MerkenderClient())
    await integration._geraete_auffrischen()
    assert reihenfolge == ["gelesen", "nachgelesen"]


async def test_auch_ohne_geraeteliste_wird_nachgelesen(hub):
    """Sonst käme der Takt nach einer Störung nie wieder an frische Werte:
    Ohne Anstoss bleibt der Zwischenspeicher des Gateways stehen."""

    class StoerenderClient(FakeClient):
        async def get_devices(self):
            raise RuntimeError("Gateway gerade weg")

    client = StoerenderClient()
    integration = _integration(hub, client)
    await integration._geraete_auffrischen()
    assert client.nachgelesen == 1


async def test_der_takt_wartet_nicht(hub):
    """Gewartet wird nicht mehr - die Reihenfolge erledigt das. Eine
    Wartezeit müsste man raten, und zu kurz geraten war der Fehler."""
    begonnen = time.monotonic()
    integration = _integration(hub, FakeClient())
    await integration._geraete_auffrischen()
    assert time.monotonic() - begonnen < 1
