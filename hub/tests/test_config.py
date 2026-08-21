import pytest

from homepilot.core.config import expand_env, load_config
from homepilot.core.errors import ConfigError

CONFIG = """
api:
  port: 9000
  token: "${TEST_TOKEN}"
supabase:
  url: "https://demo.supabase.co"
  service_key: "${TEST_KEY}"
integrations:
  - integration: demo
automations: []
"""


def test_load_config_expands_env(tmp_path, monkeypatch):
    monkeypatch.setenv("TEST_TOKEN", "geheim")
    monkeypatch.setenv("TEST_KEY", "service-key")
    path = tmp_path / "config.yaml"
    path.write_text(CONFIG, encoding="utf-8")

    config = load_config(path)
    assert config.api.port == 9000
    assert config.api.token == "geheim"
    assert config.supabase["service_key"] == "service-key"
    assert config.integrations == [{"integration": "demo"}]


def test_missing_env_var_raises(tmp_path, monkeypatch):
    monkeypatch.delenv("TEST_TOKEN", raising=False)
    monkeypatch.setenv("TEST_KEY", "x")
    path = tmp_path / "config.yaml"
    path.write_text(CONFIG, encoding="utf-8")

    with pytest.raises(ConfigError, match="TEST_TOKEN"):
        load_config(path)


def test_expand_env_is_recursive(monkeypatch):
    monkeypatch.setenv("HOST", "1.2.3.4")
    assert expand_env({"a": [{"b": "${HOST}:8123"}]}) == {"a": [{"b": "1.2.3.4:8123"}]}


def test_missing_file_raises():
    with pytest.raises(ConfigError):
        load_config("/gibt/es/nicht.yaml")


def test_a_public_url_without_a_scheme_is_refused(tmp_path):
    """Sonst verschickt der Hub eine Nachricht mit einem leeren Kasten,
    wo das Kamerabild sein sollte – und niemand sieht, warum."""
    path = tmp_path / "config.yaml"
    path.write_text(
        "integrations:\n  - integration: demo\npush:\n  public_url: haus.example.ch\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="public_url"):
        load_config(path)


def test_a_proper_public_url_is_kept(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "integrations:\n  - integration: demo\n"
        "push:\n  public_url: https://haus.example.ch\n",
        encoding="utf-8",
    )
    assert load_config(path).push == {"public_url": "https://haus.example.ch"}


def test_without_the_section_there_is_no_picture_in_the_message(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("integrations:\n  - integration: demo\n", encoding="utf-8")
    assert load_config(path).push == {}


def test_duplicate_keys_are_reported_not_swallowed():
    """YAML nimmt bei doppeltem Schlüssel wortlos den letzten.

    Steht ``energy:`` zweimal in der Datei, gilt der zweite Preis – ohne
    Fehler, ohne Warnung. Genau so sucht man den falschen Betrag wochenlang
    an der falschen Stelle.
    """
    from homepilot.core.config import read_yaml

    data, duplicates = read_yaml(
        "energy:\n"
        "  price_per_kwh: 0.2541\n"
        "rooms: {}\n"
        "energy:\n"
        "  price_per_kwh: 0.32\n"
    )
    assert data["energy"]["price_per_kwh"] == 0.32
    assert [entry.split(" ")[0] for entry in duplicates] == ["energy"]
    # Die Zeilennummer gehört dazu, sonst sucht man in 300 Zeilen.
    assert "Zeile 4" in duplicates[0]

    # Auch verschachtelt, und saubere Dateien melden nichts.
    _, nested = read_yaml("supabase:\n  url: a\n  url: b\n")
    assert [entry.split(" ")[0] for entry in nested] == ["url"]
    assert read_yaml("a: 1\nb: 2\n")[1] == []

    # Ein Schlüssel darf in verschiedenen Blöcken gleich heissen.
    assert read_yaml("a:\n  name: x\nb:\n  name: y\n")[1] == []


def test_secrets_file_next_to_the_config(tmp_path):
    """Geheimnisse ohne Umweg über die compose-Datei.

    Der Weg über Umgebungsvariablen kostete bei Portainer jedes Mal einen
    Commit: Die Variable im Stack allein genügt nicht, sie muss zusätzlich
    in der environment-Liste der compose-Datei stehen - und die liegt im
    Repository.
    """
    from homepilot.core.config import load_config, read_secrets

    (tmp_path / "secrets.env").write_text(
        "# Kommentar\n"
        "\n"
        "TUYA_KEY=geheim123\n"
        'MIT_ANFUEHRUNG="auch geheim"\n'
        "OHNE_GLEICH\n"
        "  MIT_LEERRAUM  =  getrimmt  \n",
        encoding="utf-8",
    )
    werte = read_secrets(tmp_path / "secrets.env")
    assert werte == {
        "TUYA_KEY": "geheim123",
        "MIT_ANFUEHRUNG": "auch geheim",
        "MIT_LEERRAUM": "getrimmt",
    }
    # Eine fehlende Datei ist kein Fehler, sondern der Normalfall.
    assert read_secrets(tmp_path / "gibtsnicht.env") == {}

    (tmp_path / "config.yaml").write_text(
        "integrations:\n"
        "  - integration: tuya\n"
        "    devices:\n"
        "      - name: Projektor\n"
        "        id: bf1\n"
        '        key: "${TUYA_KEY}"\n',
        encoding="utf-8",
    )
    config = load_config(tmp_path / "config.yaml")
    assert config.integrations[0]["devices"][0]["key"] == "geheim123"


def test_real_environment_beats_the_secrets_file(tmp_path, monkeypatch):
    """Was im Container gesetzt ist, gewinnt – sonst überschriebe eine
    vergessene Zeile in der Datei still den echten Wert."""
    from homepilot.core.config import load_config

    (tmp_path / "secrets.env").write_text("TUYA_KEY=aus_datei\n", encoding="utf-8")
    (tmp_path / "config.yaml").write_text(
        'integrations:\n  - integration: tuya\n    key: "${TUYA_KEY}"\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("TUYA_KEY", "aus_umgebung")
    config = load_config(tmp_path / "config.yaml")
    assert config.integrations[0]["key"] == "aus_umgebung"


def test_missing_variable_names_both_ways(tmp_path):
    """Die Meldung muss den einfachen Weg zuerst nennen."""
    import pytest

    from homepilot.core.config import ConfigError, load_config

    (tmp_path / "config.yaml").write_text(
        'integrations:\n  - integration: tuya\n    key: "${FEHLT}"\n', encoding="utf-8"
    )
    with pytest.raises(ConfigError) as fehler:
        load_config(tmp_path / "config.yaml")
    text = str(fehler.value)
    assert "secrets.env" in text
    assert "FEHLT" in text
    assert "docker-compose" in text
