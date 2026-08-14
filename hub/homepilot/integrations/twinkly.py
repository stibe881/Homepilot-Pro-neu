"""Twinkly-Lichterketten über die lokale REST-API (xled).

Konfiguration:
  - integration: twinkly
    host: 192.168.1.30
    name: Weihnachtsbaum
    default_mode: movie      # Modus beim Einschalten
    scan_interval: 30

Die Anmeldung läuft über ein Challenge-Response-Verfahren: der Hub schickt
32 zufällige Bytes, das Gerät antwortet mit einem Token, das nach vier
Stunden abläuft und rechtzeitig erneuert wird.
"""

from __future__ import annotations

import asyncio
import base64
import os
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

# Modi laut xled-Dokumentation: off, color, demo, effect, movie, playlist, rt
OFF_MODE = "off"


def state_from_mode(mode: str | None) -> str:
    """Jeder Modus ausser 'off' bedeutet: die Kette leuchtet."""
    return "off" if not mode or mode == OFF_MODE else "on"


class TwinklyIntegration(Integration):
    name = "twinkly"

    async def setup(self) -> None:
        host = self.config.get("host")
        if not host:
            raise ConfigError("twinkly braucht 'host' in der Konfiguration")
        self._base = f"http://{host}/xled/v1"
        self._default_mode = self.config.get("default_mode", "movie")
        self._interval = float(self.config.get("scan_interval", 30))
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._session = self.http_session()

        self._object_id = str(host).replace(".", "_")
        await self.add_entity(
            self._object_id,
            EntityKind.LIGHT,
            self.config.get("name", f"Twinkly {host}"),
            state={"state": "off", "brightness": 100},
            commands=["turn_on", "turn_off", "toggle", "set_brightness"],
            available=False,
        )
        await self._refresh()
        self.start_task(self._poll_loop())

    # ── Anmeldung ──────────────────────────────────────────────────────────

    async def _ensure_token(self) -> str:
        loop = asyncio.get_running_loop()
        if self._token and loop.time() < self._token_expires_at:
            return self._token

        challenge = base64.b64encode(os.urandom(32)).decode()
        async with self._session.post(
            f"{self._base}/login", json={"challenge": challenge}
        ) as response:
            response.raise_for_status()
            payload = await response.json()

        token = payload.get("authentication_token")
        if not token:
            raise ConnectionError("Twinkly-Anmeldung ohne Token")

        # Erst nach /verify akzeptiert das Gerät den Token für andere Aufrufe.
        async with self._session.post(
            f"{self._base}/verify",
            json={"challenge-response": payload.get("challenge-response")},
            headers={"X-Auth-Token": token},
        ) as response:
            response.raise_for_status()

        self._token = token
        # Etwas vor Ablauf erneuern, damit kein Aufruf ins Leere läuft.
        lifetime = float(payload.get("authentication_token_expires_in", 14400))
        self._token_expires_at = loop.time() + lifetime * 0.9
        return token

    async def _call(
        self, method: str, path: str, json: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        token = await self._ensure_token()
        async with self._session.request(
            method, f"{self._base}{path}", json=json, headers={"X-Auth-Token": token}
        ) as response:
            if response.status == 401:
                # Token vorzeitig ungültig – einmal neu anmelden.
                self._token = None
                token = await self._ensure_token()
                async with self._session.request(
                    method,
                    f"{self._base}{path}",
                    json=json,
                    headers={"X-Auth-Token": token},
                ) as retry:
                    retry.raise_for_status()
                    return await retry.json()
            response.raise_for_status()
            return await response.json()

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._refresh()

    async def _refresh(self) -> None:
        entity_id = self.entity_id(self._object_id)
        try:
            mode = await self._call("GET", "/led/mode")
            brightness = await self._call("GET", "/led/out/brightness")
        except Exception as err:
            self.log.warning("Twinkly nicht erreichbar: %s", err)
            await self.hub.registry.update_state(entity_id, {}, available=False)
            return

        await self.hub.registry.update_state(
            entity_id,
            {
                "state": state_from_mode(mode.get("mode")),
                "mode": mode.get("mode"),
                "brightness": brightness.get("value", 100),
            },
            available=True,
        )

    # ── Hub → Gerät ────────────────────────────────────────────────────────

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        if command == "toggle":
            command = "turn_off" if entity.state.get("state") == "on" else "turn_on"

        if command == "turn_on":
            await self._call(
                "POST", "/led/mode", {"mode": data.get("mode", self._default_mode)}
            )
            if "brightness" in data:
                await self._set_brightness(int(data["brightness"]))
        elif command == "turn_off":
            await self._call("POST", "/led/mode", {"mode": OFF_MODE})
        elif command == "set_brightness":
            brightness = int(data.get("brightness", 100))
            await self._set_brightness(brightness)
            # Helligkeit allein schaltet nicht ein – Modus mitziehen.
            if brightness > 0 and entity.state.get("state") != "on":
                await self._call("POST", "/led/mode", {"mode": self._default_mode})

        await self._refresh()

    async def _set_brightness(self, value: int) -> None:
        await self._call(
            "POST",
            "/led/out/brightness",
            {"mode": "enabled", "type": "A", "value": max(0, min(100, value))},
        )


INTEGRATION = TwinklyIntegration
