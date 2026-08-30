"""Der Ofen sagt Bescheid: parat nach dem Vorheizen, fertig am Ende."""

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.ofen import fertig_satz, heizt_vor, kochgeraet, parat_satz


def test_kochgeraet_erkennt_kueche_und_nicht_die_waschkueche():
    assert kochgeraet("Backofen")
    assert kochgeraet("Combi-Steam MSLQ")
    assert kochgeraet("Steamer")
    assert kochgeraet("Mikrowelle")
    # Die Waschküche hat ihren eigenen Weg (Mahnung an die volle
    # Maschine) - eine Geschirrspüler-Durchsage um 22:30 will niemand.
    assert not kochgeraet("Waschmaschine")
    assert not kochgeraet("Geschirrspüler")
    assert not kochgeraet("Tumbler")
    assert not kochgeraet("")


def test_heizt_vor_liest_programm_und_status():
    assert heizt_vor("Vorheizen", None)
    assert heizt_vor(None, "Aufheizen 180°")
    assert heizt_vor("Preheat", None)
    assert not heizt_vor("Heissluft 220°", "läuft")
    assert not heizt_vor(None, None)


def test_saetze():
    assert parat_satz("Backofen") == "Der Backofen ist parat."
    assert fertig_satz("Steamer") == "Der Steamer ist fertig."
    assert parat_satz("") == "Der Ofen ist parat."


class _Ofen:
    def __init__(self):
        self.id = "vzug.ofen"
        self.kind = "appliance"
        self.label = "Backofen"
        self.available = True
        self.state = {"state": "running", "program": "Vorheizen", "status": None}


async def test_ofen_meldet_parat_und_fertig(monkeypatch):
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None, **_):
            sent.append((title, body))
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        gesagt: list[str] = []

        async def fake_speak(_hub, text, **_):
            gesagt.append(text)
            return {}

        monkeypatch.setattr("homepilot.core.say.speak", fake_speak)

        ofen = _Ofen()
        wd = hub.watchdog

        # Runde 1: Der Ofen heizt vor - noch kein Wort.
        await wd._check_appliances([ofen])
        assert gesagt == []

        # Runde 2: Das Vorheizen ist durch, das Programm läuft weiter.
        ofen.state = {"state": "running", "program": "Heissluft 220°", "status": None}
        await wd._check_appliances([ofen])
        assert gesagt == ["Der Backofen ist parat."]
        assert any("parat" in title for title, _ in sent)

        # Runde 3: nichts Neues - und darum auch keine zweite Durchsage.
        await wd._check_appliances([ofen])
        assert gesagt == ["Der Backofen ist parat."]

        # Runde 4: Das Programm endet.
        ofen.state = {"state": "idle", "program": None, "status": None}
        await wd._check_appliances([ofen])
        assert gesagt[-1] == "Der Backofen ist fertig."
    finally:
        await hub.stop()


async def test_waschmaschine_bleibt_stumm(monkeypatch):
    """Programmende an der Waschmaschine: Mahnung ja, Durchsage nein."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        gesagt: list[str] = []

        async def fake_speak(_hub, text, **_):
            gesagt.append(text)
            return {}

        monkeypatch.setattr("homepilot.core.say.speak", fake_speak)

        maschine = _Ofen()
        maschine.id = "vzug.wasch"
        maschine.label = "Waschmaschine"
        maschine.state = {"state": "running", "program": "Buntwäsche", "status": None}
        await hub.watchdog._check_appliances([maschine])
        maschine.state = {"state": "idle", "program": None, "status": None}
        await hub.watchdog._check_appliances([maschine])
        assert gesagt == []
    finally:
        await hub.stop()
