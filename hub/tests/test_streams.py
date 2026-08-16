"""Live-Bild: der ffmpeg-Aufruf und die beiden HLS-Endpunkte.

Ohne echte Kamera und ohne ffmpeg – die Umwandlung wird durch eine
vorbereitete Wiedergabeliste ersetzt. Geprüft wird das, was in der App
ankommt: Werden die Häppchen-Adressen samt Token umgeschrieben, und lässt
sich über den Häppchen-Namen etwas anderes als Video abholen?
"""

from pathlib import Path

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.core.streams import ffmpeg_command

from .conftest import make_config

PLAYLIST = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:1
#EXTINF:1.000000,
seg00001.ts
#EXTINF:1.000000,
seg00002.ts
"""


def test_ffmpeg_command_copies_instead_of_recoding(tmp_path):
    command = ffmpeg_command("rtsps://10.0.0.1:7441/abc?enableSrtp", tmp_path)
    assert command[0] == "ffmpeg"
    # Neucodieren würde einen Mini-PC bei mehreren Kameras überfordern.
    assert "-c" in command and command[command.index("-c") + 1] == "copy"
    assert "-rtsp_transport" in command
    assert command[-1] == str(tmp_path / "index.m3u8")


class _FakeStreams:
    """Tut so, als liefe ffmpeg bereits – liefert eine fertige Liste."""

    def __init__(self, directory: Path) -> None:
        self.directory_path = directory
        self.touched = 0
        (directory / "index.m3u8").write_text(PLAYLIST)
        (directory / "seg00001.ts").write_bytes(b"videodaten")

    async def playlist(self, entity_id: str, source: str) -> Path:
        return self.directory_path / "index.m3u8"

    def directory(self, entity_id: str):
        return self.directory_path

    def touch(self, entity_id: str) -> None:
        self.touched += 1

    async def stop_all(self) -> None:
        pass


def make_client(tmp_path: Path, stream_url: str | None = "rtsps://cam/abc"):
    hub = Hub(make_config(token="geheim"))
    hub.streams = _FakeStreams(tmp_path)

    class _Camera:
        async def stream_url(self, entity):
            return stream_url

        async def teardown(self):
            pass

    # Die Demo-Integration bekommt eine Kamera-Fähigkeit untergeschoben.
    def patch(app):
        integration = hub.integrations.get("demo")
        integration.stream_url = _Camera().stream_url
        return app

    return hub, patch


def test_playlist_rewrites_segments_with_token(tmp_path):
    hub, patch = make_client(tmp_path)
    with TestClient(create_app(hub)) as client:
        patch(None)
        response = client.get(
            "/api/entities/demo.light_livingroom/stream.m3u8?token=geheim"
        )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/vnd.apple.mpegurl")
        body = response.text
        # Der Player folgt den Adressen ohne eigene Kopfzeilen – das Token
        # muss deshalb in jeder Zeile stehen.
        assert "stream/seg00001.ts?token=geheim" in body
        assert "stream/seg00002.ts?token=geheim" in body
        # Kommentarzeilen bleiben unangetastet.
        assert body.startswith("#EXTM3U")


def test_playlist_needs_a_camera_with_rtsp(tmp_path):
    hub, patch = make_client(tmp_path, stream_url=None)
    with TestClient(create_app(hub)) as client:
        patch(None)
        response = client.get(
            "/api/entities/demo.light_livingroom/stream.m3u8?token=geheim"
        )
        assert response.status_code == 404
        assert "RTSP" in response.json()["detail"]


def test_segment_needs_token_and_a_harmless_name(tmp_path):
    hub, patch = make_client(tmp_path)
    with TestClient(create_app(hub)) as client:
        patch(None)
        base = "/api/entities/demo.light_livingroom/stream"
        assert client.get(f"{base}/seg00001.ts").status_code == 401
        assert client.get(f"{base}/seg00001.ts?token=geheim").content == b"videodaten"
        # Alles, was nicht nach einem Häppchen aussieht, wird abgewiesen –
        # sonst käme man über den Namen an andere Dateien des Hubs.
        assert client.get(f"{base}/index.m3u8?token=geheim").status_code == 404
        assert client.get(f"{base}/..%2f..%2fconfig.yaml?token=geheim").status_code == 404
        assert hub.streams.touched > 0
