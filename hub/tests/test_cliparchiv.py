"""Das Kamera-Clip-Archiv (Punkt 256 der Werkbank).

Der Fall dahinter: Der Alarm-Mitschnitt lebte nur im
Schnappschuss-Speicher und war nach zehn Minuten weg - genau dann, wenn
man ihn jemandem zeigen wollte.
"""

import asyncio
import os
import time

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import cliparchiv
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.entity import Entity, EntityKind
from homepilot.core.hub import Hub
from homepilot.integrations import alarm as alarm_module

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}
GUEST = {"name": "Gast", "role": "gast", "token": "t-guest"}

# Sieht für media_type nach MP4 aus - mehr braucht das Archiv nicht.
VIDEO = b"\x00\x00\x00\x18ftypisom-testvideo"


def kamera(entity_id: str, room: str | None = None) -> Entity:
    return Entity(
        id=entity_id,
        kind=EntityKind.CAMERA,
        name="Eingang",
        integration="demo",
        state={"motion": "off"},
        commands=[],
        room=room,
    )


# ── Reine Entscheidungslogik ───────────────────────────────────────────────


def test_eintrag_traegt_raum_und_integration_der_kamera_mit():
    meta = cliparchiv.eintrag(
        kennung="20260906-120000-abcdef01",
        camera="unifi_protect.eingang",
        anlass="alarm",
        jetzt=1000.0,
        name="Eingang",
        room="Flur",
        groesse=7,
    )
    assert meta["camera"] == "unifi_protect.eingang"
    assert meta["room"] == "Flur"
    # Aus der Kennung abgeleitet, wenn niemand sie nennt: Ein Clip
    # überlebt seine Kamera, die Sichtbarkeitsprüfung braucht sie trotzdem.
    assert meta["integration"] == "unifi_protect"
    assert meta["anlass"] == "alarm"
    assert meta["bytes"] == 7


def test_abgelaufen_nimmt_nur_das_alte_und_das_kaputte():
    jetzt = 20 * 86400.0
    eintraege = [
        {"id": "20260901-000000-aaaaaaaa", "at": jetzt - 15 * 86400},
        {"id": "20260905-000000-bbbbbbbb", "at": jetzt - 5 * 86400},
        # Ohne lesbaren Zeitpunkt: kaputt, und Kaputtes bleibt nicht ewig.
        {"id": "20260905-000000-cccccccc", "at": "gestern"},
    ]
    weg = cliparchiv.abgelaufen(eintraege, jetzt, tage=14)
    assert "20260901-000000-aaaaaaaa" in weg
    assert "20260905-000000-bbbbbbbb" not in weg
    assert "20260905-000000-cccccccc" in weg


def test_frist_faellt_auf_die_vorgabe_zurueck_und_wird_begrenzt():
    assert cliparchiv.frist_tage(None) == cliparchiv.FRIST_TAGE
    assert cliparchiv.frist_tage([{"retention_days": "bald"}]) == cliparchiv.FRIST_TAGE
    assert cliparchiv.frist_tage([{"retention_days": 30}]) == 30
    assert cliparchiv.frist_tage([{"retention_days": 0}]) == cliparchiv.FRIST_MIN
    assert cliparchiv.frist_tage([{"retention_days": 9999}]) == cliparchiv.FRIST_MAX


# ── Ablage auf der Platte ──────────────────────────────────────────────────


def lege_clip(folder, alter_sekunden: float = 0.0, anlass: str = "alarm"):
    kennung = cliparchiv.neue_kennung(time.time() - alter_sekunden)
    meta = cliparchiv.eintrag(
        kennung=kennung,
        camera="demo.kamera",
        anlass=anlass,
        jetzt=time.time() - alter_sekunden,
        name="Eingang",
        room="Flur",
        integration="demo",
    )
    assert cliparchiv.ablegen(folder, VIDEO, meta) is not None
    return kennung


def test_ablegen_und_wiederfinden_mit_metadaten(tmp_path):
    folder = tmp_path / "cliparchiv"
    kennung = lege_clip(folder)
    eintraege = cliparchiv.liste(folder)
    assert [meta["id"] for meta in eintraege] == [kennung]
    assert eintraege[0]["camera"] == "demo.kamera"
    assert eintraege[0]["anlass"] == "alarm"
    assert eintraege[0]["bytes"] == len(VIDEO)
    assert cliparchiv.lesen(folder, kennung) == VIDEO
    assert cliparchiv.metadaten(folder, kennung)["room"] == "Flur"


def test_loeschen_entfernt_video_und_metadaten(tmp_path):
    folder = tmp_path / "cliparchiv"
    kennung = lege_clip(folder)
    assert cliparchiv.loeschen(folder, kennung) is True
    assert cliparchiv.liste(folder) == []
    assert cliparchiv.lesen(folder, kennung) is None
    assert cliparchiv.loeschen(folder, kennung) is False


def test_boese_kennungen_kommen_nicht_an_dateien(tmp_path):
    # Die Kennung kommt aus einer URL - ohne Prüfung wäre sie ein Fenster
    # auf beliebige Dateien des Hubs.
    folder = tmp_path / "cliparchiv"
    folder.mkdir()
    (tmp_path / "geheim.mp4").write_bytes(VIDEO)
    assert cliparchiv.lesen(folder, "../geheim") is None
    assert cliparchiv.loeschen(folder, "../geheim") is False


def test_aufraeumlauf_loescht_nur_abgelaufenes(tmp_path):
    folder = tmp_path / "cliparchiv"
    alt = lege_clip(folder, alter_sekunden=15 * 86400)
    frisch = lege_clip(folder, alter_sekunden=5 * 86400)
    weg = cliparchiv.aufraeumen(folder, time.time(), tage=14)
    assert weg == 1
    uebrig = [meta["id"] for meta in cliparchiv.liste(folder)]
    assert uebrig == [frisch]
    assert alt not in uebrig


def test_aufraeumlauf_nimmt_herrenlose_videos_mit(tmp_path):
    folder = tmp_path / "cliparchiv"
    folder.mkdir()
    # Ein Video ohne Metadaten (halb geschriebene Ablage) - alt genug.
    verwaist = folder / "20200101-000000-deadbeef.mp4"
    verwaist.write_bytes(VIDEO)
    alt = time.time() - 15 * 86400
    os.utime(verwaist, (alt, alt))
    assert cliparchiv.aufraeumen(folder, time.time(), tage=14) == 1
    assert not verwaist.exists()


# ── Der Alarm legt einen Clip an ───────────────────────────────────────────


def make_hub(tmp_path) -> Hub:
    return Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            users=[OWNER, GUEST],
            data_file=str(tmp_path / "daten.json"),
        )
    )


def test_ausgeloester_alarm_legt_den_clip_ins_archiv(tmp_path, monkeypatch):
    async def run():
        hub = make_hub(tmp_path)
        await hub.start()
        await hub.registry.add(kamera("demo.kamera", room="Flur"))

        # Die Kamera «liefert» RTSP, und der Mitschnitt kommt ohne ffmpeg.
        async def fake_stream_url(entity):
            return "rtsp://kamera.test/stream"

        hub.integrations.get("demo").stream_url = fake_stream_url

        async def fake_record_clip(source, seconds):
            return VIDEO

        monkeypatch.setattr(alarm_module.streams, "record_clip", fake_record_clip)

        service = hub.integrations.get("alarm")
        await service.update_config(
            {
                "sensors": [{"entity_id": "demo.kamera", "modes": ["ausser_haus"]}],
                "settings": {"exit_delay": 0, "notify_trigger": False},
            }
        )
        await service.arm("ausser_haus")
        await hub.registry.update_state("demo.kamera", {"motion": "on"})
        await asyncio.sleep(0)
        if service._clip_task is not None:
            await service._clip_task
        eintraege = cliparchiv.liste(cliparchiv.ordner(hub.config.data_file))
        await hub.stop()
        return eintraege

    eintraege = asyncio.run(run())
    assert len(eintraege) == 1
    assert eintraege[0]["camera"] == "demo.kamera"
    assert eintraege[0]["anlass"] == "alarm"
    assert eintraege[0]["room"] == "Flur"
    assert eintraege[0]["bytes"] == len(VIDEO)


# ── Routen und Rechte ──────────────────────────────────────────────────────


def auth(token: str = "t-owner") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_clip_routen_liste_video_und_loeschen(tmp_path):
    hub = make_hub(tmp_path)
    folder = cliparchiv.ordner(hub.config.data_file)
    kennung = lege_clip(folder)
    with TestClient(create_app(hub)) as client:
        liste = client.get("/api/clips", headers=auth())
        assert liste.status_code == 200
        body = liste.json()
        assert [meta["id"] for meta in body["clips"]] == [kennung]
        assert body["retention_days"] == cliparchiv.FRIST_TAGE

        video = client.get(f"/api/clips/{kennung}", headers=auth())
        assert video.status_code == 200
        assert video.headers["content-type"] == "video/mp4"
        assert video.content == VIDEO

        # Videoplayer fragen in Bereichen - ohne 206 spielt AVPlayer nicht.
        stueck = client.get(
            f"/api/clips/{kennung}", headers={**auth(), "Range": "bytes=0-3"}
        )
        assert stueck.status_code == 206
        assert stueck.content == VIDEO[:4]

        weg = client.delete(f"/api/clips/{kennung}", headers=auth())
        assert weg.status_code == 200 and weg.json()["removed"] is True
        assert client.get(f"/api/clips/{kennung}", headers=auth()).status_code == 404


def test_gast_ohne_kamerafreigabe_sieht_keine_clips(tmp_path):
    hub = make_hub(tmp_path)
    kennung = lege_clip(cliparchiv.ordner(hub.config.data_file))
    with TestClient(create_app(hub)) as client:
        liste = client.get("/api/clips", headers=auth("t-guest"))
        assert liste.status_code == 200
        # Unsichtbar heisst: gar nicht in der Liste, nicht bloss gesperrt.
        assert liste.json()["clips"] == []
        # Und der direkte Griff sieht aus wie «gibt es nicht».
        assert (
            client.get(f"/api/clips/{kennung}", headers=auth("t-guest")).status_code
            == 404
        )
        # Löschen dürfen nur Rollen mit edit_devices.
        assert (
            client.delete(f"/api/clips/{kennung}", headers=auth("t-guest")).status_code
            == 403
        )


def test_aufbewahrung_ist_einstellbar(tmp_path):
    hub = make_hub(tmp_path)
    with TestClient(create_app(hub)) as client:
        gesetzt = client.put(
            "/api/clips/einstellungen", headers=auth(), json={"retention_days": 30}
        )
        assert gesetzt.status_code == 200
        assert gesetzt.json()["retention_days"] == 30
        assert client.get("/api/clips", headers=auth()).json()["retention_days"] == 30
        kaputt = client.put(
            "/api/clips/einstellungen", headers=auth(), json={"retention_days": "bald"}
        )
        assert kaputt.status_code == 400
