"""Live-Video: RTSP der Kamera → HLS für die App.

Kameras liefern RTSP(S) – das spielt keine App direkt ab. Umgepackt wird es
auf zwei Wegen, je nachdem, was auf dem Rechner läuft:

**mediamtx** (bevorzugt) beherrscht Low-Latency-HLS: Statt ganzer Häppchen
liefert es Bruchstücke von 200 Millisekunden, und der Player fragt blockierend
nach dem nächsten, statt in Intervallen zu pollen. Das drückt den Rückstand
von rund zwei Sekunden auf unter eine. Apple hat das Verfahren in iOS
eingebaut, hls.js im Browser kann es ebenfalls – die App braucht also nichts
Neues. mediamtx zieht den Kamerastrom erst, wenn jemand zuschaut.

**ffmpeg** ist der Rückfall, wenn mediamtx nicht läuft. Gleiches Ergebnis,
nur mit gewöhnlichem HLS und entsprechend mehr Rückstand.

In beiden Fällen geht die Wiedergabeliste durch den Hub: Er kennt die
Sichtbarkeitsregeln, und so bleibt es beim gewohnten Token statt eines
zweiten, ungeschützten Zugangs zum Videostrom.
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

import aiohttp

log = logging.getLogger(__name__)

# ── ffmpeg-Rückfall ──────────────────────────────────────────────────────

SEGMENT_SECONDS = 1
LIST_SIZE = 6
# Ohne Abruf wird nach dieser Zeit abgeschaltet. Der Player holt sich
# laufend Häppchen; 30 Sekunden überstehen auch eine kurze Störung.
IDLE_SECONDS = 30
# So lange darf ffmpeg brauchen, bis die erste Wiedergabeliste dasteht.
START_TIMEOUT = 15

# ── mediamtx ─────────────────────────────────────────────────────────────

MEDIAMTX_API = "http://127.0.0.1:9997"
MEDIAMTX_HLS = "http://127.0.0.1:8888"
# Wie lange mediamtx die Kamera nach dem letzten Zuschauer noch hält.
ON_DEMAND_CLOSE = "20s"
# Blockierende Anfragen nach dem nächsten Bruchstück dürfen dauern – genau
# davon lebt Low-Latency-HLS.
PROXY_TIMEOUT = 20

# Dateinamen, die die beiden Wege vergeben: seg00001.ts (ffmpeg),
# init.mp4 / segment3.mp4 / part7.mp4 / stream.m3u8 (mediamtx).
SEGMENT_NAME = re.compile(r"[A-Za-z0-9_-]+\.(ts|mp4|m4s|m3u8)")
# URI="…" in Kopfzeilen wie EXT-X-MAP, EXT-X-PART und EXT-X-PRELOAD-HINT.
URI_ATTRIBUTE = re.compile(r'URI="([^"]+)"')


class StreamError(RuntimeError):
    """Der Strom liess sich nicht starten – mit erklärendem Text."""


@dataclass
class Target:
    """Woher die Wiedergabeliste kommt: aus einer Datei oder von mediamtx."""

    path: Path | None = None
    url: str | None = None


def ffmpeg_command(source: str, directory: Path) -> list[str]:
    """Der Aufruf, der aus RTSP eine HLS-Wiedergabeliste macht (rein, testbar).

    ``-c copy`` heisst: Bild und Ton werden nur umgepackt, nicht neu
    berechnet. Das hält einen Mini-PC auch bei mehreren Kameras kühl.
    """
    return [
        "ffmpeg",
        "-nostdin",
        "-loglevel", "error",
        # TCP statt UDP: über WLAN gehen sonst Pakete verloren und das Bild
        # zerfällt in Blöcke.
        "-rtsp_transport", "tcp",
        "-i", source,
        "-c", "copy",
        "-f", "hls",
        "-hls_time", str(SEGMENT_SECONDS),
        "-hls_list_size", str(LIST_SIZE),
        # delete_segments: alte Häppchen wegräumen, sonst läuft die Platte
        # voll. omit_endlist: der Player weiss, dass es weitergeht.
        "-hls_flags", "delete_segments+omit_endlist+independent_segments",
        "-hls_segment_type", "mpegts",
        "-hls_segment_filename", str(directory / "seg%05d.ts"),
        str(directory / "index.m3u8"),
    ]


def is_available() -> bool:
    """Ist ffmpeg installiert?"""
    return shutil.which("ffmpeg") is not None


def path_name(entity_id: str) -> str:
    """Entitäts-ID → Pfadname in mediamtx (rein, testbar).

    mediamtx erlaubt in Pfadnamen keine Punkte, die Entitäts-IDs haben aber
    welche (``unifi_protect.eingang``).
    """
    return re.sub(r"[^A-Za-z0-9_-]", "_", entity_id)


def rewrite_playlist(text: str, prefix: str, token: str | None) -> str:
    """Schreibt alle Adressen einer Wiedergabeliste auf den Hub um.

    Ein Videoplayer schickt beim Abarbeiten der Liste keine eigenen
    Kopfzeilen mit – das Token muss deshalb in jeder Adresse stehen. Bei
    Low-Latency-HLS stecken Adressen nicht nur in eigenen Zeilen, sondern
    auch in Kopfzeilen als ``URI="…"`` (Bruchstücke und Vorab-Hinweise).
    """

    def rewrite(uri: str) -> str:
        if "://" in uri or uri.startswith("/"):
            return uri  # fremde Adresse: unangetastet lassen
        name, _, query = uri.partition("?")
        parts = [part for part in (query, f"token={token}" if token else "") if part]
        suffix = "?" + "&".join(parts) if parts else ""
        return f"{prefix}{name}{suffix}"

    lines = []
    for line in text.splitlines():
        if line.startswith("#"):
            lines.append(
                URI_ATTRIBUTE.sub(lambda m: f'URI="{rewrite(m.group(1))}"', line)
            )
        elif line.strip():
            lines.append(rewrite(line))
        else:
            lines.append(line)
    return "\n".join(lines) + "\n"


class _Stream:
    def __init__(self, source: str, directory: Path) -> None:
        self.source = source
        self.directory = directory
        self.process: asyncio.subprocess.Process | None = None
        self.last_access = 0.0

    @property
    def playlist(self) -> Path:
        return self.directory / "index.m3u8"


class StreamManager:
    """Sorgt dafür, dass zu jeder angeschauten Kamera ein Strom läuft."""

    def __init__(
        self,
        api_url: str = MEDIAMTX_API,
        hls_url: str = MEDIAMTX_HLS,
        idle_seconds: float = IDLE_SECONDS,
    ) -> None:
        self._api = api_url.rstrip("/")
        self._hls = hls_url.rstrip("/")
        self._streams: dict[str, _Stream] = {}
        self._idle = idle_seconds
        self._lock = asyncio.Lock()
        self._reaper: asyncio.Task | None = None
        self._session: aiohttp.ClientSession | None = None
        # None = noch nicht nachgesehen, ob mediamtx läuft. Ein «läuft
        # nicht» wird regelmässig neu geprüft – der Container kann auch
        # nach dem Hub starten oder sich später erholen.
        self._mediamtx: bool | None = None
        self._mediamtx_checked = 0.0
        # Bereits in mediamtx eingerichtete Pfade: Name → Quelle
        self._paths: dict[str, str] = {}

    # ── Gemeinsamer Einstieg ──────────────────────────────────────────────

    async def playlist(self, entity_id: str, source: str) -> Target:
        """Wiedergabeliste einer Kamera – startet den Strom bei Bedarf."""
        if await self._use_mediamtx():
            name = await self._ensure_path(entity_id, source)
            return Target(url=f"{self._hls}/{name}/index.m3u8")
        return Target(path=await self._ffmpeg_playlist(entity_id, source))

    async def locate(self, entity_id: str, name: str) -> Target:
        """Adresse eines einzelnen Häppchens oder einer Unterliste."""
        if await self._use_mediamtx():
            return Target(url=f"{self._hls}/{path_name(entity_id)}/{name}")
        directory = self.directory(entity_id)
        if directory is None:
            raise StreamError("Kein laufendes Live-Bild")
        self.touch(entity_id)
        return Target(path=directory / name)

    async def fetch(self, target: Target, query: str = "") -> tuple[bytes, str]:
        """Holt Inhalt und Medientyp von mediamtx."""
        session = await self._http()
        url = f"{target.url}?{query}" if query else target.url
        try:
            async with session.get(
                str(url), timeout=aiohttp.ClientTimeout(total=PROXY_TIMEOUT)
            ) as response:
                if response.status >= 400:
                    raise StreamError(
                        f"mediamtx antwortet mit {response.status} – "
                        "liefert die Kamera gerade kein Bild?"
                    )
                return await response.read(), response.headers.get(
                    "content-type", "application/octet-stream"
                )
        except asyncio.TimeoutError as err:
            raise StreamError("mediamtx antwortet nicht") from err
        except aiohttp.ClientError as err:
            raise StreamError(f"mediamtx nicht erreichbar: {err}") from err

    # ── mediamtx ──────────────────────────────────────────────────────────

    async def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def _use_mediamtx(self) -> bool:
        """Läuft mediamtx? Ja bleibt gemerkt, Nein wird nach 60s neu geprüft."""
        now = asyncio.get_running_loop().time()
        if self._mediamtx or (
            self._mediamtx is False and now - self._mediamtx_checked < 60
        ):
            return bool(self._mediamtx)
        was = self._mediamtx
        self._mediamtx_checked = now
        session = await self._http()
        try:
            async with session.get(
                f"{self._api}/v3/config/global/get",
                timeout=aiohttp.ClientTimeout(total=3),
            ) as response:
                self._mediamtx = response.status < 400
        except Exception:
            self._mediamtx = False
        if self._mediamtx != was:
            log.info(
                "Live-Bild über %s",
                "mediamtx (Low-Latency-HLS)" if self._mediamtx else "ffmpeg (HLS)",
            )
        return self._mediamtx

    async def _ensure_path(self, entity_id: str, source: str) -> str:
        """Legt den Pfad in mediamtx an – oder zieht ihn nach, wenn sich die
        Kamera-Adresse geändert hat."""
        name = path_name(entity_id)
        if self._paths.get(name) == source:
            return name
        session = await self._http()
        body = {
            "source": source,
            # Erst verbinden, wenn jemand zuschaut – und kurz danach wieder
            # loslassen. Sonst läuft der Kamerastrom rund um die Uhr.
            "sourceOnDemand": True,
            "sourceOnDemandCloseAfter": ON_DEMAND_CLOSE,
        }
        exists = name in self._paths
        verb = "patch" if exists else "add"
        try:
            async with session.post(
                f"{self._api}/v3/config/paths/{verb}/{name}",
                json=body,
                timeout=aiohttp.ClientTimeout(total=5),
            ) as response:
                if response.status >= 400 and not exists:
                    # Schon vorhanden (z.B. nach einem Neustart des Hubs):
                    # dann nachziehen statt scheitern.
                    async with session.post(
                        f"{self._api}/v3/config/paths/patch/{name}",
                        json=body,
                        timeout=aiohttp.ClientTimeout(total=5),
                    ) as retry:
                        if retry.status >= 400:
                            raise StreamError(
                                f"mediamtx lehnt den Pfad ab ({retry.status})"
                            )
        except aiohttp.ClientError as err:
            raise StreamError(f"mediamtx nicht erreichbar: {err}") from err
        self._paths[name] = source
        return name

    # ── ffmpeg ────────────────────────────────────────────────────────────

    async def _ffmpeg_playlist(self, entity_id: str, source: str) -> Path:
        if not is_available():
            raise StreamError(
                "Weder mediamtx noch ffmpeg vorhanden – ohne eines von beiden "
                "gibt es kein Live-Bild. Hub neu bauen (deploy/rebuild-hub.sh)."
            )
        async with self._lock:
            stream = self._streams.get(entity_id)
            # Wechselt die Adresse (andere Qualität, neue Kamera), muss der
            # alte Prozess weg – sonst liefe er ins Leere weiter.
            if stream is not None and stream.source != source:
                await self._stop(entity_id)
                stream = None
            if (
                stream is None
                or stream.process is None
                or stream.process.returncode is not None
            ):
                stream = await self._start(entity_id, source)
            self.touch(entity_id)
        await self._wait_for_playlist(stream)
        return stream.playlist

    def touch(self, entity_id: str) -> None:
        """Merkt sich, dass gerade jemand zuschaut."""
        stream = self._streams.get(entity_id)
        if stream is not None:
            stream.last_access = asyncio.get_running_loop().time()

    def directory(self, entity_id: str) -> Path | None:
        stream = self._streams.get(entity_id)
        return stream.directory if stream else None

    async def _start(self, entity_id: str, source: str) -> _Stream:
        directory = Path(tempfile.mkdtemp(prefix="homepilot-stream-"))
        stream = _Stream(source, directory)
        try:
            stream.process = await asyncio.create_subprocess_exec(
                *ffmpeg_command(source, directory),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as err:
            shutil.rmtree(directory, ignore_errors=True)
            raise StreamError("ffmpeg liess sich nicht starten") from err
        self._streams[entity_id] = stream
        log.info("Live-Bild für %s gestartet", entity_id)
        if self._reaper is None or self._reaper.done():
            self._reaper = asyncio.create_task(self._reap_loop())
        return stream

    async def _wait_for_playlist(self, stream: _Stream) -> None:
        """Wartet, bis ffmpeg die erste Wiedergabeliste geschrieben hat."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + START_TIMEOUT
        while loop.time() < deadline:
            if stream.playlist.exists() and stream.playlist.stat().st_size > 0:
                return
            if stream.process is not None and stream.process.returncode is not None:
                raise StreamError(await self._describe_failure(stream))
            await asyncio.sleep(0.25)
        raise StreamError("Kamera liefert kein Bild (Zeitüberschreitung)")

    async def _describe_failure(self, stream: _Stream) -> str:
        """Die Meldung von ffmpeg weiterreichen statt sie zu verschlucken."""
        message = ""
        if stream.process is not None and stream.process.stderr is not None:
            try:
                data = await asyncio.wait_for(stream.process.stderr.read(400), timeout=2)
                message = data.decode("utf-8", "replace").strip().replace("\n", " ")
            except (asyncio.TimeoutError, ValueError):
                pass
        return f"Kamerastrom abgebrochen: {message}" if message else "Kamerastrom abgebrochen"

    async def _reap_loop(self) -> None:
        while self._streams:
            await asyncio.sleep(5)
            now = asyncio.get_running_loop().time()
            for entity_id, stream in list(self._streams.items()):
                if now - stream.last_access > self._idle:
                    log.info("Live-Bild für %s beendet (niemand schaut zu)", entity_id)
                    async with self._lock:
                        await self._stop(entity_id)

    async def _stop(self, entity_id: str) -> None:
        stream = self._streams.pop(entity_id, None)
        if stream is None:
            return
        process = stream.process
        if process is not None and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=5)
            except asyncio.TimeoutError:
                process.kill()
        shutil.rmtree(stream.directory, ignore_errors=True)

    async def stop_all(self) -> None:
        if self._reaper is not None:
            self._reaper.cancel()
            self._reaper = None
        for entity_id in list(self._streams):
            await self._stop(entity_id)
        if self._session is not None and not self._session.closed:
            await self._session.close()
        self._session = None
