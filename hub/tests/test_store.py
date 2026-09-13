import asyncio
import logging

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.store import Store


class FakeSupabaseClient:
    """Ersetzt Supabase im Test: merkt sich Zeilen, kann Fehler simulieren."""

    def __init__(self, existing=None):
        self.tables: dict[str, list[dict]] = {}
        self.existing = existing or []
        self.fail = False
        self.closed = False

    async def select(self, table, params=None):
        if self.fail:
            raise RuntimeError("Supabase nicht erreichbar")
        return list(self.existing)

    async def insert(self, table, rows):
        if self.fail:
            raise RuntimeError("Supabase nicht erreichbar")
        self.tables.setdefault(table, []).extend(rows)

    async def upsert(self, table, rows, on_conflict="id"):
        if self.fail:
            raise RuntimeError("Supabase nicht erreichbar")
        by_id = {row["id"]: row for row in self.tables.setdefault(table, [])}
        for row in rows:
            by_id[row["id"]] = row
        self.tables[table] = list(by_id.values())

    async def close(self):
        self.closed = True


async def make_hub(client, store_config=None, automations=None):
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            automations=automations or [],
        )
    )
    store = Store(hub, client, {"flush_interval": 3600, **(store_config or {})})
    await store.start()
    hub.store = store
    hub.registry.state_provider = store.restored_state
    await hub.integrations.setup_all(hub.config.integrations)
    await hub.automations.start(hub.config.automations)
    return hub


async def settle():
    for _ in range(10):
        await asyncio.sleep(0)


async def test_state_changes_are_written():
    client = FakeSupabaseClient()
    hub = await make_hub(client)
    try:
        await hub.integrations.dispatch_command(
            "demo.light_livingroom", "turn_on", {"brightness": 55}
        )
        await hub.store.flush()

        entities = {row["id"]: row for row in client.tables["entities"]}
        assert entities["demo.light_livingroom"]["state"]["brightness"] == 55

        history = client.tables["state_history"]
        assert any(
            row["entity_id"] == "demo.light_livingroom"
            and row["state"]["state"] == "on"
            for row in history
        )
    finally:
        await hub.stop()


async def test_entity_upserts_are_deduplicated():
    client = FakeSupabaseClient()
    hub = await make_hub(client)
    try:
        for brightness in (10, 20, 30):
            await hub.integrations.dispatch_command(
                "demo.light_livingroom", "set_brightness", {"brightness": brightness}
            )
        await hub.store.flush()

        rows = [
            row for row in client.tables["entities"] if row["id"] == "demo.light_livingroom"
        ]
        # Ein Upsert pro Entität, aber jede Änderung im Verlauf.
        assert len(rows) == 1
        assert rows[0]["state"]["brightness"] == 30
        assert (
            len(
                [
                    row
                    for row in client.tables["state_history"]
                    if row["entity_id"] == "demo.light_livingroom"
                ]
            )
            == 3
        )
    finally:
        await hub.stop()


async def test_history_exclude():
    client = FakeSupabaseClient()
    hub = await make_hub(client, {"history_exclude": ["demo.*"]})
    try:
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
        await hub.store.flush()
        assert client.tables.get("state_history", []) == []
        assert client.tables["entities"]
    finally:
        await hub.stop()


async def test_failed_write_is_retried():
    client = FakeSupabaseClient()
    hub = await make_hub(client)
    try:
        client.fail = True
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
        await hub.store.flush()
        assert client.tables.get("entities") is None

        client.fail = False
        await hub.store.flush()
        entities = {row["id"]: row for row in client.tables["entities"]}
        assert entities["demo.switch_coffee"]["state"]["state"] == "on"
        assert client.tables["state_history"]
    finally:
        await hub.stop()


async def test_ein_abgelehnter_rumpf_blockiert_den_verlauf_nicht_fuer_immer(caplog):
    """Fehler aus der Runde 579 der Werkbank: Ein 400 nach einer
    Spaltenänderung wurde unendlich wiederholt - und riss die Zustände
    und den Ablauf-Verlauf mit in die Schleife."""
    from homepilot.core.supabase import SupabaseError

    class Waehlerisch(FakeSupabaseClient):
        async def insert(self, table, rows):
            if table == "state_history" and rows:
                raise SupabaseError("POST state_history → 400: column x missing", 400)
            await super().insert(table, rows)

    client = Waehlerisch()
    hub = await make_hub(client)
    try:
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
        with caplog.at_level(logging.WARNING, logger="homepilot.core.store"):
            await hub.store.flush()
            # Die Zustände sind trotzdem geschrieben - die eine Tabelle
            # hält die anderen nicht auf.
            assert client.tables["entities"]
            # Der abgelehnte Verlauf ist verworfen, nicht eingereiht.
            assert hub.store._pending_history == []
            assert hub.store.abgelehnt["state_history"] >= 1
            # Einmal laut, danach still - sonst füllen 720 gleiche
            # Warnungen pro Stunde den Log-Ring.
            await hub.integrations.dispatch_command("demo.switch_coffee", "turn_off")
            await hub.store.flush()
            await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
            await hub.store.flush()
        warnungen = [r for r in caplog.records if "lehnt state_history ab" in r.getMessage()]
        assert len(warnungen) == 1
    finally:
        await hub.stop()


async def test_eine_stoerung_wird_einmal_gemeldet_und_die_warteschlange_bleibt_gedeckelt(caplog):
    from homepilot.core.store import MAX_PENDING_RUNS

    client = FakeSupabaseClient()
    hub = await make_hub(client)
    try:
        client.fail = True
        with caplog.at_level(logging.INFO, logger="homepilot.core.store"):
            for _ in range(3):
                await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
                await hub.integrations.dispatch_command("demo.switch_coffee", "turn_off")
                await hub.store.flush()
            # Der Ablauf-Verlauf war als Einziger nicht gedeckelt.
            hub.store._pending_runs = [{"automation_id": str(i)} for i in range(MAX_PENDING_RUNS + 50)]
            await hub.store.flush()
            assert len(hub.store._pending_runs) == MAX_PENDING_RUNS
            client.fail = False
            await hub.store.flush()
        texte = [r.getMessage() for r in caplog.records]
        assert sum("fehlgeschlagen" in t for t in texte) == 1
        assert sum("wieder erreichbar" in t for t in texte) == 1
        assert client.tables["automation_runs"]
    finally:
        await hub.stop()


def test_was_dauerhaft_abgelehnt_ist_und_was_nicht():
    from homepilot.core.store import dauerhaft_abgelehnt
    from homepilot.core.supabase import SupabaseError

    assert dauerhaft_abgelehnt(SupabaseError("kaputt", 400))
    assert dauerhaft_abgelehnt(SupabaseError("Tabelle weg", 404))
    assert dauerhaft_abgelehnt(SupabaseError("Spalte passt nicht", 422))
    # Schlüssel, Drosselung, Serverfehler, Netz: ein zweiter Versuch hat Sinn.
    assert not dauerhaft_abgelehnt(SupabaseError("Schlüssel", 401))
    assert not dauerhaft_abgelehnt(SupabaseError("zu schnell", 429))
    assert not dauerhaft_abgelehnt(SupabaseError("Server", 503))
    assert not dauerhaft_abgelehnt(RuntimeError("Netz weg"))


async def test_restored_state_fills_gaps_only():
    client = FakeSupabaseClient(
        existing=[
            {
                "id": "demo.light_livingroom",
                # "state" ist veraltet und darf die Integration nicht überschreiben,
                # "room" kennt nur die Datenbank und soll erhalten bleiben.
                "state": {"state": "on", "brightness": 5, "room": "Wohnzimmer"},
            }
        ]
    )
    hub = await make_hub(client)
    try:
        light = hub.registry.get("demo.light_livingroom")
        assert light.state["state"] == "off"       # von der Integration
        assert light.state["brightness"] == 100    # von der Integration
        assert light.state["room"] == "Wohnzimmer"  # nur aus der Datenbank
    finally:
        await hub.stop()


async def test_unavailable_database_does_not_break_hub():
    client = FakeSupabaseClient()
    client.fail = True
    hub = await make_hub(client)
    try:
        await hub.integrations.dispatch_command("demo.switch_coffee", "turn_on")
        await hub.store.flush()
        assert hub.registry.get("demo.switch_coffee").state["state"] == "on"
    finally:
        await hub.stop()


async def test_automation_runs_are_logged():
    automation = {
        "id": "motion_light",
        "alias": "Licht bei Bewegung",
        "trigger": [{"type": "state", "entity_id": "demo.motion_hall", "to": "on"}],
        "action": [
            {"type": "command", "entity_id": "demo.light_livingroom", "command": "turn_on"}
        ],
    }
    client = FakeSupabaseClient()
    hub = await make_hub(client, automations=[automation])
    try:
        await hub.integrations.dispatch_command("demo.motion_hall", "turn_on")
        await settle()
        await hub.store.flush()

        runs = client.tables["automation_runs"]
        assert len(runs) == 1
        assert runs[0]["automation_id"] == "motion_light"
        assert runs[0]["success"] is True
    finally:
        await hub.stop()


async def test_store_closes_client_on_stop():
    client = FakeSupabaseClient()
    hub = await make_hub(client)
    await hub.stop()
    assert client.closed
