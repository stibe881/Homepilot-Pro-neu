"""UniFi Network Controller – Anwesenheitserkennung über verbundene Clients.

Konfiguration:
  - integration: unifi
    host: 192.168.1.1
    username: "${UNIFI_USER}"
    password: "${UNIFI_PASSWORD}"
    site: default
    scan_interval: 30
    track:
      - mac: "aa:bb:cc:dd:ee:ff"
        name: iPhone Stefan
      - mac: "11:22:33:44:55:66"
        name: iPad

Legt je verfolgtem Gerät einen binary_sensor an, dazu `unifi.anyone_home`
(an, sobald irgendjemand da ist) und `unifi.clients_total`.

Es gibt zwei Controller-Generationen: UniFi OS (UDM, UCG, Cloud Key Gen2)
meldet sich unter /api/auth/login an und stellt der Netzwerk-API
/proxy/network voran; ältere Standalone-Controller nutzen /api/login ohne
Präfix. Beides wird beim Verbinden automatisch erkannt.
"""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from ..core.entity import EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


def normalise_mac(mac: str) -> str:
    return mac.strip().lower().replace("-", ":")


def format_voucher(code: str) -> str:
    """«0123456789» → «01234-56789», wie auf der Portal-Seite (rein)."""
    cleaned = str(code or "").strip()
    if len(cleaned) == 10 and cleaned.isdigit():
        return f"{cleaned[:5]}-{cleaned[5:]}"
    return cleaned


def shape_voucher(row: dict[str, Any]) -> dict[str, Any]:
    """Ein Voucher des Controllers in die Form der App (rein, testbar)."""
    return {
        "id": str(row.get("_id") or ""),
        "code": format_voucher(str(row.get("code") or "")),
        "note": str(row.get("note") or ""),
        # Gültigkeitsdauer ab erster Anmeldung, in Minuten.
        "minutes": int(row.get("duration") or 0),
        "created": row.get("create_time"),
        "used": int(row.get("used") or 0) > 0,
    }


def presence_from_clients(
    clients: list[dict[str, Any]], macs: list[str]
) -> dict[str, bool]:
    """Welche der verfolgten MAC-Adressen sind gerade verbunden?"""
    online = {normalise_mac(str(client.get("mac", ""))) for client in clients}
    return {mac: mac in online for mac in macs}


class UnifiIntegration(Integration):
    name = "unifi"

    async def setup(self) -> None:
        self._host = self.config.get("host")
        self._username = self.config.get("username")
        self._password = self.config.get("password")
        if not (self._host and self._username and self._password):
            raise ConfigError("unifi braucht 'host', 'username' und 'password'")

        self._site = self.config.get("site", "default")
        self._interval = float(self.config.get("scan_interval", 30))
        # Ein Telefon fällt gern kurz aus dem WLAN. Ohne Karenzzeit meldet
        # der Hub dann „niemand zuhause“ und schaltet das Licht aus, während
        # man auf dem Sofa sitzt – die eine Erfahrung, nach der man dem
        # System nicht mehr traut.
        self._away_grace = float(self.config.get("away_grace", 300))
        self._last_seen: dict[str, float] = {}
        self._base = f"https://{self._host}"
        self._prefix = ""  # wird beim Login gesetzt
        self._csrf: str | None = None

        # Der Controller nutzt ein selbstsigniertes Zertifikat.
        self._session = self.http_session(
            connector=aiohttp.TCPConnector(ssl=False),
            timeout=aiohttp.ClientTimeout(total=20),
        )

        self._tracked: dict[str, str] = {}  # MAC → entity_id
        for device in self.config.get("track") or []:
            mac = device.get("mac")
            if not mac:
                raise ConfigError("unifi: jeder Eintrag unter 'track' braucht eine 'mac'")
            mac = normalise_mac(str(mac))
            entity = await self.add_entity(
                mac.replace(":", ""),
                EntityKind.BINARY_SENSOR,
                device.get("name", mac),
                state={"state": "off", "mac": mac},
                available=False,
            )
            self._tracked[mac] = entity.id

        if self._tracked:
            await self.add_entity(
                "anyone_home",
                EntityKind.BINARY_SENSOR,
                "Jemand zuhause",
                state={"state": "off"},
                available=False,
            )
        await self.add_entity(
            "clients_total",
            EntityKind.SENSOR,
            "Verbundene Clients",
            state={"state": 0},
            available=False,
        )

        await self._login()
        self.start_task(self._poll_loop())

    # ── Verbindung ─────────────────────────────────────────────────────────

    async def _login(self) -> None:
        """Meldet sich an und erkennt dabei die Controller-Generation."""
        credentials = {"username": self._username, "password": self._password}
        for path, prefix in (("/api/auth/login", "/proxy/network"), ("/api/login", "")):
            try:
                async with self._session.post(
                    f"{self._base}{path}", json=credentials
                ) as response:
                    if response.status >= 400:
                        continue
                    self._prefix = prefix
                    self._csrf = response.headers.get("X-CSRF-Token") or self._csrf
                    self.log.info(
                        "Am UniFi-Controller angemeldet (%s)",
                        "UniFi OS" if prefix else "Standalone",
                    )
                    return
            except aiohttp.ClientError as err:
                raise ConnectionError(f"UniFi-Controller nicht erreichbar: {err}") from err
        raise ConnectionError("UniFi-Anmeldung fehlgeschlagen – Zugangsdaten prüfen")

    async def _fetch_clients(self) -> list[dict[str, Any]]:
        url = f"{self._base}{self._prefix}/api/s/{self._site}/stat/sta"
        headers = {"X-CSRF-Token": self._csrf} if self._csrf else {}

        async with self._session.get(url, headers=headers) as response:
            if response.status == 401:
                # Sitzung abgelaufen – einmal neu anmelden und erneut versuchen.
                await self._login()
                async with self._session.get(url, headers=headers) as retry:
                    retry.raise_for_status()
                    payload = await retry.json()
            else:
                response.raise_for_status()
                payload = await response.json()
        return payload.get("data", [])

    async def _api(
        self,
        method: str,
        path: str,
        json: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        """Ein Aufruf der Netzwerk-API, mit Neu-Anmeldung bei 401."""
        url = f"{self._base}{self._prefix}{path}"
        headers = {"X-CSRF-Token": self._csrf} if self._csrf else {}
        async with self._session.request(
            method, url, json=json, params=params, headers=headers
        ) as response:
            if response.status == 401:
                await self._login()
                headers = {"X-CSRF-Token": self._csrf} if self._csrf else {}
                async with self._session.request(
                    method, url, json=json, params=params, headers=headers
                ) as retry:
                    retry.raise_for_status()
                    payload = await retry.json(content_type=None)
            else:
                response.raise_for_status()
                payload = await response.json(content_type=None)
        return payload.get("data", []) if isinstance(payload, dict) else []

    # ── Hotspot-Voucher ────────────────────────────────────────────────────
    # Für das Captive Portal: Der Hub stellt Gutscheine aus, statt dass
    # jemand dafür in den Controller muss. Einmal-Codes (quota 1), damit
    # ein weitergereichter Zettel nicht zur Dauerkarte wird.

    async def list_vouchers(self) -> list[dict[str, Any]]:
        rows = await self._api("GET", f"/api/s/{self._site}/stat/voucher")
        vouchers = [shape_voucher(row) for row in rows]
        return sorted(vouchers, key=lambda entry: entry.get("created") or 0, reverse=True)

    async def create_voucher(self, minutes: int, note: str = "") -> dict[str, Any]:
        result = await self._api(
            "POST",
            f"/api/s/{self._site}/cmd/hotspot",
            json={
                "cmd": "create-voucher",
                "expire": max(30, int(minutes)),
                "n": 1,
                "quota": 1,
                "note": note[:80] or "HomePilot",
            },
        )
        created = result[0].get("create_time") if result else None
        # Der Controller gibt beim Anlegen nur den Zeitstempel zurück -
        # den Code holt erst die Voucher-Liste.
        rows = await self._api(
            "GET",
            f"/api/s/{self._site}/stat/voucher",
            params={"create_time": str(created)} if created else None,
        )
        if not rows:
            raise ConnectionError("Voucher angelegt, aber nicht auffindbar")
        return shape_voucher(rows[0])

    async def delete_voucher(self, voucher_id: str) -> None:
        await self._api(
            "POST",
            f"/api/s/{self._site}/cmd/hotspot",
            json={"cmd": "delete-voucher", "_id": voucher_id},
        )

    # ── Abfrage ────────────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        while True:
            await self._refresh()
            await asyncio.sleep(self._interval)

    async def _refresh(self) -> None:
        try:
            clients = await self._fetch_clients()
        except Exception as err:
            self.log.warning("UniFi-Abfrage fehlgeschlagen: %s", err)
            for entity_id in self._tracked.values():
                await self.hub.registry.update_state(entity_id, {}, available=False)
            await self.hub.registry.update_state(
                self.entity_id("clients_total"), {}, available=False
            )
            return

        seen = presence_from_clients(clients, list(self._tracked))
        now = asyncio.get_running_loop().time()
        presence: dict[str, bool] = {}
        for mac, is_seen in seen.items():
            if is_seen:
                self._last_seen[mac] = now
                presence[mac] = True
            else:
                last = self._last_seen.get(mac)
                presence[mac] = last is not None and (now - last) < self._away_grace

            await self.hub.registry.update_state(
                self._tracked[mac],
                {
                    "state": "on" if presence[mac] else "off",
                    # Sichtbar machen, dass jemand nur noch in der Karenzzeit
                    # als anwesend gilt.
                    "connected": is_seen,
                },
                available=True,
            )

        if self._tracked:
            await self.hub.registry.update_state(
                self.entity_id("anyone_home"),
                {"state": "on" if any(presence.values()) else "off"},
                available=True,
            )
        await self.hub.registry.update_state(
            self.entity_id("clients_total"), {"state": len(clients)}, available=True
        )


INTEGRATION = UnifiIntegration
