"""Durchsagen: Text zu Sprache auf die Cast-Boxen.

Ausgelagert aus dem API-Endpunkt, damit auch Abläufe durchsagen können
(«Es hat geklingelt», «Waschmaschine ist fertig»). Der Endpunkt und die
Ablauf-Aktion teilen sich denselben Weg: Text → MP3 (gTTS) → kurzlebige
Adresse im Schnappschuss-Speicher → play_url auf die Boxen.

Die Basis-Adresse merkt sich der Hub von den Anfragen der App: Dieselbe
Adresse, unter der die App den Hub erreicht, erreichen im Normalfall
auch die Lautsprecher. Gespeichert wird sie mit, damit ein Ablauf auch
direkt nach einem Neustart durchsagen kann.

gTTS braucht Internet - und «Es hat geklingelt» soll auch durchkommen,
wenn die Leitung gerade tot ist. Deshalb wandert jedes erzeugte MP3 in
einen kleinen Vorrat auf der Platte; ein schon einmal gesprochener Satz
kommt von dort, mit oder ohne Netz. Die immergleichen Ablauf-Durchsagen
liegen so nach dem ersten Mal dauerhaft bereit.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
from contextlib import nullcontext
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .errors import HomePilotError
from .source import as_source

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

MAX_TEXT = 200

# So viele gesprochene Sätze bleiben im Vorrat. Ein MP3 sind ~20-50 KB;
# die Standardsätze eines Haushalts sind eine Handvoll.
CACHE_LIMIT = 40


def cache_dir(hub: Hub) -> Path | None:
    """Wo der Vorrat liegt: neben der Datendatei. Ohne sie (Tests, Demo
    im Speicher) auch kein Vorrat."""
    if not hub.config.data_file:
        return None
    return Path(hub.config.data_file).parent / "say-cache"


def cache_file(folder: Path, text: str) -> Path:
    """Die Datei zu einem Satz (rein, testbar). Der Name ist ein Hash -
    Umlaute, Länge und Schrägstriche im Text gehen ihn nichts an."""
    key = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    return folder / f"{key}.mp3"


def cached_audio(folder: Path, text: str) -> bytes | None:
    """Den Satz aus dem Vorrat holen, wenn er da ist."""
    try:
        return cache_file(folder, text).read_bytes()
    except OSError:
        return None


def store_audio(folder: Path, text: str, audio: bytes) -> None:
    """Den Satz in den Vorrat legen - still bei jedem Fehler: Der Vorrat
    ist eine Zugabe, keine Voraussetzung fürs Durchsagen."""
    try:
        folder.mkdir(parents=True, exist_ok=True)
        cache_file(folder, text).write_bytes(audio)
        # Die ältesten hinauswerfen, wenn es zu viele werden.
        files = sorted(folder.glob("*.mp3"), key=lambda f: f.stat().st_mtime)
        for stale in files[: max(0, len(files) - CACHE_LIMIT)]:
            stale.unlink(missing_ok=True)
    except OSError as err:
        log.debug("Durchsage-Vorrat nicht schreibbar: %s", err)


def base_url(hub: Hub) -> str | None:
    """Die zuletzt gesehene Hub-Adresse - oder None, wenn noch keine App
    vorbeikam."""
    for entry in hub.data.get("hub_base"):
        if isinstance(entry, dict) and entry.get("url"):
            return str(entry["url"]).rstrip("/")
    return None


def remember_base(hub: Hub, url: str) -> None:
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
    hub: Hub,
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
    address = (base or "").rstrip("/") or base_url(hub)
    if not address:
        raise HomePilotError(
            "Die Hub-Adresse ist noch unbekannt - einmal die App öffnen, "
            "dann kennt der Hub sie."
        )

    # Erst der Vorrat, dann das Netz: Ein schon einmal gesprochener Satz
    # kommt sofort und auch ohne Internet.
    folder = cache_dir(hub)
    audio = cached_audio(folder, cleaned) if folder else None
    if audio is None:
        # Erst hier nach gTTS fragen: Ein Satz aus dem Vorrat braucht
        # weder die Bibliothek noch Internet.
        try:
            import gtts  # noqa: F401
        except ImportError as err:
            raise HomePilotError(
                "Sprachausgabe nicht installiert - das Abbild braucht das "
                "Extra 'speech' (gTTS)."
            ) from err
        try:
            audio = await asyncio.to_thread(synthesize, cleaned)
        except Exception as err:
            raise HomePilotError(
                f"Sprachausgabe fehlgeschlagen (braucht Internet, und dieser "
                f"Satz liegt noch nicht im Vorrat): {err}"
            ) from err
        if folder:
            store_audio(folder, cleaned, audio)

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

    # Was auf den Boxen lief, bevor die Ansage kommt - danach soll es
    # wieder so sein. Vorher blieb die Box auf der Lautstärke der
    # Durchsage stehen und die Musik aus.
    ton = getattr(hub, "ton", None)
    davor = ton.zustand_merken([entity.id for entity in targets]) if ton else {}

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
            sent.append(entity.label)
        except Exception as err:
            errors.append(f"{entity.label}: {err}")
    if ton is not None and sent:
        # Als eigene Aufgabe: Die Durchsage ist unterwegs, und die
        # Antwort an die App soll nicht warten, bis sie durch ist.
        asyncio.create_task(ton.durchsage_zurueck(davor))
    return {"sent": sent, "errors": errors}
