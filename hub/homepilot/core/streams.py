"""Live-Video: RTSP der Kamera → HLS für die App.

Kameras liefern RTSP(S) – das spielt keine App direkt ab. ffmpeg packt den
Videostrom deshalb ohne Neucodierung (``-c copy``, also praktisch ohne
Rechenlast) in kleine HLS-Häppchen, die der Hub wie eine Webseite ausliefert.
iPhone und iPad spielen HLS von Haus aus.

Gestartet wird erst, wenn jemand hinschaut, und wieder gestoppt, sobald ein
paar Sekunden niemand mehr Häppchen abholt – eine dauerhaft laufende
Umwandlung pro Kamera würde den Hub sonst rund um die Uhr beschäftigen.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

# Ein Häppchen pro Sekunde, sechs davon in der Liste: kurzer Rückstand
# (~3–5 Sekunden), aber genug Puffer für eine wacklige WLAN-Strecke.
SEGMENT_SECONDS = 1
LIST_SIZE = 6
# Ohne Abruf wird nach dieser Zeit abgeschaltet. Der Player holt sich alle
# ein bis zwei Sekunden ein Häppchen; 30 Sekunden überstehen damit auch
# eine kurze Störung, ohne dass die Umwandlung ewig weiterläuft.
IDLE_SECONDS = 30
# So lange darf ffmpeg brauchen, bis die erste Wiedergabeliste dasteht.
START_TIMEOUT = 15


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
    """Ist ffmpeg installiert? Ohne das gibt es kein Live-Bild."""
    return shutil.which("ffmpeg") is not None


class StreamError(RuntimeError):
    """Der Strom liess sich nicht starten – mit erklärendem Text."""


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
    """Hält je Kamera höchstens eine laufende Umwandlung."""

    def __init__(self, idle_seconds: float = IDLE_SECONDS) -> None:
        self._streams: dict[str, _Stream] = {}
        self._idle = idle_seconds
        self._lock = asyncio.Lock()
        self._reaper: asyncio.Task | None = None

    async def playlist(self, entity_id: str, source: str) -> Path:
        """Wiedergabeliste einer Kamera – startet die Umwandlung bei Bedarf."""
        if not is_available():
            raise StreamError(
                "ffmpeg fehlt im Container – ohne das gibt es kein Live-Bild. "
                "Hub neu bauen (deploy/rebuild-hub.sh)."
            )
        async with self._lock:
            stream = self._streams.get(entity_id)
            # Wechselt die Adresse (andere Qualität, neue Kamera), muss der
            # alte Prozess weg – sonst liefe er ins Leere weiter.
            if stream is not None and stream.source != source:
                await self._stop(entity_id)
                stream = None
            if stream is None or stream.process is None or stream.process.returncode is not None:
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
        deadline = asyncio.get_running_loop().time() + START_TIMEOUT
        while asyncio.get_running_loop().time() < deadline:
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
