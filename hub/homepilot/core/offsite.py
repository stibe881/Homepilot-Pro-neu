"""Off-Site-Sicherung: die tägliche Sicherung zusätzlich zu Supabase.

Die Sicherungen im Ordner «backups» liegen auf derselben Platte wie das
Original - gegen einen Plattenschaden helfen sie nicht. Supabase ist
ohnehin eingerichtet; sein Storage nimmt die Tagessicherung mit auf, und
damit überlebt der Haushalt (Benutzer, Abläufe, Szenen, Zähler) auch den
Totalausfall des Hosts.

Den Bucket (Standard «backups», privat) legt der Hub beim ersten
Hochladen selbst an, wenn er fehlt. Hier stand lange «anlegen wäre mehr
Rechte, als der Hub braucht» - nur hält der Hub ohnehin den
Service-Schlüssel, der es kann. Was die Zurückhaltung wirklich bewirkte:
Die Off-Site-Sicherung schlug monatelang still fehl, und auf der
System-Seite stand «Bucket not found», bis jemand nachfragte.
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


def bucket_fehlt(body: str) -> bool:
    """Sagt die Storage-Antwort «diesen Bucket gibt es nicht»? (rein,
    testbar) Supabase meldet das je nach Weg als Code oder als Satz."""
    return "NoSuchBucket" in body or "Bucket not found" in body


async def bucket_anlegen(url: str, service_key: str, bucket: str) -> None:
    """Den privaten Sicherungs-Bucket anlegen.

    Wirft mit einem Satz, der weiterhilft: Wer hier landet, dessen
    Schlüssel darf keine Buckets anlegen - dann bleibt nur das Dashboard.
    """
    target = f"{url.rstrip('/')}/storage/v1/bucket"
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as session, session.post(
        target,
        json={"id": bucket, "name": bucket, "public": False},
        headers={**_headers(service_key), "Content-Type": "application/json"},
    ) as response:
        if response.status >= 400:
            body = (await response.text())[:200]
            raise RuntimeError(
                f"Der Bucket «{bucket}» fehlt und liess sich nicht anlegen "
                f"({response.status}: {body}). Im Supabase-Dashboard unter "
                f"Storage einen privaten Bucket «{bucket}» anlegen."
            )
    log.info("Off-Site-Bucket «%s» angelegt (privat)", bucket)


async def upload(
    url: str, service_key: str, bucket: str, name: str, payload: bytes
) -> None:
    """Eine Sicherung hochladen (x-upsert: derselbe Name überschreibt).

    Fehlt der Bucket, wird er einmal angelegt und der Upload wiederholt -
    der Fall aus dem Betrieb: Das Supabase-Projekt war da, der Bucket
    nie, und jede Nacht stand «Bucket not found» auf der System-Seite.
    """
    target = f"{url.rstrip('/')}/storage/v1/object/{bucket}/{name}"
    timeout = aiohttp.ClientTimeout(total=60)
    for versuch in (1, 2):
        async with aiohttp.ClientSession(timeout=timeout) as session, session.post(
            target,
            data=payload,
            headers={
                **_headers(service_key),
                "Content-Type": "application/json",
                "x-upsert": "true",
            },
        ) as response:
            if response.status < 400:
                return
            body = (await response.text())[:300]
        if versuch == 1 and bucket_fehlt(body):
            await bucket_anlegen(url, service_key, bucket)
            continue
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
