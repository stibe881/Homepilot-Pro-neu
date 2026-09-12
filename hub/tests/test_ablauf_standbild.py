"""Punkt 510: Löst eine Kamera einen Ablauf aus, hält der Lauf den Moment fest.

«Bewegung an der Kamera Garten → Licht an» stand bisher im Verlauf nur
als Satz. Was die Kamera dabei sah, war nach zehn Minuten weg
(core/snapshots.py). Jetzt liegt das Standbild im Bildarchiv des
Alarms - mit derselben Frist - und der Lauf trägt seine Kennung.
"""

from __future__ import annotations

import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from homepilot.api.server import create_app
from homepilot.core import bildarchiv, cliparchiv
from homepilot.core.automation import Automation, standbild_meta
from homepilot.core.config import ApiConfig, HubConfig, load_config
from homepilot.core.entity import EntityKind
from homepilot.core.hub import Hub
from homepilot.core.integration import Integration

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32


class Tor(Integration):
    """Eine Kamera, die ein Bild liefert - und eine, die schweigt."""

    name = "tor"

    async def setup(self) -> None:
        await self.add_entity("kamera", EntityKind.CAMERA, "Kamera Tor", room="Garten")
        await self.add_entity("stumm", EntityKind.CAMERA, "Kamera stumm", room="Garten")

    async def handle_command(self, entity, command, data):
        pass

    async def snapshot(self, entity):
        if entity.id == "tor.stumm":
            return None
        return JPEG


async def _hub(data_file: str | None) -> Hub:
    hub = Hub(
        HubConfig(
            api=ApiConfig(), integrations=[{"integration": "demo"}], data_file=data_file
        )
    )
    await hub.start()
    integration = Tor(hub, {})
    hub.integrations._integrations["tor"] = integration
    await integration.setup()
    return hub


def _ablauf(ausloeser: str) -> Automation:
    return Automation(
        id="garten",
        alias="Garten bei Bewegung",
        triggers=[{"type": "state", "entity_id": ausloeser}],
        actions=[
            {"type": "command", "entity_id": "demo.light_livingroom", "command": "turn_on"}
        ],
    )


def test_standbild_meta_names_the_automation():
    class Kamera:
        id = "tor.kamera"
        label = "Kamera Tor"
        room = "Garten"
        integration = "tor"

    meta = standbild_meta(_ablauf("tor.kamera"), Kamera(), 1_700_000_000.0)
    assert cliparchiv.KENNUNG.fullmatch(meta["id"])
    assert meta["automation_id"] == "garten"
    assert meta["anlass"] == "Ablauf «Garten bei Bewegung»"
    assert meta["room"] == "Garten"


def test_a_camera_trigger_leaves_a_still_in_the_run(tmp_path):
    async def check():
        hub = await _hub(str(tmp_path / "data.json"))
        try:
            await hub.automations._run(_ablauf("tor.kamera"), "tor.kamera")
            lauf = hub.automations.runs[0]
            assert lauf["executed"] is True
            kennung = lauf.get("image")
            assert kennung and cliparchiv.KENNUNG.fullmatch(kennung)
            folder = bildarchiv.ordner(hub.config.data_file)
            assert bildarchiv.lesen(folder, kennung) == JPEG
            (meta,) = bildarchiv.liste(folder)
            assert meta["automation_id"] == "garten"
            assert meta["camera"] == "tor.kamera"
        finally:
            await hub.stop()

    asyncio.run(check())


def test_no_still_without_picture_camera_or_archive(tmp_path):
    async def check():
        hub = await _hub(str(tmp_path / "data.json"))
        try:
            # Die Kamera schweigt: Der Lauf läuft trotzdem, nur ohne Bild.
            await hub.automations._run(_ablauf("tor.stumm"), "tor.stumm")
            assert hub.automations.runs[0]["executed"] is True
            assert "image" not in hub.automations.runs[0]
            # Ein Melder ist keine Kamera.
            await hub.automations._run(_ablauf("demo.motion_hall"), "demo.motion_hall")
            assert "image" not in hub.automations.runs[0]
            assert bildarchiv.liste(bildarchiv.ordner(hub.config.data_file)) == []
        finally:
            await hub.stop()

        # Ohne Datendatei gibt es kein Archiv - und keinen Versuch.
        hub = await _hub(None)
        try:
            await hub.automations._run(_ablauf("tor.kamera"), "tor.kamera")
            assert "image" not in hub.automations.runs[0]
        finally:
            await hub.stop()

    asyncio.run(check())


# ── Die Route ─────────────────────────────────────────────────────────────

CONFIG = """\
api: {{ host: 127.0.0.1, port: 18197 }}
integrations:
  - integration: demo
users:
  - name: Stefan
    role: besitzer
    token: t-owner
  - name: Gast
    role: gast
    token: t-guest
data_file: {data_file}
"""


@pytest.fixture
def client(tmp_path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(CONFIG.format(data_file=tmp_path / "data.json"))
    hub = Hub(load_config(config_file))
    with TestClient(create_app(hub)) as test_client:
        test_client.hub = hub
        yield test_client


def test_the_run_image_route_serves_the_archive(client):
    hub = client.hub
    jetzt = time.time()
    kennung = cliparchiv.neue_kennung(jetzt)
    meta = cliparchiv.eintrag(kennung, "tor.kamera", "Ablauf «x»", jetzt)
    bildarchiv.ablegen(bildarchiv.ordner(hub.config.data_file), JPEG, meta)

    antwort = client.get(
        f"/api/automations/bild/{kennung}", headers={"Authorization": "Bearer t-owner"}
    )
    assert antwort.status_code == 200
    assert antwort.headers["content-type"] == "image/jpeg"
    assert antwort.content == JPEG
    # Wie in der App: das Token in der Adresse, weil <Image> keine Kopfzeilen setzt.
    assert client.get(f"/api/automations/bild/{kennung}?token=t-owner").status_code == 200
    assert (
        client.get(
            "/api/automations/bild/gibt-es-nicht", headers={"Authorization": "Bearer t-owner"}
        ).status_code
        == 404
    )
    # Ein Gast sieht keine Läufe - und damit auch kein Bild.
    assert (
        client.get(
            f"/api/automations/bild/{kennung}", headers={"Authorization": "Bearer t-guest"}
        ).status_code
        == 403
    )
