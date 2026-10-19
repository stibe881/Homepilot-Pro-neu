import time

import pytest

from homepilot.core import wochenbericht
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub


def make_config(**kwargs) -> HubConfig:
    defaults = {
        "api": ApiConfig(token=kwargs.pop("token", None)),
        "integrations": [{"integration": "demo"}],
        "automations": [],
    }
    defaults.update(kwargs)
    return HubConfig(**defaults)


@pytest.fixture
async def hub():
    hub = Hub(make_config())
    await hub.start()
    yield hub
    await hub.stop()


@pytest.fixture(autouse=True)
def wochenbericht_haengt_nicht_an_der_uhr(monkeypatch):
    """Der Montagsbericht kommt ab acht Uhr - und mischte sich an jedem
    Montagmorgen in alle Tests, die den Wächter mit aufgezeichneten Pushes
    laufen lassen: sechs Tests meldeten plötzlich einen «Wochenbericht»
    mehr, als sie erwarteten (Punkt 667 der Werkbank).

    Nur die Frage «ist es jetzt so weit?» bekommt ein Nein. Feste
    Zeitpunkte gehen unverändert an die echte Funktion, damit ihre eigenen
    Tests weiter prüfen, was sie prüfen sollen; wer den Bericht wirklich
    braucht, setzt `faellig` im Test selbst.
    """
    echt = wochenbericht.faellig

    def faellig(wochentag, stunde, jetzt=None):
        if jetzt is None or abs(jetzt - time.time()) < 60:
            return False
        return echt(wochentag, stunde, jetzt)

    monkeypatch.setattr(wochenbericht, "faellig", faellig)
