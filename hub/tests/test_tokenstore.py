"""Der eine Umgang mit den Token-Dateien der Integrationen."""

import json

from homepilot.core import tokenstore


def test_path_resolution_prefers_the_config(tmp_path):
    eigene = tokenstore.token_file(str(tmp_path / "daten.json"), {"token_file": "/tmp/x.json"}, "ring")
    assert str(eigene) == "/tmp/x.json"
    standard = tokenstore.token_file(str(tmp_path / "daten.json"), {}, "ring")
    assert standard == tmp_path / "ring-token.json"
    # Auch ganz ohne Konfigurationsblock (CLI-Helfer ohne config-Eintrag).
    assert tokenstore.token_file(str(tmp_path / "daten.json"), None, "google").name == "google-token.json"


def test_save_is_atomic_owner_only_and_load_survives_garbage(tmp_path):
    file = tmp_path / "ring-token.json"
    tokenstore.save(file, {"token": {"access": "a"}})
    assert oct(file.stat().st_mode)[-3:] == "600"
    assert list(tmp_path.glob("*.tmp")) == []
    assert tokenstore.load(file) == {"token": {"access": "a"}}
    assert tokenstore.value(file, "fehlt") is None

    # Kaputt heisst «neu anmelden», nicht «Hub bleibt stehen».
    file.write_text("{kein json")
    assert tokenstore.load(file) is None
    assert tokenstore.load(tmp_path / "gibtsnicht.json") is None
    (tmp_path / "liste.json").write_text(json.dumps([1, 2]))
    assert tokenstore.load(tmp_path / "liste.json") is None
