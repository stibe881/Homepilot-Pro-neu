"""Eine unveränderte Auskunft des Gateways darf nichts überschreiben.

Der Fall aus dem Haus, vierte Runde: «Ich habe heute morgen alle Storen
hochgefahren. Es zeigt aber nur bei 2 von 6 an, dass sie oben sind.»

Auf dem Bild standen bei den anderen vier haargenau die Werte vom
Vorabend - Stellung 0, Lamellen 100. Nicht ähnlich, sondern identisch.
Eine io-Store meldet dem Gateway nicht von sich aus, dass sie gefahren
ist; das Gateway gab also stundenlang dieselbe alte Zahl heraus, und der
Takt schrieb sie jede Minute neu. Dabei löschte er über `angenommen`
genau die Auskunft, die der Hub aus seinem eigenen Befehl hatte - aus
«wir haben eben aufgefahren» wurde wieder «geschlossen».
"""

import pytest

from homepilot.integrations.overkiz import OverkizIntegration


class FakeState:
    def __init__(self, name, value):
        self.name = name
        self.value = value


class FakeDevice:
    def __init__(self, url, states, available=True):
        self.device_url = url
        self.label = "EVB Sofa"
        self.widget = "PositionableExteriorVenetianBlind"
        self.states = [FakeState(n, v) for n, v in states.items()]
        self.available = available


class FakeClient:
    def __init__(self, geraete):
        self._geraete = geraete

    async def get_devices(self):
        return self._geraete


ZU = {"core:ClosureState": 100, "core:SlateOrientationState": 100}


def _integration(hub, client, roh) -> OverkizIntegration:
    integration = OverkizIntegration(hub, {})
    integration._client = client
    integration._devices = {"io://a/1": "overkiz.sofa"}
    integration._abwesend = {}
    integration._nachlesen_geht = False
    integration._roh = roh
    return integration


@pytest.fixture
async def store(hub):
    from homepilot.core.entity import Entity, EntityKind

    entity = Entity(
        id="overkiz.sofa", kind=EntityKind.COVER, name="EVB Sofa",
        integration="overkiz",
        state={"position": 0, "state": "closed", "tilt": 100},
    )
    await hub.registry.add(entity)
    return entity


async def test_dieselbe_alte_auskunft_ueberschreibt_die_annahme_nicht(hub, store):
    """Der gemeldete Fehler: Nach «Auf» stand die Store eine Minute später
    wieder als geschlossen da - mit dem Wert vom Vorabend."""
    await hub.registry.update_state(
        "overkiz.sofa", {"position": 100, "state": "open", "angenommen": True}
    )
    integration = _integration(
        hub, FakeClient([FakeDevice("io://a/1", ZU)]), {"io://a/1": dict(ZU)}
    )
    await integration._geraete_auffrischen()
    zustand = hub.registry.get("overkiz.sofa").state
    assert zustand["position"] == 100
    assert zustand["state"] == "open"
    assert zustand["angenommen"] is True


async def test_eine_geaenderte_auskunft_sticht_die_annahme(hub, store):
    """Sobald das Gateway etwas Neues weiss, gilt das - eine Messung
    schlägt jede Vermutung."""
    await hub.registry.update_state(
        "overkiz.sofa", {"position": 100, "state": "open", "angenommen": True}
    )
    offen = {"core:ClosureState": 0, "core:SlateOrientationState": 0}
    integration = _integration(
        hub, FakeClient([FakeDevice("io://a/1", offen)]), {"io://a/1": dict(ZU)}
    )
    await integration._geraete_auffrischen()
    zustand = hub.registry.get("overkiz.sofa").state
    assert zustand["position"] == 100
    assert zustand["angenommen"] is None


async def test_beim_ersten_takt_gilt_das_gateway(hub, store):
    """Ohne Merker gibt es nichts zu schützen - nach einem Neustart ist
    die Auskunft des Gateways das Einzige, was der Hub hat."""
    integration = _integration(hub, FakeClient([FakeDevice("io://a/1", ZU)]), {})
    await integration._geraete_auffrischen()
    zustand = hub.registry.get("overkiz.sofa").state
    assert zustand["position"] == 0
    assert zustand["state"] == "closed"


async def test_eine_unveraenderte_auskunft_frischt_die_erreichbarkeit_auf(hub, store):
    """Dass ein Gerät sich wieder meldet, ist die eine Neuigkeit, die in
    einer unveränderten Zustandsliste steckt."""
    hub.registry.get("overkiz.sofa").available = False
    integration = _integration(
        hub, FakeClient([FakeDevice("io://a/1", ZU)]), {"io://a/1": dict(ZU)}
    )
    await integration._geraete_auffrischen()
    assert hub.registry.get("overkiz.sofa").available is True


async def test_ein_ereignis_wird_im_merker_fortgeschrieben(hub, store):
    """Sonst hielte der nächste Takt seinen alten Stand für eine Änderung
    und schriebe ihn über das, was das Ereignis gerade gebracht hat."""
    integration = _integration(
        hub, FakeClient([FakeDevice("io://a/1", ZU)]), {"io://a/1": dict(ZU)}
    )
    integration._moves = {}

    class Ereignis:
        device_url = "io://a/1"
        device_states = [FakeState("core:ClosureState", 0)]

    await integration._handle_event(Ereignis())
    assert integration._roh["io://a/1"]["core:ClosureState"] == 0
