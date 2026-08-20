"""Durchsagen: Text zu Sprache auf die Cast-Boxen.

Ausgelagert aus dem API-Endpunkt, damit auch Abläufe durchsagen können
(«Es hat geklingelt», «Waschmaschine ist fertig»). Der Endpunkt und die
Ablauf-Aktion teilen sich denselben Weg: Text → MP3 (gTTS) → kurzlebige
Adresse im Schnappschuss-Speicher → play_url auf die Boxen.

Die Basis-Adresse merkt sich der Hub von den Anfragen der App: Dieselbe
Adresse, unter der die App den Hub erreicht, erreichen im Normalfall
auch die Lautsprecher. Gespeichert wird sie mit, damit ein Ablauf auch
direkt nach einem Neustart durchsagen kann.
"""

from __future__ import annotations

import asyncio
import io
import logging
from typing import TYPE_CHECKING, Any

from contextlib import nullcontext

from .errors import HomePilotError
from .source import as_source

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

MAX_TEXT = 200


def base_url(hub: "Hub") -> str | None:
    """Die zuletzt gesehene Hub-Adresse - oder None, wenn noch keine App
    vorbeikam."""
    for entry in hub.data.get("hub_base"):
        if isinstance(entry, dict) and entry.get("url"):
            return str(entry["url"]).rstrip("/")
    return None


def remember_base(hub: "Hub", url: str) -> None:
    """Die Adresse aus einer App-Anfrage festhalten (nur bei Änderung -
    sonst schriebe jede Anfrage die Datendatei neu)."""
    cleaned = str(url).rstrip("/")
    if not cleaned or base_url(hub) == cleaned:
        return
    hub.data.set("hub_base", [{"url": cleaned}])


def synthesize(text: str) -> bytes:
    """Text zu MP3 - blockierend, deshalb von aussen in einen Thread."""
    from gtts import gTTS

    buffer = io.BytesIO()
    gTTS(text=text, lang="de").write_to_fp(buffer)
    return buffer.getvalue()


async def speak(
    hub: "Hub",
    text: str,
    speakers: list[str] | None = None,
    volume: int | None = None,
    base: str | None = None,
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Eine Durchsage machen. Wirft HomePilotError mit lesbarem Grund."""
    cleaned = (text or "").strip()
    if not cleaned:
        raise HomePilotError("Ohne Text keine Durchsage.")
    if len(cleaned) > MAX_TEXT:
        raise HomePilotError(
            "Bitte kurz halten - eine Durchsage ist kein Vortrag "
            f"(höchstens {MAX_TEXT} Zeichen)."
        )
    try:
        import gtts  # noqa: F401
    except ImportError as err:
        raise HomePilotError(
            "Sprachausgabe nicht installiert - das Abbild braucht das "
            "Extra 'speech' (gTTS)."
        ) from err

    address = (base or "").rstrip("/") or base_url(hub)
    if not address:
        raise HomePilotError(
            "Die Hub-Adresse ist noch unbekannt - einmal die App öffnen, "
            "dann kennt der Hub sie."
        )

    try:
        audio = await asyncio.to_thread(synthesize, cleaned)
    except Exception as err:
        raise HomePilotError(
            f"Sprachausgabe fehlgeschlagen (braucht Internet): {err}"
        ) from err

    token = hub.snapshots.put(audio)
    url = f"{address}/api/broadcast/{token}.mp3"

    wanted = set(speakers or [])
    targets = [
        entity
        for entity in hub.registry.all()
        if "play_url" in entity.commands
        and entity.available
        and (not wanted or entity.id in wanted)
    ]
    if not targets:
        raise HomePilotError("Kein Lautsprecher erreichbar, der Durchsagen kann.")

    sent: list[str] = []
    errors: list[str] = []
    for entity in targets:
        try:
            # Ohne eigene Quelle die des Aufrufers behalten - ein Ablauf
            # läuft schon unter seinem Namen, den darf speak() nicht
            # mit «Gerät» überschreiben.
            with as_source(source) if source is not None else nullcontext():
                await hub.integrations.dispatch_command(
                    entity.id, "play_url", {"url": url, "volume": volume}
                )
            sent.append(entity.name)
        except Exception as err:
            errors.append(f"{entity.name}: {err}")
    return {"sent": sent, "errors": errors}
