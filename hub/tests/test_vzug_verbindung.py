"""V-ZUG-Geräte gelten nicht schon nach einem verlorenen Abruf als weg.

Der Fall: In der Ausfallliste standen im Zehnminutentakt Löcher von einer
bis vier Minuten – Waschmaschine und Geschirrspüler hingen die ganze Zeit
am Netz. Ein einziger misslungener Abruf genügte, und bei 60 Sekunden
Takt wurde daraus genau so ein Loch.
"""

import asyncio
import types

import aiohttp

from homepilot.integrations import vzug as modul


class FakeRegistry:
    def __init__(self, gesehen: float | None = 1000.0) -> None:
        self.calls: list[tuple[str, dict, object]] = []
        # Voreingestellt ein Gerät, das schon einmal geantwortet hat -
        # das ist der Normalfall dieser Tests. ``gesehen=None`` ist das
        # Gerät, das den Hub-Start verschlafen hat.
        self.entity = types.SimpleNamespace(last_seen=gesehen)

    def get(self, entity_id):
        return self.entity

    async def update_state(self, entity_id, state, available=None):
        self.calls.append((entity_id, state, available))

    @property
    def letzter_grund(self):
        for _, state, _ in reversed(self.calls):
            if "problem" in state:
                return state["problem"]
        return None

    @property
    def letzte_verfuegbarkeit(self):
        for _, _, available in reversed(self.calls):
            if available is not None:
                return available
        return None


def geraet(antworten, gesehen: float | None = 1000.0):
    """Integration, gerade so weit gebaut, wie _refresh sie braucht.

    `antworten` ist eine Liste: ein Eintrag je Abrufversuch. Eine
    Ausnahme darin wird geworfen, alles andere zurückgegeben.
    """
    integration = object.__new__(modul.VZugIntegration)
    integration._down = set()
    integration._fehlversuche = {}
    integration._countdown = {}
    integration._beschaeftigt_seit = {}
    integration._beschaeftigt_runden = {}
    integration._ruhe_bis = {}
    integration._interval = 60.0
    integration.log = types.SimpleNamespace(
        debug=lambda *a, **k: None,
        info=lambda *a, **k: None,
        warning=lambda *a, **k: None,
    )
    registry = FakeRegistry(gesehen)
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


# ── «503 – bedient gerade nicht» ─────────────────────────────────────────
# Das Protokoll einer ganzen Nacht zeigte den festen Takt: rund vier
# Minuten 503, rund zwei Minuten Antwort, ohne ein einziges laufendes
# Programm. Das ist der Standby-Rhythmus des Geräts, kein Ausfall.


def beschaeftigt():
    return aiohttp.ClientResponseError(
        request_info=None, history=(), status=modul.BESCHAEFTIGT, message="Service Unavailable"
    )


def test_a_busy_device_keeps_its_last_state(monkeypatch):
    ohne_pause(monkeypatch)
    integration, registry = geraet([beschaeftigt()])
    lauf(integration)
    # Kein update_state: Das Gerät ist da, es bedient nur gerade nicht.
    assert registry.calls == []
    assert "vzug.waschmaschine" not in integration._down


def test_a_busy_device_is_not_asked_again_right_away(monkeypatch):
    ohne_pause(monkeypatch)
    integration, _ = geraet([beschaeftigt()])
    lauf(integration)
    assert integration._ruhe_bis["vzug.waschmaschine"] > 0


def test_busy_is_not_retried_within_the_same_poll(monkeypatch):
    """Diese Phase dauert Minuten. Drei Sekunden später noch einmal zu
    fragen kostet nur eine zweite 503."""
    pausen = []

    async def gemerkt(sekunden):
        pausen.append(sekunden)

    monkeypatch.setattr(modul.asyncio, "sleep", gemerkt)
    integration, _ = geraet([beschaeftigt(), GUT])
    lauf(integration)
    assert pausen == []


def test_the_waiting_time_grows_but_has_a_ceiling():
    # Erst der normale Takt, dann doppelt, dann vierfach – und nie mehr
    # als die Obergrenze.
    assert modul.wartezeit(1, 60) == 60
    assert modul.wartezeit(2, 60) == 120
    assert modul.wartezeit(3, 60) == 240
    assert modul.wartezeit(9, 60) == modul.RUHE_HOECHSTENS
    # Ohne Runde gilt der normale Takt, nie weniger.
    assert modul.wartezeit(0, 60) == 60


def test_after_a_very_long_busy_stretch_it_is_an_outage_after_all(monkeypatch):
    ohne_pause(monkeypatch)
    integration, registry = geraet([beschaeftigt(), beschaeftigt()])
    uhr = [1000.0]
    monkeypatch.setattr(modul, "monotonic", lambda: uhr[0])
    lauf(integration)
    assert registry.calls == []
    # Eine gute Stunde später meldet es immer noch dasselbe.
    uhr[0] += modul.BESCHAEFTIGT_HOECHSTENS + 60
    integration._ruhe_bis.clear()
    lauf(integration)
    assert registry.letzte_verfuegbarkeit is False


def test_one_good_answer_ends_the_busy_stretch(monkeypatch):
    ohne_pause(monkeypatch)
    integration, registry = geraet([beschaeftigt(), GUT])
    lauf(integration, mal=2)
    assert integration._beschaeftigt_seit == {}
    assert integration._ruhe_bis == {}
    assert registry.letzte_verfuegbarkeit is True


# ── Warum ein Gerät fehlt, gehört an die Kachel ──────────────────────────
# Aus dem Betrieb: Geschirrspüler und Waschmaschine standen in der
# Ausfallliste als «nie gesehen» – ohne ein Wort dazu. Der Grund stand im
# Log des Hubs, also genau dort, wo niemand nachsieht, der gerade in der
# Küche steht.


def test_an_unreachable_device_says_why_on_the_tile(monkeypatch):
    ohne_pause(monkeypatch)
    integration, registry = geraet(
        [ConnectionError("Connection refused")] * (2 * modul.AUSFAELLE_BIS_WEG)
    )
    lauf(integration, mal=modul.AUSFAELLE_BIS_WEG)
    assert registry.letzte_verfuegbarkeit is False
    grund = str(registry.letzter_grund)
    assert "10.0.0.5" in grund
    # Der häufigste Fall bei diesen Geräten – und der einzige, den der
    # Besitzer selbst beheben kann.
    assert "DHCP" in grund


def test_a_device_that_wants_credentials_says_so(monkeypatch):
    ohne_pause(monkeypatch)
    nicht_erlaubt = aiohttp.ClientResponseError(
        request_info=None, history=(), status=401, message="Unauthorized"
    )
    integration, registry = geraet([nicht_erlaubt] * (2 * modul.AUSFAELLE_BIS_WEG))
    lauf(integration, mal=modul.AUSFAELLE_BIS_WEG)
    grund = str(registry.letzter_grund)
    assert "Anmeldung" in grund
    assert "username" in grund
    # Und nicht der DHCP-Satz: Die Adresse stimmt ja, das Gerät antwortet.
    assert "DHCP" not in grund


def test_a_good_answer_clears_the_reason(monkeypatch):
    """Sonst klebte der Satz für immer an der Kachel – update_state
    merged, ein weggelassenes Feld behält seinen alten Wert."""
    ohne_pause(monkeypatch)
    integration, registry = geraet(
        [ConnectionError("weg")] * (2 * modul.AUSFAELLE_BIS_WEG) + [GUT]
    )
    lauf(integration, mal=modul.AUSFAELLE_BIS_WEG + 1)
    assert registry.letzte_verfuegbarkeit is True
    assert registry.letzter_grund is None


def test_a_device_that_slept_through_the_hub_start_is_not_left_silent(monkeypatch):
    """503 ist kein Ausfall – aber ein Gerät, das noch nie geantwortet
    hat, stünde sonst eine halbe Stunde als «nie gesehen» ohne Grund."""
    ohne_pause(monkeypatch)
    integration, registry = geraet([beschaeftigt()], gesehen=None)
    lauf(integration)
    assert "503" in str(registry.letzter_grund)
    # Die Erreichbarkeit bleibt unangetastet.
    assert registry.letzte_verfuegbarkeit is None
    assert "vzug.waschmaschine" not in integration._down
