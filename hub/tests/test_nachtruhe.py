"""Nachts still - das Fenster und der Ablauf, der es benutzt.

Der Fall aus dem Haus: Der Geschirrspüler meldete um 03:25 «fertig, du
kannst ausräumen». Das weckt jemanden und ändert nichts - ausgeräumt
wird um acht. Die eingebaute Erinnerung schweigt seither nachts von
selbst (core/waschkueche.py); ein selbst gebauter Ablauf braucht dafür
einen Schalter, weil «Jemand weint im Kinderzimmer» genau die Nachricht
ist, die nachts kommen muss.
"""

import time

import pytest

from homepilot.core import nachtruhe
from homepilot.core.automation import Automation
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub


def um(stunde: int, minute: int = 0) -> float:
    """Ein Zeitpunkt im März 2026 - Ortszeit, wie der Hub rechnet."""
    return time.mktime((2026, 3, 12, stunde, minute, 0, 0, 0, -1))


def test_das_fenster_geht_ueber_mitternacht():
    assert nachtruhe.still(um(23))
    assert nachtruhe.still(um(3))
    assert not nachtruhe.still(um(8))
    assert not nachtruhe.still(um(21, 59))


def test_ein_fenster_ohne_mitternacht_darin():
    """«Ab 0 bis 8» mit dem Oder-Vergleich hiesse rund um die Uhr still -
    jede Stunde ist >= 0."""
    assert nachtruhe.still(um(3), 0, 8)
    assert not nachtruhe.still(um(23), 0, 8)


def test_gleiche_zahlen_heben_die_nachtruhe_auf():
    """Ohne diesen Ausweg hiesse «ab 22 bis 22 Uhr» für immer still."""
    assert not nachtruhe.still(um(3), 22, 22)


@pytest.fixture
async def hub():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    yield hub
    await hub.stop()


async def _sammle(hub) -> list[str]:
    gesendet: list[str] = []

    async def fake_send(tokens, title, body, data=None, **_):
        gesendet.append(title)
        return len(tokens)

    hub.push.send = fake_send  # type: ignore[assignment]
    hub.push.register("ExponentPushToken[x]", "Stefan")
    return gesendet


async def test_ein_ablauf_mit_nachtruhe_meldet_nachts_nicht(hub, monkeypatch):
    gesendet = await _sammle(hub)
    monkeypatch.setattr(nachtruhe, "still", lambda *_, **__: True)
    ablauf = Automation(
        id="a", alias="Geschirrspüler", triggers=[], actions=[], quiet_night=True
    )
    notiz = await hub.automations._execute_action(
        ablauf, {"type": "notify", "title": "Geschirrspüler ist fertig", "body": "x"}
    )
    assert gesendet == []
    # Und in der Schritt-Spur steht, warum nichts kam - sonst sucht man
    # den Fehler bei der Push-Anmeldung.
    assert notiz is not None and "nachts" in notiz


async def test_am_tag_meldet_derselbe_ablauf(hub, monkeypatch):
    gesendet = await _sammle(hub)
    monkeypatch.setattr(nachtruhe, "still", lambda *_, **__: False)
    ablauf = Automation(
        id="a", alias="Geschirrspüler", triggers=[], actions=[], quiet_night=True
    )
    await hub.automations._execute_action(
        ablauf, {"type": "notify", "title": "Geschirrspüler ist fertig", "body": "x"}
    )
    assert gesendet == ["Geschirrspüler ist fertig"]


async def test_ohne_schalter_bleibt_alles_wie_bisher(hub, monkeypatch):
    """Nachts nicht zu melden ist die Ausnahme, nicht die Regel: «Jemand
    weint im Kinderzimmer» muss um drei Uhr durchkommen."""
    gesendet = await _sammle(hub)
    monkeypatch.setattr(nachtruhe, "still", lambda *_, **__: True)
    ablauf = Automation(id="a", alias="Kinderzimmer", triggers=[], actions=[])
    await hub.automations._execute_action(
        ablauf, {"type": "notify", "title": "Jemand weint", "body": "x"}
    )
    assert gesendet == ["Jemand weint"]


async def test_auch_die_durchsage_bleibt_nachts_aus(hub, monkeypatch):
    """Eine Box, die um drei Uhr spricht, weckt zuverlässiger als jede
    Push."""
    gesagt: list[str] = []
    from homepilot.core import say

    async def fake_speak(hub_, text, **_):
        gesagt.append(text)
        return True

    monkeypatch.setattr(say, "speak", fake_speak)
    monkeypatch.setattr(nachtruhe, "still", lambda *_, **__: True)
    ablauf = Automation(
        id="a", alias="Waschküche", triggers=[], actions=[], quiet_night=True
    )
    notiz = await hub.automations._execute_action(
        ablauf, {"type": "broadcast", "text": "Waschmaschine ist fertig"}
    )
    assert gesagt == []
    assert notiz is not None and "nachts" in notiz


async def test_der_rest_des_ablaufs_laeuft_weiter(hub, monkeypatch):
    """Nur die meldenden Schritte fallen weg. Wer nachts das Licht
    löschen und dabei nichts sagen will, hat einen Ablauf und nicht
    zwei."""
    monkeypatch.setattr(nachtruhe, "still", lambda *_, **__: True)
    ablauf = Automation(
        id="a", alias="Nachts", triggers=[], actions=[], quiet_night=True
    )
    lampe = hub.registry.get("demo.light_livingroom")
    await hub.integrations.dispatch_command(lampe.id, "turn_on", {})
    await hub.automations._execute_action(
        ablauf,
        {"type": "command", "entity_id": lampe.id, "command": "turn_off"},
    )
    assert hub.registry.get(lampe.id).state["state"] == "off"


def test_der_schalter_ueberlebt_das_speichern():
    """Ohne ihn in as_config wäre er beim nächsten Neuladen weg - und
    die Nachricht käme wieder um drei Uhr."""
    ablauf = Automation(id="a", alias="x", triggers=[], actions=[], quiet_night=True)
    assert ablauf.as_dict()["quiet_night"] is True
    assert ablauf.as_config()["quiet_night"] is True
