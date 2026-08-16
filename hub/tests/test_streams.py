"""Live-Bild: der ffmpeg-Aufruf, das Umschreiben der Wiedergabelisten und
die beiden HLS-Endpunkte.

Ohne echte Kamera, ohne ffmpeg und ohne mediamtx – der Strom wird durch eine
vorbereitete Wiedergabeliste ersetzt. Geprüft wird das, was in der App
ankommt: Zeigen alle Adressen auf den Hub und tragen sie das Token? Und
lässt sich über den Häppchen-Namen etwas anderes als Video abholen?
"""

from pathlib import Path

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.core.streams import (
    Target,
    ffmpeg_command,
    path_name,
    publish_command,
    rewrite_playlist,
    strip_low_latency,
)

from .conftest import make_config

PLAYLIST = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:1
#EXTINF:1.000000,
seg00001.ts
#EXTINF:1.000000,
seg00002.ts
"""

# So sieht Low-Latency-HLS aus: Bruchstücke und Vorab-Hinweise stecken in
# Kopfzeilen, nicht in eigenen Zeilen.
LOW_LATENCY = """#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXT-X-PART:DURATION=0.2,URI="part7.mp4"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part8.mp4"
#EXTINF:1.000000,
segment3.mp4
"""


def test_ffmpeg_command_copies_instead_of_recoding(tmp_path):
    command = ffmpeg_command("rtsps://10.0.0.1:7441/abc?enableSrtp", tmp_path)
    assert command[0] == "ffmpeg"
    # Neucodieren würde einen Mini-PC bei mehreren Kameras überfordern.
    assert "-c" in command and command[command.index("-c") + 1] == "copy"
    assert "-rtsp_transport" in command
    assert command[-1] == str(tmp_path / "index.m3u8")


def test_publish_command_strips_audio_but_keeps_video():
    """Der Ton fliegt raus (-an): Seine Frame-Längen bringen die Part-Dauer
    des Low-Latency-HLS zum Schwanken, woran iOS-Player scheitern – und die
    App spielt Kamera-Ton ohnehin nicht ab."""
    command = publish_command("rtsp://10.10.1.10:7447/abc", "unifi_protect_x")
    assert "-an" in command.split()
    # Neu codiert mit 1-s-Keyframes: Protect liefert nur alle 4-8 s einen,
    # und HLS-Segmente können nicht kürzer sein als der Keyframe-Abstand -
    # daraus wurden ~25 s Rückstand auf dem iPhone.
    assert "-c:v libx264" in command
    assert "-g 25" in command
    # 720p statt voller Kamera-Auflösung: sonst kommt der Encoder auf
    # kleinen Rechnern nicht nach und der Strom reisst ab.
    assert "scale=-2:720" in command
    assert command.count("-rtsp_transport tcp") == 2  # lesen UND publizieren
    assert command.endswith("rtsp://127.0.0.1:8554/unifi_protect_x")


def test_strip_low_latency_keeps_segments_and_map():
    """Apple bekommt gewöhnliches HLS: Parts weg, Segmente und Init bleiben."""
    text = strip_low_latency(
        '#EXTM3U\n'
        '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES\n'
        '#EXT-X-PART-INF:PART-TARGET=0.2\n'
        '#EXT-X-MAP:URI="init.mp4"\n'
        '#EXT-X-PART:DURATION=0.24,URI="part7.mp4"\n'
        '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part8.mp4"\n'
        '#EXTINF:1.000000,\n'
        'segment3.mp4\n'
    )
    assert "PART" not in text
    assert "SERVER-CONTROL" not in text
    assert '#EXT-X-MAP:URI="init.mp4"' in text
    assert "segment3.mp4" in text
    # Nahe der Gegenwart einsteigen statt drei Segmente dahinter.
    assert text.splitlines()[1] == "#EXT-X-START:TIME-OFFSET=-3"


def test_apple_gets_playlist_without_low_latency_parts(tmp_path):
    hub, patch = make_client(tmp_path)
    (tmp_path / "index.m3u8").write_text(
        '#EXTM3U\n#EXT-X-PART:DURATION=0.24,URI="part7.mp4"\nseg00001.ts\n'
    )
    with TestClient(create_app(hub)) as client:
        patch()
        url = "/api/entities/demo.light_livingroom/stream.m3u8?token=geheim"
        fast = client.get(url, headers={"User-Agent": "hls.js"}).text
        assert "EXT-X-PART" in fast
        slow = client.get(
            url, headers={"User-Agent": "AppleCoreMedia/1.0.0 (iPhone)"}
        ).text
        assert "EXT-X-PART" not in slow
        assert "seg00001.ts" in slow


def test_path_name_survives_mediamtx():
    # Punkte sind in mediamtx-Pfaden nicht erlaubt, in Entitäts-IDs schon.
    assert path_name("unifi_protect.eingang") == "unifi_protect_eingang"
    assert path_name("a/../b") == "a____b"


def test_rewrite_playlist_covers_lines_and_uri_attributes():
    text = rewrite_playlist(LOW_LATENCY, "stream/", "geheim")
    assert 'URI="stream/init.mp4?token=geheim"' in text
    assert 'URI="stream/part7.mp4?token=geheim"' in text
    assert 'URI="stream/part8.mp4?token=geheim"' in text
    assert "stream/segment3.mp4?token=geheim" in text
    # Kopfzeilen ohne Adresse bleiben unangetastet.
    assert "#EXTINF:1.000000," in text


def test_rewrite_playlist_keeps_existing_query_and_foreign_urls():
    text = rewrite_playlist(
        '#EXT-X-PART:URI="part1.mp4?msn=3"\nhttp://anderswo/seg.ts\n', "", "geheim"
    )
    assert 'URI="part1.mp4?msn=3&token=geheim"' in text
    assert "http://anderswo/seg.ts" in text


def test_rewrite_playlist_encodes_the_token_and_deduplicates():
    """Echte Tokens enthalten '+', '/' und '=' – roh angehängt wird das '+'
    beim nächsten Abruf als Leerzeichen gelesen und der Hub antwortet 401
    (beim iPhone: NSURLError -1013). Und mediamtx reicht die Query durch,
    das alte Token muss also raus statt sich zu stapeln."""
    text = rewrite_playlist(
        "seg1.ts?token=alt%2Bkodiert\n", "stream/", "bMfjF/oE+kh45D=="
    )
    assert text.strip() == "stream/seg1.ts?token=bMfjF%2FoE%2Bkh45D%3D%3D"


class _FakeStreams:
    """Tut so, als liefe bereits ein Strom – liefert eine fertige Liste."""

    def __init__(self, directory: Path) -> None:
        self.directory_path = directory
        self.touched = 0
        (directory / "index.m3u8").write_text(PLAYLIST)
        (directory / "seg00001.ts").write_bytes(b"videodaten")

    async def playlist(self, entity_id: str, source: str) -> Target:
        return Target(path=self.directory_path / "index.m3u8")

    async def locate(self, entity_id: str, name: str) -> Target:
        self.touched += 1
        return Target(path=self.directory_path / name)

    def directory(self, entity_id: str):
        return self.directory_path

    def touch(self, entity_id: str) -> None:
        self.touched += 1

    async def stop_all(self) -> None:
        pass


def make_client(tmp_path: Path, stream_url: str | None = "rtsps://cam/abc"):
    hub = Hub(make_config(token="geheim"))
    hub.streams = _FakeStreams(tmp_path)

    async def fake_stream_url(entity):
        return stream_url

    def patch():
        hub.integrations.get("demo").stream_url = fake_stream_url

    return hub, patch


def test_playlist_rewrites_segments_with_token(tmp_path):
    hub, patch = make_client(tmp_path)
    with TestClient(create_app(hub)) as client:
        patch()
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
        assert body.startswith("#EXTM3U")


def test_playlist_allows_the_browser_to_fetch_it(tmp_path):
    """hls.js holt die Liste per XHR – ohne CORS-Kopfzeile blockt der Browser.

    Ein <img>-Standbild bräuchte das nicht; das Live-Bild im Web schon.
    """
    hub, patch = make_client(tmp_path)
    with TestClient(create_app(hub)) as client:
        patch()
        response = client.get(
            "/api/entities/demo.light_livingroom/stream.m3u8?token=geheim",
            headers={"Origin": "http://localhost:8081"},
        )
        assert response.headers["access-control-allow-origin"] == "*"


def test_playlist_needs_a_camera_with_rtsp(tmp_path):
    hub, patch = make_client(tmp_path, stream_url=None)
    with TestClient(create_app(hub)) as client:
        patch()
        response = client.get(
            "/api/entities/demo.light_livingroom/stream.m3u8?token=geheim"
        )
        assert response.status_code == 404
        assert "RTSP" in response.json()["detail"]


def test_segment_needs_token_and_a_harmless_name(tmp_path):
    hub, patch = make_client(tmp_path)
    with TestClient(create_app(hub)) as client:
        patch()
        base = "/api/entities/demo.light_livingroom/stream"
        assert client.get(f"{base}/seg00001.ts").status_code == 401
        assert client.get(f"{base}/seg00001.ts?token=geheim").content == b"videodaten"
        # Alles, was nicht nach einem Häppchen aussieht, wird abgewiesen –
        # sonst käme man über den Namen an andere Dateien des Hubs.
        assert client.get(f"{base}/geheim.yaml?token=geheim").status_code == 404
        assert client.get(f"{base}/..%2f..%2fconfig.yaml?token=geheim").status_code == 404
        assert hub.streams.touched > 0
