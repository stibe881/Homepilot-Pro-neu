"""Integrations-Wächter: Ausfall erkennen, melden, Entwarnung geben."""

import time

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.watchdog import (
    cycle_stats,
    down_integrations,
    low_batteries,
    watched_entities,
)


class _E:
    def __init__(self, integration, available):
        self.integration, self.available = integration, available


def test_down_integrations_pure():
    entities = [
        _E("hue", False), _E("hue", False),
        _E("ring", False), _E("ring", True),
        _E("demo", False),  # steht auf der Ignorier-Liste
    ]
    assert down_integrations(entities) == {"hue"}
    assert down_integrations([]) == set()


async def test_watchdog_meldet_ausfall_und_rueckkehr():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None, **_):
            sent.append((title, body))
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        # 'hue' fällt komplett aus – zwei Runden Karenz, dann Meldung.
        entity = type(
            "E",
            (),
            {
                "id": "hue.lampe",
                "name": "Lampe",
                "label": "Lampe",
                "kind": "light",
                "integration": "hue",
                "available": False,
                "state": {},
            },
        )()
        hub.registry.all = lambda: [entity]  # type: ignore[assignment]
        await hub.watchdog.check()
        assert hub.watchdog.down_since == {}
        await hub.watchdog.check()
        assert "hue" in hub.watchdog.down_since
        assert sent and "hue" in sent[0][0]
        assert hub.watchdog.outages[0]["ended"] is None

        # Wieder erreichbar → Entwarnung, Ausfall abgeschlossen.
        entity.available = True
        await hub.watchdog.check()
        assert hub.watchdog.down_since == {}
        assert "wieder da" in sent[1][0]
        assert hub.watchdog.outages[0]["ended"] is not None
    finally:
        await hub.stop()


def test_only_alarm_sensors_are_watched_one_by_one():
    """Alles zu melden wäre Lärm – bei hundert Geräten ist immer eines
    kurz weg. Was die Alarmanlage bewacht, hat jemand bewusst als wichtig
    eingestuft."""
    def entity(entity_id: str, available: bool = True, low: bool | None = None):
        state = {} if low is None else {"low_battery": low}
        return type(
            "E",
            (),
            {
                "id": entity_id,
                "name": entity_id,
                "label": entity_id,
                "integration": "homematic",
                "available": available,
                "state": state,
            },
        )()

    entities = [entity("hm.rauchmelder"), entity("hm.lampe")]
    watched = watched_entities(entities, {"hm.rauchmelder"})
    assert [item.id for item in watched] == ["hm.rauchmelder"]
    assert watched_entities(entities, set()) == []


def test_low_batteries_are_found():
    def entity(entity_id: str, low: bool | None):
        state = {} if low is None else {"low_battery": low}
        return type(
            "E", (), {"id": entity_id, "name": entity_id, "label": entity_id, "state": state}
        )()

    entities = [entity("a", True), entity("b", False), entity("c", None)]
    assert [item.id for item in low_batteries(entities)] == ["a"]


async def test_a_weak_battery_is_reported_once():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None, **_):
            sent.append((title, body))
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        melder = type(
            "E",
            (),
            {
                "id": "hm.rauchmelder",
                "name": "Rauchmelder Flur",
                "label": "Rauchmelder Flur",
                "kind": "binary_sensor",
                "integration": "homematic",
                "available": True,
                "state": {"low_battery": True},
            },
        )()
        hub.registry.all = lambda: [melder]  # type: ignore[assignment]

        await hub.watchdog.check()
        assert any("Rauchmelder Flur" in title for title, _ in sent)
        # Zweite Runde: keine zweite Nachricht, sonst schweigt man sie tot.
        before = len(sent)
        await hub.watchdog.check()
        assert len(sent) == before

        # Nach dem Batteriewechsel wieder scharf für die nächste Warnung.
        melder.state = {"low_battery": False}
        await hub.watchdog.check()
        melder.state = {"low_battery": True}
        await hub.watchdog.check()
        assert len(sent) > before
    finally:
        await hub.stop()


async def test_a_finished_machine_is_remembered_once():
    """Die Push beim Programmende geht unter, wenn man gerade nicht kann.
    Erinnert wird deshalb später – aber nur einmal je Programm."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[str] = []

        async def fake_send(tokens, title, body, data=None, **_):
            sent.append(title)
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        maschine = type(
            "E",
            (),
            {
                "id": "vzug.waschmaschine",
                "name": "Waschmaschine",
                "label": "Waschmaschine",
                "kind": "appliance",
                "integration": "vzug",
                "available": True,
                "state": {"state": "running"},
            },
        )()
        hub.registry.all = lambda: [maschine]  # type: ignore[assignment]

        await hub.watchdog.check()
        maschine.state = {"state": "idle"}
        await hub.watchdog.check()
        # Gerade erst fertig – noch keine Mahnung.
        assert not any("voll" in title for title in sent)

        # Zwei Stunden vorspulen.
        hub.watchdog._finished_at["vzug.waschmaschine"] -= 2 * 3600
        await hub.watchdog.check()
        assert any("Waschmaschine" in title for title in sent)

        before = len(sent)
        await hub.watchdog.check()
        assert len(sent) == before

        # Neues Programm: Der Merker ist wieder frei.
        maschine.state = {"state": "running"}
        await hub.watchdog.check()
        assert "vzug.waschmaschine" not in hub.watchdog._reminded
    finally:
        await hub.stop()


def test_cycle_stats_compare_the_last_run_with_the_average():
    """Erst der Vergleich verrät ein Gerät, das schleichend länger braucht –
    beim Tumbler meist ein verstopftes Flusensieb."""
    stats = cycle_stats(
        [
            {"entity_id": "vzug.tumbler", "name": "Tumbler", "seconds": 5400, "finished": 30},
            {"entity_id": "vzug.tumbler", "name": "Tumbler", "seconds": 3600, "finished": 20},
            {"entity_id": "vzug.tumbler", "name": "Tumbler", "seconds": 3600, "finished": 10},
            {"entity_id": "vzug.wama", "name": "Waschmaschine", "seconds": 0},
            "kaputt",
        ]
    )
    assert len(stats) == 1
    tumbler = stats[0]
    assert tumbler["runs"] == 3
    assert tumbler["average_seconds"] == 4200
    # Der jüngste Lauf steht vorne – er ist der interessante.
    assert tumbler["last_seconds"] == 5400


async def test_a_cycle_without_a_beginning_is_not_guessed():
    """Beim Hubstart mitten im Programm fehlt der Anfang. Eine geratene
    Dauer in einer Statistik ist schlimmer als keine."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        maschine = type(
            "E",
            (),
            {
                "id": "vzug.wama",
                "name": "Waschmaschine",
                "label": "Waschmaschine",
                "kind": "appliance",
                "integration": "vzug",
                "available": True,
                "state": {"state": "running"},
            },
        )()
        hub.registry.all = lambda: [maschine]  # type: ignore[assignment]

        # Erste Runde sieht «running» – ohne zu wissen, seit wann. Der
        # Wächter merkt sich den Zeitpunkt selbst, also zählt dieser Lauf.
        await hub.watchdog.check()
        hub.watchdog._started_at.pop("vzug.wama")
        maschine.state = {"state": "idle"}
        await hub.watchdog.check()
        assert hub.data.get("appliance_cycles") == []
    finally:
        await hub.stop()


async def test_the_day_is_closed_with_the_last_value_before_midnight():
    """Die Zähler springen um Mitternacht auf 0. Ohne diesen Abschluss
    fehlten dem Vortag die letzten Minuten – oder er stünde ganz auf 0."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        steckdose = type(
            "E",
            (),
            {
                "id": "hm.psm",
                "name": "Steckdose",
                "label": "Steckdose",
                "kind": "sensor",
                "integration": "homematic",
                "available": True,
                "state": {"energy_today": 4.0},
            },
        )()
        hub.registry.all = lambda: [steckdose]  # type: ignore[assignment]

        # Der Wächter steht mitten im «Vortag» und hat dessen letzten Stand
        # gesehen, aber wegen des Zehnminutentakts noch nicht geschrieben.
        hub.watchdog._energy_day = "2020-01-01"
        hub.watchdog._energy_written = time.time()
        hub.watchdog._energy_last = 6.5

        # Mitternacht: Der Zähler steht wieder bei fast null.
        steckdose.state = {"energy_today": 0.1}
        await hub.watchdog.check()

        days = {entry["day"]: entry["kwh"] for entry in hub.data.get("energy_days")}
        # Der Vortag bekommt den letzten gesehenen Stand, nicht die 0.
        assert days["2020-01-01"] == 6.5
        # Und der neue Tag fängt bei seinem eigenen Wert an.
        assert days[hub.watchdog._energy_day] == 0.1
        assert hub.watchdog._energy_day != "2020-01-01"
    finally:
        await hub.stop()


async def test_without_a_meter_nothing_is_written():
    """Ein Haushalt ohne Messsteckdose soll keine Datei voller Nullen
    bekommen."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        lampe = type(
            "E",
            (),
            {
                "id": "hue.lampe",
                "name": "Lampe",
                "label": "Lampe",
                "kind": "light",
                "integration": "hue",
                "available": True,
                "state": {"state": "on"},
            },
        )()
        hub.registry.all = lambda: [lampe]  # type: ignore[assignment]
        await hub.watchdog.check()
        assert hub.data.get("energy_days") == []
    finally:
        await hub.stop()


# ── Offene Fenster und Wasser ──────────────────────────────────────────────


def melder(entity_id: str, device_class: str, state: str = "on"):
    return type(
        "E",
        (),
        {
            "id": entity_id,
            "name": entity_id,
            "label": entity_id,
            "kind": "binary_sensor",
            "integration": "homematic",
            "available": True,
            "state": {"state": state, "device_class": device_class},
        },
    )()


def test_only_contacts_count_as_open():
    """Ein Bewegungsmelder, der lange «on» meldet, heizt nicht zum Fenster
    hinaus."""
    from homepilot.core.watchdog import open_contacts

    entities = [
        melder("hm.fenster", "contact"),
        melder("hm.bewegung", "motion"),
        melder("hm.tuer", "contact", "off"),
        melder("hm.ohne", ""),
    ]
    assert [entity.id for entity in open_contacts(entities)] == ["hm.fenster"]


def test_leaks_are_found_by_their_device_class():
    from homepilot.core.watchdog import leaks

    entities = [melder("hm.keller", "moisture"), melder("hm.fenster", "contact")]
    assert [entity.id for entity in leaks(entities)] == ["hm.keller"]


async def test_an_open_window_is_reported_once_and_rearms_after_closing():
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[str] = []

        async def fake_send(tokens, title, body, data=None, image=None, **_):
            sent.append(title)
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        fenster = melder("hm.fenster", "contact")
        hub.registry.all = lambda: [fenster]  # type: ignore[assignment]

        await hub.watchdog.check()
        assert not sent  # Gerade erst geöffnet – noch keine Mahnung.

        # Zwei Stunden vorspulen.
        hub.watchdog._open_since["hm.fenster"] -= 2 * 3600
        await hub.watchdog.check()
        assert any("steht offen" in title for title in sent)

        before = len(sent)
        await hub.watchdog.check()
        assert len(sent) == before  # Nicht jede Minute erneut.

        # Zugemacht und wieder geöffnet: Der Merker ist frei.
        fenster.state = {"state": "off", "device_class": "contact"}
        await hub.watchdog.check()
        assert "hm.fenster" not in hub.watchdog._reported_open
        assert "hm.fenster" not in hub.watchdog._open_since
    finally:
        await hub.stop()


async def test_water_is_reported_immediately_no_matter_the_alarm_state():
    """Der Waschmaschinenschlauch platzt am liebsten, während man zuhause
    ist und nichts hört."""
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[str] = []

        async def fake_send(tokens, title, body, data=None, image=None, **_):
            sent.append(title)
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        keller = melder("hm.keller", "moisture")
        hub.registry.all = lambda: [keller]  # type: ignore[assignment]

        # Keine Karenzzeit – anders als beim offenen Fenster.
        await hub.watchdog.check()
        assert any("Wasser" in title for title in sent)

        before = len(sent)
        await hub.watchdog.check()
        assert len(sent) == before

        # Trocken und wieder nass: erneut melden.
        keller.state = {"state": "off", "device_class": "moisture"}
        await hub.watchdog.check()
        keller.state = {"state": "on", "device_class": "moisture"}
        await hub.watchdog.check()
        assert len(sent) > before
    finally:
        await hub.stop()


def test_open_contacts_counts_the_door_sensor_in_a_lock():
    """Der Riegel sagt nichts darüber, ob die Türe offen *steht*."""
    from homepilot.core.watchdog import open_contacts

    schloss = type(
        "E",
        (),
        {
            "id": "nuki.haustuer",
            "name": "Haustüre",
            "label": "Haustüre",
            "kind": "lock",
            "integration": "nuki",
            "available": True,
            "state": {"state": "locked", "door": "open"},
        },
    )()
    assert [entity.id for entity in open_contacts([schloss])] == ["nuki.haustuer"]
    schloss.state = {"state": "unlocked", "door": "closed"}
    # Aufgeschlossen, aber zu: nicht offen. Genau diesen Fall zählte das
    # Widget vorher falsch herum.
    assert open_contacts([schloss]) == []


def test_open_contacts_falls_back_to_the_name():
    """Ohne device_class entscheidet der Name – und zwar der selbst
    vergebene.

    Der Matter-Kontakt heisst ab Werk «Aqara Door and Window Sensor P2».
    Was ihn als Fenster erkennbar macht, ist der Name, den jemand ihm in
    der App gegeben hat.
    """
    from homepilot.core.watchdog import open_contacts

    fenster = melder("matter.kueche", "")
    fenster.name = "Aqara Door and Window Sensor P2"
    fenster.label = "Fenster Küche"
    assert [entity.id for entity in open_contacts([fenster])] == ["matter.kueche"]


def test_open_contacts_ignores_unreachable_sensors():
    """Ein Kontakt, der nicht mehr meldet, weiss nicht, ob offen ist."""
    from homepilot.core.watchdog import open_contacts

    fenster = melder("hm.fenster", "contact")
    fenster.available = False
    assert open_contacts([fenster]) == []


def test_heartbeat_respects_its_own_pace(monkeypatch):
    """Der Wächter dreht jede Minute – das Lebenszeichen geht trotzdem
    nur im eingestellten Takt hinaus, und ohne url gar nicht."""
    import asyncio

    import aiohttp

    from homepilot.core.config import ApiConfig, HubConfig
    from homepilot.core.hub import Hub

    aufrufe = []

    class FakeResponse:
        status = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class FakeSession:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def get(self, url):
            aufrufe.append(url)
            return FakeResponse()

    monkeypatch.setattr(aiohttp, "ClientSession", FakeSession)

    async def check():
        hub = Hub(
            HubConfig(
                api=ApiConfig(),
                integrations=[],
                automations=[],
                heartbeat={"url": "https://hc-ping.com/test", "minutes": 5},
            )
        )
        await hub.watchdog._heartbeat()
        await hub.watchdog._heartbeat()
        await hub.watchdog._heartbeat()
        # Drei Runden, ein Ping – die übrigen fielen unter den Takt.
        assert aufrufe == ["https://hc-ping.com/test"]

        ohne = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
        await ohne.watchdog._heartbeat()
        assert len(aufrufe) == 1

    asyncio.run(check())


async def test_the_open_window_push_names_the_window_not_the_sensor_model():
    """«Aqara Door and Window Sensor P2 steht offen» sagt nicht, welches.

    Der Matter-Kontakt bringt den Namen von der Verpackung mit. Wer ihn in
    der App «Fenster Küche» genannt hat, will genau das lesen - nachts, in
    einer Mitteilung, die man in zwei Sekunden versteht oder gar nicht.
    """
    from homepilot.core.entity import Entity

    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None, **_):
            sent.append((title, body))
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        fenster = Entity(
            id="matter.kontakt",
            kind="binary_sensor",
            name="Aqara Door and Window Sensor P2",
            integration="matter",
            state={"state": "on", "device_class": "contact"},
        )
        fenster.display_name = "Fenster Küche"
        hub.registry.all = lambda: [fenster]  # type: ignore[assignment]

        await hub.watchdog.check()
        # Drei Stunden zurückdrehen - die Regel erinnert nach zwei.
        hub.watchdog._open_since["matter.kontakt"] -= 3 * 3600
        await hub.watchdog.check()

        titel = [title for title, _ in sent if "steht offen" in title]
        assert titel == ["Fenster Küche steht offen"]
        # Die Uhrzeit steht vorne: Wer weiss, wann er aufgemacht hat,
        # erkennt daran sofort einen hängenden Sensor. Eine gerundete
        # Dauer allein liesse ihn nur rätseln.
        text = next(body for title, body in sent if "steht offen" in title)
        assert text.startswith("Offen seit ")
        assert "3 Std." in text
    finally:
        await hub.stop()


async def test_die_offen_meldung_zaehlt_ab_der_letzten_oeffnung():
    """Der Fall, der die Nachricht zu früh brachte.

    Der Wächter zählte selbst, und seine Uhr begann in der Runde, in der
    er den Kontakt zum ersten Mal offen sah. Ging eine Türe zwischen zwei
    Runden auf, zu und wieder auf, lief sie von der ersten Öffnung weiter
    - und «seit einer Stunde offen» kam nach fünf Minuten.
    """
    import time as zeit

    from homepilot.core.entity import Entity

    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None, **_):
            sent.append((title, body))
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        tuere = Entity(
            id="matter.tuere",
            kind="binary_sensor",
            name="Haustüre",
            integration="matter",
            state={"state": "on", "device_class": "contact"},
        )
        hub.registry.all = lambda: [tuere]  # type: ignore[assignment]

        jetzt = zeit.time()
        # Vor drei Stunden aufgemacht, vor zwei zugemacht, vor fünf
        # Minuten wieder aufgemacht.
        hub.eventlog._events.extend(
            [
                {"entity_id": "matter.tuere", "state": "on", "at": jetzt - 3 * 3600, "source": {}},
                {"entity_id": "matter.tuere", "state": "off", "at": jetzt - 2 * 3600, "source": {}},
                {"entity_id": "matter.tuere", "state": "on", "at": jetzt - 300, "source": {}},
            ]
        )

        await hub.watchdog.check()
        assert [title for title, _ in sent if "steht offen" in title] == []
    finally:
        await hub.stop()


async def test_die_offen_meldung_kommt_wenn_es_wirklich_so_lange_ist():
    import time as zeit

    from homepilot.core.entity import Entity

    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()
    try:
        sent: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None, **_):
            sent.append((title, body))
            return len(tokens)

        hub.push.send = fake_send  # type: ignore[assignment]
        hub.push.register("ExponentPushToken[x]", "Stefan")

        tuere = Entity(
            id="matter.tuere",
            kind="binary_sensor",
            name="Haustüre",
            integration="matter",
            state={"state": "on", "device_class": "contact"},
        )
        hub.registry.all = lambda: [tuere]  # type: ignore[assignment]

        jetzt = zeit.time()
        hub.eventlog._events.append(
            {"entity_id": "matter.tuere", "state": "on", "at": jetzt - 3 * 3600, "source": {}}
        )

        await hub.watchdog.check()
        text = next(body for title, body in sent if "steht offen" in title)
        assert text.startswith("Offen seit ")
    finally:
        await hub.stop()


def test_offen_satz_nennt_die_uhrzeit():
    import time as zeit

    from homepilot.core.watchrules import offen_satz

    jetzt = zeit.mktime((2026, 8, 27, 15, 5, 0, 0, 0, -1))
    seit = jetzt - 3660  # eine Stunde und eine Minute
    satz = offen_satz(seit, jetzt)
    assert satz.startswith("Offen seit 14:04")
    assert "1 Std. 1 Min." in satz
    # Unter einer Stunde in Minuten - «0 Stunden» wäre keine Auskunft.
    assert offen_satz(jetzt - 900, jetzt).endswith("15 Minuten")
