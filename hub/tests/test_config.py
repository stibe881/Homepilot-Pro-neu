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
