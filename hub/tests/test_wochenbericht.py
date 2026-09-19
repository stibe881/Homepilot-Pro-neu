"""Der wöchentliche Gesundheitscheck (Punkt 667 der Werkbank)."""

from __future__ import annotations

import time

from homepilot.core import wochenbericht
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub


def test_faellig_nur_am_richtigen_tag_und_zur_richtigen_stunde():
    # Montag, 08:00 Uhr lokal.
    montag_acht = time.mktime((2026, 9, 14, 8, 0, 0, 0, 0, -1))
    assert wochenbericht.faellig(0, 8, montag_acht) is True
    assert wochenbericht.faellig(0, 9, montag_acht) is False
    dienstag_acht = time.mktime((2026, 9, 15, 8, 0, 0, 0, 0, -1))
    assert wochenbericht.faellig(0, 8, dienstag_acht) is False


def test_uptime_text_unter_einem_tag_in_stunden():
    assert wochenbericht.uptime_text(3600) == "seit 1 Stunde"
    assert wochenbericht.uptime_text(3 * 3600) == "seit 3 Stunden"
    # Unter einer Stunde gilt trotzdem «1 Stunde» - «seit 0 Stunden» wäre
    # falsch, der Hub läuft ja bereits.
    assert wochenbericht.uptime_text(60) == "seit 1 Stunde"


def test_uptime_text_ab_einem_tag_in_tagen():
    assert wochenbericht.uptime_text(24 * 3600) == "seit 1 Tag"
    assert wochenbericht.uptime_text(12 * 24 * 3600) == "seit 12 Tagen"


def test_zeilen_steht_auch_ohne_auffaelligkeiten():
    """Anders als beim Morgenbericht: keine leere Liste, nur weil nichts
    auffällig ist - «läuft seit 12 Tagen» ist selbst die Auskunft."""
    zeilen = wochenbericht.zeilen(
        laufzeit_sekunden=12 * 24 * 3600,
        memory_mb=None,
        disk_percent=None,
        commands_pro_stunde=0.0,
        automations_pro_stunde=0.0,
        ausgefallene_integrationen=[],
    )
    assert zeilen == ["Läuft seit 12 Tagen", "0 Befehle, 0 Abläufe pro Stunde"]


def test_zeilen_zeigt_speicher_platte_und_ausfaelle_wenn_vorhanden():
    zeilen = wochenbericht.zeilen(
        laufzeit_sekunden=3 * 3600,
        memory_mb=142.3,
        disk_percent=61,
        commands_pro_stunde=8.5,
        automations_pro_stunde=1.2,
        ausgefallene_integrationen=["tuya", "hue"],
    )
    assert zeilen == [
        "Läuft seit 3 Stunden",
        "Speicher: 142 MB",
        "Datenträger zu 61 % belegt",
        "8 Befehle, 1 Abläufe pro Stunde",
        "Ausgefallen: hue, tuya",
    ]


def test_satz_kommt_immer_anders_als_beim_morgenbericht():
    titel, text = wochenbericht.satz(["Läuft seit 1 Tag"])
    assert titel == "Wochenbericht"
    assert text == "· Läuft seit 1 Tag"


async def test_der_wochenbericht_kommt_nur_einmal_pro_woche(monkeypatch):
    """Am Wächter selbst geprüft: `faellig` entscheidet, wann geschickt
    wird - `_einmal` sorgt dafür, dass der Montag um 8 Uhr nicht bei
    jedem Minutentakt eine neue Nachricht auslöst."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None, **_):
            sent.append((title, body))
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]

        monkeypatch.setattr(wochenbericht, "faellig", lambda *a, **k: True)

        await hub.watchdog._check_wochenbericht()
        assert any(title == "Wochenbericht" for title, _ in sent)
        assert any(body.startswith("· Läuft seit") for _, body in sent)

        # Derselbe Minutentakt, dieselbe Woche: keine zweite Nachricht.
        vorher = len(sent)
        await hub.watchdog._check_wochenbericht()
        assert len(sent) == vorher
    finally:
        await hub.stop()
