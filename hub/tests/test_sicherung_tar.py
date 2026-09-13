"""Die Sicherung sichert den ganzen Hub, nicht eine Datei (Punkt 593).

Der Befund: Täglich und offsite gesichert wurde nur die
homepilot-data.json. Daneben lagen und fehlten Gutschein-PDFs, Rezept-,
Personen- und Raumbilder, der Grundriss, der Anrufbeantworter, die
Token-Dateien der Dienste, config.yaml und secrets.env. Nach einem
Plattenschaden zeigten Gutscheine ins Leere, und vier Dienste wollten
neu angemeldet werden.
"""

from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import (
    bilder,
    confighistory,
    dateien,
    heimgruss,
    offsite,
    personenbilder,
    raumbilder,
    tokenstore,
)
from homepilot.core.config import load_config
from homepilot.core.hub import Hub
from homepilot.core.persistence import (
    ARCHIV_DATENDATEI,
    BEILAGEN_DATEIEN,
    BEILAGEN_ORDNER,
    DataStore,
    archivname_erlaubt,
    beilagen,
)


def _haushalt(tmp_path: Path) -> DataStore:
    """Ein Datenordner, wie er im Betrieb aussieht - samt dem, was nicht
    in die Sicherung gehört."""
    ordner = tmp_path / "config"
    ordner.mkdir()
    (ordner / "personenbilder").mkdir()
    (ordner / "personenbilder" / "anna.jpg").write_bytes(b"JPG")
    (ordner / "gutscheindateien").mkdir()
    (ordner / "gutscheindateien" / "g1-abc.pdf").write_bytes(b"%PDF")
    (ordner / "config-history").mkdir()
    (ordner / "config-history" / "2026-01-01_120000.yaml").write_text("a: 1")
    (ordner / "spotify-token.json").write_text('{"refresh": "x"}')
    (ordner / "geraete-verlauf.json").write_text("[]")
    (ordner / "config.yaml").write_text("api: {}")
    (ordner / "secrets.env").write_text("KEY=1")
    # Nicht dabei: das Clip-Archiv, der Log-Ring, die Sicherungen selbst -
    # und der Quellbaum, falls die Daten in der Entwicklung daneben liegen.
    (ordner / "cliparchiv").mkdir()
    (ordner / "cliparchiv" / "clip.mp4").write_bytes(b"MP4" * 100)
    (ordner / "log-uebergabe.json").write_text("[]")
    (ordner / "homepilot").mkdir()
    (ordner / "homepilot" / "hub.py").write_text("print()")
    store = DataStore(ordner / "homepilot-data.json")
    store.load()
    store.set("users", [{"name": "Anna", "role": "besitzer", "token": "t"}])
    store.set("automations", [{"id": "a1", "alias": "Flurlicht"}])
    return store


def _namen(pfad: Path) -> list[str]:
    with tarfile.open(pfad, mode="r:gz") as archiv:
        return sorted(m.name for m in archiv.getmembers())


def test_die_sicherung_nimmt_alles_mit_was_neben_den_daten_liegt(tmp_path):
    store = _haushalt(tmp_path)
    gemacht = store.backup()
    assert gemacht is not None and gemacht["name"].endswith(".tar.gz")
    namen = _namen(tmp_path / "config" / "backups" / gemacht["name"])
    assert namen == [
        "config-history/2026-01-01_120000.yaml",
        "config.yaml",
        "geraete-verlauf.json",
        "gutscheindateien/g1-abc.pdf",
        ARCHIV_DATENDATEI,
        "personenbilder/anna.jpg",
        "secrets.env",
        "spotify-token.json",
    ]


def test_der_quellbaum_und_die_clips_bleiben_draussen(tmp_path):
    """Eine Erlaubnisliste, keine Sperrliste: In der Entwicklung liegt die
    Datendatei neben dem ganzen Quellbaum."""
    store = _haushalt(tmp_path)
    gemacht = store.backup()
    assert gemacht is not None
    namen = _namen(tmp_path / "config" / "backups" / gemacht["name"])
    assert not any(name.startswith(("cliparchiv", "homepilot/", "backups")) for name in namen)
    assert "log-uebergabe.json" not in namen


def test_die_konfiguration_kommt_aus_ihrem_eigenen_ordner(tmp_path):
    """data_file kann in der config.yaml woanders hinzeigen - dann liegen
    config.yaml und secrets.env nicht neben den Daten."""
    daten = tmp_path / "daten"
    daten.mkdir()
    konfig = tmp_path / "konfig"
    konfig.mkdir()
    (konfig / "config.yaml").write_text("api: {}")
    (daten / "raumbilder").mkdir()
    (daten / "raumbilder" / "kueche.jpg").write_bytes(b"JPG")
    liste = beilagen(daten, konfig)
    assert [arc for _, arc in liste] == ["raumbilder/kueche.jpg", "config.yaml"]


def test_zurueckspielen_bringt_die_beilagen_zurueck_auf_einen_leeren_hub(tmp_path):
    """Die Übung aus deploy/README.md: neue Platte, nichts da. Sicherung in
    den Ordner legen, zurückspielen - und die Gutschein-PDFs sind wieder da."""
    quelle = _haushalt(tmp_path)
    gemacht = quelle.backup()
    assert gemacht is not None
    payload = quelle.backup_bytes(gemacht["name"])

    neu = tmp_path / "neu"
    neu.mkdir()
    ziel = DataStore(neu / "homepilot-data.json")
    ziel.load()
    abgelegt = ziel.backup_ablegen(gemacht["name"], payload)
    ergebnis = ziel.restore_backup(abgelegt["name"])
    assert ergebnis["beilagen"] == 7
    assert [user["name"] for user in ziel.get("users")] == ["Anna"]
    assert (neu / "gutscheindateien" / "g1-abc.pdf").read_bytes() == b"%PDF"
    assert (neu / "personenbilder" / "anna.jpg").read_bytes() == b"JPG"
    assert (neu / "spotify-token.json").read_text() == '{"refresh": "x"}'
    assert (neu / "config.yaml").read_text() == "api: {}"
    # Und auf der Platte steht der zurückgespielte Stand, nicht der leere.
    auf_platte = json.loads((neu / "homepilot-data.json").read_text("utf-8"))
    assert auf_platte["automations"] == [{"id": "a1", "alias": "Flurlicht"}]


def test_die_konfiguration_landet_wieder_in_ihrem_ordner(tmp_path):
    daten = tmp_path / "daten"
    konfig = tmp_path / "konfig"
    daten.mkdir()
    konfig.mkdir()
    (konfig / "config.yaml").write_text("api: {port: 1}")
    quelle = DataStore(daten / "homepilot-data.json")
    quelle.config_dir = konfig
    quelle.load()
    gemacht = quelle.backup()
    assert gemacht is not None

    neu_daten = tmp_path / "neu-daten"
    neu_konfig = tmp_path / "neu-konfig"
    neu_daten.mkdir()
    neu_konfig.mkdir()
    ziel = DataStore(neu_daten / "homepilot-data.json")
    ziel.config_dir = neu_konfig
    ziel.load()
    ziel.backup_ablegen(gemacht["name"], quelle.backup_bytes(gemacht["name"]))
    ziel.restore_backup(gemacht["name"])
    assert (neu_konfig / "config.yaml").read_text() == "api: {port: 1}"
    assert not (neu_daten / "config.yaml").exists()


def test_alte_einzeldatei_sicherungen_bleiben_lesbar(tmp_path):
    """Vierzehn Tage lang liegen die JSON-Sicherungen von vor Punkt 593
    noch im Ordner - und sie müssen zurückspielbar bleiben."""
    store = _haushalt(tmp_path)
    alt = tmp_path / "config" / "backups" / "homepilot-data-2026-09-01_030000.json"
    alt.parent.mkdir(exist_ok=True)
    alt.write_text(json.dumps({"users": [], "automations": [{"id": "alt"}]}))
    assert any(entry["name"] == alt.name for entry in store.backups())
    store.restore_backup(alt.name)
    assert store.get("automations") == [{"id": "alt"}]


def test_die_frist_zaehlt_alte_und_neue_sicherungen_gemeinsam(tmp_path):
    store = _haushalt(tmp_path)
    ordner = tmp_path / "config" / "backups"
    ordner.mkdir(exist_ok=True)
    for tag in range(1, 5):
        (ordner / f"homepilot-data-2026-08-0{tag}_030000.json").write_text("{}")
    store.backup(keep=3)
    assert len(store.backups()) == 3
    # Die jüngste - das frische Archiv - ist dabei.
    assert store.backups()[0]["name"].endswith(".tar.gz")


def test_boese_namen_im_archiv_bleiben_draussen(tmp_path):
    """Ein Archiv kann hochgeladen sein - jeder Name darin ist Eingabe."""
    assert archivname_erlaubt("personenbilder/anna.jpg")
    assert archivname_erlaubt("config-history/2026.yaml")
    assert archivname_erlaubt("spotify-token.json")
    assert archivname_erlaubt("config.yaml")
    assert not archivname_erlaubt("../etc/passwd")
    assert not archivname_erlaubt("/etc/passwd")
    assert not archivname_erlaubt("personenbilder/../../x")
    assert not archivname_erlaubt("homepilot/hub.py")
    assert not archivname_erlaubt("token.json")
    assert not archivname_erlaubt("")

    # Und im Ganzen: ein gebasteltes Archiv mit einem Ausbruchsversuch.
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archiv:
        for name, inhalt in (
            (ARCHIV_DATENDATEI, b'{"users": []}'),
            ("../ausbruch.txt", b"nein"),
            ("personenbilder/ok.jpg", b"JPG"),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(inhalt)
            archiv.addfile(info, io.BytesIO(inhalt))
    ziel = DataStore(tmp_path / "neu" / "homepilot-data.json")
    ziel.load()
    name = "homepilot-data-2026-09-13_000000.tar.gz"
    ziel.backup_ablegen(name, buffer.getvalue())
    ergebnis = ziel.restore_backup(name)
    assert ergebnis["beilagen"] == 1
    assert (tmp_path / "neu" / "personenbilder" / "ok.jpg").exists()
    assert not (tmp_path / "ausbruch.txt").exists()


def test_ablegen_prueft_name_und_inhalt(tmp_path):
    store = DataStore(tmp_path / "homepilot-data.json")
    store.load()
    with pytest.raises(ValueError):
        store.backup_ablegen("../x.json", b"{}")
    with pytest.raises(ValueError):
        store.backup_ablegen("homepilot-data-1.json", b"kein json")
    with pytest.raises(ValueError):
        store.backup_ablegen("homepilot-data-1.json", b'{"foo": 1}')
    with pytest.raises(ValueError):
        store.backup_ablegen("homepilot-data-1.tar.gz", b"kein tar")
    # Ein Name, den es schon gibt, wird nicht überschrieben.
    erst = store.backup_ablegen("homepilot-data-1.json", b'{"users": []}')
    zweit = store.backup_ablegen("homepilot-data-1.json", b'{"users": [1]}')
    assert erst["name"] == "homepilot-data-1.json"
    assert zweit["name"] == "homepilot-data-1-2.json"


def test_die_beilagenliste_kennt_jeden_ordner_den_ein_modul_anlegt(tmp_path):
    """Der Abgleich: Wer einen neuen Ordner neben die Daten legt, muss ihn
    in die Sicherung aufnehmen - sonst fehlt er nach dem Plattenschaden,
    und niemand merkt es vorher."""
    daten = str(tmp_path / "homepilot-data.json")
    ordner = set(BEILAGEN_ORDNER)
    for name in (*bilder.ORDNER.values(), *dateien.ORDNER.values()):
        assert name in ordner, f"bilder/dateien-Ordner «{name}» fehlt in BEILAGEN_ORDNER"
    for modul in (personenbilder, raumbilder):
        pfad = modul.ordner(daten)
        assert pfad is not None and pfad.name in ordner, f"{modul.__name__} fehlt"
    assert confighistory.folder(tmp_path / "config.yaml").name in ordner
    assert heimgruss.AUDIO_NAME in BEILAGEN_DATEIEN
    assert archivname_erlaubt(tokenstore.token_file(daten, None, "google").name)


def test_das_archiv_geht_als_gzip_in_den_bucket():
    assert offsite.content_type("homepilot-data-2026.tar.gz") == "application/gzip"
    assert offsite.content_type("homepilot-data-2026.json") == "application/json"
    assert offsite.sicherungsnamen(
        [
            {"name": "homepilot-data-2026-09-01_030000.json"},
            {"name": "matter-fabrik-2026-09-02.tar.gz"},
            {"name": "homepilot-data-2026-09-02_030000.tar.gz"},
        ]
    ) == [
        "homepilot-data-2026-09-02_030000.tar.gz",
        "homepilot-data-2026-09-01_030000.json",
    ]


# ── Die Routen ───────────────────────────────────────────────────────────

CONFIG = """
api:
  host: 127.0.0.1
  port: 8123
  token: t-owner
integrations:
  - integration: demo
automations: []
data_file: {data_file}
"""


@pytest.fixture
def client(tmp_path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(CONFIG.format(data_file=tmp_path / "homepilot-data.json"))
    hub = Hub(load_config(config_file))
    with TestClient(create_app(hub)) as test_client:
        test_client.hub = hub
        yield test_client


AUTH = {"Authorization": "Bearer t-owner"}


def test_eine_hochgeladene_sicherung_liegt_danach_im_ordner(client):
    antwort = client.post(
        "/api/system/backups/upload?name=homepilot-data-2026-09-13_010203.json",
        content=b'{"users": [], "automations": [{"id": "x"}]}',
        headers=AUTH,
    )
    assert antwort.status_code == 200, antwort.text
    assert antwort.json()["backup"]["name"] == "homepilot-data-2026-09-13_010203.json"
    namen = [entry["name"] for entry in client.get("/api/system/backups", headers=AUTH).json()["backups"]]
    assert "homepilot-data-2026-09-13_010203.json" in namen


def test_ein_falscher_upload_wird_abgewiesen(client):
    antwort = client.post(
        "/api/system/backups/upload?name=beliebig.txt", content=b"x", headers=AUTH
    )
    assert antwort.status_code == 400
    assert antwort.json()["detail"].startswith("Kein Sicherungsname")


def test_ohne_bucket_gibt_es_nichts_zurueckzuholen(client):
    assert client.get("/api/system/backups", headers=AUTH).json()["offsite_moeglich"] is False
    assert client.get("/api/system/backups/offsite", headers=AUTH).status_code == 400
    antwort = client.post(
        "/api/system/backups/offsite/homepilot-data-1.json/fetch", headers=AUTH
    )
    assert antwort.status_code == 400


def test_aus_dem_bucket_holen_legt_die_sicherung_in_den_ordner(client, monkeypatch):
    client.hub.config.supabase = {"url": "https://x.supabase.co", "service_key": "srv"}

    async def fake_liste(url, key, bucket):
        assert (url, key, bucket) == ("https://x.supabase.co", "srv", "backups")
        return ["homepilot-data-2026-09-12_030000.json"]

    async def fake_download(url, key, bucket, name):
        assert name == "homepilot-data-2026-09-12_030000.json"
        return b'{"users": [], "automations": [{"id": "aus-dem-bucket"}]}'

    monkeypatch.setattr(offsite, "liste", fake_liste)
    monkeypatch.setattr(offsite, "download", fake_download)
    assert client.get("/api/system/backups", headers=AUTH).json()["offsite_moeglich"] is True
    liste = client.get("/api/system/backups/offsite", headers=AUTH)
    assert liste.status_code == 200
    assert liste.json()["names"] == ["homepilot-data-2026-09-12_030000.json"]
    geholt = client.post(
        "/api/system/backups/offsite/homepilot-data-2026-09-12_030000.json/fetch",
        headers=AUTH,
    )
    assert geholt.status_code == 200, geholt.text
    assert geholt.json()["backup"]["name"] == "homepilot-data-2026-09-12_030000.json"
    # Ein Name, der keiner ist, kommt gar nicht bis zum Bucket.
    assert (
        client.post("/api/system/backups/offsite/..%2Fx.json/fetch", headers=AUTH).status_code
        in (400, 404)
    )
