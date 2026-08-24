"""Pit-Boss-Pelletgrill.

Getestet wird das, was der Hub aus dem Rohzustand der Steuerplatine macht –
ohne Grill und ohne die Bibliothek. Genau das ist der Teil, der beim
Grillen zählt: ob «Pellets leer» ankommt, bevor das Fleisch kalt wird.
"""

import asyncio

import pytest

from homepilot.core.errors import ConfigError
from homepilot.integrations.pitboss import (
    RPC_ABFRAGE,
    _frage_rpc,
    faults,
    fundzeile,
    grill_entries,
    grill_state,
    grill_zeilen,
    netzadressen,
    probe_temperatures,
    rpc_antwort,
    slug,
    yaml_block,
    zustandszeilen,
)


def test_slug_makes_a_usable_id():
    assert slug("Grill Terrasse") == "grill_terrasse"
    assert slug("  Grill!  ") == "grill"
    # Ohne brauchbaren Namen trotzdem eine Kennung – ein Gerät ohne
    # Kennung liesse sich nirgends zuordnen.
    assert slug("---") == "grill"


def test_only_plugged_probes_count():
    """Ein nicht eingesteckter Fühler meldet None.

    Ihn trotzdem zu führen hiesse: eine Kachel, die dauerhaft «–» zeigt.
    """
    state = {"p1Temp": 62, "p2Temp": None, "p3Temp": 0, "p4Temp": None}
    # 0 Grad ist ein Messwert, kein fehlender Fühler.
    assert probe_temperatures(state) == {1: 62, 3: 0}
    assert probe_temperatures({}) == {}


def test_faults_are_named_not_just_counted():
    """«Störung» genügt nicht - Pellets nachfüllen und ein defektes
    Gebläse führen zu ganz verschiedenen Schritten."""
    assert faults({}) == []
    assert faults({"noPellets": True}) == ["Pellets leer"]
    many = faults({"noPellets": True, "fanErr": True, "err2": True})
    assert many == ["Pellets leer", "Gebläse", "Fühler 2"]


def test_grill_state_shape():
    raw = {
        "moduleIsOn": True,
        "grillTemp": 107,
        "grillSetTemp": 121,
        "isFahrenheit": False,
        "hotState": False,
        "fanState": True,
        "motorState": True,
        "lightState": False,
        "p1Temp": 62,
        "p2Temp": None,
    }
    shaped = grill_state(raw)
    assert shaped["state"] == "running"
    assert shaped["temperature"] == 107
    assert shaped["target"] == 121
    assert shaped["unit"] == "°C"
    assert shaped["fan"] is True
    assert shaped["igniter"] is False
    assert shaped["probes"] == {1: 62}
    assert shaped["problem"] is None

    # Ein stromloser Grill zwischen zwei Grillabenden.
    assert grill_state({"moduleIsOn": False})["state"] == "off"
    # Fahrenheit-Geräte melden ihre Einheit selbst.
    assert grill_state({"isFahrenheit": True})["unit"] == "°F"
    # Die erste Störung steht vorne, damit die Kachel sie zeigen kann.
    assert grill_state({"noPellets": True})["problem"] == "Pellets leer"


# --- Der Einrichtungs-Helfer -------------------------------------------
#
# `python -m homepilot.integrations.pitboss` prüft die Verbindung, bevor
# irgendetwas in die config.yaml wandert. Das Verbinden selbst braucht
# einen Grill; was der Helfer daraus macht, nicht.

def test_yaml_block_takes_the_local_way_when_there_is_a_host():
    block = yaml_block("Grill", "PBV4PS2", host="10.10.1.60")
    assert block.splitlines() == [
        "  - integration: pitboss",
        "    scan_interval: 30",
        "    grills:",
        "      - name: Grill",
        "        model: PBV4PS2",
        "        host: 10.10.1.60",
    ]
    # Ohne die Zeile gibt es den Fernstart gar nicht – das soll man dem
    # Vorschlag ansehen und nicht erst in der Anleitung nachlesen.
    assert "allow_remote_start" not in block


def test_yaml_block_stays_a_list_even_for_a_single_grill():
    """Sonst schreibt der zweite Grill den ersten tot.

    Wer später einen anschliesst, hängt ihn unter 'grills:' an - und
    genau dahin führt der Vorschlag von Anfang an.
    """
    assert "    grills:" in yaml_block("Grill", "PBV4PS2", host="10.10.1.60")
    assert yaml_block("Grill", "PBV4PS2", host="10.10.1.60").count(
        "- integration: pitboss"
    ) == 1


def test_yaml_block_quotes_the_cloud_id():
    """Die Kennung aus der App ist eine lange Ziffernfolge.

    Ohne Anführungszeichen liest YAML sie als Zahl – und dann fehlen
    führende Nullen.
    """
    block = yaml_block("Grill", "LG0800BL", grill_id="0123456789")
    assert '        grill_id: "0123456789"' in block
    # Über die Cloud meldet der Grill von selbst – da gibt es nichts abzufragen.
    assert "scan_interval" not in block


def test_yaml_block_carries_the_remote_start_when_asked():
    block = yaml_block("Grill", "PBV4PS2", host="10.10.1.60", allow_remote_start=True)
    assert block.endswith("        allow_remote_start: true")


def test_the_device_lines_stand_on_their_own():
    """Für den zweiten Grill braucht es nur diese Zeilen."""
    assert grill_zeilen("Smoker", "PB1150PS2", host="10.10.1.61") == [
        "      - name: Smoker",
        "        model: PB1150PS2",
        "        host: 10.10.1.61",
    ]


def test_state_lines_show_what_matters_at_the_grill():
    zeilen = zustandszeilen(
        grill_state(
            {
                "moduleIsOn": True,
                "grillTemp": 110,
                "grillSetTemp": 120,
                "p1Temp": 63,
                "noPellets": True,
            }
        )
    )
    assert zeilen[0] == "Zustand:     läuft"
    assert zeilen[1] == "Garraum:     110 °C  (Ziel 120 °C)"
    assert zeilen[2] == "Fühler:      1: 63 °C"
    assert zeilen[3] == "Störungen:   Pellets leer"


def test_state_lines_say_when_no_probe_is_plugged():
    """Ein leeres Gerüst und ein Grill ohne Fühler sehen sonst gleich aus."""
    zeilen = zustandszeilen(grill_state({"moduleIsOn": False}))
    assert zeilen[0] == "Zustand:     aus"
    assert "Fühler:      keiner eingesteckt" in zeilen
    assert "Störungen:   keine" in zeilen


# --- Den Grill im Netz finden ------------------------------------------
#
# Die Adresse steht auf keinem Typenschild. Die Steuerplatine läuft unter
# Mongoose OS und beantwortet Sys.GetInfo auf Port 80 – das genügt zum
# Absuchen, noch bevor das Modell feststeht.

def test_network_notation_is_forgiving():
    assert netzadressen("10.10.1.0/30") == ["10.10.1.1", "10.10.1.2"]
    # Die Kurzform meint das ganze Netz dahinter.
    assert netzadressen("10.10.1")[0] == "10.10.1.1"
    assert len(netzadressen("10.10.1")) == 254
    # Eine einzelne Adresse bleibt eine einzelne Adresse.
    assert netzadressen(" 10.10.1.60 ") == ["10.10.1.60"]


def test_a_network_too_big_is_refused_not_attempted():
    """Ein /8 abzusuchen dauert Stunden.

    Wer sich vertippt, soll das sofort erfahren und nicht nach zehn
    Minuten Stille abbrechen müssen.
    """
    with pytest.raises(ValueError, match="dauert zu lange"):
        netzadressen("10.0.0.0/8")
    with pytest.raises(ValueError):
        netzadressen("")


def test_only_json_answers_count_as_a_device():
    """Drucker und Kameras antworten auf Port 80 ebenfalls – mit HTML."""
    assert rpc_antwort(b"HTTP/1.1 200 OK\r\n\r\n<html>Drucker</html>") is None
    assert rpc_antwort(b"HTTP/1.1 404 Not Found\r\n\r\n") is None
    # Mongoose OS packt die Antwort in "result".
    info = rpc_antwort(b'HTTP/1.1 200 OK\r\nX: y\r\n\r\n{"id":1,"result":{"app":"PitBoss"}}')
    assert info == {"app": "PitBoss"}
    # Ohne Hülle geht es auch – nicht jede Firmware hält sich daran.
    assert rpc_antwort(b'{"app":"PitBoss"}') == {"app": "PitBoss"}


def test_the_hit_line_keeps_the_firmware_name():
    """Shelly-Geräte laufen ebenfalls unter Mongoose OS.

    Wegzufiltern wäre geraten; den Namen zu zeigen lässt den Menschen
    entscheiden.
    """
    zeile = fundzeile("10.10.1.60", {"app": "PitBoss", "mac": "AABBCC", "fw_version": "1.2"})
    assert zeile.startswith("10.10.1.60")
    assert "PitBoss" in zeile and "fw 1.2" in zeile and "AABBCC" in zeile
    # Eine karge Antwort ist immer noch ein Fund.
    assert fundzeile("10.10.1.61", {}).strip() == "10.10.1.61"


@pytest.mark.asyncio
async def test_the_probe_speaks_http_a_grill_would_understand():
    """Der HTTP-Aufruf ist von Hand geschrieben – also einmal wirklich führen.

    Ein vergessenes Content-Length hätte hier nie jemand gesehen: Der
    Grill hätte einfach geschwiegen, und die Suche hätte «nichts
    gefunden» gemeldet.
    """
    gesehen: dict[str, bytes] = {}

    async def antworte(reader, writer):
        gesehen["anfrage"] = await reader.read(512)
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n'
                     b'{"id":1,"result":{"app":"PitBoss","mac":"AABBCC"}}')
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(antworte, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        info = await _frage_rpc("127.0.0.1", port)

    assert info == {"app": "PitBoss", "mac": "AABBCC"}
    anfrage = gesehen["anfrage"]
    assert anfrage.startswith(b"POST /rpc HTTP/1.1\r\n")
    assert b"Content-Length: %d\r\n" % len(RPC_ABFRAGE) in anfrage
    assert anfrage.endswith(RPC_ABFRAGE)


@pytest.mark.asyncio
async def test_a_closed_port_is_simply_no_device():
    """Beim Absuchen eines /24 antworten 250 Adressen gar nicht.

    Jede davon dürfte keine Ausnahme werfen, sonst reisst der erste
    leere Platz die ganze Suche ab.
    """
    server = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    server.close()
    await server.wait_closed()
    assert await _frage_rpc("127.0.0.1", port) is None


# --- Zwei Grills auf derselben Terrasse --------------------------------

def test_a_single_grill_needs_no_list():
    """Die kurze Form bleibt gültig – für ein Gerät soll niemand eine
    Liste tippen müssen."""
    (eintrag,) = grill_entries(
        {"integration": "pitboss", "name": "Grill", "model": "PBV4PS2", "host": "10.10.1.60"}
    )
    assert eintrag["id"] == "grill"
    assert eintrag["model"] == "PBV4PS2"
    assert eintrag["grill_id"] == ""
    assert eintrag["allow_remote_start"] is False


def test_two_grills_live_in_one_entry():
    """Zwei getrennte Einträge sähen richtig aus, wären es aber nicht.

    Der Hub führt Integrationen unter ihrem Namen; der zweite Eintrag
    verdrängt den ersten, und dann landet der Befehl für den
    Räucherschrank beim Smoker.
    """
    eintraege = grill_entries(
        {
            "integration": "pitboss",
            "grills": [
                {"name": "Räucherschrank", "model": "PBV4PS2", "host": "10.10.1.60"},
                {"name": "Smoker", "model": "PB1150PS2", "grill_id": "abc"},
            ],
        }
    )
    # Umlaute bleiben stehen – so machen es auch die Gruppen (group.py),
    # und die Kennung steht später in Szenen und Abläufen.
    assert [eintrag["id"] for eintrag in eintraege] == ["räucherschrank", "smoker"]
    assert eintraege[1]["grill_id"] == "abc"


def test_the_remote_start_can_be_set_for_all_or_for_one():
    eintraege = grill_entries(
        {
            "allow_remote_start": True,
            "grills": [
                {"name": "A", "model": "PBV4PS2", "host": "1.2.3.4"},
                {"name": "B", "model": "PBV4PS2", "host": "1.2.3.5", "allow_remote_start": False},
            ],
        }
    )
    assert [eintrag["allow_remote_start"] for eintrag in eintraege] == [True, False]


def test_a_grill_without_a_way_is_refused_by_name():
    """Bei zwei Geräten muss die Meldung sagen, welches gemeint ist."""
    with pytest.raises(ConfigError, match="Smoker"):
        grill_entries({"grills": [{"name": "Smoker", "model": "PB1150PS2"}]})
    with pytest.raises(ConfigError, match="Smoker"):
        grill_entries(
            {"grills": [{"name": "Smoker", "model": "PB1150PS2", "host": "1.2.3.4", "grill_id": "x"}]}
        )
    with pytest.raises(ConfigError, match="model"):
        grill_entries({"grills": [{"name": "Smoker", "host": "1.2.3.4"}]})


def test_the_same_name_twice_would_be_one_tile():
    with pytest.raises(ConfigError, match="zweimal"):
        grill_entries(
            {
                "grills": [
                    {"name": "Grill", "model": "PBV4PS2", "host": "1.2.3.4"},
                    {"name": "Grill!", "model": "PBV4PS2", "host": "1.2.3.5"},
                ]
            }
        )


@pytest.mark.asyncio
async def test_each_grill_gets_its_own_commands(monkeypatch):
    """Der Fehler, den zwei Einträge gemacht hätten, in einem Test.

    Der Hub sucht die Integration beim Schalten über den Namen –
    «pitboss». Läge die Verbindung an der Integration statt am Gerät,
    ginge «Smoker aus» an den Räucherschrank.
    """
    import sys
    import types

    from homepilot.core.config import ApiConfig, HubConfig
    from homepilot.core.hub import Hub
    from homepilot.integrations.pitboss import PitBossIntegration

    geschaltet: list[tuple[str, str]] = []

    class FakeBoss:
        def __init__(self, connection, model, password=""):
            self.model = model

        async def start(self):
            # Wie in pytboss: Die Bauart entsteht erst hier, nicht im
            # Konstruktor (siehe test_the_lights_appear_after_start).
            self.spec = types.SimpleNamespace(has_lights=False)

        async def stop(self):
            pass

        async def get_state(self):
            return {"moduleIsOn": False}

        async def turn_grill_off(self):
            geschaltet.append((self.model, "off"))

    fake = types.ModuleType("pytboss")
    fake.PitBoss = FakeBoss
    fake.HttpConnection = lambda host: ("http", host)
    fake.WebSocketConnection = lambda grill_id: ("ws", grill_id)
    monkeypatch.setitem(sys.modules, "pytboss", fake)

    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    try:
        integration = PitBossIntegration(
            hub,
            {
                "integration": "pitboss",
                "grills": [
                    {"name": "Räucherschrank", "model": "PBV4PS2", "host": "10.10.1.60"},
                    {"name": "Smoker", "model": "PB1150PS2", "host": "10.10.1.61"},
                ],
            },
        )
        await integration.setup()

        entities = {entity.id: entity for entity in hub.registry.all()}
        assert "pitboss.räucherschrank" in entities
        assert "pitboss.smoker" in entities

        await integration.handle_command(entities["pitboss.smoker"], "turn_off", {})
        assert geschaltet == [("PB1150PS2", "off")]

        await integration.handle_command(
            entities["pitboss.räucherschrank"], "turn_off", {}
        )
        assert geschaltet[-1] == ("PBV4PS2", "off")

        # Ohne den Schalter gibt es den Fernstart gar nicht – auch nicht
        # für den zweiten Grill.
        assert "turn_on" not in entities["pitboss.smoker"].commands
    finally:
        await integration.teardown()
        await hub.stop()


# ── Wann pytboss die Bauart des Grills kennt ─────────────────────────────
#
# `PitBoss.spec` entsteht in `start()`, nicht im Konstruktor: Erst dort
# wird das Modell aufgelöst. Wer vorher danach greift, bekommt einen
# AttributeError - und die Integration stand in der Diagnose mit
# «'PitBoss' object has no attribute 'spec'» statt mit einem Grill da.


def test_no_spec_means_no_light_switch():
    import types

    from homepilot.integrations.pitboss import hat_licht

    assert hat_licht(types.SimpleNamespace(has_lights=True)) is True
    assert hat_licht(types.SimpleNamespace(has_lights=False)) is False
    # Ein Lichtschalter, der ins Leere greift, ist schlimmer als keiner.
    assert hat_licht(None) is False
    assert hat_licht(types.SimpleNamespace()) is False


def _fake_pytboss(monkeypatch, start):
    """Ein pytboss, dessen `start()` der Test bestimmt."""
    import sys
    import types

    class FakeBoss:
        def __init__(self, connection, model, password=""):
            self.model = model

        async def start(self):
            await start(self)

        async def stop(self):
            pass

        async def get_state(self):
            return {"moduleIsOn": False}

    fake = types.ModuleType("pytboss")
    fake.PitBoss = FakeBoss
    fake.HttpConnection = lambda host: ("http", host)
    fake.WebSocketConnection = lambda grill_id: ("ws", grill_id)
    monkeypatch.setitem(sys.modules, "pytboss", fake)


async def _aufbau(start):
    """Die Integration mit einem Grill hochfahren. Gibt (hub, integration)."""
    from homepilot.core.config import ApiConfig, HubConfig
    from homepilot.core.hub import Hub
    from homepilot.integrations.pitboss import PitBossIntegration

    hub = Hub(HubConfig(api=ApiConfig(), integrations=[], automations=[]))
    await hub.start()
    integration = PitBossIntegration(
        hub,
        {
            "integration": "pitboss",
            "name": "Grill",
            "model": "PBV4PS2",
            "host": "10.10.1.60",
        },
    )
    return hub, integration


@pytest.mark.asyncio
async def test_the_lights_appear_after_start(monkeypatch):
    import types

    async def start(boss):
        boss.spec = types.SimpleNamespace(has_lights=True)

    _fake_pytboss(monkeypatch, start)
    hub, integration = await _aufbau(start)
    try:
        await integration.setup()
        grill = hub.registry.get("pitboss.grill")
        assert "light_on" in grill.commands
        assert "light_off" in grill.commands
    finally:
        await integration.teardown()
        await hub.stop()


@pytest.mark.asyncio
async def test_a_cold_grill_still_gets_its_tile(monkeypatch):
    """Zwischen zwei Grillabenden ist das Gerät stromlos.

    Die Bauart steht trotzdem fest - pytboss löst sie auf, bevor es die
    Verbindung aufbaut. Der Grill kommt also mit allem, was er kann, in
    die App; nur eben als «nicht erreichbar».
    """
    import types

    async def start(boss):
        boss.spec = types.SimpleNamespace(has_lights=True)
        raise OSError("Verbindung abgelehnt")

    _fake_pytboss(monkeypatch, start)
    hub, integration = await _aufbau(start)
    try:
        await integration.setup()
        grill = hub.registry.get("pitboss.grill")
        assert grill is not None
        assert grill.available is False
        assert "light_on" in grill.commands
    finally:
        await integration.teardown()
        await hub.stop()


@pytest.mark.asyncio
async def test_an_unknown_model_is_named_as_a_configuration_error(monkeypatch):
    """Scheitert start(), bevor es eine Bauart gibt, liegt es am Modell."""

    async def start(boss):
        raise ValueError("Invalid grill: PBV4PS2")

    _fake_pytboss(monkeypatch, start)
    hub, integration = await _aufbau(start)
    try:
        with pytest.raises(ConfigError) as fehler:
            await integration.setup()
        assert "PBV4PS2" in str(fehler.value)
    finally:
        await integration.teardown()
        await hub.stop()
