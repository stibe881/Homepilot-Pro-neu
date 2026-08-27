"""Die Morgen-Zusammenfassung: eine Nachricht statt sieben."""

from __future__ import annotations

import time

from homepilot.core import morgen


def test_nur_was_nachts_etwas_bedeutet():
    """Ein Kühlschrank, der taktet, und eine Heizung, die regelt, gehören
    nicht in einen Rückblick - sie tun das jede Nacht."""
    arten = {
        "matter.tuere": "binary_sensor",
        "nuki.haustuere": "lock",
        "demo.kuehlschrank": "switch",
        "demo.heizung": "climate",
    }
    ereignisse = [
        {"entity_id": "matter.tuere", "at": 500},
        {"entity_id": "demo.kuehlschrank", "at": 510},
        {"entity_id": "nuki.haustuere", "at": 520},
        {"entity_id": "demo.heizung", "at": 530},
        # Ausserhalb des Fensters.
        {"entity_id": "matter.tuere", "at": 100},
    ]
    treffer = morgen.in_der_nacht(ereignisse, arten, 400, 600)
    assert [e["entity_id"] for e in treffer] == ["matter.tuere", "nuki.haustuere"]


def test_zeilen_lassen_leeres_weg():
    # «0 offene Fenster» ist keine Auskunft, sondern Füllung.
    assert morgen.zeilen(offen=[], schwach=[], stumm=[], nacht=0, stille_ablaeufe=[]) == []
    zeilen = morgen.zeilen(
        offen=["Balkontüre"],
        schwach=["Melder Bad"],
        stumm=[],
        nacht=3,
        stille_ablaeufe=["Guten Morgen"],
    )
    assert any("Balkontüre" in z for z in zeilen)
    assert any("Melder Bad" in z for z in zeilen)
    assert any("3 Ereignisse" in z for z in zeilen)
    assert any("Guten Morgen" in z for z in zeilen)
    # Nichts über stumme Geräte, wenn keines stumm ist.
    assert not any("Meldet sich nicht" in z for z in zeilen)


def test_eine_meldung_die_nichts_zu_sagen_hat_kommt_nicht():
    """Sie bestellt man nach einer Woche ab - und dann fehlt sie an dem
    Morgen, an dem sie etwas zu sagen hätte."""
    assert morgen.satz([]) is None
    titel, text = morgen.satz(["Noch offen: Balkontüre"])
    assert titel
    assert "Balkontüre" in text


def test_die_nacht_reicht_bis_zum_abend_davor():
    # Was um 23 Uhr aufging und noch offen ist, gehört in den Bericht.
    von, bis = morgen.nacht_fenster(1000.0, stunden=12)
    assert bis == 1000.0
    assert von == 1000.0 - 12 * 3600


def test_stille_ablaeufe():
    jetzt = time.time()
    ablaeufe = [
        {"id": "a", "alias": "Läuft täglich", "enabled": True, "triggers": [{"type": "time"}]},
        {"id": "b", "alias": "Seit Wochen still", "enabled": True, "triggers": [{"type": "state"}]},
        # Bewusst aus: soll nicht jeden Morgen daran erinnern, dass er aus ist.
        {"id": "c", "alias": "Abgeschaltet", "enabled": False, "triggers": [{"type": "time"}]},
        # Ohne Auslöser: läuft eben nur, wenn man ihn startet.
        {"id": "d", "alias": "Von Hand", "enabled": True, "triggers": []},
    ]
    laeufe = [{"automation_id": "a", "at": jetzt - 3600}]
    assert morgen.stille_ablaeufe(ablaeufe, laeufe, jetzt, tage=7) == ["Seit Wochen still"]


def test_faellig_nur_zur_gewaehlten_stunde():
    sieben = time.mktime((2026, 8, 27, 7, 30, 0, 0, 0, -1))
    assert morgen.faellig(7, sieben) is True
    assert morgen.faellig(8, sieben) is False
    # Unsinn läuft nicht ins Leere, sondern in die Grenzen.
    assert morgen.faellig(99, sieben) is False


async def test_die_zusammenfassung_geht_am_morgen_raus(hub, monkeypatch):
    """Der ganze Weg: Wächter, Regel, Push."""
    from homepilot.core.entity import Entity

    sent: list[tuple[str, str]] = []

    async def fake_send(tokens, title, body, data=None, **_):
        sent.append((title, body))
        return len(tokens)

    hub.push.send = fake_send  # type: ignore[assignment]
    hub.push.register("ExponentPushToken[x]", "Stefan")

    fenster = Entity(
        id="matter.balkon",
        kind="binary_sensor",
        name="Balkontüre",
        integration="matter",
        state={"state": "on", "device_class": "contact"},
    )
    hub.registry.all = lambda: [fenster]  # type: ignore[assignment]
    monkeypatch.setattr(morgen, "faellig", lambda stunde, jetzt=None: True)

    await hub.watchdog.check()
    treffer = [body for title, body in sent if "Balkontüre" in body]
    assert treffer, sent
    assert treffer[0].startswith("·")

    # Und nur einmal am Tag: Ein zweiter Durchlauf schweigt.
    sent.clear()
    await hub.watchdog.check()
    assert [body for _t, body in sent if "Balkontüre" in body] == []


async def test_ohne_etwas_zu_melden_kommt_keine_zusammenfassung(hub, monkeypatch):
    sent: list[tuple[str, str]] = []

    async def fake_send(tokens, title, body, data=None, **_):
        sent.append((title, body))
        return len(tokens)

    hub.push.send = fake_send  # type: ignore[assignment]
    hub.push.register("ExponentPushToken[x]", "Stefan")
    hub.registry.all = lambda: []  # type: ignore[assignment]
    monkeypatch.setattr(morgen, "faellig", lambda stunde, jetzt=None: True)

    await hub.watchdog.check()
    assert [t for t, _b in sent if "Morgen" in t] == []
