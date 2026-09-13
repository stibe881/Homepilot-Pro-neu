"""Der Hub weiss, dass die Tür aufging - nicht, wer sie aufgeschlossen hat
(Punkt 616 der Werkbank).

/smartlock liefert Zustand, Batterie und Türsensor; wer aufgeschlossen
hat, steht nur in /smartlock/{id}/log. Ein Kind mit Keypad-Code kommt
heim, und das Haus erfuhr es bisher nur über das Telefon, das es nicht
hat.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

from homepilot.core import heimgruss
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations.nuki import (
    NukiIntegration,
    log_eintraege,
    log_weg,
    neuester_zeitpunkt,
    unlock_satz,
)

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def _log(date: str, action: int, name: str = "Livia", trigger: int = 255, **extra):
    return {
        "id": date,
        "smartlockId": 1,
        "date": date,
        "action": action,
        "trigger": trigger,
        "state": extra.pop("state", 0),
        "name": name,
        **extra,
    }


# ── Reine Hälften ─────────────────────────────────────────────────────────


def test_log_eintraege_keeps_unlocks_after_the_last_seen_entry_oldest_first():
    payload = [
        # Nuki liefert neueste zuerst.
        _log("2026-09-13T13:44:00.000Z", 2, "Stefan", trigger=4),  # abgeschlossen: kein Aufschliessen
        _log("2026-09-13T13:43:00.000Z", 3, "Livia", source=1),  # Falle gezogen, per Code
        _log("2026-09-13T13:42:00.000Z", 1, "Livia", trigger=255),
        _log("2026-09-13T13:41:00.000Z", 1, "Bine", trigger=0, state=1),  # Motor blockiert
        _log("2026-09-13T13:40:00.000Z", 1, "Stefan", trigger=5),  # schon gesehen
        "quatsch",
    ]
    neue = log_eintraege(payload, seit=_ts("2026-09-13T13:40:00.000Z"))
    assert [(e["by"], e["via"], e["action"]) for e in neue] == [
        ("Livia", "Code", "unlock"),
        ("Livia", "Code", "unlatch"),
    ]
    assert neue[0]["at"] < neue[1]["at"]
    # Ohne «seit» kommt alles, was je aufgeschlossen hat.
    assert [e["by"] for e in log_eintraege(payload, None)] == ["Stefan", "Livia", "Livia"]
    assert log_eintraege(None, None) == []


def test_log_weg_names_keypad_fingerprint_and_auto_unlock():
    assert log_weg({"trigger": 255}) == "Code"
    assert log_weg({"trigger": 0, "source": 2}) == "Fingerabdruck"
    assert log_weg({"trigger": 0, "autoUnlock": True}) == "Auto-Unlock"
    assert log_weg({"trigger": 2}) == "Knopf"
    assert log_weg({"trigger": 4}) == "Web"
    assert log_weg({"trigger": "x"}) == "unbekannt"


def test_neuester_zeitpunkt_is_the_start_of_the_count():
    payload = [_log("2026-09-13T13:40:00.000Z", 2), _log("2026-09-13T13:44:00.000Z", 1)]
    assert neuester_zeitpunkt(payload) == _ts("2026-09-13T13:44:00.000Z")
    assert neuester_zeitpunkt([]) is None


def test_unlock_satz_says_who_when_and_how():
    at = datetime(2026, 9, 13, 15, 42).timestamp()
    titel, text = unlock_satz({"by": "Livia", "via": "Code", "at": at, "action": "unlock"}, "Haustüre")
    assert titel == "Haustüre aufgeschlossen"
    assert text == "Livia hat um 15:42 per Code aufgeschlossen."
    titel, text = unlock_satz({"by": "", "via": "unbekannt", "at": at, "action": "unlatch"}, "Haustüre")
    assert titel == "Haustüre geöffnet"
    assert text == "Jemand hat um 15:42 geöffnet."


# ── Am lebenden Hub ───────────────────────────────────────────────────────


async def _nuki(tmp_path, monkeypatch):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[],
            users=[OWNER],
            data_file=str(tmp_path / "daten.json"),
        )
    )
    await hub.start()
    nuki = NukiIntegration(hub, {"token": "x"})
    nuki._ids = {}
    nuki._log_seit = {}
    entity = await nuki.add_entity("1", EntityKind.LOCK, "Haustüre", state={"state": "unlocked"})
    nuki._ids[entity.id] = 1
    protokoll: list[dict] = []

    async def log_holen(smartlock_id):
        return list(protokoll)

    monkeypatch.setattr(nuki, "_log_holen", log_holen)
    hub.push.register("ExponentPushToken[Stefan]", "Stefan")
    gesendet: list[dict] = []

    async def send(tokens, title, body, data=None, image=None, category=None):
        gesendet.append({"title": title, "body": body, "category": category, "data": data})
        return SimpleNamespace(accepted=len(tokens))

    hub.push.send = send  # type: ignore[method-assign]
    ereignisse: list[dict] = []
    hub.bus.subscribe("door_unlocked", lambda _t, d: ereignisse.append(d))
    ankuenfte: list[tuple[str, str]] = []

    async def bei_ankunft(hub_, zone_id, name):
        ankuenfte.append((zone_id, name))

    monkeypatch.setattr(heimgruss, "bei_ankunft", bei_ankunft)
    return hub, nuki, entity, protokoll, gesendet, ereignisse, ankuenfte


def test_a_keypad_unlock_reaches_state_bus_push_and_the_answering_machine(tmp_path, monkeypatch):
    async def check():
        hub, nuki, entity, protokoll, gesendet, ereignisse, ankuenfte = await _nuki(
            tmp_path, monkeypatch
        )
        try:
            # Erster Blick: Was vor dem Hub war, wird nicht nachgemeldet.
            protokoll.append(_log("2026-09-13T08:00:00.000Z", 1, "Stefan", trigger=5))
            await nuki._log_pruefen(entity.id, 1)
            assert gesendet == [] and ereignisse == []
            assert "last_unlock" not in hub.registry.get(entity.id).state

            # Livia kommt per Code heim.
            protokoll.insert(0, _log("2026-09-13T13:42:00.000Z", 1, "Livia", trigger=255))
            await nuki._log_pruefen(entity.id, 1)
            zustand = hub.registry.get(entity.id).state["last_unlock"]
            assert zustand["by"] == "Livia" and zustand["via"] == "Code"
            assert zustand["at"] == _ts("2026-09-13T13:42:00.000Z")
            assert ereignisse[0]["entity_id"] == entity.id
            assert ereignisse[0]["by"] == "Livia"
            assert gesendet[0]["category"] == "door"
            assert gesendet[0]["title"] == "Haustüre aufgeschlossen"
            assert "Livia" in gesendet[0]["body"] and "per Code" in gesendet[0]["body"]
            # Der Tipp führt zur Türe selbst (core/pushziel.py).
            assert gesendet[0]["data"]["ziel"] == f"geraet:{entity.id}"
            # Der Anrufbeantworter des Hauses spielt - mit der Zonenkennung
            # wie beim Geofence, damit die eigene Nachricht liegen bleibt.
            assert ankuenfte == [("livia", "Livia")]

            # Derselbe Stand noch einmal: nichts Neues, nichts doppelt.
            await nuki._log_pruefen(entity.id, 1)
            assert len(gesendet) == 1 and len(ereignisse) == 1

            # Von innen am Knopf: gemeldet, aber kein Heimkommen.
            protokoll.insert(0, _log("2026-09-13T13:50:00.000Z", 1, "Stefan", trigger=2))
            await nuki._log_pruefen(entity.id, 1)
            assert len(gesendet) == 2
            assert ankuenfte == [("livia", "Livia")]
        finally:
            await hub.stop()

    asyncio.run(check())


def test_a_failed_log_read_leaves_the_lock_alone(tmp_path, monkeypatch):
    async def check():
        hub, nuki, entity, protokoll, gesendet, ereignisse, ankuenfte = await _nuki(
            tmp_path, monkeypatch
        )
        try:

            async def kaputt(smartlock_id):
                raise ConnectionError("Nuki weg")

            monkeypatch.setattr(nuki, "_log_holen", kaputt)
            await nuki._log_pruefen(entity.id, 1)
            assert gesendet == []
            assert hub.registry.get(entity.id).state["state"] == "unlocked"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_who_muted_the_category_gets_nothing(tmp_path, monkeypatch):
    async def check():
        hub, nuki, entity, protokoll, gesendet, ereignisse, ankuenfte = await _nuki(
            tmp_path, monkeypatch
        )
        try:
            hub.push.muted["Stefan"] = {"door"}
            await nuki._log_pruefen(entity.id, 1)
            protokoll.insert(0, _log("2026-09-13T13:42:00.000Z", 1, "Livia", trigger=255))
            await nuki._log_pruefen(entity.id, 1)
            # Je Person abschaltbar - das Ereignis und der Zustand bleiben.
            assert gesendet == []
            assert len(ereignisse) == 1
        finally:
            await hub.stop()

    asyncio.run(check())


def test_the_timezone_of_the_log_is_utc():
    # Nuki schreibt «Z»; ein Eintrag um 13:42 UTC ist derselbe Moment wie
    # 15:42 in Zell - die Kachel rechnet aus der Unix-Zeit, nicht aus dem Text.
    assert _ts("2026-09-13T13:42:00.000Z") == datetime(
        2026, 9, 13, 13, 42, tzinfo=UTC
    ).timestamp()
