"""Der Storen-Check: liest er Zugang und Stellung richtig heraus?

Geprüft wird nur, was ohne Hub prüfbar ist – das Herauslesen aus der
Konfiguration und die Wortwahl in der Spalte «angenommen». Der Abruf
selbst braucht einen laufenden Hub und gehört ins Haus, nicht in die
Testreihe.
"""

from homepilot import storencheck


def test_token_und_port_kommen_aus_der_konfiguration(tmp_path, monkeypatch):
    config = tmp_path / "config.yaml"
    config.write_text(
        "api: { host: 127.0.0.1, port: 8199, token: geheim-123 }\n", encoding="utf-8"
    )
    monkeypatch.setattr(storencheck, "CONFIG", str(config))
    monkeypatch.delenv("TOKEN_STEFAN", raising=False)
    monkeypatch.delenv("HOMEPILOT_TOKEN", raising=False)

    token, port = storencheck.token_und_port()
    assert token == "geheim-123"
    assert port == "8199"


def test_nicht_das_erstbeste_token_aus_der_datei(tmp_path, monkeypatch):
    """Der Grund für den 401 beim ersten Versuch.

    In einer echten config.yaml steht ein halbes Dutzend `token:` – für
    Overkiz, für Ring, fürs Update. Ein Muster nimmt das erste; gemeint
    ist aber das unter `api`.
    """
    config = tmp_path / "config.yaml"
    config.write_text(
        "integrations:\n"
        "  - integration: overkiz\n"
        "    token: das-falsche\n"
        "api:\n"
        "  port: 8199\n"
        "  token: das-richtige\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(storencheck, "CONFIG", str(config))
    monkeypatch.delenv("TOKEN_STEFAN", raising=False)
    monkeypatch.delenv("HOMEPILOT_TOKEN", raising=False)

    token, port = storencheck.token_und_port()
    assert token == "das-richtige"
    assert port == "8199"


def test_die_umgebung_sticht_die_datei(tmp_path, monkeypatch):
    config = tmp_path / "config.yaml"
    config.write_text("api: { port: 8199, token: aus-der-datei }\n", encoding="utf-8")
    monkeypatch.setattr(storencheck, "CONFIG", str(config))
    monkeypatch.setenv("HOMEPILOT_TOKEN", "aus-der-umgebung")

    token, _ = storencheck.token_und_port()
    assert token == "aus-der-umgebung"


def test_ohne_konfiguration_bleibt_der_standardport(tmp_path, monkeypatch):
    monkeypatch.setattr(storencheck, "CONFIG", str(tmp_path / "gibts-nicht.yaml"))
    monkeypatch.setenv("HOMEPILOT_TOKEN", "t")

    token, port = storencheck.token_und_port()
    assert (token, port) == ("t", "8123")


def test_angenommen_wird_auf_deutsch_geschrieben():
    # «True» in einer Spalte, die «angenommen» heisst, liest sich wie ein
    # Fehler. Ein «ja» oder «nein» beantwortet die Frage.
    assert storencheck.ja_nein(True) == "ja"
    assert storencheck.ja_nein(False) == "nein"
    assert storencheck.ja_nein(None) == "nein"


def test_ohne_api_token_hilft_ein_benutzer_aus_der_datendatei(tmp_path, monkeypatch):
    """Nicht jede Anlage hat ein festes Token in der Konfiguration.

    Wer seine Zugänge in der App verwaltet, hat keines - die Token der
    Benutzer stehen dann in der Datendatei. Ohne diesen Rückfall endet
    der Aufruf dort in einem 401.
    """
    config = tmp_path / "config.yaml"
    config.write_text("api: { port: 8123 }\n", encoding="utf-8")
    daten = tmp_path / "homepilot-data.json"
    daten.write_text(
        '{"users": [{"name": "Stefan", "token": "aus-der-datendatei"}]}', encoding="utf-8"
    )
    monkeypatch.setattr(storencheck, "CONFIG", str(config))
    monkeypatch.setattr(storencheck, "DATEN", str(daten))
    monkeypatch.delenv("TOKEN_STEFAN", raising=False)
    monkeypatch.delenv("HOMEPILOT_TOKEN", raising=False)

    token, _ = storencheck.token_und_port()
    assert token == "aus-der-datendatei"


def test_ohne_alles_bleibt_das_token_leer(tmp_path, monkeypatch):
    monkeypatch.setattr(storencheck, "CONFIG", str(tmp_path / "weg.yaml"))
    monkeypatch.setattr(storencheck, "DATEN", str(tmp_path / "auch-weg.json"))
    monkeypatch.delenv("TOKEN_STEFAN", raising=False)
    monkeypatch.delenv("HOMEPILOT_TOKEN", raising=False)

    assert storencheck.token_und_port() == ("", "8123")
