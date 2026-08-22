"""Off-Site-Sicherung: die tägliche Sicherung zusätzlich zu Supabase.

Die Sicherungen im Ordner «backups» liegen auf derselben Platte wie das
Original - gegen einen Plattenschaden helfen sie nicht. Supabase ist
ohnehin eingerichtet; sein Storage nimmt die Tagessicherung mit auf, und
damit überlebt der Haushalt (Benutzer, Abläufe, Szenen, Zähler) auch den
Totalausfall des Hosts.

Der Bucket (Standard «backups», privat) muss einmal im Supabase-Dashboard
angelegt werden - Buckets selbst anzulegen wäre mehr Rechte, als der Hub
für eine Sicherung braucht.
"""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

log = logging.getLogger(__name__)

KEEP = 14

# Die Matter-Fabrik im Bucket – höchstens so viele Stände. Sie ändert
# sich nur beim Koppeln, ein Stand je Änderung genügt.
MATTER_KEEP = 3


def matter_tar(matter_dir: str) -> bytes | None:
    """Den Matter-Ordner als Tar-Archiv (rein bis aufs Lesen).

    ``hub/matter/`` trägt Schlüssel und Zertifikate aller gekoppelten
    Geräte. Geht der Ordner verloren, muss jedes Gerät neu gekoppelt
    werden - und genau dieser Ordner fehlte in der Off-Site-Sicherung.
    Er geht in denselben privaten Bucket wie die homepilot-data.json,
    die ohnehin schon Benutzer-Tokens enthält; die Abwägung ist dieselbe.
    """
    import io
    import tarfile
    from pathlib import Path as _Path

    ordner = _Path(matter_dir)
    if not ordner.is_dir():
        return None
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archiv:
        for datei in sorted(ordner.rglob("*")):
            if datei.is_file():
                archiv.add(datei, arcname=str(datei.relative_to(ordner)))
    daten = buffer.getvalue()
    # Ein leerer Ordner ist keine Fabrik.
    return daten if any(ordner.iterdir()) else None


def _headers(service_key: str) -> dict[str, str]:
    return {"apikey": service_key, "Authorization": f"Bearer {service_key}"}


async def upload(
    url: str, service_key: str, bucket: str, name: str, payload: bytes
) -> None:
    """Eine Sicherung hochladen (x-upsert: derselbe Name überschreibt)."""
    target = f"{url.rstrip('/')}/storage/v1/object/{bucket}/{name}"
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as session, session.post(
        target,
        data=payload,
        headers={
            **_headers(service_key),
            "Content-Type": "application/json",
            "x-upsert": "true",
        },
    ) as response:
        if response.status >= 400:
            body = (await response.text())[:300]
            raise RuntimeError(f"Upload → {response.status}: {body}")


async def prune(url: str, service_key: str, bucket: str, keep: int = KEEP) -> None:
    """Alte Sicherungen im Bucket aufräumen - dieselbe Regel wie lokal."""
    await prune_prefix(url, service_key, bucket, "homepilot-data-", keep)


async def prune_prefix(
    url: str, service_key: str, bucket: str, prefix: str, keep: int
) -> None:
    """Alles mit diesem Präfix bis auf die jüngsten ``keep`` löschen."""
    base = url.rstrip("/") + "/storage/v1"
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(
        timeout=timeout, headers={**_headers(service_key), "Content-Type": "application/json"}
    ) as session:
        async with session.post(
            f"{base}/object/list/{bucket}",
            json={"prefix": "", "limit": 200, "sortBy": {"column": "name", "order": "desc"}},
        ) as response:
            if response.status >= 400:
                return
            entries: list[dict[str, Any]] = await response.json(content_type=None)
        names = [
            str(entry.get("name") or "")
            for entry in entries
            if str(entry.get("name") or "").startswith(prefix)
        ]
        # Namen tragen den Zeitstempel - absteigend sortiert heisst: die
        # jüngsten zuerst, alles ab «keep» darf weg.
        for name in sorted(names, reverse=True)[keep:]:
            async with session.delete(f"{base}/object/{bucket}/{name}") as response:
                if response.status >= 400:
                    log.debug("Off-Site-Aufräumen: %s blieb liegen", name)
