"""Schlanker asynchroner Supabase-Client (PostgREST über aiohttp).

Bewusst kein `supabase-py`: wir brauchen nur select/insert/upsert, und
aiohttp ist im Hub ohnehin schon vorhanden.
"""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

log = logging.getLogger(__name__)


class SupabaseError(Exception):
    pass


class SupabaseClient:
    def __init__(self, url: str, service_key: str, timeout: float = 20.0) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self._session = aiohttp.ClientSession(
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            },
            timeout=aiohttp.ClientTimeout(total=timeout),
        )

    async def close(self) -> None:
        await self._session.close()

    async def _request(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        async with self._session.request(
            method, f"{self.base}/{table}", params=params, json=json, headers=headers
        ) as response:
            body = await response.text()
            if response.status >= 400:
                raise SupabaseError(f"{method} {table} → {response.status}: {body[:300]}")
            if not body.strip():
                return []
            return await response.json(content_type=None)

    async def select(
        self, table: str, params: dict[str, str] | None = None
    ) -> list[dict[str, Any]]:
        return await self._request("GET", table, params=params)

    async def insert(self, table: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        await self._request(
            "POST", table, json=rows, headers={"Prefer": "return=minimal"}
        )

    async def upsert(
        self, table: str, rows: list[dict[str, Any]], on_conflict: str = "id"
    ) -> None:
        if not rows:
            return
        await self._request(
            "POST",
            table,
            params={"on_conflict": on_conflict},
            json=rows,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
