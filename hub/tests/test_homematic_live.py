"""End-to-End-Test der Homematic-Integration gegen einen CCU-Simulator.

pydevccu bildet eine echte CCU mit den originalen Gerätebeschreibungen und
der vollständigen XML-RPC-Schnittstelle nach. Damit lässt sich prüfen, was
sonst echte Hardware bräuchte: Zustand lesen, schalten und vor allem der
Push-Weg über ``init``/``event``.
"""

from __future__ import annotations

import asyncio
import http.client
import socket
import subprocess
import sys
import xmlrpc.client

import pytest

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

pydevccu = pytest.importorskip("pydevccu", reason="pydevccu nicht installiert")

# Kanal 1 des simulierten Schaltaktors HM-LC-Sw1-Pl-DN-R1.
CHANNEL = "VCU0000299:1"
ENTITY_ID = "homematic.VCU0000299_1"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def _wait_until(predicate, timeout: float = 15.0) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(0.1)
    return predicate()


@pytest.fixture
async def ccu():
    """Startet pydevccu als eigenen Prozess.

    Als Prozess, weil der Simulator beim Stoppen Threads offen lässt – so
    lässt er sich am Ende zuverlässig beenden.
    """
    port = _free_port()
    process = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import time, pydevccu;"
            f"s = pydevccu.Server(addr=('127.0.0.1', {port}),"
            " devices=['HM-LC-Sw1-Pl-DN-R1']);"
            "s.start();"
            "time.sleep(600)",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        assert await _wait_until(lambda: _port_open(port)), "CCU-Simulator startet nicht"
        yield port
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def _port_open(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


async def make_hub(ccu_port: int) -> Hub:
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[
                {
                    "integration": "homematic",
                    "host": "127.0.0.1",
                    "port": ccu_port,
                    "callback_port": _free_port(),
                    "callback_host": "127.0.0.1",
                    "devices": [
                        {
                            "address": CHANNEL,
                            "name": "Licht Küche",
                            "kind": "switch",
                        }
                    ],
                }
            ],
        )
    )
    await hub.start()
    return hub


async def test_initial_state_is_read_from_ccu(ccu):
    hub = await make_hub(ccu)
    try:
        entity = hub.registry.get(ENTITY_ID)
        assert entity is not None
        assert entity.available is True
        assert entity.state["state"] == "off"
        assert entity.commands == ["turn_on", "turn_off", "toggle"]
    finally:
        await hub.stop()


def _ccu_meldet_an(port: int) -> bool:
    """Fragt die CCU mit einer **frischen** Verbindung, ob STATE an ist.

    Eine frische je Poll, mit Absicht: Der ServerProxy hält sonst eine
    einzige HTTP-Verbindung, und bleibt die nach einem abgebrochenen
    Versuch im Zustand «Request-sent» hängen, wirft jeder weitere Poll
    CannotSendRequest - so fiel dieser Test in der Prüfung um, während
    der Schaltbefehl längst angekommen war. Ein Fehlversuch zählt als
    «noch nicht», nicht als Absturz; ob es wirklich nie klappt, sagt der
    Timeout von _wait_until.
    """
    try:
        with xmlrpc.client.ServerProxy(f"http://127.0.0.1:{port}") as proxy:
            return proxy.getValue(CHANNEL, "STATE") is True
    except (OSError, http.client.HTTPException, xmlrpc.client.Error):
        return False


async def test_command_reaches_the_ccu(ccu):
    hub = await make_hub(ccu)
    try:
        await hub.integrations.dispatch_command(ENTITY_ID, "turn_on")

        # Der Wert muss tatsächlich in der CCU stehen, nicht nur im Hub.
        assert await _wait_until(
            lambda: _ccu_meldet_an(ccu)
        ), "Schaltbefehl kam nicht bei der CCU an"

        # …und über den Event-Rückweg im Hub landen.
        assert await _wait_until(
            lambda: hub.registry.get(ENTITY_ID).state["state"] == "on"
        ), "Hub hat den neuen Zustand nicht übernommen"
    finally:
        await hub.stop()


async def test_external_change_arrives_as_event(ccu):
    """Der eigentliche Nutzen des Callbacks: Änderungen von aussen.

    Schaltet jemand am Gerät selbst oder über die CCU-Oberfläche, muss der
    Hub das erfahren, ohne auf den nächsten Poll zu warten.
    """
    hub = await make_hub(ccu)
    proxy = xmlrpc.client.ServerProxy(f"http://127.0.0.1:{ccu}")
    try:
        assert hub.registry.get(ENTITY_ID).state["state"] == "off"

        await asyncio.to_thread(proxy.setValue, CHANNEL, "STATE", True)

        assert await _wait_until(
            lambda: hub.registry.get(ENTITY_ID).state["state"] == "on"
        ), "Externe Änderung wurde nicht per Event gemeldet"
    finally:
        await hub.stop()


async def test_unreachable_ccu_does_not_break_startup():
    """Eine tote CCU darf den Hub nicht am Starten hindern."""
    hub = Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[
                {
                    "integration": "homematic",
                    "host": "127.0.0.1",
                    "port": _free_port(),  # hier lauscht niemand
                    "callback_port": 0,
                    "devices": [{"address": CHANNEL, "name": "Licht", "kind": "switch"}],
                }
            ],
        )
    )
    await hub.start()
    try:
        entity = hub.registry.get(ENTITY_ID)
        assert entity is not None
        assert entity.available is False
    finally:
        await hub.stop()
