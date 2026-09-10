"""Der Takt muss das Gateway fragen, nicht den Zwischenspeicher.

Vier Runden lang sah es aus, als bekäme das Gateway nichts mit. Der
Beweis kam aus der rohen Ausgabe: Dort meldete es für alle sechs Storen
``ClosureState 0`` – offen, richtig –, während der Hub im selben
Augenblick vier davon als geschlossen führte. Beide fragen dasselbe
Gateway; nur fragte der Hub gar nicht.

``pyoverkiz`` merkt sich die Geräteliste in der Sitzung::

    async def get_devices(self, refresh: bool = False):
        if self.devices and not refresh:
            return self.devices

Der Hub hält eine Sitzung, solange er läuft. Sein erster Abruf beim
Start füllte den Zwischenspeicher, jeder spätere Takt bekam dieselben
Objekte zurück. `storencheck` widersprach ihm, weil es eine eigene,
frische Sitzung aufmacht.
"""

from homepilot.integrations.overkiz import OverkizIntegration


class SammelnderClient:
    """Ein Gateway, das sich merkt, wie gefragt wurde."""

    def __init__(self, kennt_refresh: bool = True):
        self.gefragt: list[bool] = []
        self._kennt_refresh = kennt_refresh

    async def get_devices(self, refresh: bool = False):
        if refresh and not self._kennt_refresh:
            raise TypeError("get_devices() got an unexpected keyword argument 'refresh'")
        self.gefragt.append(refresh)
        return []


def _integration(hub, client) -> OverkizIntegration:
    integration = OverkizIntegration(hub, {})
    integration._client = client
    integration._devices = {}
    integration._abwesend = {}
    integration._roh = {}
    integration._nachlesen_geht = False
    return integration


async def test_der_takt_verlangt_einen_frischen_abruf(hub):
    client = SammelnderClient()
    integration = _integration(hub, client)
    await integration._geraete_auffrischen()
    assert client.gefragt == [True]


async def test_eine_aeltere_bibliothek_kennt_den_schalter_nicht(hub):
    """Dann eben ohne - sonst stünde jede Minute «Geräteliste nicht
    abrufbar» im Protokoll, und der Takt liefe leer."""
    client = SammelnderClient(kennt_refresh=False)
    integration = _integration(hub, client)
    await integration._geraete_auffrischen()
    assert client.gefragt == [False]


async def test_jeder_takt_fragt_erneut(hub):
    """Genau das war der Fehler: Der zweite Takt bekam den ersten Stand."""
    client = SammelnderClient()
    integration = _integration(hub, client)
    await integration._geraete_auffrischen()
    await integration._geraete_auffrischen()
    await integration._geraete_auffrischen()
    assert client.gefragt == [True, True, True]
