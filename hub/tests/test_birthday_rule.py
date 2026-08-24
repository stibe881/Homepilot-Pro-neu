"""Der Geburtstagsgruss als Regel – abschaltbar und verstellbar.

Der Hub erinnerte längst an Geburtstage, aber die Erinnerung stand
nirgends: nicht unter «Abläufe → Push», und die Uhrzeit (8 Uhr) sowie der
Vorlauf (drei Tage) waren fest verdrahtet. Wer um sechs aufsteht, bekam
den Gruss zwei Stunden zu spät.
"""

from datetime import date, datetime

import pytest

from homepilot.core import notifyrules
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

KONTAKTE = [
    {"text": "Livia", "birthday": "21.08.1985"},
    {"text": "Levin", "birthday": "24.08.2016"},
]


def test_die_regel_steht_in_der_liste():
    keys = [rule["key"] for rule in notifyrules.RULES]
    assert "birthday" in keys
    rules = notifyrules.effective(None)
    assert rules["birthday"]["params"] == {"hour": 8.0, "days": 3.0}


def test_unsinn_wird_in_die_grenzen_gezwungen():
    rules = notifyrules.effective(
        [{"key": "birthday", "params": {"hour": 99, "days": -5}}]
    )
    assert rules["birthday"]["params"]["hour"] == 22
    assert rules["birthday"]["params"]["days"] == 0


async def wach(monkeypatch, jetzt: datetime, gespeichert=None):
    """Ein Hub mit zwei Geburtstagen und angehaltener Uhr."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    hub.data.set("family_contacts", KONTAKTE)
    if gespeichert is not None:
        hub.data.set("notify_rules", gespeichert)
    hub.watchdog.rules = notifyrules.effective(hub.data.get("notify_rules"))

    class Uhr(datetime):
        @classmethod
        def now(cls, tz=None):
            return jetzt

    monkeypatch.setattr("homepilot.core.watchdog.datetime", Uhr)
    gesendet: list[tuple[str, str]] = []

    async def merken(title, body, category="outage", to=None):
        gesendet.append((title, body))

    hub.watchdog._notify = merken  # type: ignore[method-assign]
    return hub, gesendet


@pytest.mark.asyncio
async def test_der_gruss_kommt_zur_eingestellten_stunde(monkeypatch):
    # Vorgabe ist 8 Uhr - um 6 darf nichts kommen.
    hub, gesendet = await wach(monkeypatch, datetime(2026, 8, 21, 6, 0))
    try:
        await hub.watchdog._check_birthdays()
        assert gesendet == []
    finally:
        await hub.stop()

    hub, gesendet = await wach(monkeypatch, datetime(2026, 8, 21, 8, 0))
    try:
        await hub.watchdog._check_birthdays()
        assert any("Geburtstag heute" in titel for titel, _ in gesendet)
        assert any("Livia" in text for _, text in gesendet)
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_eine_andere_stunde_laesst_sich_einstellen(monkeypatch):
    hub, gesendet = await wach(
        monkeypatch,
        datetime(2026, 8, 21, 6, 0),
        gespeichert=[{"key": "birthday", "enabled": True, "params": {"hour": 6}}],
    )
    try:
        await hub.watchdog._check_birthdays()
        assert any("Geburtstag heute" in titel for titel, _ in gesendet)
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_der_vorlauf_laesst_sich_abschalten(monkeypatch):
    # Vorlauf 0: nur der Gruss am Tag selbst, keine Geschenk-Erinnerung.
    hub, gesendet = await wach(
        monkeypatch,
        datetime(2026, 8, 21, 8, 0),
        gespeichert=[{"key": "birthday", "enabled": True, "params": {"days": 0}}],
    )
    try:
        await hub.watchdog._check_birthdays()
        assert [titel for titel, _ in gesendet] == ["Geburtstag heute"]
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_mit_vorlauf_kommt_die_geschenk_erinnerung(monkeypatch):
    # Levin hat am 24. Geburtstag, heute ist der 21. - drei Tage Vorlauf.
    hub, gesendet = await wach(monkeypatch, datetime(2026, 8, 21, 8, 0))
    try:
        await hub.watchdog._check_birthdays()
        assert any(titel == "Levin hat in 3 Tagen Geburtstag" for titel, _ in gesendet)
    finally:
        await hub.stop()


def test_die_kontakte_liefern_den_tag():
    from homepilot.core import familie

    treffer = familie.birthdays_on(KONTAKTE, date(2026, 8, 21))
    assert [c["text"] for c in treffer] == ["Livia"]


@pytest.mark.asyncio
async def test_ein_neustart_bringt_den_gruss_nicht_ein_zweites_mal(monkeypatch):
    """Der gemeldete Fall: «Die Geburtstagsbenachrichtigung ist zwei Mal
    gekommen.»

    Der Wächter merkte sich im Arbeitsspeicher, was heute schon raus
    ist. Wer während der Meldestunde ein Update einspielt – und das
    dauert Minuten, die Stunde aber sechzig –, bekam den Gruss erneut.
    """
    jetzt = datetime(2026, 8, 21, 8, 0)
    hub, gesendet = await wach(monkeypatch, jetzt)
    try:
        await hub.watchdog._check_birthdays()
        assert any("Geburtstag heute" in titel for titel, _ in gesendet)
        # Das, was der Hub auf die Platte schreibt.
        gemerkt = hub.data.get("notified")
        assert gemerkt
    finally:
        await hub.stop()

    # Neustart mitten in derselben Stunde, mit demselben Gedächtnis.
    hub, gesendet = await wach(monkeypatch, datetime(2026, 8, 21, 8, 20))
    try:
        hub.data.set("notified", gemerkt)
        # Der Wächter läuft nebenher auf seinem eigenen Takt; was er vor
        # dieser Zeile geschickt hat, gehört nicht zur Frage.
        gesendet.clear()
        await hub.watchdog._check_birthdays()
        assert gesendet == []
    finally:
        await hub.stop()

    # Am nächsten Tag darf er wieder grüssen – Livia hat dann zwar nicht
    # Geburtstag, aber der Vorlauf für Levin greift.
    hub, gesendet = await wach(monkeypatch, datetime(2026, 8, 22, 8, 0))
    try:
        hub.data.set("notified", gemerkt)
        gesendet.clear()
        await hub.watchdog._check_birthdays()
        assert gesendet != []
    finally:
        await hub.stop()
