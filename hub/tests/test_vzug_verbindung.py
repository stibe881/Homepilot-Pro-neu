"""V-ZUG-Geräte gelten nicht schon nach einem verlorenen Abruf als weg.

Der Fall: In der Ausfallliste standen im Zehnminutentakt Löcher von einer
bis vier Minuten – Waschmaschine und Geschirrspüler hingen die ganze Zeit
am Netz. Ein einziger misslungener Abruf genügte, und bei 60 Sekunden
Takt wurde daraus genau so ein Loch.
"""

import asyncio
import types

from homepilot.integrations import vzug as modul


class FakeRegistry:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict, object]] = []

    async def update_state(self, entity_id, state, available=None):
        self.calls.append((entity_id, state, available))

    @property
    def letzte_verfuegbarkeit(self):
        for _, _, available in reversed(self.calls):
            if available is not None:
                return available
        return None


def geraet(antworten):
    """Integration, gerade so weit gebaut, wie _refresh sie braucht.

    `antworten` ist eine Liste: ein Eintrag je Abrufversuch. Eine
    Ausnahme darin wird geworfen, alles andere zurückgegeben.
    """
    integration = object.__new__(modul.VZugIntegration)
    integration._down = set()
    integration._fehlversuche = {}
    integration._countdown = {}
    integration.log = types.SimpleNamespace(
        debug=lambda *a, **k: None,
        info=lambda *a, **k: None,
        warning=lambda *a, **k: None,
    )
    registry = FakeRegistry()
    integration.hub = types.SimpleNamespace(registry=registry)

    rest = list(antworten)

    async def holen(host, auth):
        naechste = rest.pop(0) if rest else ConnectionError("nichts mehr")
        if isinstance(naechste, Exception):
            raise naechste
        return naechste

    integration._holen = holen
    return integration, registry


GUT = {"DeviceName": "Adora", "Inactive": "false", "Program": "Kochwäsche"}


async def _nicht_warten(_sekunden):
    """Statt zu schlafen sofort weiter – sonst dauerte jeder Test Sekunden.

    Nicht als Lambda mit asyncio.sleep(0): Das wäre die Funktion, die wir
    gerade ersetzen, und riefe sich selbst auf.
    """
    return None


def ohne_pause(monkeypatch):
    monkeypatch.setattr(modul.asyncio, "sleep", _nicht_warten)


def lauf(integration, mal=1):
    async def durch():
        for _ in range(mal):
            await integration._refresh("vzug.waschmaschine", "10.0.0.5", None)

    asyncio.run(durch())


def test_a_single_lost_request_is_not_an_outage(monkeypatch):
    ohne_pause(monkeypatch)
    # Erster Versuch scheitert, der zweite im selben Durchgang klappt.
    integration, registry = geraet([ConnectionError("weg"), GUT])
    lauf(integration)
    assert registry.letzte_verfuegbarkeit is True


def test_a_whole_failed_poll_still_keeps_the_last_state(monkeypatch):
    """Das Gerät behält seinen Zustand, statt für eine Minute zu
    verschwinden – ein verlorenes Paket ist kein Ausfall."""
    ohne_pause(monkeypatch)
    integration, registry = geraet([ConnectionError("weg"), ConnectionError("weg")])
    lauf(integration)
    assert registry.calls == []


def test_after_enough_silence_the_device_really_counts_as_gone(monkeypatch):
    ohne_pause(monkeypatch)
    fehler = [ConnectionError("weg")] * (2 * modul.AUSFAELLE_BIS_WEG)
    integration, registry = geraet(fehler)
    lauf(integration, mal=modul.AUSFAELLE_BIS_WEG)
    assert registry.letzte_verfuegbarkeit is False


def test_one_good_answer_clears_the_count(monkeypatch):
    """Sonst summierten sich zwei verlorene Abrufe über den ganzen Tag zu
    einem Ausfall, der nie stattfand."""
    ohne_pause(monkeypatch)
    integration, registry = geraet(
        [
            ConnectionError("weg"),
            ConnectionError("weg"),  # Durchgang 1: misslungen
            GUT,  # Durchgang 2: klappt
            ConnectionError("weg"),
            ConnectionError("weg"),  # Durchgang 3: misslungen
        ]
    )
    lauf(integration, mal=3)
    assert integration._fehlversuche["vzug.waschmaschine"] == 1
    assert registry.letzte_verfuegbarkeit is True


def test_coming_back_is_reported_again(monkeypatch):
    ohne_pause(monkeypatch)
    fehler = [ConnectionError("weg")] * (2 * modul.AUSFAELLE_BIS_WEG)
    integration, registry = geraet([*fehler, GUT])
    lauf(integration, mal=modul.AUSFAELLE_BIS_WEG + 1)
    assert registry.letzte_verfuegbarkeit is True
    assert "vzug.waschmaschine" not in integration._down


def test_the_second_try_waits_a_moment(monkeypatch):
    """Sofort noch einmal zu fragen träfe denselben besetzten Webserver."""
    pausen: list[float] = []

    async def gemerkt(sekunden):
        pausen.append(sekunden)

    monkeypatch.setattr(modul.asyncio, "sleep", gemerkt)
    integration, _ = geraet([ConnectionError("weg"), GUT])
    lauf(integration)
    assert pausen == [modul.PAUSE_VOR_ZWEITEM_VERSUCH]
