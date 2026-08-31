"""Die Off-Site-Sicherung – und die Probe, dass sie zurückkommt.

Punkt 6 der Werkbank-Liste: Eine Sicherung, die nie zurückgespielt
wurde, ist eine Vermutung. Der Rundlauf hier ist die automatisierte
Fassung der jährlichen Übung – Herunterladen und Einspielen von Hand
steht in deploy/README.md.
"""

import json

from homepilot.core.offsite import matter_tar
from homepilot.core.persistence import DataStore


def test_a_backup_restores_a_household_on_an_empty_hub(tmp_path):
    """Benutzer, Abläufe, Szenen – alles, was die Off-Site-Kopie trägt,
    muss auf einem leeren Hub wieder zum Haushalt werden."""
    quelle = DataStore(tmp_path / "alt" / "homepilot-data.json")
    quelle.load()
    quelle.set("users", [{"name": "Stefan", "role": "besitzer", "token": "t"}])
    quelle.set("automations", [{"id": "a1", "alias": "Flurlicht"}])
    quelle.set("scenes", [{"id": "s1", "name": "Kino", "actions": []}])
    gemacht = quelle.backup()
    assert gemacht is not None
    # Das ist exakt der Inhalt, der zu Supabase hochgeladen wird.
    payload = quelle.backup_bytes(gemacht["name"])

    # «Leerer Hub»: neue Platte, nichts da. Die Übung: Datei aus dem
    # Bucket holen, an den Datenpfad legen, starten.
    ziel_pfad = tmp_path / "neu" / "homepilot-data.json"
    ziel_pfad.parent.mkdir(parents=True)
    ziel_pfad.write_bytes(payload)

    ziel = DataStore(ziel_pfad)
    ziel.load()
    assert [user["name"] for user in ziel.get("users")] == ["Stefan"]
    assert [auto["alias"] for auto in ziel.get("automations")] == ["Flurlicht"]
    assert [scene["name"] for scene in ziel.get("scenes")] == ["Kino"]
    # Und es ist gültiges JSON geblieben – kein Transportschaden.
    json.loads(payload)


def test_the_matter_factory_travels_as_a_tarball(tmp_path):
    """hub/matter/ trägt die Schlüssel aller gekoppelten Geräte – ohne
    sie heisst ein Plattenschaden: jedes Gerät neu koppeln."""
    import io
    import tarfile

    matter = tmp_path / "matter"
    (matter / "certs").mkdir(parents=True)
    (matter / "fabric.json").write_text('{"id": 1}', encoding="utf-8")
    (matter / "certs" / "device.pem").write_text("PEM", encoding="utf-8")

    daten = matter_tar(str(matter))
    assert daten is not None
    with tarfile.open(fileobj=io.BytesIO(daten), mode="r:gz") as archiv:
        namen = sorted(archiv.getnames())
    assert namen == ["certs/device.pem", "fabric.json"]


def test_no_factory_no_tarball(tmp_path):
    assert matter_tar(str(tmp_path / "gibtsnicht")) is None
    leer = tmp_path / "leer"
    leer.mkdir()
    assert matter_tar(str(leer)) is None


def test_bucket_fehlt_erkennt_beide_schreibweisen():
    from homepilot.core.offsite import bucket_fehlt

    # Der Fall aus dem Betrieb: Supabase meldet den fehlenden Bucket als
    # 400 mit «Bucket not found» und Code «NoSuchBucket».
    assert bucket_fehlt(
        '{"statusCode":"404","error":"Bucket not found",'
        '"message":"Bucket not found","code":"NoSuchBucket"}'
    )
    assert bucket_fehlt('{"code":"NoSuchBucket"}')
    assert not bucket_fehlt('{"error":"invalid signature"}')
    assert not bucket_fehlt("")
